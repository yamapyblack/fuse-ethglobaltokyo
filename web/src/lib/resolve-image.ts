import { readTokenUri } from "./chain";
import { GENESIS_SUPPLY } from "./config";
import { imageKeyOf, keys } from "./keys";
import { exists, publicUrl } from "./r2";

/// tokenId から表示用の画像URLを引く。
/// 親はスナップショットが取れているならそれを優先し、無ければ tokenURI を辿る。
export async function resolveImageUrl(tokenId: bigint, preferSnapshot = false): Promise<string | null> {
  if (preferSnapshot) {
    // R2が落ちていても tokenURI から引き直せるので、ここでは失敗を飲み込む
    try {
      const key = keys.parentSnapshot(tokenId);
      if (await exists(key)) return publicUrl(key);
    } catch {
      // fall through
    }
  }

  // burnされた親は tokenURI が revert するので、先にキー規約で引く
  try {
    const key = imageKeyOf(tokenId, GENESIS_SUPPLY);
    if (await exists(key)) return publicUrl(key);
  } catch {
    // fall through
  }

  const tokenUri = await readTokenUri(tokenId).catch(() => "");
  if (!tokenUri) return null;

  try {
    const res = await fetch(tokenUri, { cache: "no-store" });
    if (!res.ok) return null;
    const meta = (await res.json()) as { image?: string };
    return meta.image ?? null;
  } catch {
    return null;
  }
}
