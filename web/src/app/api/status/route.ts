import { readStatus } from "@/lib/generate";
import { resolveImageUrl } from "@/lib/resolve-image";
import { GEN_STATE } from "@/lib/config";

/// 画面のポーリング先。生成は起動しない。
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("tokenId");
  let tokenId: bigint;
  try {
    if (!raw) throw new Error("tokenId is required");
    tokenId = BigInt(raw);
  } catch {
    return Response.json({ error: "invalid tokenId" }, { status: 400 });
  }

  try {
    const { info, tokenUri, request } = await readStatus(tokenId);

    const [image, parentA, parentB] = await Promise.all([
      tokenUri ? resolveImageUrl(tokenId) : Promise.resolve(null),
      resolveImageUrl(info.parentA, true),
      resolveImageUrl(info.parentB, true),
    ]);

    return Response.json(
      {
        tokenId: tokenId.toString(),
        chainState: GEN_STATE[info.state] ?? "Unknown",
        requestId: info.requestId.toString(),
        rerollCount: Number(info.rerollCount),
        prevChildTokenId: info.prevChildTokenId.toString(),
        seed: `0x${info.seed.toString(16)}`,
        parents: [
          { tokenId: info.parentA.toString(), image: parentA },
          { tokenId: info.parentB.toString(), image: parentB },
        ],
        tokenUri,
        image,
        request: request
          ? { status: request.status, attempts: request.attempts, error: request.error ?? null }
          : null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
