import { baseSepolia } from "viem/chains";

export const chain = baseSepolia;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

export const FUSE_ADDRESS = (process.env.NEXT_PUBLIC_FUSE_ADDRESS ?? "0x") as `0x${string}`;
export const FUSE_NFT_ADDRESS = (process.env.NEXT_PUBLIC_FUSE_NFT_ADDRESS ?? "0x") as `0x${string}`;

/// Fuse.sol の定数と一致させる。コントラクトは msg.value の完全一致を要求する。
export const MINT_PRICE_WEI = 100_000_000_000_000_000n; // 0.1 ETH
export const FUSE_FEE_WEI = 5_000_000_000_000_000n; // 0.005 ETH
/// Remintは無料。
export const REMINT_FEE_WEI = 0n;
export const GENESIS_SUPPLY = 1000;
export const MAX_MINT_PER_TX = 10;

export const EXPLORER = "https://sepolia.basescan.org";

/// 子NFTの生成状態。Fuse.GenState と同じ並び。
export const GEN_STATE = ["None", "Pending", "Ready", "Burned"] as const;
export type GenState = (typeof GEN_STATE)[number];

/// OpenAIの課金が暴走しないよう、1リクエストあたりの生成試行回数を打ち止めにする。
export const MAX_ATTEMPTS = 5;

export function isConfigured() {
  return FUSE_ADDRESS.length === 42 && FUSE_NFT_ADDRESS.length === 42;
}
