/// Genesis画像が納品基準を満たしているか機械で判定する。
/// 337枚を人手で見るのは現実的でないので、必ずこれを通してから受け取る。
///
///   pnpm verify:genesis              R2上の全画像を検査
///   DIR=./incoming pnpm verify:genesis   ローカルのディレクトリを検査
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { required } from "./env";

const SIZE = 1024;
/// 四隅の平均輝度がこれを下回ったら、背景が暗いか透過のまま。
const MIN_LUMINANCE = 225;

type Result = { id: number; ok: boolean; reasons: string[] };

async function check(id: number, buf: Buffer): Promise<Result> {
  const reasons: string[] = [];
  const meta = await sharp(buf).metadata();

  if (meta.width !== SIZE || meta.height !== SIZE) reasons.push(`size ${meta.width}x${meta.height}`);
  if (meta.hasAlpha) reasons.push("has alpha (must be flattened)");
  if (meta.format !== "png") reasons.push(`format ${meta.format}`);

  // 焼き込んでから測る。透過のまま測るとRGBが0になり黒と誤判定する。
  const { data, info } = await sharp(buf)
    .flatten({ background: { r: 250, g: 247, b: 242 } })
    .resize(8, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const lum = (at(0, 0) + at(7, 0) + at(0, 7) + at(7, 7)) / 4;
  if (lum < MIN_LUMINANCE) reasons.push(`background luminance ${lum.toFixed(0)} < ${MIN_LUMINANCE}`);

  return { id, ok: reasons.length === 0, reasons };
}

async function main() {
  const dir = process.env.DIR;
  let entries: { id: number; load: () => Promise<Buffer> }[];

  if (dir) {
    const files = await readdir(dir).catch((e) => {
      console.error(`DIR に指定したディレクトリが見つかりません: ${dir}`);
      console.error("");
      console.error("  手元にダウンロード済みのものを検査:  DIR=./genesis-local/images pnpm verify:genesis");
      console.error("  R2上のものを検査 (DIRを付けない)   :  pnpm verify:genesis");
      throw e;
    });
    const pngs = files.filter((f) => f.endsWith(".png"));
    if (pngs.length === 0) {
      console.error(`${dir} に .png がありません`);
      process.exit(1);
    }
    entries = pngs.map((f) => ({
      id: Number(f.replace(".png", "")),
      load: () => readFile(`${dir}/${f}`),
    }));
    console.log(`検査対象: ${dir} の ${entries.length} 件\n`);
  } else {
    const base = required("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      },
    });
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: required("R2_BUCKET"), Prefix: "genesis/images/", ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.NextContinuationToken;
    } while (token);
    entries = keys.map((k) => ({
      id: Number(k.replace("genesis/images/", "").replace(".png", "")),
      load: async () => Buffer.from(await (await fetch(`${base}/${k}`)).arrayBuffer()),
    }));
    console.log(`検査対象: R2 の ${entries.length} 件\n`);
  }

  const bad: Result[] = [];
  let done = 0;
  const queue = [...entries];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const e = queue.shift();
        if (!e) return;
        try {
          const r = await check(e.id, await e.load());
          if (!r.ok) bad.push(r);
        } catch (err) {
          bad.push({ id: e.id, ok: false, reasons: [`load failed: ${err instanceof Error ? err.message : err}`] });
        }
        if (++done % 100 === 0) console.log(`  ${done} / ${entries.length}`);
      }
    }),
  );

  console.log(`\n${entries.length} 件中 ${entries.length - bad.length} 件が基準を満たしています`);
  if (bad.length > 0) {
    console.log(`\n不合格 ${bad.length} 件:`);
    for (const b of bad.sort((a, z) => a.id - z.id).slice(0, 30)) {
      console.log(`  #${b.id}: ${b.reasons.join(", ")}`);
    }
    if (bad.length > 30) console.log(`  … 他 ${bad.length - 30} 件`);
    console.log(`\n作り直し用: ONLY=${bad.map((b) => b.id).join(",")} pnpm gen:genesis`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
