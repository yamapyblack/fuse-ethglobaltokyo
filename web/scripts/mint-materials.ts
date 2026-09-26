/// gen-materials.ts が作ったメタデータURLで初期素材をmintする。
///
/// 何がmint済みかはローカルのJSONではなく**チェーンを走査して**判断する。
/// パブリックRPCは直前のtxを反映していない値を返すことがあるので、
/// nonceは最初に1回だけ取ってローカルで進め、tokenIdはTransferイベントから読む。
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { required } from "./env";
import { fuseNftAbi } from "../src/lib/abi";

type Manifest = {
  index: number;
  name: string;
  imageUrl: string;
  metadataUrl: string;
  tokenId?: string;
}[];

const manifestPath = new URL("materials.json", import.meta.url);

async function main() {
  const nftAddress = required("NEXT_PUBLIC_FUSE_NFT_ADDRESS") as `0x${string}`;
  const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as `0x${string}`);
  const recipient = (process.env.MATERIAL_RECIPIENT ?? account.address) as `0x${string}`;
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // --- 既存トークンを走査して metadataUrl → tokenId を復元する ---
  const nextTokenId = await publicClient.readContract({
    address: nftAddress,
    abi: fuseNftAbi,
    functionName: "nextTokenId",
  });

  for (const m of manifest) delete m.tokenId;

  for (let id = 1n; id < nextTokenId; id++) {
    const uri = await publicClient
      .readContract({ address: nftAddress, abi: fuseNftAbi, functionName: "tokenURI", args: [id] })
      .catch(() => "");
    const hit = manifest.find((m) => m.metadataUrl === uri);
    if (hit) hit.tokenId = id.toString();
  }
  await save();

  const minted = manifest.filter((m) => m.tokenId);
  console.log(`チェーン上の既存素材: ${minted.length} / ${manifest.length}`);
  for (const m of minted) console.log(`  #${m.tokenId} ${m.name}`);

  const todo = manifest.filter((m) => !m.tokenId);
  if (todo.length === 0) {
    console.log("\nすべてmint済み。");
    return;
  }
  console.log("");

  // --- 足りないぶんをmint。nonceはローカルで進める ---
  let nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });

  for (const material of todo) {
    console.log(`minting ${material.name} → ${recipient} (nonce ${nonce})…`);
    const hash = await wallet.writeContract({
      address: nftAddress,
      abi: fuseNftAbi,
      functionName: "mintMaterial",
      args: [recipient, material.metadataUrl],
      nonce: nonce++,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`mint reverted: ${hash}`);

    // tokenIdは推測せず、実際に発行されたTransferイベントから読む
    const [transfer] = parseEventLogs({ abi: fuseNftAbi, eventName: "Transfer", logs: receipt.logs });
    if (!transfer) throw new Error(`Transfer イベントが見つかりません: ${hash}`);

    material.tokenId = transfer.args.tokenId.toString();
    await save();
    console.log(`  token #${material.tokenId}  ${hash}`);
  }

  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
