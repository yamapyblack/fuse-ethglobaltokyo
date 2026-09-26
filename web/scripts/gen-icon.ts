/// アプリのアイコンを生成して、Nextのファイル規約に沿って書き出す。
///   src/app/favicon.ico     ブラウザのタブ (16/32/48)
///   src/app/icon.png        高解像度のタブアイコン (512)
///   src/app/apple-icon.png  ホーム画面 (180)
///   public/logo.png         ヘッダーのロゴマーク (128)
///   public/icon-1024.png    提出フォームなどに貼る原寸
///
/// favicon.ico を別に置くのは、Chromeが <link> を見る前に /favicon.ico を
/// 取りに行き、無いとタブが地球儀アイコンのままになるため。
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

/// ICOはPNGをそのまま内包できる。エンコーダを足すほどの処理ではないので手で組む。
/// 内包するPNGはRGBAでないとNextのICOパーサが弾くので、ensureAlpha/palette:false で固定する。
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;

  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main() {
  required("OPENAI_API_KEY");

  console.log("generating icon…");
  const master = await generateImage(PROMPT);

  const outputs: [string, number][] = [
    ["public/icon-1024.png", 1024],
    ["public/logo.png", 128],
    ["src/app/icon.png", 512],
    ["src/app/apple-icon.png", 180],
  ];

  await mkdir(new URL("../public/", import.meta.url), { recursive: true });

  for (const [path, size] of outputs) {
    const resized = await sharp(master).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(new URL(`../${path}`, import.meta.url), resized);
    console.log(`  ${path}  ${size}x${size}  ${(resized.length / 1024).toFixed(0)}KB`);
  }

  const icoSizes = [16, 32, 48];
  const ico = buildIco(
    await Promise.all(
      icoSizes.map(async (size) => ({
        size,
        png: await sharp(master)
          .resize(size, size, { fit: "cover" })
          .ensureAlpha()
          .png({ compressionLevel: 9, palette: false })
          .toBuffer(),
      })),
    ),
  );
  await writeFile(new URL("../src/app/favicon.ico", import.meta.url), ico);
  console.log(`  src/app/favicon.ico  ${icoSizes.join("/")}  ${(ico.length / 1024).toFixed(0)}KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
