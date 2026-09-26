import { runGeneration } from "@/lib/generate";

/// 画像生成に30〜60秒かかる。Hobbyプランでは60秒で打ち切られるが、
/// 途中で落ちても state レコードから再試行できる。
export const maxDuration = 300;

/// 画面から「この子の生成を進めて」と叩かれる入口。
/// 呼び出し側の言い分は信用せず、オンチェーンの Pending 状態だけを根拠に生成する。
export async function POST(req: Request) {
  let tokenId: bigint;
  try {
    const body = (await req.json()) as { tokenId?: string | number };
    if (body.tokenId === undefined) throw new Error("tokenId is required");
    tokenId = BigInt(body.tokenId);
  } catch {
    return Response.json({ error: "invalid tokenId" }, { status: 400 });
  }

  try {
    const result = await runGeneration(tokenId);
    const status = result.status === "not_child" ? 400 : 200;
    return Response.json(result, { status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ status: "failed", error }, { status: 500 });
  }
}
