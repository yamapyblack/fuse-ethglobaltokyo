/// R2のキー設計。1箇所にまとめて、再試行時に同じキーを引けるようにする。
export const keys = {
  /// requestId単位の進行状況。これが再試行の冪等性の土台。
  state: (requestId: string | bigint) => `state/${requestId}.json`,
  /// 親画像のスナップショット。Remint時も必ずここから読むので同じ2枚が使われる。
  parentSnapshot: (tokenId: string | bigint) => `snapshots/parent-${tokenId}.png`,
  childImage: (tokenId: string | bigint) => `images/child-${tokenId}.png`,
  childMetadata: (tokenId: string | bigint) => `metadata/child-${tokenId}.json`,
  materialImage: (index: number) => `images/material-${index}.png`,
  materialMetadata: (index: number) => `metadata/material-${index}.json`,
};
