import OpenAI, { toFile } from "openai";

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";

let cached: OpenAI | undefined;

function client() {
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

/// 親2枚を同時に渡して合成画像を1枚作る。返り値はPNGのBuffer。
export async function generateFusedImage(
  parents: readonly Buffer[],
  prompt: string,
): Promise<Buffer> {
  const images = await Promise.all(
    parents.map((buf, i) => toFile(buf, `parent-${i}.png`, { type: "image/png" })),
  );

  const res = await client().images.edit({
    model: MODEL,
    image: images,
    prompt,
    size: "1024x1024",
    quality: "medium",
    // 既定(auto)だと背景が透過で返ることがあり、初期素材の不透過クリーム地と揃わない
    background: "opaque",
    n: 1,
  });

  return decodeFirstImage(res);
}

/// 初期素材の生成。親画像が無いので generate 側を使う。
export async function generateImage(prompt: string): Promise<Buffer> {
  const res = await client().images.generate({
    model: MODEL,
    prompt,
    size: "1024x1024",
    quality: "medium",
    n: 1,
  });
  return decodeFirstImage(res);
}

function decodeFirstImage(res: { data?: Array<{ b64_json?: string }> }): Buffer {
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return Buffer.from(b64, "base64");
}
