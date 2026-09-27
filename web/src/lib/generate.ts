import { readChildInfo, readTokenUri, finalizeMetadata, type ChildInfo } from "./chain";
import { imageKeyOf, keys } from "./keys";
import { generateFusedImage } from "./openai";
import { buildChildPrompt } from "./prompt";
import { umamiFromSeed } from "./traits";
import { exists, getBuffer, put, publicUrl, putJson } from "./r2";
import { GENESIS_SUPPLY } from "./config";
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
    snapshotParent(BigInt(info.parentA)),
    snapshotParent(BigInt(info.parentB)),
  ]);
  const { prompt } = buildChildPrompt(info.seed);
  const image = await generateFusedImage(parents, prompt);
  return put(key, image, "image/png");
}

async function ensureMetadata(tokenId: bigint, info: ChildInfo, imageUrl: string): Promise<string> {
  const { traits } = buildChildPrompt(info.seed);
  const umami = umamiFromSeed(info.seed);
  const engimonoBps = 10000 - info.creatureBps - info.sushiBps;
  const pct = (bps: number) => Math.round(bps / 100);

  const lineage = (
    [
      ["Creature", info.creatureBps],
      ["Sushi", info.sushiBps],
      ["Engimono", engimonoBps],
    ] as const
  ).filter(([, bps]) => bps > 0);
  // 最も比率の高いファミリー。同率なら Mixed
  const top = [...lineage].sort((a, b) => b[1] - a[1]);
  const family = top.length > 1 && top[0][1] === top[1][1] ? "Mixed" : top[0][0];

  const metadata = {
    name: `Fuse #${tokenId}`,
    description:
      `Fused from #${info.parentA} and #${info.parentB}. ` +
      `Each piece can be used in three fusions before it is burned.`,
    image: imageUrl,
    // 配合の残り回数はここに書かない。tokenURIは確定後に変更できないので、
    // 変動する値を載せると必ず古くなる。残り回数はチェーンから読むこと。
    attributes: [
      { trait_type: "Generation", value: info.generation, display_type: "number" },
      { trait_type: "Family", value: family },
      { trait_type: "Lineage", value: lineage.map(([n, b]) => `${n} ${pct(b)}%`).join(" / ") },
      { trait_type: "Umami", value: umami, display_type: "number", max_value: 100 },
      { trait_type: "Mood", value: traits.mood },
      { trait_type: "Accent", value: traits.accent },
      { trait_type: "Charm", value: traits.charm },
      { trait_type: "Pose", value: traits.pose },
      { trait_type: "Parent A", value: `#${info.parentA}` },
      { trait_type: "Parent B", value: `#${info.parentB}` },
      { trait_type: "Remint Count", value: info.remintCount, display_type: "number" },
      { trait_type: "Seed", value: `0x${info.seed.toString(16)}` },
    ],
  };
  return putJson(keys.childMetadata(tokenId), metadata);
}

/// 親画像をR2から引く。
///
/// **チェーンは読まない。** v2では3回使い切った親が配合と同じtxでburnされるため、
/// tokenURI(親) を読む方式だと生成のたびに失敗する。tokenId から決まるキーで直接取る。
///
/// スナップショットを別に持つのは、親がburnされた後も同じ2枚で焼き直せるようにするため。
async function snapshotParent(parentTokenId: bigint): Promise<Buffer> {
  const snapshotKey = keys.parentSnapshot(parentTokenId);
  const cached = await getBuffer(snapshotKey);
  if (cached) return cached;

  const sourceKey = imageKeyOf(parentTokenId, GENESIS_SUPPLY);
  const source = await getBuffer(sourceKey);
  if (!source) {
    throw new Error(`parent #${parentTokenId} has no image at ${sourceKey}`);
  }

  await put(snapshotKey, source, "image/png");
  return source;
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
