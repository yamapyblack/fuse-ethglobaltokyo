import { baseSepolia } from "viem/chains";

export const chain = baseSepolia;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

export const FUSE_ADDRESS = (process.env.NEXT_PUBLIC_FUSE_ADDRESS ?? "0x") as `0x${string}`;
export const FUSE_NFT_ADDRESS = (process.env.NEXT_PUBLIC_FUSE_NFT_ADDRESS ?? "0x") as `0x${string}`;

/// Fuse.FEE と一致させる。コントラクト側は msg.value の完全一致を要求する。
export const FEE_WEI = 1_000_000_000_000_000n; // 0.001 ETH

export const EXPLORER = "https://sepolia.basescan.org";

/// 子NFTの生成状態。Fuse.GenState と同じ並び。
export const GEN_STATE = ["None", "Pending", "Ready", "Burned"] as const;
export type GenState = (typeof GEN_STATE)[number];

/// OpenAIの課金が暴走しないよう、1リクエストあたりの生成試行回数を打ち止めにする。
export const MAX_ATTEMPTS = 5;

export function isConfigured() {
  return FUSE_ADDRESS.length === 42 && FUSE_NFT_ADDRESS.length === 42;
}
