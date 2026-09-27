"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { OwnedToken } from "@/components/NftCard";
import { fuseAbi, fuseNftAbi } from "./abi";
import { FUSE_ADDRESS, FUSE_NFT_ADDRESS } from "./config";

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

  /// 残り配合回数。3回目で親が焼かれるので、選ぶ前に見えている必要がある。
  const charges = useReadContracts({
    contracts: tokenIds.map((tokenId) => ({
      address: FUSE_ADDRESS,
      abi: fuseAbi,
      functionName: "chargesLeft" as const,
      args: [tokenId] as const,
    })),
    query: { enabled: tokenIds.length > 0 },
  });
  const chargeList = (charges.data ?? []).map((r) => (r.status === "success" ? Number(r.result) : null));

  const metadata = useQuery({
    queryKey: ["metadata", uriList, chargeList],
    enabled: uriList.length > 0,
    queryFn: async (): Promise<OwnedToken[]> =>
      Promise.all(
        tokenIds.map(async (tokenId, i) => {
          const uri = uriList[i];
          if (!uri) return { tokenId, image: null, name: null, pending: true, chargesLeft: chargeList[i] ?? null };
          try {
            const res = await fetch(uri);
            if (!res.ok) throw new Error("metadata fetch failed");
            const meta = (await res.json()) as { image?: string; name?: string };
            return {
              tokenId,
              image: meta.image ?? null,
              name: meta.name ?? null,
              pending: false,
              chargesLeft: chargeList[i] ?? null,
            };
          } catch {
            return { tokenId, image: null, name: null, pending: false, chargesLeft: chargeList[i] ?? null };
          }
        }),
      ),
  });

  return {
    tokens: metadata.data ?? tokenIds.map((tokenId) => ({ tokenId, image: null, name: null, pending: !uriList.length, chargesLeft: null })),
    isLoading: owned.isLoading || uris.isLoading || charges.isLoading || metadata.isLoading,
    refetch: async () => {
      await owned.refetch();
      await uris.refetch();
    },
  };
}
