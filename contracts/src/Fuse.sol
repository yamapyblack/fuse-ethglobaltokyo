// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FuseNFT} from "./FuseNFT.sol";
import {FusePool} from "./FusePool.sol";

/// @title Fuse
/// @notice 親2体を消費して子1体を生む。子はRemintで焼き直せる。画像生成はオフチェーン。
contract Fuse is Ownable, ReentrancyGuard {
    /// @notice 子NFTの生成状態。
    /// - None:    そもそも子ではない（初期素材）
    /// - Pending: mint済み・画像生成待ち。この間はRemint不可
    /// - Ready:   tokenURI確定済み
    /// - Burned:  Remintで焼かれた
    enum GenState {
        None,
        Pending,
        Ready,
        Burned
    }

    struct ChildInfo {
        address parentCollection;
        uint256 parentA;
        uint256 parentB;
        uint256 requestId;
        uint256 seed;
        uint256 prevChildTokenId;
        uint32 remintCount;
        GenState state;
    }

    uint256 public constant FEE = 0.001 ether;

    /// 1体の子をRemintできる回数の上限。使い切ったらその子で確定する。
    uint32 public constant MAX_REMINTS = 3;

    FuseNFT public immutable nft;
    FusePool public immutable pool;

    /// @notice tokenURI を確定できるバックエンドのアドレス。mintもburnも出金もできない。
    address public metadataSigner;

    uint256 private _nextRequestId = 1;
    mapping(uint256 tokenId => ChildInfo info) private _children;

    /// @notice requestId から子tokenIdを引く。バックエンドの再試行に使う。
    mapping(uint256 requestId => uint256 tokenId) public tokenIdOfRequest;

    error IncorrectFee();
    error SameParent();
    error NotParentOwner();
    error NotChild();
    error NotChildOwner();
    error GenerationInProgress();
    error AlreadyBurned();
    error RemintLimitReached();
    error NotMetadataSigner();
    error NotPending();
    error ZeroAddress();
    error WithdrawFailed();

    event FuseRequested(
        uint256 indexed requestId,
        uint256 indexed childTokenId,
        address indexed owner,
        uint256 parentA,
        uint256 parentB,
        uint256 seed
    );
    event RemintRequested(
        uint256 indexed requestId,
        uint256 indexed childTokenId,
        address indexed owner,
        uint256 prevChildTokenId,
        uint256 parentA,
        uint256 parentB,
        uint256 seed,
        uint32 remintCount
    );
    event MetadataFinalized(uint256 indexed requestId, uint256 indexed childTokenId, string tokenURI);
    event MetadataSignerSet(address metadataSigner);

    constructor(FuseNFT nft_, FusePool pool_, address metadataSigner_, address initialOwner) Ownable(initialOwner) {
        if (address(nft_) == address(0) || address(pool_) == address(0) || metadataSigner_ == address(0)) {
            revert ZeroAddress();
        }
        nft = nft_;
        pool = pool_;
        metadataSigner = metadataSigner_;
    }

    /// @notice 親2体をプールへ永久ロックし、子1体をmintする。画像はまだ無い。
    /// @dev 呼び出し前に、親2体への approve か setApprovalForAll でこのコントラクトを承認しておく必要がある。
    function fuse(uint256 parentA, uint256 parentB)
        external
        payable
        nonReentrant
        returns (uint256 childTokenId, uint256 requestId)
    {
        if (msg.value != FEE) revert IncorrectFee();
        if (parentA == parentB) revert SameParent();
        if (nft.ownerOf(parentA) != msg.sender || nft.ownerOf(parentB) != msg.sender) revert NotParentOwner();

        // 出庫機能を持たないプールへ送るので、この2体は二度と動かせない
        nft.safeTransferFrom(msg.sender, address(pool), parentA);
        nft.safeTransferFrom(msg.sender, address(pool), parentB);

        childTokenId = nft.mintChild(msg.sender);
        requestId = _nextRequestId++;

        _children[childTokenId] = ChildInfo({
            parentCollection: address(nft),
            parentA: parentA,
            parentB: parentB,
            requestId: requestId,
            seed: _seed(requestId, childTokenId),
            prevChildTokenId: 0,
            remintCount: 0,
            state: GenState.Pending
        });
        tokenIdOfRequest[requestId] = childTokenId;

        emit FuseRequested(requestId, childTokenId, msg.sender, parentA, parentB, _children[childTokenId].seed);
    }

    /// @notice 今の子を焼いて、別tokenIdの子を新しく生む。親は再投入しない。
    /// @dev 1系統あたり MAX_REMINTS 回まで。
    /// @dev 素材として使われた子はプール所有になっているので、所有者チェックで自然に弾かれる。
    function remint(uint256 tokenId) external payable nonReentrant returns (uint256 newTokenId, uint256 requestId) {
        if (msg.value != FEE) revert IncorrectFee();

        ChildInfo storage prev = _children[tokenId];
        if (prev.state == GenState.None) revert NotChild();
        if (prev.state == GenState.Burned) revert AlreadyBurned();
        if (prev.state == GenState.Pending) revert GenerationInProgress();
        if (nft.ownerOf(tokenId) != msg.sender) revert NotChildOwner();
        if (prev.remintCount >= MAX_REMINTS) revert RemintLimitReached();

        uint256 parentA = prev.parentA;
        uint256 parentB = prev.parentB;
        uint32 remintCount = prev.remintCount + 1;
        prev.state = GenState.Burned;

        nft.burnChild(tokenId);
        newTokenId = nft.mintChild(msg.sender);
        requestId = _nextRequestId++;

        _children[newTokenId] = ChildInfo({
            parentCollection: address(nft),
            parentA: parentA,
            parentB: parentB,
            requestId: requestId,
            seed: _seed(requestId, newTokenId),
            prevChildTokenId: tokenId,
            remintCount: remintCount,
            state: GenState.Pending
        });
        tokenIdOfRequest[requestId] = newTokenId;

        emit RemintRequested(
            requestId,
            newTokenId,
            msg.sender,
            tokenId,
            parentA,
            parentB,
            _children[newTokenId].seed,
            remintCount
        );
    }

    /// @notice 生成完了後にバックエンドが tokenURI を確定させる。Pending以外は受け付けないので上書きは不可。
    function finalizeMetadata(uint256 tokenId, string calldata uri) external {
        if (msg.sender != metadataSigner) revert NotMetadataSigner();

        ChildInfo storage info = _children[tokenId];
        if (info.state != GenState.Pending) revert NotPending();
        info.state = GenState.Ready;

        nft.setChildTokenURI(tokenId, uri);
        emit MetadataFinalized(info.requestId, tokenId, uri);
    }

    function setMetadataSigner(address metadataSigner_) external onlyOwner {
        if (metadataSigner_ == address(0)) revert ZeroAddress();
        metadataSigner = metadataSigner_;
        emit MetadataSignerSet(metadataSigner_);
    }

    /// @notice 集まった手数料(ETH)の引き出し。プールのNFTには一切触れられない。
    function withdrawFees(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = payable(to).call{value: address(this).balance}("");
        if (!ok) revert WithdrawFailed();
    }

    function childInfo(uint256 tokenId) external view returns (ChildInfo memory) {
        return _children[tokenId];
    }

    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }

    /// @dev 取り込まれたブロック情報とrequestIdから算出する。公平な乱数は保証しない（要件対象外）。
    function _seed(uint256 requestId, uint256 tokenId) private view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(block.prevrandao, block.number, block.timestamp, requestId, tokenId, address(this))
            )
        );
    }
}
