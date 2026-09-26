import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fuseAbi, fuseNftAbi } from "./abi";
import { chain, FUSE_ADDRESS, FUSE_NFT_ADDRESS, RPC_URL } from "./config";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

export type ChildInfo = {
  parentCollection: `0x${string}`;
  parentA: bigint;
  parentB: bigint;
  requestId: bigint;
  seed: bigint;
  prevChildTokenId: bigint;
  remintCount: number;
  /// 0:None 1:Pending 2:Ready 3:Burned
  state: number;
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
