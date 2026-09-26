import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.R2_BUCKET!;
const publicBase = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

let cached: S3Client | undefined;

function client() {
  if (!cached) {
    cached = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cached;
}

/// R2上の公開URL。metadataのimageとtokenURIはこれを指す。
export function publicUrl(key: string) {
  return `${publicBase}/${key}`;
}

export async function put(key: string, body: Buffer | string, contentType: string) {
  await client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return publicUrl(key);
}

export async function getBuffer(key: string): Promise<Buffer | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const buf = await getBuffer(key);
  return buf ? (JSON.parse(buf.toString("utf8")) as T) : null;
}

export async function putJson(key: string, value: unknown) {
  return put(key, JSON.stringify(value, null, 2), "application/json");
}

/// キーが無いときだけ書く。R2の条件付き書き込みを使うので、同時実行でも1回しか成功しない。
/// 生成ロックの取得に使う。
export async function putJsonIfAbsent(key: string, value: unknown): Promise<boolean> {
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(value, null, 2),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
    return true;
  } catch (e) {
    if (isPreconditionFailed(e)) return false;
    throw e;
  }
}

export async function exists(key: string) {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

function isPreconditionFailed(e: unknown) {
  const name = (e as { name?: string })?.name;
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "PreconditionFailed" || status === 412 || status === 409;
}

function isNotFound(e: unknown) {
  const name = (e as { name?: string })?.name;
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
