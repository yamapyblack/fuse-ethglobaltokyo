"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { fuseAbi } from "@/lib/abi";
import { EXPLORER, FUSE_ADDRESS, MAX_ATTEMPTS, REMINT_FEE_WEI } from "@/lib/config";
import { wagmiConfig } from "@/lib/wagmi";

type Status = {
  tokenId: string;
  chainState: "None" | "Pending" | "Ready" | "Burned" | "Unknown";
  requestId: string;
  remintCount: number;
  maxRemints: number;
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

export function ResultView({ tokenId, fuseTx }: { tokenId: string; fuseTx: string | null }) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [status, setStatus] = useState<Status | null>(null);
  const [noneStreak, setNoneStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [remintTx, setRemintTx] = useState<`0x${string}` | null>(null);
  const [reminting, setReminting] = useState(false);
  /// Remintが通って新しい子のページへ移る途中。古いtokenIdはこの間にBurnedへ変わる。
  const [leaving, setLeaving] = useState(false);
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
    if (leaving) return;
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
  }, [tokenId, kick, leaving]);

  async function handleRemint() {
    setConfirming(false);
    setReminting(true);
    setError(null);
    setRemintTx(null);
    try {
      const hash = await writeContract(wagmiConfig, {
        address: FUSE_ADDRESS,
        abi: fuseAbi,
        functionName: "remint",
        args: [BigInt(tokenId)],
        value: REMINT_FEE_WEI,
      });
      setRemintTx(hash);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      const [log] = parseEventLogs({ abi: fuseAbi, eventName: "RemintRequested", logs: receipt.logs });
      if (!log) throw new Error("RemintRequested event not found in the receipt");
      setLeaving(true);
      router.push(`/result/${log.args.childTokenId}?tx=${hash}`);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setReminting(false);
    }
  }

  if (error && !status) {
    return (
      <div className="card center">
        <h1>Could not load</h1>
        <p className="note">{error}</p>
        <Link href="/">Back</Link>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="card center">
        <div className="spinner" />
        <p className="note">Checking on-chain state…</p>
      </div>
    );
  }

  // txが取り込まれた直後はRPCがまだ古い状態を返すことがあるので、少し待ってから判定する
  if (status.chainState === "None" && noneStreak < NONE_TOLERANCE) {
    return (
      <div className="card center">
        <div className="spinner" />
        <p className="note">Checking on-chain state…</p>
      </div>
    );
  }

  if (status.chainState === "None") {
    return (
      <div className="card center">
        <h1>Not a fused NFT</h1>
        <p className="note">#{tokenId} was not created by fusing, so it cannot be reminted.</p>
        <Link href="/">Back</Link>
      </div>
    );
  }

  if (status.chainState === "Burned") {
    // Remint直後は、新しい子のページへ移る前に古いtokenIdがBurnedになる。
    // ここで焼失画面を出すと赤い画面が1〜2秒挟まって事故に見えるので抑える。
    if (reminting || leaving) {
      return (
        <div className="card center">
          <div className="spinner" />
          <p className="note">Opening your new NFT…</p>
        </div>
      );
    }
    return (
      <div className="card center">
        <div style={{ fontSize: 40 }}>🔥</div>
        <h1>Burned by a Remint</h1>
        <p className="note">#{tokenId} no longer exists. Check the new NFT instead.</p>
        <Link href="/">Back</Link>
      </div>
    );
  }

  const failedForGood = status.request?.status === "failed" && status.request.attempts >= MAX_ATTEMPTS;
  const generating = status.chainState === "Pending";
  const remintsLeft = Math.max(0, status.maxRemints - status.remintCount);
  const pendingTx = remintTx ?? (generating ? fuseTx : null);

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
              <div className="pulse note">An AI is fusing the two…</div>
            </div>
          </div>
          <p className="note">Takes 30–60 seconds. Keep this page open.</p>
          {failedForGood ? (
            <div className="warn">
              Generation failed: {status.request?.error}
              <br />
              You can retry at no extra cost.
              <div style={{ marginTop: 10 }}>
                <button className="ghost" onClick={() => void kick(true)}>
                  Try again
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
            <div className="result-art thumb-empty">Could not load the image</div>
          )}
          <h1>Done!</h1>
          <p className="note">
            Your NFT is already minted. If you are happy with it, you can stop right here.
          </p>
        </>
      )}

      {pendingTx ? (
        <p className="note">
          <a href={`${EXPLORER}/tx/${pendingTx}`} target="_blank" rel="noreferrer">
            View mint transaction on BaseScan ↗
          </a>
        </p>
      ) : null}

      <div className="meta">
        <div>
          <span>tokenId</span>
          <span>#{status.tokenId}</span>
        </div>
        <div>
          <span>Remints used</span>
          <span>
            {status.remintCount} / {status.maxRemints}
          </span>
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
          <span>Contract</span>
          <a href={`${EXPLORER}/address/${FUSE_ADDRESS}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      </div>

      {error ? <p className="warn">{error}</p> : null}

      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/">
          <button className="ghost" type="button">
            Home
          </button>
        </Link>
        <button
          className="danger"
          disabled={generating || reminting || !isConnected || remintsLeft === 0}
          onClick={() => setConfirming(true)}
        >
          {reminting ? "Reminting…" : "Remint (free)"}
        </button>
      </div>
      {generating ? (
        <p className="note">Remint is locked while the image is being generated.</p>
      ) : remintsLeft === 0 ? (
        <p className="note">
          No remints left ({status.maxRemints} of {status.maxRemints} used). This one is final.
        </p>
      ) : (
        <p className="note">
          {remintsLeft} of {status.maxRemints} remints left.
        </p>
      )}

      {confirming ? (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h1 style={{ fontSize: 20 }}>Remint this NFT?</h1>
            <div className="warn">
              #{status.tokenId} will be <strong>burned and cannot be recovered</strong>.
              <br />
              A new NFT is minted with a different tokenId, and this page is replaced with the new
              result.
              <br />
              Parents #{status.parents[0]?.tokenId} and #{status.parents[1]?.tokenId} are not
              consumed again.
            </div>
            <p className="note">
              Free apart from gas. No side-by-side comparison, no undo. {remintsLeft} of{" "}
              {status.maxRemints} remints left.
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="danger" onClick={handleRemint}>
                Burn &amp; Remint
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
  if (/User rejected|User denied/i.test(raw)) return "Rejected in your wallet.";
  if (/RemintLimitReached/i.test(raw)) return "This NFT has used all of its remints.";
  return raw.split("\n")[0];
}
