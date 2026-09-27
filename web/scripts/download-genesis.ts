/// R2のGenesis画像とメタデータをローカルに一括ダウンロードする。
///
///   出力先: web/genesis-local/images/{tokenId}.png
///           web/genesis-local/metadata/{tokenId}.json
///
/// すでにあるファイルはスキップするので、中断して再実行できる。
/// 出力先は .gitignore 済み（1枚1MB前後あり、リポジトリに入れるものではない）。
///
///   pnpm download:genesis
///   OUT=/path/to/dir CONCURRENCY=8 pnpm download:genesis
import { mkdir, stat, writeFile } from "node:fs/promises";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { required } from "./env";

async function main() {
  const bucket = required("R2_BUCKET");
  const outDir = process.env.OUT ?? new URL("../genesis-local/", import.meta.url).pathname;
  const concurrency = Number(process.env.CONCURRENCY ?? 8);

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  async function listAll(prefix: string) {
    const out: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
      token = res.NextContinuationToken;
    } while (token);
    return out;
  }

  const images = await listAll("genesis/images/");
  const metas = (await listAll("genesis/")).filter((o) => o.key.endsWith(".json"));
  const all = [
    ...images.map((o) => ({ ...o, dir: "images", name: o.key.replace("genesis/images/", "") })),
    ...metas.map((o) => ({ ...o, dir: "metadata", name: o.key.replace("genesis/", "") })),
  ];
  const totalMb = all.reduce((n, o) => n + o.size, 0) / 1048576;

  await mkdir(`${outDir}/images`, { recursive: true });
  await mkdir(`${outDir}/metadata`, { recursive: true });

  console.log(`出力先: ${outDir}`);
  console.log(`対象  : 画像 ${images.length} 件 / メタデータ ${metas.length} 件 / 合計 ${totalMb.toFixed(0)} MB\n`);

  // 公開URLから取る。認証が要らず、S3のGetObjectより速い。
  const base = required("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  const queue = [...all];
  let done = 0;
  let skipped = 0;
  const failed: string[] = [];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const o = queue.shift();
        if (!o) return;
        const dest = `${outDir}/${o.dir}/${o.name}`;
        try {
          const existing = await stat(dest).catch(() => null);
          if (existing && existing.size === o.size) {
            skipped++;
            done++;
            continue;
          }
          const res = await fetch(`${base}/${o.key}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await writeFile(dest, Buffer.from(await res.arrayBuffer()));
          done++;
          if (done % 50 === 0) console.log(`  ${done} / ${all.length}`);
        } catch (e) {
          failed.push(`${o.key}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }),
  );

  console.log(`\n${done} / ${all.length} 完了（うちスキップ ${skipped}）`);
  if (failed.length > 0) {
    console.log(`失敗 ${failed.length} 件:`);
    for (const f of failed.slice(0, 10)) console.log(`  ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
