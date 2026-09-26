# Fuse

Burn two NFTs. An AI fuses them into one. Remint throws the current child away — an irreversible gacha.

- Chain: Base Sepolia (84532)
- Storage: Cloudflare R2
- Image generation: OpenAI image edit API (both parent images go in, one fused image comes out)
- Starter set: 13 pastel creatures + 13 pastel sushi
- Hosting: Vercel

**Live: https://fuse-ethglobaltokyo.vercel.app**

**Demo (60s): https://fuse-ethglobaltokyo.vercel.app/demo.mp4**

> MetaMask shows a "deceptive site" warning on this URL. It is a Blockaid false positive:
> `*.vercel.app` is a shared free-hosting domain that phishing kits abuse heavily, so a new
> subdomain asking to connect a wallet gets flagged by pattern alone. The contracts and the
> source are all in this repo. To avoid the warning entirely, run it locally (see Setup).

Requirements (Japanese): [docs/fuse-requirements.md](docs/fuse-requirements.md)

## Deployed (Base Sepolia)

| Contract | Address |
| --- | --- |
| FuseNFT | [`0x96d0d610671b4240AcAC0F5B7De18f2f94749559`](https://sepolia.basescan.org/address/0x96d0d610671b4240AcAC0F5B7De18f2f94749559) |
| FusePool | [`0x8E648661964bc1Fb82037EaDA2e712eC58907665`](https://sepolia.basescan.org/address/0x8E648661964bc1Fb82037EaDA2e712eC58907665) |
| Fuse | [`0xFF9116784747986f8c5D2c10c63D6f9a681268a1`](https://sepolia.basescan.org/address/0xFF9116784747986f8c5D2c10c63D6f9a681268a1) |

All three are verified on BaseScan, so the source is readable from the links above.

The starter set is 26 pieces (#1–#26): **13 creatures (#1–#13) and 13 sushi (#14–#26)**.
Anything minted after #26 is a fused child.

Half the set is sushi on purpose. Fusing two similar creatures produces something that could just be
a third creature, so a demo viewer cannot tell a fusion happened. Creature × sushi makes it obvious
at a glance.

Put these in `web/.env.local`:

```
NEXT_PUBLIC_FUSE_ADDRESS=0xFF9116784747986f8c5D2c10c63D6f9a681268a1
NEXT_PUBLIC_FUSE_NFT_ADDRESS=0x96d0d610671b4240AcAC0F5B7De18f2f94749559
```

## Layout

```
contracts/   Foundry. FuseNFT / FusePool / Fuse
web/         Next.js (App Router). Two screens + backend API
```

### Three contracts

| Name | Role |
| --- | --- |
| `FuseNFT` | One ERC-721 holding both starter creatures and fused children. Only `Fuse` can mint, burn, or set a tokenURI |
| `FusePool` | Where parents go to stay. It implements nothing but `onERC721Received`, so whatever lands there can never be moved again |
| `Fuse` | `fuse()` / `remint()` / `finalizeMetadata()`. Checks the fee, ownership, and that the two parents are distinct. A child can be reminted at most 3 times (`MAX_REMINTS`) |

Three separate authorities:

- **owner** (deploy key): mints starter creatures, withdraws collected ETH, rotates the metadata signer
- **metadataSigner** (backend key): `finalizeMetadata` only. It cannot mint, burn, or withdraw
- **anyone**: `fuse` / `remint` for 0.001 ETH

### Generation flow

```
[browser] setApprovalForAll (first time only) -> fuse() -> child NFT is minted as Pending
        | after the tx lands: POST /api/generate { tokenId }
[server]  read childInfo(tokenId) from chain
        -> do nothing unless it is Pending (this is the only ticket in)
        -> take a generation lock in R2 (conditional write, so concurrent calls collapse to one)
        -> snapshot both parent images to R2 -> fuse with OpenAI -> store image + JSON in R2
        -> send finalizeMetadata(tokenId, url) as the metadata signer
[browser] poll GET /api/status?tokenId= every 4s and render the result
```

Vercel cannot host a long-running worker, so instead of a polling event listener the browser pokes
the server and the server verifies the claim against the chain. Nothing the caller says is trusted:
only a tokenId that someone paid 0.001 ETH to put into `Pending` will ever be generated.

### Why a failed generation never costs extra

`state/{requestId}.json` tracks attempts and progress, and every step checks whether it is already done.

- Image already in R2 -> OpenAI is not called
- Chain already Ready -> `finalizeMetadata` is not sent
- While the lock is fresh, repeated calls return `generating` immediately (a stale lock can be taken over)
- Capped at 5 automatic attempts; the screen offers an explicit retry that bypasses the cap

No re-mint, no second payment. Metadata cannot be overwritten either, since `finalizeMetadata`
rejects anything that is not `Pending`.

## Setup

### 1. Run the contract tests

```bash
cd contracts && forge test
```

### 2. Create an R2 bucket and make it public

Create one bucket in Cloudflare R2 and configure three things.

1. **Enable the Public Development URL** — the resulting `https://pub-xxxxxxxx.r2.dev` is your
   `R2_PUBLIC_BASE_URL`. tokenURIs point at it, so it has to be publicly readable over HTTPS.
2. **CORS policy** — required, because the selection screen fetches metadata JSON directly from the
   browser. Without it the owned NFTs render without images (plain `<img>` loading would be fine).

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   `*` is fine for a public read-only bucket. Pinning the origin actually gets in the way, since
   Vercel preview deployments get a fresh URL every time.
3. **R2 API token** — create it from R2 -> `{} API` -> Manage API tokens. That path shows you an
   Access Key ID and a Secret Access Key. (Creating one from the generic Account API tokens screen
   gives you a Bearer token, which an S3 client cannot use.) Permission must be
   **Object Read & Write** — write-only breaks the HeadObject/GetObject checks that keep a retry
   from calling OpenAI again.

`R2_ACCOUNT_ID` is the subdomain of the bucket's S3 API endpoint,
`https://<account_id>.r2.cloudflarestorage.com/...`.

### 3. Prepare two keys

Keep the deploy key and the metadata key separate. Fund both with Base Sepolia test ETH
([faucet](https://www.alchemy.com/faucets/base-sepolia)).

### 4. Deploy

```bash
cd contracts
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY and METADATA_SIGNER_ADDRESS
set -a && source .env && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url https://sepolia.base.org --broadcast
```

Addresses are written to `contracts/deployments/84532.json`.
Add `--verify --etherscan-api-key $BASESCAN_API_KEY` to verify on BaseScan.

### 5. Create web/.env.local

```bash
cd web && cp .env.example .env.local
```

Fill in the deployed addresses, `METADATA_SIGNER_PRIVATE_KEY`, `OPENAI_API_KEY`, and the R2 values.

### 6. Generate and mint the starter creatures

```bash
cd web
pnpm install
pnpm check:r2         # verify R2 connectivity first (does not call OpenAI)
pnpm gen:materials    # generate with OpenAI -> R2. Re-runs skip what already exists
pnpm mint:materials   # mintMaterial. Scans the chain and skips what is already minted
```

Set `MATERIAL_RECIPIENT` to mint to a demo wallet (defaults to the deploy key's address).

### 7. Run it

```bash
pnpm dev
```

To deploy on Vercel, set `web/` as the root directory and add the variables from `.env.example`
as environment variables. Everything except `NEXT_PUBLIC_*` stays server-side.

## Screens

1. `/` — pick two parents from the wallet, approve, fuse. Approval is `setApprovalForAll`,
   so it costs one transaction the first time and nothing after that
2. `/result/[tokenId]` — generation status, the single result, and Remint. Remint is behind a
   burn confirmation dialog and shows how many remints are left

All on-screen text is English. While a mint is in flight the screen links to the transaction on BaseScan.

There is deliberately no side-by-side comparison, no history of past candidates, and no undo.
Exactly one result is ever on screen.

## Demo video

[fuse-ethglobaltokyo.vercel.app/demo.mp4](https://fuse-ethglobaltokyo.vercel.app/demo.mp4)
(source: [web/public/demo.mp4](web/public/demo.mp4)) — 60 seconds, no audio, recorded against a
local build so MetaMask's `*.vercel.app` warning does not get in the way.

It runs the whole path end to end: connect, switch to Base Sepolia, pick #16 Tamago Nigiri and
#6 Pearl Draco, approve, fuse, watch the generation, see the result, then Remint it behind the burn
confirmation and land on a different child from the same two parents. The generation wait is cut.

The two children make the point: same parents, visibly different results. That is what Remint is.

## Out of scope

- **Fusing a child again as a parent**: the contract allows it (parents are not restricted), but it
  is not part of the UI or the demo. A child used as a parent moves to the pool, so its Remint is
  naturally rejected by the ownership check
- Arbitrary external NFT collections, trading, battles, stats, rarity, social integrations, a token
- IPFS (R2 only)
- Reproducibility or fair randomness — the seed is derived from block data plus the requestId

## Known limitations

- **Vercel's Hobby plan caps functions at 60s** while generation takes 30–60s, so it can time out.
  The run resumes from the state record at no extra cost. On Pro, `maxDuration = 300` applies as written
- Generation does not start while the page is closed. Reopening the result page resumes it
- The image model is swappable via `OPENAI_IMAGE_MODEL` (default `gpt-image-1`)
- If the deploy wallet is an EIP-7702 delegated smart account, `_safeMint` invokes
  `onERC721Received` on it and gas estimates from the public RPC can fall short. The mint script
  doubles its estimate; if a wallet transaction fails with "out of gas", raise the limit by hand
