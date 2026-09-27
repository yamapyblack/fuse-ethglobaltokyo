import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fuseAbi, fuseNftAbi } from "./abi";
import { chain, FUSE_ADDRESS, FUSE_NFT_ADDRESS, RPC_URL } from "./config";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

/// Fuse.sol の Child 構造体。uint32 は number、uint256 は bigint で返る。
export type ChildInfo = {
  parentA: number;
  parentB: number;
  prevTokenId: number;
  generation: number;
  remintCount: number;
  creatureBps: number;
  sushiBps: number;
  /// 0:None 1:Pending 2:Ready 3:Burned
  state: number;
  requestId: bigint;
  seed: bigint;
};

export async function readChildInfo(tokenId: bigint): Promise<ChildInfo> {
  const info = await publicClient.readContract({
    address: FUSE_ADDRESS,
    abi: fuseAbi,
    functionName: "childInfo",
    args: [tokenId],
  });
  return info as ChildInfo;
}

let cachedMaxRemints: number | undefined;

/// Remint回数の上限。コントラクトの定数なので一度読んだら使い回す。
export async function readMaxRemints(): Promise<number> {
  if (cachedMaxRemints === undefined) {
    cachedMaxRemints = Number(
      await publicClient.readContract({
        address: FUSE_ADDRESS,
        abi: fuseAbi,
        functionName: "MAX_REMINTS",
      }),
    );
  }
  return cachedMaxRemints;
}

export async function readTokenUri(tokenId: bigint): Promise<string> {
  return publicClient.readContract({
    address: FUSE_NFT_ADDRESS,
    abi: fuseNftAbi,
    functionName: "tokenURI",
    args: [tokenId],
  });
}

/// tokenURIを確定させる。この秘密鍵はmintもburnも出金もできない。
export async function finalizeMetadata(tokenId: bigint, uri: string): Promise<`0x${string}`> {
  const pk = process.env.METADATA_SIGNER_PRIVATE_KEY;
  if (!pk) throw new Error("METADATA_SIGNER_PRIVATE_KEY is not set");

  const wallet = createWalletClient({
    account: privateKeyToAccount(pk as `0x${string}`),
    chain,
    transport: http(RPC_URL),
  });

  const hash = await wallet.writeContract({
    address: FUSE_ADDRESS,
    abi: fuseAbi,
    functionName: "finalizeMetadata",
    args: [tokenId, uri],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
