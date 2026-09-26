"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { OwnedToken } from "@/components/NftCard";
import { fuseNftAbi } from "./abi";
import { FUSE_NFT_ADDRESS } from "./config";

/// 所有NFTの一覧 + それぞれのメタデータを引く。選択画面用。
export function useOwnedTokens() {
  const { address } = useAccount();

  const owned = useReadContract({
    address: FUSE_NFT_ADDRESS,
    abi: fuseNftAbi,
    functionName: "tokensOfOwner",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const tokenIds = (owned.data ?? []) as readonly bigint[];

  const uris = useReadContracts({
    contracts: tokenIds.map((tokenId) => ({
      address: FUSE_NFT_ADDRESS,
      abi: fuseNftAbi,
      functionName: "tokenURI" as const,
      args: [tokenId] as const,
    })),
    query: { enabled: tokenIds.length > 0 },
  });

  const uriList = (uris.data ?? []).map((r) => (r.status === "success" ? (r.result as string) : ""));

  const metadata = useQuery({
    queryKey: ["metadata", uriList],
    enabled: uriList.length > 0,
    queryFn: async (): Promise<OwnedToken[]> =>
      Promise.all(
        tokenIds.map(async (tokenId, i) => {
          const uri = uriList[i];
          if (!uri) return { tokenId, image: null, name: null, pending: true };
          try {
            const res = await fetch(uri);
            if (!res.ok) throw new Error("metadata fetch failed");
            const meta = (await res.json()) as { image?: string; name?: string };
            return {
              tokenId,
              image: meta.image ?? null,
              name: meta.name ?? null,
              pending: false,
            };
          } catch {
            return { tokenId, image: null, name: null, pending: false };
          }
        }),
      ),
  });

  return {
    tokens: metadata.data ?? tokenIds.map((tokenId) => ({ tokenId, image: null, name: null, pending: !uriList.length })),
    isLoading: owned.isLoading || uris.isLoading || metadata.isLoading,
    refetch: async () => {
      await owned.refetch();
      await uris.refetch();
    },
  };
}
