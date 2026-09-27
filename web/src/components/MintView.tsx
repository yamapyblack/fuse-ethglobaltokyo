"use client";

import Link from "next/link";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { baseSepolia } from "wagmi/chains";
import { fuseAbi } from "@/lib/abi";
import { EXPLORER, FUSE_ADDRESS, GENESIS_SUPPLY, MAX_MINT_PER_TX, MINT_PRICE_WEI, isConfigured } from "@/lib/config";
import { fuseNftAbi } from "@/lib/abi";
import { FUSE_NFT_ADDRESS } from "@/lib/config";
import { wagmiConfig } from "@/lib/wagmi";

function formatEth(wei: bigint) {
  return (Number(wei) / 1e18).toString();
}

export function MintView({ mintTx }: { mintTx: string | null }) {
  const { isConnected, chainId } = useAccount();
  const [quantity, setQuantity] = useState(1);
  const [step, setStep] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [minted, setMinted] = useState<bigint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const saleOpen = useReadContract({ address: FUSE_ADDRESS, abi: fuseAbi, functionName: "saleOpen" });
  const nextId = useReadContract({
    address: FUSE_NFT_ADDRESS,
    abi: fuseNftAbi,
    functionName: "nextTokenId",
    query: { refetchInterval: 8000 },
  });
  /// 段階的に開放するので「いま買える残り」を出す。全体の残りではない。
  const mintable = useReadContract({
    address: FUSE_ADDRESS,
    abi: fuseAbi,
    functionName: "mintableLeft",
    query: { refetchInterval: 8000 },
  });

  const sold = nextId.data ? Math.min(Number(nextId.data) - 1, GENESIS_SUPPLY) : 0;
  const left = mintable.data === undefined ? 0 : Number(mintable.data);
  const ready = isConnected && chainId === baseSepolia.id;
  const busy = step !== null;

  async function handleMint() {
    setError(null);
    setMinted([]);
    try {
      setStep("Minting…");
      const h = await writeContract(wagmiConfig, {
        address: FUSE_ADDRESS,
        abi: fuseAbi,
        functionName: "mintGenesis",
        args: [BigInt(quantity)],
        value: MINT_PRICE_WEI * BigInt(quantity),
      });
      setHash(h);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: h });
      const logs = parseEventLogs({ abi: fuseAbi, eventName: "GenesisMinted", logs: receipt.logs });
      setMinted(logs.map((l) => l.args.tokenId));
      setStep(null);
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
          Set <code>NEXT_PUBLIC_FUSE_ADDRESS</code> and <code>NEXT_PUBLIC_FUSE_NFT_ADDRESS</code>.
        </p>
      </div>
    );
  }

  return (
    <main>
      <h1>Mint a Genesis piece</h1>
      <p className="lead">
        1,000 Genesis pieces: 13 creatures, 13 sushi and 13 Japanese lucky charms.
        <br />
        Every one of them has the same Umami of 50, and each can be used in three fusions before it burns.
      </p>

      <div className="card" style={{ display: "grid", gap: 20, justifyItems: "center" }}>
        <div className="meta" style={{ maxWidth: 420 }}>
          <div>
            <span>Price</span>
            <span>{formatEth(MINT_PRICE_WEI)} ETH each</span>
          </div>
          <div>
            <span>Minted</span>
            <span>
              {sold} / {GENESIS_SUPPLY}
            </span>
          </div>
          <div>
            <span>Available now</span>
            <span>{left}</span>
          </div>
        </div>

        {!ready ? (
          <p className="note">
            {isConnected ? "Switch to Base Sepolia to continue." : "Connect your wallet to mint."}
          </p>
        ) : saleOpen.data === false ? (
          <p className="note">The sale is not open yet.</p>
        ) : left === 0 ? (
          <p className="note">This batch is sold out. The next one opens soon.</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: "center", gap: 14 }}>
              <button className="ghost" disabled={busy || quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
                −
              </button>
              <strong style={{ fontSize: 22, minWidth: 40, textAlign: "center" }}>{quantity}</strong>
              <button
                className="ghost"
                disabled={busy || quantity >= Math.min(MAX_MINT_PER_TX, left)}
                onClick={() => setQuantity((q) => q + 1)}
              >
                +
              </button>
            </div>
            <button className="primary" disabled={busy} onClick={handleMint}>
              {step ?? `Mint ${quantity} for ${formatEth(MINT_PRICE_WEI * BigInt(quantity))} ETH`}
            </button>
            <p className="note">Up to {MAX_MINT_PER_TX} per transaction.</p>
          </>
        )}

        {(hash ?? mintTx) ? (
          <p className="note">
            <a href={`${EXPLORER}/tx/${hash ?? mintTx}`} target="_blank" rel="noreferrer">
              View mint transaction on BaseScan ↗
            </a>
          </p>
        ) : null}
        {error ? <p className="warn">{error}</p> : null}
      </div>

      {minted.length > 0 ? (
        <div className="card" style={{ marginTop: 18, display: "grid", gap: 14, justifyItems: "center" }}>
          <h1 style={{ fontSize: 20 }}>Minted!</h1>
          <div className="row" style={{ justifyContent: "center" }}>
            {minted.map((id) => (
              <span key={id.toString()} className="pill">
                #{id.toString()}
              </span>
            ))}
          </div>
          <Link href="/">
            <button className="primary" type="button">
              Go fuse them
            </button>
          </Link>
        </div>
      ) : null}
    </main>
  );
}

function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied/i.test(raw)) return "Rejected in your wallet.";
  if (/SaleClosed/i.test(raw)) return "The sale is not open.";
  if (/GenesisSoldOut|SaleCapReached/i.test(raw)) return "This batch is sold out.";
  return raw.split("\n")[0];
}
