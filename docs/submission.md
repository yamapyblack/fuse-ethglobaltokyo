# ETHGlobal submission

提出フォームに貼る文面。文字数はフォームの制約に合わせてある
（Short description は100文字以内、他は280文字以上）。

**親は burn していない。** プールへ transfer するだけでトークンは存在し続ける
（ownerOf はプールを返し、totalSupply も減らない）。本物の burn は Remint で
子を焼くときだけ。この2つを同じ動詞で書かないこと。コントラクトは BaseScan で
検証済みなので、fuse() が safeTransferFrom しか呼んでいないことは審査員が
その場で確認できる。

## Links

| | |
| --- | --- |
| Live | https://fuse-ethglobaltokyo.vercel.app |
| Demo (60s) | https://fuse-ethglobaltokyo.vercel.app/demo.mp4 |
| Source | https://github.com/yamapyblack/fuse-ethglobaltokyo |
| FuseNFT | https://sepolia.basescan.org/address/0x96d0d610671b4240AcAC0F5B7De18f2f94749559 |
| FusePool | https://sepolia.basescan.org/address/0x8E648661964bc1Fb82037EaDA2e712eC58907665 |
| Fuse | https://sepolia.basescan.org/address/0xFF9116784747986f8c5D2c10c63D6f9a681268a1 |

## Short description (94/100)

```
NFT gacha: lock two away for good, an AI fuses them into one. Rerolling burns what you pulled.
```

## Description (1057 chars)

```
Fuse turns two NFTs you own into a single new one. Pick two, pay 0.001 ETH, and both parents move into a pool contract that has no way to send anything back out. It is not a burn address and not a promise in the docs: the pool's entire implementation is a single receive hook, with no withdraw, no approve, no owner and no upgrade path. A child NFT is minted to you in the same transaction, and an AI then fuses the two parent images into its artwork.

If you don't like what you got, Remint burns that child and rolls a new one from the same two parents. It costs another 0.001 ETH, each child can be reminted at most three times, and there is no side-by-side comparison, no history and no undo. Exactly one result is ever on screen. That is the whole product: a gacha where the price of rerolling is the thing you already have.

Half of the 26 starter pieces are sushi, on purpose. Two similar creatures fuse into something that could just be a third creature, and nobody watching can tell it happened. A creature fused with nigiri is obvious at a glance.
```

## How it's made (1335 chars)

```
Three Foundry contracts on Base Sepolia, all verified. FuseNFT is one ERC-721 holding both starter pieces and fused children. FusePool is where parents go, and its whole implementation is onERC721Received — no withdraw, no owner, no upgrade — so "they never come back" is the absence of code rather than a claim. Fuse owns fuse(), remint() and finalizeMetadata(), and splits authority three ways: the deploy key mints starters, the backend key can only write a tokenURI, anyone can fuse for 0.001 ETH. Fusion traits come from a seed derived on-chain from block data and a requestId.

Off-chain is one Next.js app on Vercel, with OpenAI's image edit endpoint taking both parent PNGs and Cloudflare R2 holding the results.

Vercel can't run a worker, so there is no event listener: the browser pokes /api/generate and the server checks the chain itself. The only way in is a tokenId somebody paid 0.001 ETH to put into Pending. There is no database either — R2 conditional writes are the lock, and every step asks whether it already happened, so a timed-out generation resumes without a second mint or a second payment.

What bit us: after a redeploy, requestIds restart at 1. A fresh fuse read the previous deployment's state record, saw "done", and never generated anything. R2 keys are now namespaced by chain id and contract address.
```
