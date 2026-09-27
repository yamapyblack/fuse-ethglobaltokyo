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
  state: (requestId: string | number | bigint) => `${scope()}/state/${requestId}.json`,
  /// 親画像のスナップショット。Remint時も必ずここから読むので同じ2枚が使われる。
  parentSnapshot: (tokenId: string | number | bigint) => `${scope()}/snapshots/parent-${tokenId}.png`,
  childImage: (tokenId: string | number | bigint) => `${scope()}/images/child-${tokenId}.png`,
  childMetadata: (tokenId: string | number | bigint) => `${scope()}/metadata/child-${tokenId}.json`,

  /// Genesisはコントラクトの genesisBaseURI が指す場所。mint済みのtokenURIが
  /// ここを指すので、デプロイをまたいでも変えない。
  genesisImage: (tokenId: number | bigint) => `genesis/images/${tokenId}.png`,
  genesisMetadata: (tokenId: number | bigint) => `genesis/${tokenId}.json`,
};

/// tokenId だけから画像のキーを決める。
/// **チェーンを読まないことが重要。** v2では3回使い切った親がburnされるので、
/// tokenURI(親) を読む方式だと配合直後に親が消えていて解決できない。
export function imageKeyOf(tokenId: number | bigint, genesisSupply: number): string {
  return BigInt(tokenId) <= BigInt(genesisSupply)
    ? keys.genesisImage(tokenId)
    : keys.childImage(tokenId);
}
