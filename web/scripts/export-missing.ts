/// R2に無いGenesisを洗い出し、生成に必要な情報を1ファイルにまとめる。
/// 別のエージェントや別ツールに作業を渡すとき用。
/// プロンプト全文を含めるので、このリポジトリの外でも同じ絵柄を再現できる。
import { writeFile } from "node:fs/promises";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { required } from "./env";
import { buildGenesisPrompt } from "../src/lib/prompt";
import { BASES } from "../src/lib/traits";

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

async function main() {
  const { readFile } = await import("node:fs/promises");
  const all = JSON.parse(await readFile(new URL("genesis.json", import.meta.url), "utf8")) as Piece[];

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  const have = new Set<number>();
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: required("R2_BUCKET"), Prefix: "genesis/images/", ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) {
      const id = Number(o.Key?.replace("genesis/images/", "").replace(".png", ""));
      if (id) have.add(id);
    }
    token = res.NextContinuationToken;
  } while (token);

  const missing = all
    .filter((p) => !have.has(p.tokenId))
    .map((p) => ({
      tokenId: p.tokenId,
      family: p.family,
      base: p.base,
      mood: p.mood,
      accent: p.accent,
      charm: p.charm,
      pose: p.pose,
      outputImage: `genesis/images/${p.tokenId}.png`,
      outputMetadata: `genesis/${p.tokenId}.json`,
      prompt: buildGenesisPrompt({
        family: p.family,
        motif: BASES[p.baseIndex].motif,
        mood: p.mood,
        accent: p.accent,
        charm: p.charm,
        pose: p.pose,
      }),
    }));

  const out = new URL("../../docs/genesis-missing.json", import.meta.url);
  await writeFile(out, JSON.stringify(missing, null, 1) + "\n");

  const byFamily = missing.reduce<Record<string, number>>((m, p) => ({ ...m, [p.family]: (m[p.family] ?? 0) + 1 }), {});
  console.log(`既存 ${have.size} 件 / 欠番 ${missing.length} 件`);
  console.log("  内訳:", Object.entries(byFamily).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`  書き出し: docs/genesis-missing.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
