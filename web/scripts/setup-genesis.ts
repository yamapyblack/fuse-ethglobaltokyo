/// デプロイ後にGenesisの設定を流し込む。
///
///   1. setGenesisFamilies で8ワードを投入（2bit x 1000体）
///   2. チェーン上の値を genesis.json と突き合わせて検証
///   3. OPEN_SALE=1 なら販売を開始
///
/// 販売開始前に1回だけ実行する。familyが入っていないと全体が Creature 扱いになり、
/// 配合で生まれる子のファミリー比率が全部狂う。
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { required } from "./env";
import { fuseAbi } from "../src/lib/abi";

const FAMILIES = ["creature", "sushi", "engimono"] as const;

async function main() {
  const fuseAddress = required("NEXT_PUBLIC_FUSE_ADDRESS") as `0x${string}`;
  const account = privateKeyToAccount(required("DEPLOYER_PRIVATE_KEY") as `0x${string}`);
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

  const words = (JSON.parse(await readFile(new URL("genesis-families.json", import.meta.url), "utf8")) as string[])
    .map((w) => BigInt(w));
  const pieces = JSON.parse(await readFile(new URL("genesis.json", import.meta.url), "utf8")) as {
    tokenId: number;
    family: (typeof FAMILIES)[number];
  }[];

  console.log(`family を ${words.length} ワード投入します\n`);

  // パブリックRPCの見積もりが古い状態で計算されることがあるので、nonceは
  // ローカルで進め、ガスは倍にして送る。未使用ぶんは課金されない。
  let nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });

  for (const [i, word] of words.entries()) {
    const onChain = await publicClient.readContract({
      address: fuseAddress,
      abi: fuseAbi,
      functionName: "genesisFamily",
      args: [BigInt(i * 128 + 1)],
    }).catch(() => null);

    const estimated = await publicClient
      .estimateContractGas({ address: fuseAddress, abi: fuseAbi, functionName: "setGenesisFamilies", args: [BigInt(i), word], account })
      .catch(() => 120_000n);

    const hash = await wallet.writeContract({
      address: fuseAddress,
      abi: fuseAbi,
      functionName: "setGenesisFamilies",
      args: [BigInt(i), word],
      nonce: nonce++,
      gas: estimated * 2n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`word ${i} reverted: ${hash}`);
    console.log(`  word ${i}  ${hash}${onChain === null ? "" : ""}`);
  }

  // --- 検証: チェーン上の値が割り当て表と一致するか ---
  console.log("\n検証中…");
  const sample = [1, 2, 128, 129, 500, 512, 513, 999, 1000].filter((id) => id <= pieces.length);
  let bad = 0;
  for (const tokenId of sample) {
    const onChain = await publicClient.readContract({
      address: fuseAddress,
      abi: fuseAbi,
      functionName: "genesisFamily",
      args: [BigInt(tokenId)],
    });
    const expected = pieces.find((p) => p.tokenId === tokenId)!.family;
    const actual = FAMILIES[Number(onChain)];
    const ok = actual === expected;
    if (!ok) bad++;
    console.log(`  #${String(tokenId).padEnd(5)} ${ok ? "✓" : "✗"} chain=${actual} expected=${expected}`);
  }
  if (bad > 0) throw new Error(`${bad} 件が不一致。販売を開始しないこと`);

  if (process.env.OPEN_SALE === "1") {
    const hash = await wallet.writeContract({
      address: fuseAddress,
      abi: fuseAbi,
      functionName: "setSaleOpen",
      args: [true],
      nonce: nonce++,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`\n販売を開始しました  ${hash}`);
  } else {
    console.log("\nfamily の投入が完了しました。販売開始は OPEN_SALE=1 を付けて再実行してください。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
