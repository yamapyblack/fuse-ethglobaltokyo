/// 初期素材の画像とメタデータを作ってR2へ上げる。
/// 何度実行しても、すでにR2にあるものは作り直さない。
///
/// 1体の失敗で全体を止めない。生成にも保存にも課金や時間がかかるので、
/// 一時的なネットワークエラーは握って次へ進み、最後にまとめて報告する。
import { writeFile } from "node:fs/promises";
import { required } from "./env";
import { keys } from "../src/lib/keys";
import { generateImage } from "../src/lib/openai";
import { buildMaterialPrompt, MATERIALS } from "../src/lib/prompt";
import { exists, publicUrl, put, putJson } from "../src/lib/r2";

type Manifest = {
  index: number;
  name: string;
  imageUrl: string;
  metadataUrl: string;
}[];

/// 生成し直すと再課金になるので、保存側は特に粘る。
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = 2 ** i * 1000;
      console.log(`  ${label} 失敗 (${i}/${attempts}): ${e instanceof Error ? e.message : e} → ${wait / 1000}秒後に再試行`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  required("OPENAI_API_KEY");
  required("R2_BUCKET");
  required("R2_PUBLIC_BASE_URL");

  const manifest: Manifest = [];
  const failed: { index: number; name: string; error: string }[] = [];

  for (const [i, material] of MATERIALS.entries()) {
    const index = i + 1;
    const imageKey = keys.materialImage(index);
    const metadataKey = keys.materialMetadata(index);

    try {
      if (await withRetry("exists", () => exists(imageKey))) {
        console.log(`skip #${index} ${material.name} (already on R2)`);
      } else {
        console.log(`generating #${index} ${material.name}…`);
        const image = await withRetry("generate", () =>
          generateImage(buildMaterialPrompt(index, material.motif)),
        );
        // ここで落とすと生成しなおしになるので、保存は粘って通す
        await withRetry("upload", () => put(imageKey, image, "image/png"));
      }

      const metadataUrl = await withRetry("metadata", () =>
        putJson(metadataKey, {
          name: material.name,
          description: "A starter creature for Fuse. Pick two and fuse them into a brand-new one.",
          image: publicUrl(imageKey),
          attributes: [
            { trait_type: "Kind", value: "Material" },
            { trait_type: "Material No", value: index },
          ],
        }),
      );

      manifest.push({ index, name: material.name, imageUrl: publicUrl(imageKey), metadataUrl });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.log(`  ✗ #${index} ${material.name}: ${error}`);
      failed.push({ index, name: material.name, error });
    }
  }

  await writeFile(new URL("materials.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n${manifest.length} / ${MATERIALS.length} materials ready.`);
  if (failed.length > 0) {
    console.log(`失敗 ${failed.length} 件（もう一度実行すれば成功ぶんはスキップされます）:`);
    for (const f of failed) console.log(`  #${f.index} ${f.name}: ${f.error}`);
    process.exit(1);
  }
  console.log("next: pnpm mint:materials");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
