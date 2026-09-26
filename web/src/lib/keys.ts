import { chain, FUSE_ADDRESS } from "./config";

/// 子NFT由来のキーはデプロイ単位で名前空間を分ける。
/// requestId も子のtokenId もコントラクトを撒き直すと1から振り直されるため、
/// 分けないと旧デプロイの状態レコードや画像を拾ってしまう。
function scope() {
  return `c/${chain.id}/${FUSE_ADDRESS.toLowerCase()}`;
}

/// R2のキー設計。1箇所にまとめて、再試行時に同じキーを引けるようにする。
export const keys = {
  /// requestId単位の進行状況。これが再試行の冪等性の土台。
  state: (requestId: string | bigint) => `${scope()}/state/${requestId}.json`,
  /// 親画像のスナップショット。Remint時も必ずここから読むので同じ2枚が使われる。
  parentSnapshot: (tokenId: string | bigint) => `${scope()}/snapshots/parent-${tokenId}.png`,
  childImage: (tokenId: string | bigint) => `${scope()}/images/child-${tokenId}.png`,
  childMetadata: (tokenId: string | bigint) => `${scope()}/metadata/child-${tokenId}.json`,

  // 素材のキーは mint 済みの tokenURI が指しているので、デプロイをまたいでも変えない
  materialImage: (index: number) => `images/material-${index}.png`,
  materialMetadata: (index: number) => `metadata/material-${index}.json`,
};
