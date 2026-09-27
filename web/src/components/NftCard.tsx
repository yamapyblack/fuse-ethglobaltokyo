"use client";

export type OwnedToken = {
  tokenId: bigint;
  image: string | null;
  name: string | null;
  /// tokenURI未設定 = 画像生成待ちの子NFT
  pending: boolean;
  /// 残りの配合回数。0になった時点でburnされるので、1のものは次で消える。
  chargesLeft: number | null;
};

export function NftCard({
  token,
  selected,
  disabled,
  onSelect,
}: {
  token: OwnedToken;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="nft"
      data-selected={selected}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      {token.image ? (
        // R2の画像をそのまま出す
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={token.image} alt={`#${token.tokenId}`} />
      ) : (
        <div className="thumb thumb-empty">{token.pending ? "Generating…" : "No image"}</div>
      )}
      <div className="nft-id">
        <span>#{token.tokenId.toString()}</span>
        {token.chargesLeft !== null ? (
          <span className="pill" data-warn={token.chargesLeft === 1}>
            {token.chargesLeft === 1 ? "last fuse" : `${token.chargesLeft} left`}
          </span>
        ) : token.name ? (
          <span className="pill">{token.name}</span>
        ) : null}
      </div>
      {selected ? <span className="check">✓</span> : null}
    </button>
  );
}
