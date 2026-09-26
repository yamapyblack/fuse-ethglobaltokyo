"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { fuseAbi } from "@/lib/abi";
import { EXPLORER, FEE_WEI, FUSE_ADDRESS, MAX_ATTEMPTS } from "@/lib/config";
import { wagmiConfig } from "@/lib/wagmi";

type Status = {
  tokenId: string;
  chainState: "None" | "Pending" | "Ready" | "Burned" | "Unknown";
  requestId: string;
  rerollCount: number;
  seed: string;
  parents: { tokenId: string; image: string | null }[];
  tokenUri: string | null;
  image: string | null;
  request: { status: "generating" | "done" | "failed"; attempts: number; error: string | null } | null;
};

const POLL_MS = 4000;
/// 生成の再キックはこの間隔まで。バックエンド側にもロックがあるので連打しても二重生成しない。
const KICK_INTERVAL_MS = 25_000;
/// パブリックRPCはtx直後にまだ古い状態を返すことがある。Fuse直後に「子ではない」と
/// 誤判定しないよう、この回数連続で None を見るまでは確認中として扱う。
const NONE_TOLERANCE = 4;

export function ResultView({ tokenId }: { tokenId: string }) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [status, setStatus] = useState<Status | null>(null);
  const [noneStreak, setNoneStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const lastKick = useRef(0);

  const kick = useCallback(async (force = false) => {
    if (!force && Date.now() - lastKick.current < KICK_INTERVAL_MS) return;
    lastKick.current = Date.now();
    try {
      await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, force }),
      });
    } catch {
      // ポーリングが次の周回で拾うので、ここでは握りつぶす
    }
  }, [tokenId]);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const res = await fetch(`/api/status?tokenId=${tokenId}`, { cache: "no-store" });
        const data = (await res.json()) as Status & { error?: string };
        if (!alive) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setStatus(data);
        setNoneStreak((n) => (data.chainState === "None" ? n + 1 : 0));
        if (data.chainState === "Pending") void kick();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tokenId, kick]);

  async function handleReroll() {
    setConfirming(false);
    setRerolling(true);
    setError(null);
    try {
      const hash = await writeContract(wagmiConfig, {
        address: FUSE_ADDRESS,
        abi: fuseAbi,
        functionName: "reroll",
        args: [BigInt(tokenId)],
        value: FEE_WEI,
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      const [log] = parseEventLogs({ abi: fuseAbi, eventName: "RerollRequested", logs: receipt.logs });
      if (!log) throw new Error("RerollRequested イベントが見つかりませんでした");
      router.push(`/result/${log.args.childTokenId}`);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setRerolling(false);
    }
  }

  if (error && !status) {
    return (
      <div className="card center">
        <h1>読み込めませんでした</h1>
        <p className="note">{error}</p>
        <Link href="/">もどる</Link>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="card center">
        <div className="spinner" />
        <p className="note">状態を確認中…</p>
      </div>
    );
  }

  // txが取り込まれた直後はRPCがまだ古い状態を返すことがあるので、少し待ってから判定する
  if (status.chainState === "None" && noneStreak < NONE_TOLERANCE) {
    return (
      <div className="card center">
        <div className="spinner" />
        <p className="note">チェーンの状態を確認中…</p>
      </div>
    );
  }

  if (status.chainState === "None") {
    return (
      <div className="card center">
        <h1>子NFTではありません</h1>
        <p className="note">#{tokenId} は配合で生まれたNFTではないので、Rerollできません。</p>
        <Link href="/">もどる</Link>
      </div>
    );
  }

  if (status.chainState === "Burned") {
    return (
      <div className="card center">
        <div style={{ fontSize: 40 }}>🔥</div>
        <h1>このNFTはRerollで焼かれました</h1>
        <p className="note">#{tokenId} はもう存在しません。新しい子NFTをご確認ください。</p>
        <Link href="/">もどる</Link>
      </div>
    );
  }

  const failedForGood = status.request?.status === "failed" && status.request.attempts >= MAX_ATTEMPTS;
  const generating = status.chainState === "Pending";

  return (
    <main className="card result">
      <div className="parents">
        {status.parents.map((p) => (
          <span key={p.tokenId} className="row" style={{ gap: 6 }}>
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="parent-thumb" src={p.image} alt={`#${p.tokenId}`} />
            ) : (
              <span className="parent-thumb" />
            )}
            #{p.tokenId}
          </span>
        ))}
        <span>→</span>
        <strong style={{ color: "var(--lavender-deep)" }}>#{status.tokenId}</strong>
      </div>

      {generating ? (
        <>
          <div className="result-art" style={{ display: "grid", placeItems: "center" }}>
            <div style={{ display: "grid", gap: 14, justifyItems: "center" }}>
              <div className="spinner" />
              <div className="pulse note">AIが2体を配合しています…</div>
            </div>
          </div>
          <p className="note">
            30〜60秒ほどかかります。この画面を開いたままお待ちください。
            {status.request ? `（試行 ${status.request.attempts} 回目）` : null}
          </p>
          {failedForGood ? (
            <div className="warn">
              生成が {status.request?.attempts} 回失敗しました：{status.request?.error}
              <br />
              追加の課金なしで再試行できます。
              <div style={{ marginTop: 10 }}>
                <button className="ghost" onClick={() => void kick(true)}>
                  もう一度試す
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {status.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="result-art" src={status.image} alt={`#${status.tokenId}`} />
          ) : (
            <div className="result-art thumb-empty">画像を読み込めませんでした</div>
          )}
          <h1>できました！</h1>
          <p className="note">
            この子NFTはもう発行済みです。満足ならこのまま終了で大丈夫です。
          </p>
        </>
      )}

      <div className="meta">
        <div>
          <span>tokenId</span>
          <span>#{status.tokenId}</span>
        </div>
        <div>
          <span>Reroll回数</span>
          <span>{status.rerollCount}</span>
        </div>
        <div>
          <span>seed</span>
          <span>{status.seed.slice(0, 12)}…</span>
        </div>
        {status.tokenUri ? (
          <div>
            <span>tokenURI</span>
            <a href={status.tokenUri} target="_blank" rel="noreferrer">
              metadata
            </a>
          </div>
        ) : null}
        <div>
          <span>コントラクト</span>
          <a href={`${EXPLORER}/address/${FUSE_ADDRESS}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      </div>

      {error ? <p className="warn">{error}</p> : null}

      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/">
          <button className="ghost" type="button">
            トップへ
          </button>
        </Link>
        <button
          className="danger"
          disabled={generating || rerolling || !isConnected}
          onClick={() => setConfirming(true)}
        >
          {rerolling ? "Reroll中…" : "Reroll (0.001 ETH)"}
        </button>
      </div>
      {generating ? <p className="note">生成が終わるまでRerollはできません。</p> : null}

      {confirming ? (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h1 style={{ fontSize: 20 }}>本当にRerollしますか？</h1>
            <div className="warn">
              現在のNFT #{status.tokenId} は<strong>burnされ、元に戻せません</strong>。
              <br />
              新しい子NFTが別のtokenIdで発行され、画面はその結果に置き換わります。
              <br />
              親 #{status.parents[0]?.tokenId} と #{status.parents[1]?.tokenId} は再投入されません。
            </div>
            <p className="note">0.001 ETH ＋ ガス代がかかります。新旧の比較や元に戻す操作はありません。</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirming(false)}>
                やめる
              </button>
              <button className="danger" onClick={handleReroll}>
                burnしてReroll
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied/i.test(raw)) return "ウォレットで拒否されました。";
  return raw.split("\n")[0];
}
