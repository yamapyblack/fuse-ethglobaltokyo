/// R2の疎通確認。put → head → get → 公開URLのHTTPS取得まで通す。
/// OpenAIを呼ぶ前にこれを通しておくと、権限不足やCORS以前の設定ミスで詰まらない。
import { required } from "./env";
import { exists, getBuffer, put, publicUrl, putJsonIfAbsent } from "../src/lib/r2";

const key = "healthcheck/ping.txt";
const body = `ok ${new Date().toISOString()}`;

async function main() {
  required("R2_ACCOUNT_ID");
  required("R2_ACCESS_KEY_ID");
  required("R2_SECRET_ACCESS_KEY");
  required("R2_BUCKET");
  const base = required("R2_PUBLIC_BASE_URL");

  console.log(`bucket : ${process.env.R2_BUCKET}`);
  console.log(`public : ${base}\n`);

  const url = await put(key, body, "text/plain");
  console.log(`✓ write   ${url}`);

  if (!(await exists(key))) throw new Error("HeadObject が false を返した（読み取り権限を確認）");
  console.log("✓ head    オブジェクトを認識");

  const got = await getBuffer(key);
  if (got?.toString() !== body) throw new Error("GetObject の中身が一致しない");
  console.log("✓ read    中身が一致");

  // 生成ロックに使う条件付き書き込み。2回目は false になるのが正しい
  const first = await putJsonIfAbsent("healthcheck/lock.json", { at: Date.now() });
  const second = await putJsonIfAbsent("healthcheck/lock.json", { at: Date.now() });
  if (second) {
    console.log("⚠ conditional write が効いていない（同時実行時に二重生成の可能性）");
  } else {
    console.log(`✓ lock    条件付き書き込みが機能 (1回目=${first}, 2回目=${second})`);
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `公開URLが ${res.status} を返した。Public Development URL が Enable か、` +
        `R2_PUBLIC_BASE_URL が正しいか確認する`,
    );
  }
  if ((await res.text()) !== body) throw new Error("公開URLの中身が一致しない");
  console.log("✓ public  HTTPSで読める\n");

  console.log("R2 OK. 次: pnpm gen:materials");
  console.log(`後片付け: ${publicUrl(key)} と healthcheck/lock.json は消して構いません`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\n✗ ${msg}`);
  if (/Access Denied|Forbidden|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(msg)) {
    console.error(
      `\n  よくある原因:\n` +
        `  - R2_BUCKET が実際のバケット名と違う（今の値: ${process.env.R2_BUCKET}）\n` +
        `  - APIトークンのスコープがそのバケットを含んでいない\n` +
        `  - 権限が Object Write のみ。Object Read & Write が必要`,
    );
  }
  process.exit(1);
});
