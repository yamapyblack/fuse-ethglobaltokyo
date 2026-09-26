/// 初期素材6体の画像とメタデータを作ってR2へ上げる。
/// 何度実行しても、すでにR2にあるものは作り直さない。
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

async function main() {
  required("OPENAI_API_KEY");
  required("R2_BUCKET");
  required("R2_PUBLIC_BASE_URL");

  const manifest: Manifest = [];

  for (const [i, material] of MATERIALS.entries()) {
    const index = i + 1;
    const imageKey = keys.materialImage(index);
    const metadataKey = keys.materialMetadata(index);

    if (await exists(imageKey)) {
      console.log(`skip #${index} ${material.name} (already on R2)`);
    } else {
      console.log(`generating #${index} ${material.name}…`);
      const image = await generateImage(buildMaterialPrompt(index, material.motif));
      await put(imageKey, image, "image/png");
    }

    const metadataUrl = await putJson(metadataKey, {
      name: material.name,
      description: "Fuseの初期素材。2体えらんで配合すると、新しい1体が生まれます。",
      image: publicUrl(imageKey),
      attributes: [
        { trait_type: "Kind", value: "Material" },
        { trait_type: "Material No", value: index },
      ],
    });

    manifest.push({ index, name: material.name, imageUrl: publicUrl(imageKey), metadataUrl });
  }

  await writeFile(new URL("materials.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n${manifest.length} materials ready. next: pnpm mint:materials`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
