# Fuse

2体のNFTを消費して、AIが合成した1体を生み出す。Remintは今の子NFTを捨てる、後戻りできないガチャ。

- チェーン: Base Sepolia (84532)
- ストレージ: Cloudflare R2
- 画像生成: OpenAI 画像編集API（親2枚を同時入力して1枚合成）
- ホスティング: Vercel

要件は [docs/fuse-requirements.md](docs/fuse-requirements.md)。

## デプロイ済み (Base Sepolia)

| コントラクト | アドレス |
| --- | --- |
| FuseNFT | [`0x0d32356ae050406DD2b33C6CdB14B2A7867f06cA`](https://sepolia.basescan.org/address/0x0d32356ae050406DD2b33C6CdB14B2A7867f06cA) |
| FusePool | [`0x70ae089e5a45BAd2cdB3b3f42a4bD2c509c375DF`](https://sepolia.basescan.org/address/0x70ae089e5a45BAd2cdB3b3f42a4bD2c509c375DF) |
| Fuse | [`0x926b31D4BA670e2AAAF14962A34d157c7fFCC222`](https://sepolia.basescan.org/address/0x926b31D4BA670e2AAAF14962A34d157c7fFCC222) |

初期素材6体をmint済み。動作確認で #1 と #2 を配合して子 #7 を作り、Remintで #8 に焼き直したため、
**残りの素材は #3 #4 #5 #6 の4体**（＝あと2回配合できる）。

`web/.env.local` に以下を入れること。

```
NEXT_PUBLIC_FUSE_ADDRESS=0x926b31D4BA670e2AAAF14962A34d157c7fFCC222
NEXT_PUBLIC_FUSE_NFT_ADDRESS=0x0d32356ae050406DD2b33C6CdB14B2A7867f06cA
```

## 構成

```
contracts/   Foundry。FuseNFT / FusePool / Fuse
web/         Next.js (App Router)。画面2枚 + バックエンドAPI
```

### コントラクト3本

| 名前 | 役割 |
| --- | --- |
| `FuseNFT` | 初期素材と子を同居させるERC-721。mint/burn/tokenURI設定は `Fuse` だけが呼べる |
| `FusePool` | 親の永久保管先。`onERC721Received` しか実装していないので、入ったNFTは誰も動かせない |
| `Fuse` | `fuse()` / `remint()` / `finalizeMetadata()`。料金・所有権・親2体が別個体であることを検証する |

権限は3つに分かれている。

- **owner**（デプロイ鍵）: 初期素材のmint、手数料ETHの引き出し、metadataSignerの差し替え
- **metadataSigner**（バックエンド鍵）: `finalizeMetadata` のみ。mintもburnも出金もできない
- **誰でも**: `fuse` / `remint`（0.001 ETH）

### 生成フロー

```
[ブラウザ] setApprovalForAll(初回のみ) → fuse() → 子NFTがPendingでmintされる
        ↓ tx確定後に POST /api/generate { tokenId }
[サーバー] childInfo(tokenId) をチェーンから読む
        → Pending でなければ何もしない（これが唯一の入場券）
        → R2に生成ロックを取る（条件付き書き込みなので同時実行でも1回だけ）
        → 親画像をR2にスナップショット → OpenAIで合成 → 画像とJSONをR2へ
        → finalizeMetadata(tokenId, url) を metadataSigner で送信
[ブラウザ] GET /api/status?tokenId= を4秒おきにポーリングして結果を表示
```

Vercelには常駐ワーカーが置けないため、イベント検知のポーリングワーカーではなく
「画面が叩いてサーバーがチェーンで裏を取る」形にしている。呼び出し側の言い分は一切信用せず、
0.001 ETHを払って `Pending` になったtokenIdだけが生成される。

### 失敗しても追加課金にならない理由

`state/{requestId}.json` に試行回数と進捗を持たせ、工程ごとに「すでに済んでいるか」を見てから進む。

- 画像がR2にある → OpenAIを呼ばない
- チェーンが既にReady → `finalizeMetadata` を送らない
- ロックが新しいうちは何度叩いても即 `generating` を返す（古くなったロックは奪える）
- 試行は5回で打ち止め。画面から手動で再試行できる

再mintも追加の支払いも発生しない。完成後のメタデータは `Pending` 以外を弾くので上書きできない。

## セットアップ

### 1. コントラクトのテスト

```bash
cd contracts && forge test
```

### 2. R2バケットを作って公開する

Cloudflare R2でバケットを1つ作り、3つ設定する。

1. **Public Development URL を Enable** — 発行される `https://pub-xxxxxxxx.r2.dev` が
   `R2_PUBLIC_BASE_URL`。tokenURIがこのURLを指すので、HTTPSで誰でも読める必要がある
2. **CORS Policy** — 選択画面はブラウザから直接メタデータJSONを `fetch` するので必須。
   これが無いと所有NFTの画像が出ない（`<img>` での画像表示だけなら不要）

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

   公開読み取り専用なので `*` でよい。Vercelのプレビューデプロイは毎回URLが変わるため、
   オリジンを固定すると逆に詰まる
3. **R2 APIトークン** — R2 → `{} API` → Manage API tokens から作る。この導線なら
   Access Key ID と Secret Access Key が表示される（汎用のAccount API tokens画面から作ると
   Bearerトークンになり、S3クライアントでは使えない）。権限は **Object Read & Write**。
   書き込みのみだと「生成済みならOpenAIを呼ばない」判定で使う HeadObject / GetObject が通らない

`R2_ACCOUNT_ID` はバケット詳細のS3 APIエンドポイント `https://<account_id>.r2.cloudflarestorage.com/...`
のサブドメイン部分。

### 3. 鍵を2つ用意する

デプロイ用とメタデータ確定用は分ける。どちらもBase SepoliaのテストETHを入れておく
（[faucet](https://www.alchemy.com/faucets/base-sepolia)）。

### 4. デプロイ

```bash
cd contracts
cp .env.example .env   # DEPLOYER_PRIVATE_KEY と METADATA_SIGNER_ADDRESS を埋める
set -a && source .env && set +a
forge script script/Deploy.s.sol:Deploy --rpc-url https://sepolia.base.org --broadcast
```

アドレスは `contracts/deployments/84532.json` に書き出される。
BaseScanで検証する場合は `--verify --etherscan-api-key $BASESCAN_API_KEY` を足す。

### 5. web/.env.local を作る

```bash
cd web && cp .env.example .env.local
```

デプロイしたアドレス、`METADATA_SIGNER_PRIVATE_KEY`、`OPENAI_API_KEY`、R2の値を埋める。

### 6. 初期素材6体を作ってmint

```bash
cd web
pnpm install
pnpm check:r2         # 先にR2の疎通だけ確認する（OpenAIは呼ばない）
pnpm gen:materials    # OpenAIで6枚生成 → R2へ。2回目以降は既存をスキップ
pnpm mint:materials   # mintMaterial × 6。mint済みはスキップ
```

`MATERIAL_RECIPIENT` を設定すればデモ用ウォレット宛にmintできる（既定はデプロイ鍵のアドレス）。

### 7. 起動

```bash
pnpm dev
```

Vercelにデプロイする場合は `web/` をルートに指定し、`.env.example` の変数を環境変数に入れる
（`NEXT_PUBLIC_*` 以外はサーバー専用なのでブラウザには渡らない）。

## 画面

1. `/` — 所有NFTから親2体を選び、承認 → fuse。承認は `setApprovalForAll` なので初回の1txだけ
2. `/result/[tokenId]` — 生成状態・結果1体・Remint。Remint前に burn の確認ダイアログを出す

新旧比較・過去候補の選択・元に戻す機能は意図的に作っていない。画面に出る結果は常に1体。

## デモ動画（60〜90秒）

収録する流れ:

1. 初期素材の一覧から親2体を選ぶ
2. 承認（`setApprovalForAll`、初回のみ1tx）
3. Fuse（0.001 ETH）
4. 生成中 → 結果1体（**待ち時間をカットした旨をテロップで出す**）
5. Remintボタン → 「burnされ、元に戻せません」の確認
6. 新しい結果に置き換わる

## 対象外

- **子NFTを親にして再Fuse**: コントラクト上は可能（親の条件を絞っていない）が、
  UI・デモとしては想定していない。素材にした子はプール所有になるので、その子のRemintは
  所有者チェックで自然に弾かれる
- 外部NFTの一般対応、売買、対戦、能力値、レア度、SNS連携、独自通貨
- IPFS（R2のみ）
- 完全な再現性・公平な乱数の保証（seedはブロック情報とrequestIdから算出する簡易版）

## 既知の制約

- **Vercel Hobbyプランは関数実行が60秒上限**。画像生成が30〜60秒かかるため、
  タイムアウトすることがある。その場合も状態レコードから再開できる（追加課金なし）。
  Proプランなら `maxDuration = 300` がそのまま効く
- 画面を閉じたまま放置すると生成が始まらない。結果画面を開き直せば再開する
- 画像生成モデルは `OPENAI_IMAGE_MODEL` で差し替え可（既定 `gpt-image-1`）
