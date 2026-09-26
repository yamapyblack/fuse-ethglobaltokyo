"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <button
        className="primary"
        disabled={!connector || isPending}
        onClick={() => connector && connect({ connector })}
      >
        {isPending ? "接続中…" : "ウォレット接続"}
      </button>
    );
  }

  if (chainId !== baseSepolia.id) {
    return (
      <button className="danger" onClick={() => switchChain({ chainId: baseSepolia.id })}>
        Base Sepoliaに切り替え
      </button>
    );
  }

  return (
    <button className="ghost" onClick={() => disconnect()}>
      {address?.slice(0, 6)}…{address?.slice(-4)}
    </button>
  );
}
