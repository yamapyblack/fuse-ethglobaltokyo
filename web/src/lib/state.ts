import { MAX_ATTEMPTS } from "./config";
import { keys } from "./keys";
import { getJson, putJson, putJsonIfAbsent } from "./r2";

export type RequestStatus = "generating" | "done" | "failed";

/// requestId単位の進行状況。追加課金なしの再試行はこのレコードで冪等にする。
export type RequestState = {
  requestId: string;
  tokenId: string;
  status: RequestStatus;
  attempts: number;
  /// generating を主張した時刻。古くなったロックは他のリクエストが奪える。
  lockedAt: number;
  updatedAt: number;
  imageUrl?: string;
  tokenUri?: string;
  error?: string;
};

export { MAX_ATTEMPTS };

/// 生成は30〜60秒程度。Vercelの関数タイムアウトで落ちた場合もこの時間で復帰できる。
export const LOCK_TTL_MS = 180_000;

export async function loadState(requestId: bigint): Promise<RequestState | null> {
  return getJson<RequestState>(keys.state(requestId));
}

export async function saveState(state: RequestState): Promise<void> {
  await putJson(keys.state(state.requestId), { ...state, updatedAt: Date.now() });
}

/// 生成ロックを取る。取れたら RequestState、取れなかったら null。
/// 初回は条件付き書き込みなので、同時に叩かれても1つしか通らない。
export async function claimLock(
  requestId: bigint,
  tokenId: bigint,
): Promise<{ claimed: true; state: RequestState } | { claimed: false; state: RequestState | null }> {
  const now = Date.now();
  const fresh: RequestState = {
    requestId: requestId.toString(),
    tokenId: tokenId.toString(),
    status: "generating",
    attempts: 1,
    lockedAt: now,
    updatedAt: now,
  };

  if (await putJsonIfAbsent(keys.state(requestId), fresh)) {
    return { claimed: true, state: fresh };
  }

  const existing = await loadState(requestId);
  if (!existing) return { claimed: false, state: null };

  const lockIsFresh = existing.status === "generating" && now - existing.lockedAt < LOCK_TTL_MS;
  if (existing.status === "done" || lockIsFresh) {
    return { claimed: false, state: existing };
  }
  if (existing.attempts >= MAX_ATTEMPTS) {
    return { claimed: false, state: existing };
  }

  const retried: RequestState = {
    ...existing,
    status: "generating",
    attempts: existing.attempts + 1,
    lockedAt: now,
    updatedAt: now,
    error: undefined,
  };
  await saveState(retried);
  return { claimed: true, state: retried };
}
