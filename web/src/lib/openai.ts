import OpenAI, { toFile } from "openai";

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";

let cached: { client: OpenAI; apiKey: string } | undefined;

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  // 鍵が差し替わったら作り直す。キャッシュが古い鍵を握ったままになるのを防ぐ
  if (!cached || cached.apiKey !== apiKey) cached = { client: new OpenAI({ apiKey }), apiKey };
  return cached.client;
}

/// 401/403 は「シェルで export された鍵が .env.local より優先されていた」が定番なので、
/// どの鍵で叩いたかを添えて投げ直す。Next も dotenv も既存の process.env を上書きしない。
async function withKeyHint<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status !== 401 && status !== 403) throw e;
    const key = process.env.OPENAI_API_KEY ?? "";
    const suffix = key ? `…${key.slice(-4)} (length ${key.length})` : "(not set)";
    throw new Error(
      `${e instanceof Error ? e.message : String(e)} / key used: ${suffix}. ` +
        `An exported OPENAI_API_KEY in your shell takes precedence over .env.local`,
    );
  }
}

/// 親2枚を同時に渡して合成画像を1枚作る。返り値はPNGのBuffer。
export async function generateFusedImage(
  parents: readonly Buffer[],
  prompt: string,
): Promise<Buffer> {
  const images = await Promise.all(
    parents.map((buf, i) => toFile(buf, `parent-${i}.png`, { type: "image/png" })),
  );

  const res = await withKeyHint(() =>
    client().images.edit({
      model: MODEL,
      image: images,
      prompt,
      size: "1024x1024",
      quality: "medium",
      // 既定(auto)だと背景が透過で返ることがあり、初期素材の不透過クリーム地と揃わない
      background: "opaque",
      n: 1,
    }),
  );

  return decodeFirstImage(res);
}

/// 初期素材の生成。親画像が無いので generate 側を使う。
export async function generateImage(prompt: string): Promise<Buffer> {
  const res = await withKeyHint(() =>
    client().images.generate({
      model: MODEL,
      prompt,
      size: "1024x1024",
      quality: "medium",
      // 既定(auto)だと透過で返ることがあり、不透過のものと混在して見た目が揃わない
      background: "opaque",
      n: 1,
    }),
  );
  return decodeFirstImage(res);
}

function decodeFirstImage(res: { data?: Array<{ b64_json?: string }> }): Buffer {
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return Buffer.from(b64, "base64");
}
