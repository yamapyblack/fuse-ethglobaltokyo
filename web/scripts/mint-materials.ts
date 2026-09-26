/// gen-materials.ts が作ったメタデータURLで初期素材をmintする。
/// mint済みのものは materials.json に tokenId が入るのでスキップされる。
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http } from "viem";
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

  for (const material of manifest) {
    if (material.tokenId) {
      console.log(`skip #${material.index} ${material.name} (token ${material.tokenId})`);
      continue;
    }

    const nextTokenId = await publicClient.readContract({
      address: nftAddress,
      abi: fuseNftAbi,
      functionName: "nextTokenId",
    });

    console.log(`minting ${material.name} → ${recipient}…`);
    const hash = await wallet.writeContract({
      address: nftAddress,
      abi: fuseNftAbi,
      functionName: "mintMaterial",
      args: [recipient, material.metadataUrl],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    material.tokenId = nextTokenId.toString();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`  token #${material.tokenId}  ${hash}`);
  }

  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
