/// R2にあるGenesis画像を数えて、欠けているtokenIdを出す。
/// 生成を中断したあと、どこから再開すればよいかを知るため。
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { required } from "./env";

async function main() {
  const bucket = required("R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  async function listAll(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.NextContinuationToken;
    } while (token);
    return keys;
  }

  const images = await listAll("genesis/images/");
  const metas = (await listAll("genesis/")).filter((k) => k.endsWith(".json"));

  const have = new Set(images.map((k) => Number(k.replace("genesis/images/", "").replace(".png", ""))));
  const missing = Array.from({ length: 1000 }, (_, i) => i + 1).filter((id) => !have.has(id));

  console.log(`バケット : ${bucket}`);
  console.log(`画像     : genesis/images/{tokenId}.png   ${images.length} 件`);
  console.log(`メタデータ: genesis/{tokenId}.json         ${metas.length} 件`);
  console.log(`公開URL  : ${process.env.R2_PUBLIC_BASE_URL}/genesis/images/1.png`);
  console.log(`\n欠け     : ${missing.length} 件`);
  if (missing.length > 0) {
    const preview = missing.slice(0, 20).join(",");
    console.log(`  先頭20: ${preview}${missing.length > 20 ? " …" : ""}`);
    console.log(`  連番の最大: #${Math.max(...have)} まで存在`);
  }

  // 他のプレフィックスも把握しておく
  for (const p of ["images/", "metadata/", "c/", "snapshots/"]) {
    const n = (await listAll(p)).length;
    if (n > 0) console.log(`\n（v1の残骸）${p}  ${n} 件`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
