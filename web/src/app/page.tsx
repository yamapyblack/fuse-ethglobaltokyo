"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { baseSepolia } from "wagmi/chains";
import { NftCard } from "@/components/NftCard";
import { fuseAbi, fuseNftAbi } from "@/lib/abi";
import { EXPLORER, FEE_WEI, FUSE_ADDRESS, FUSE_NFT_ADDRESS, isConfigured } from "@/lib/config";
import { useOwnedTokens } from "@/lib/useOwnedTokens";
import { wagmiConfig } from "@/lib/wagmi";

type Step = { label: string; hash?: `0x${string}` } | null;

export default function SelectPage() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { tokens, isLoading } = useOwnedTokens();
  const [selected, setSelected] = useState<bigint[]>([]);
  const [step, setStep] = useState<Step>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = isConnected && chainId === baseSepolia.id;
  const busy = step !== null;

  function toggle(tokenId: bigint) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(tokenId)) return prev.filter((id) => id !== tokenId);
      if (prev.length >= 2) return prev;
      return [...prev, tokenId];
    });
  }

  /// 承認 → 配合 を1本の流れで通す。
  /// 承認は setApprovalForAll なので初回の1txだけ。2回目以降の配合では省略される。
  async function handleFuse() {
    if (selected.length !== 2 || !address) return;
    setError(null);
    try {
      const approved = await readContract(wagmiConfig, {
        address: FUSE_NFT_ADDRESS,
        abi: fuseNftAbi,
        functionName: "isApprovedForAll",
        args: [address, FUSE_ADDRESS],
      });
      if (!approved) {
        setStep({ label: "Approving…" });
        const hash = await writeContract(wagmiConfig, {
          address: FUSE_NFT_ADDRESS,
          abi: fuseNftAbi,
          functionName: "setApprovalForAll",
          args: [FUSE_ADDRESS, true],
        });
        setStep({ label: "Approving…", hash });
        await waitForTransactionReceipt(wagmiConfig, { hash });
      }

      setStep({ label: "Minting…" });
      const hash = await writeContract(wagmiConfig, {
        address: FUSE_ADDRESS,
        abi: fuseAbi,
        functionName: "fuse",
        args: [selected[0], selected[1]],
        value: FEE_WEI,
      });
      setStep({ label: "Minting…", hash });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

      const [log] = parseEventLogs({ abi: fuseAbi, eventName: "FuseRequested", logs: receipt.logs });
      if (!log) throw new Error("FuseRequested event not found in the receipt");

      router.push(`/result/${log.args.childTokenId}?tx=${hash}`);
    } catch (e) {
      setStep(null);
      setError(toMessage(e));
    }
  }

  if (!isConfigured()) {
    return (
      <div className="card center">
        <h1>Setup incomplete</h1>
        <p className="note">
          Set <code>NEXT_PUBLIC_FUSE_ADDRESS</code> and <code>NEXT_PUBLIC_FUSE_NFT_ADDRESS</code> in{" "}
          <code>.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <main>
      <h1>Pick two parents</h1>
      <p className="lead">
        The two you pick are locked in the pool forever, and an AI fuses them into one new NFT.
        <br />
        0.001 ETH + gas.
      </p>

      {!ready ? (
        <div className="card center">
          <div style={{ fontSize: 40 }}>🫧</div>
          <p className="note">
            {isConnected ? "Switch to Base Sepolia to continue." : "Connect your wallet to start."}
          </p>
        </div>
      ) : isLoading ? (
        <div className="card center">
          <div className="spinner" />
          <p className="note">Loading your NFTs…</p>
        </div>
      ) : tokens.length === 0 ? (
        <div className="card center">
          <div style={{ fontSize: 40 }}>🥚</div>
          <p className="note">No NFTs in this wallet. Mint the starter creatures first.</p>
        </div>
      ) : (
        <div className="grid">
          {tokens.map((token) => {
            const isSelected = selected.includes(token.tokenId);
            return (
              <NftCard
                key={token.tokenId.toString()}
                token={token}
                selected={isSelected}
                disabled={busy || token.pending || (!isSelected && selected.length >= 2)}
                onSelect={() => toggle(token.tokenId)}
              />
            );
          })}
        </div>
      )}

      {error ? (
        <p className="warn" style={{ marginTop: 18 }}>
          {error}
        </p>
      ) : null}

      {ready && tokens.length > 0 ? (
        <div className="actionbar">
          <div className="actionbar-inner">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {selected.length === 2
                  ? `#${selected[0]} × #${selected[1]}`
                  : `Pick ${2 - selected.length} more`}
              </div>
              <div className="note">
                {step?.hash ? (
                  <a href={`${EXPLORER}/tx/${step.hash}`} target="_blank" rel="noreferrer">
                    View transaction on BaseScan ↗
                  </a>
                ) : (
                  "0.001 ETH + gas / parents never come back"
                )}
              </div>
            </div>
            <button className="primary" disabled={selected.length !== 2 || busy} onClick={handleFuse}>
              {step ? step.label : "Fuse"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied/i.test(raw)) return "Rejected in your wallet.";
  return raw.split("\n")[0];
}
