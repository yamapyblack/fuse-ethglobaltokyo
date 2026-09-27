/// Genesis 1000体の画像とメタデータを生成してR2へ上げる。
///
///   R2キー: genesis/images/{tokenId}.png  と  genesis/{tokenId}.json
///   contract の genesisBaseURI は  <R2公開URL>/genesis/  を指す。
///
/// 何度実行しても、すでにR2にあるものは作り直さない。1体の失敗で全体を止めず、
/// 最後に失敗ぶんをまとめて報告する。
///
/// 使い方:
///   pnpm gen:genesis              全件
///   LIMIT=6 pnpm gen:genesis      先頭6件だけ（パイロット用）
///   ONLY=1,5,9 pnpm gen:genesis   指定tokenIdだけ強制再生成
///   CONCURRENCY=5 pnpm gen:genesis
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { required } from "./env";
import { generateImage } from "../src/lib/openai";
import { buildGenesisPrompt } from "../src/lib/prompt";
import { BASES } from "../src/lib/traits";
import { exists, publicUrl, put, putJson } from "../src/lib/r2";

type Piece = {
  tokenId: number;
  family: "creature" | "sushi" | "engimono";
  base: string;
  baseIndex: number;
  mood: string;
  accent: string;
  charm: string;
  pose: string;
};

const imageKey = (id: number) => `genesis/images/${id}.png`;
const metaKey = (id: number) => `genesis/${id}.json`;

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = 2 ** i * 1000;
      console.log(`  ${label} 失敗 (${i}/${attempts}): ${e instanceof Error ? e.message : e} → ${wait / 1000}秒待機`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/// 透過で返ることがあるので、必ず背景色に焼き込んでから保存する。
/// 混在するとコレクションとして見た目が揃わない。
const BG = { r: 250, g: 247, b: 242 };

async function flatten(png: Buffer): Promise<Buffer> {
  return sharp(png).flatten({ background: BG }).png({ compressionLevel: 9 }).toBuffer();
}

/// 四隅の輝度を測る。焼き込み後に測ること。透過のまま測るとRGBが0で黒と誤判定する。
async function cornerLuminance(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).flatten({ background: BG }).resize(8, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  return (at(0, 0) + at(7, 0) + at(0, 7) + at(7, 7)) / 4;
}

/// 背景が暗いものは作り直す。暖色パレットのとき背景まで塗られることがあり、
/// 1000枚を目視で確認するのは現実的でないので機械で弾く。
const MIN_BACKGROUND_LUMINANCE = 225;

async function generateWithLightBackground(prompt: string, tokenId: number): Promise<Buffer> {
  let last: Buffer | undefined;
  for (let i = 1; i <= 3; i++) {
    const image = await withRetry("generate", () => generateImage(prompt));
    const lum = await cornerLuminance(image);
    if (lum >= MIN_BACKGROUND_LUMINANCE) return image;
    console.log(`  #${tokenId} 背景が暗い (輝度${lum.toFixed(0)}) → 作り直し ${i}/3`);
    last = image;
  }
  throw new Error("background stayed dark after 3 attempts");
}

async function buildOne(p: Piece, force: boolean) {
  const motif = BASES[p.baseIndex].motif;

  if (force || !(await withRetry("exists", () => exists(imageKey(p.tokenId))))) {
    const raw = await generateWithLightBackground(
      buildGenesisPrompt({ family: p.family, motif, mood: p.mood, accent: p.accent, charm: p.charm, pose: p.pose }),
      p.tokenId,
    );
    // ここで落とすと生成しなおしになるので、保存は粘って通す
    const image = await flatten(raw);
    await withRetry("upload", () => put(imageKey(p.tokenId), image, "image/png"));
  }

  await withRetry("metadata", () =>
    putJson(metaKey(p.tokenId), {
      name: `${p.base} #${p.tokenId}`,
      description:
        "A Genesis piece of Fuse. Pick two and fuse them into a brand-new one. " +
        "Each piece can be used in three fusions before it is burned.",
      image: publicUrl(imageKey(p.tokenId)),
      attributes: [
        { trait_type: "Generation", value: 0 },
        { trait_type: "Family", value: p.family[0].toUpperCase() + p.family.slice(1) },
        { trait_type: "Base", value: p.base },
        { trait_type: "Mood", value: p.mood },
        { trait_type: "Accent", value: p.accent },
        { trait_type: "Charm", value: p.charm },
        { trait_type: "Pose", value: p.pose },
        { trait_type: "Umami", value: 50 },
      ],
    }),
  );
}

async function main() {
  required("OPENAI_API_KEY");
  required("R2_BUCKET");
  required("R2_PUBLIC_BASE_URL");

  const all = JSON.parse(await readFile(new URL("genesis.json", import.meta.url), "utf8")) as Piece[];
  const only = (process.env.ONLY ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean);
  const limit = Number(process.env.LIMIT ?? 0);
  const concurrency = Number(process.env.CONCURRENCY ?? 5);

  let targets = only.length > 0 ? all.filter((p) => only.includes(p.tokenId)) : all;
  if (limit > 0) targets = targets.slice(0, limit);

  console.log(`対象 ${targets.length} 体 / 並列 ${concurrency}${only.length ? " / 強制再生成" : ""}\n`);

  const failed: { tokenId: number; error: string }[] = [];
  let done = 0;
  const started = Date.now();

  const queue = [...targets];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const p = queue.shift();
        if (!p) return;
        try {
          await buildOne(p, only.length > 0);
          done++;
          const per = (Date.now() - started) / done / 1000;
          const left = ((targets.length - done) * per) / 60;
          console.log(`  ✓ #${p.tokenId} ${p.base} (${done}/${targets.length}, 残り約${left.toFixed(0)}分)`);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          console.log(`  ✗ #${p.tokenId} ${p.base}: ${error}`);
          failed.push({ tokenId: p.tokenId, error });
        }
      }
    }),
  );

  console.log(`\n${done} / ${targets.length} 完了（${((Date.now() - started) / 60000).toFixed(1)}分）`);
  if (failed.length > 0) {
    console.log(`失敗 ${failed.length} 件（もう一度実行すれば成功ぶんはスキップされます）:`);
    for (const f of failed) console.log(`  #${f.tokenId}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
