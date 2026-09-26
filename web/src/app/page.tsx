"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { baseSepolia } from "wagmi/chains";
import { NftCard } from "@/components/NftCard";
import { fuseAbi, fuseNftAbi } from "@/lib/abi";
import { FEE_WEI, FUSE_ADDRESS, FUSE_NFT_ADDRESS, isConfigured } from "@/lib/config";
import { useOwnedTokens } from "@/lib/useOwnedTokens";
import { wagmiConfig } from "@/lib/wagmi";

type Step = { label: string } | null;

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
        setStep({ label: "承認中…" });
        const hash = await writeContract(wagmiConfig, {
          address: FUSE_NFT_ADDRESS,
          abi: fuseNftAbi,
          functionName: "setApprovalForAll",
          args: [FUSE_ADDRESS, true],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
      }

      setStep({ label: "配合中…" });
      const hash = await writeContract(wagmiConfig, {
        address: FUSE_ADDRESS,
        abi: fuseAbi,
        functionName: "fuse",
        args: [selected[0], selected[1]],
        value: FEE_WEI,
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

      const [log] = parseEventLogs({ abi: fuseAbi, eventName: "FuseRequested", logs: receipt.logs });
      if (!log) throw new Error("FuseRequested イベントが見つかりませんでした");

      router.push(`/result/${log.args.childTokenId}`);
    } catch (e) {
      setStep(null);
      setError(toMessage(e));
    }
  }

  if (!isConfigured()) {
    return (
      <div className="card center">
        <h1>セットアップ未完了</h1>
        <p className="note">
          <code>.env.local</code> に <code>NEXT_PUBLIC_FUSE_ADDRESS</code> と{" "}
          <code>NEXT_PUBLIC_FUSE_NFT_ADDRESS</code> を設定してください。
        </p>
      </div>
    );
  }

  return (
    <main>
      <h1>親を2体えらぶ</h1>
      <p className="lead">
        選んだ2体はプールへ永久にロックされ、AIが合成した子NFTが1体生まれます。
        <br />
        料金は 0.001 ETH ＋ ガス代。
      </p>

      {!ready ? (
        <div className="card center">
          <div style={{ fontSize: 40 }}>🫧</div>
          <p className="note">
            {isConnected ? "Base Sepolia に切り替えてください。" : "ウォレットを接続してください。"}
          </p>
        </div>
      ) : isLoading ? (
        <div className="card center">
          <div className="spinner" />
          <p className="note">NFTを読み込み中…</p>
        </div>
      ) : tokens.length === 0 ? (
        <div className="card center">
          <div style={{ fontSize: 40 }}>🥚</div>
          <p className="note">このウォレットにNFTがありません。初期素材をmintしてから試してください。</p>
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
                  : `あと ${2 - selected.length} 体えらぶ`}
              </div>
              <div className="note">0.001 ETH ＋ ガス代 / 親は戻ってきません</div>
            </div>
            <button className="primary" disabled={selected.length !== 2 || busy} onClick={handleFuse}>
              {step ? step.label : "配合する"}
            </button>
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
