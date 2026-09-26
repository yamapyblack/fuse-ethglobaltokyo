import { readChildInfo, readTokenUri, finalizeMetadata, type ChildInfo } from "./chain";
import { keys } from "./keys";
import { generateFusedImage } from "./openai";
import { buildPrompt } from "./prompt";
import { exists, getBuffer, put, publicUrl, putJson } from "./r2";
import { claimLock, loadState, MAX_ATTEMPTS, saveState, type RequestState } from "./state";

export type GenerateResult =
  | { status: "done"; tokenUri: string; imageUrl?: string }
  | { status: "generating"; attempts: number }
  | { status: "failed"; error: string; attempts: number }
  | { status: "burned" }
  | { status: "not_child" };

const PENDING = 1;
const READY = 2;
const BURNED = 3;

/// 子NFT1体ぶんの画像生成を進める。何度呼ばれても安全で、
/// すでに終わっている工程はスキップする（= 生成失敗時の再試行が追加課金を生まない）。
export async function runGeneration(tokenId: bigint, force = false): Promise<GenerateResult> {
  const info = await readChildInfo(tokenId);

  // オンチェーンの状態が唯一の入場券。0.001 ETHを払ってPendingになったものだけ生成する。
  if (info.state === 0) return { status: "not_child" };
  if (info.state === BURNED) return { status: "burned" };
  if (info.state === READY) {
    return { status: "done", tokenUri: await readTokenUri(tokenId) };
  }
  if (info.state !== PENDING) return { status: "not_child" };

  const lock = await claimLock(info.requestId, tokenId, force);
  if (!lock.claimed) {
    const s = lock.state;
    if (!s) return { status: "generating", attempts: 0 };
    if (s.status === "generating") return { status: "generating", attempts: s.attempts };
    if (s.attempts >= MAX_ATTEMPTS) {
      return { status: "failed", error: s.error ?? "generation failed", attempts: s.attempts };
    }
    return { status: "generating", attempts: s.attempts };
  }

  let state = lock.state;
  try {
    const imageUrl = await ensureImage(tokenId, info);
    const tokenUri = await ensureMetadata(tokenId, info, imageUrl);

    state = { ...state, imageUrl, tokenUri };
    await saveState(state);

    // チェーンの状態を読み直す。別の試行が先に確定させていたら二重送信しない。
    const latest = await readChildInfo(tokenId);
    if (latest.state === PENDING) {
      await finalizeMetadata(tokenId, tokenUri);
    }

    await saveState({ ...state, status: "done" });
    return { status: "done", tokenUri, imageUrl };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await saveState({ ...state, status: "failed", error });
    return { status: "failed", error, attempts: state.attempts };
  }
}

/// 生成済みの画像があれば再利用する。落ちたのが後半の工程だったときに
/// OpenAIを叩き直さないための分岐。
async function ensureImage(tokenId: bigint, info: ChildInfo): Promise<string> {
  const key = keys.childImage(tokenId);
  if (await exists(key)) return publicUrl(key);

  const parents = await Promise.all([
    snapshotParent(info.parentA),
    snapshotParent(info.parentB),
  ]);
  const { prompt } = buildPrompt(info.seed);
  const image = await generateFusedImage(parents, prompt);
  return put(key, image, "image/png");
}

async function ensureMetadata(tokenId: bigint, info: ChildInfo, imageUrl: string): Promise<string> {
  const { traits } = buildPrompt(info.seed);
  const metadata = {
    name: `Fuse #${tokenId}`,
    description:
      `Fused from #${info.parentA} and #${info.parentB}. ` +
      `Both parents are locked in the pool forever. This one can be burned and reminted.`,
    image: imageUrl,
    attributes: [
      { trait_type: "Parent A", value: `#${info.parentA}` },
      { trait_type: "Parent B", value: `#${info.parentB}` },
      { trait_type: "Remint Count", value: Number(info.remintCount) },
      { trait_type: "Dominance", value: traits.dominance.label },
      { trait_type: "Accent", value: traits.accent.label },
      { trait_type: "Charm", value: traits.charm.label },
      { trait_type: "Expression", value: traits.expression.label },
      { trait_type: "Pose", value: traits.pose.label },
      { trait_type: "Seed", value: `0x${info.seed.toString(16)}` },
    ],
  };
  return putJson(keys.childMetadata(tokenId), metadata);
}

/// 親画像をR2にスナップショットしておく。Remintは必ずここから読むので、
/// 何度焼き直しても同じ2枚が素材になる。
async function snapshotParent(parentTokenId: bigint): Promise<Buffer> {
  const key = keys.parentSnapshot(parentTokenId);
  const cachedImage = await getBuffer(key);
  if (cachedImage) return cachedImage;

  const tokenUri = await readTokenUri(parentTokenId);
  if (!tokenUri) throw new Error(`parent #${parentTokenId} has no tokenURI yet`);

  const metaRes = await fetch(tokenUri);
  if (!metaRes.ok) throw new Error(`failed to fetch parent metadata: ${tokenUri}`);
  const meta = (await metaRes.json()) as { image?: string };
  if (!meta.image) throw new Error(`parent #${parentTokenId} metadata has no image`);

  const imgRes = await fetch(meta.image);
  if (!imgRes.ok) throw new Error(`failed to fetch parent image: ${meta.image}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());

  await put(key, buf, "image/png");
  return buf;
}

/// 画面のポーリング用。生成は起動しない。
export async function readStatus(tokenId: bigint): Promise<{
  chainState: number;
  info: ChildInfo;
  tokenUri: string | null;
  request: RequestState | null;
}> {
  const info = await readChildInfo(tokenId);
  const tokenUri = info.state === READY ? await readTokenUri(tokenId) : null;
  // 進行状況はおまけ。R2が読めなくてもチェーン上の状態は返す
  const request = info.state === 0 ? null : await loadState(info.requestId).catch(() => null);
  return { chainState: info.state, info, tokenUri, request };
}
