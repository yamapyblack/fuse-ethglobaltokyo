/// アプリのアイコンを生成して、Nextのファイル規約に沿って書き出す。
///   src/app/icon.png        ブラウザのタブ (512)
///   src/app/apple-icon.png  ホーム画面 (180)
///   public/icon-1024.png    提出フォームなどに貼る原寸
/// 小さく表示しても潰れないよう、プロンプト側で要素を絞っている。
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { required } from "./env";
import { generateImage } from "../src/lib/openai";

const PROMPT = [
  "App icon: one piece of nigiri sushi that is also a creature — a rounded cream-white rice base",
  "with a soft pastel-pink fish topping, and two long lavender bunny ears standing up from the topping.",
  "Simple closed-eye smile and round blush cheeks. It must read clearly at very small sizes:",
  "bold silhouette, few elements, thick outlines, no tiny details, no text.",
  "Style: kawaii chibi mascot illustration, soft rounded shapes, thick gentle outlines,",
  "flat shading with light pastel gradients, one single subject centered and filling most of the frame,",
  "sticker-like clean edges, no watermark, no border, no collage.",
  "Palette: pastel lavender, cream white and soft pink.",
  "The background must be one flat off-white tone (#FAF7F2).",
  "No dark background, no coloured gradient, no vignette, no glow, no scene.",
].join("\n");

async function main() {
  required("OPENAI_API_KEY");

  console.log("generating icon…");
  const master = await generateImage(PROMPT);

  const outputs: [string, number][] = [
    ["public/icon-1024.png", 1024],
    ["src/app/icon.png", 512],
    ["src/app/apple-icon.png", 180],
  ];

  await mkdir(new URL("../public/", import.meta.url), { recursive: true });

  for (const [path, size] of outputs) {
    const resized = await sharp(master).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(new URL(`../${path}`, import.meta.url), resized);
    console.log(`  ${path}  ${size}x${size}  ${(resized.length / 1024).toFixed(0)}KB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
