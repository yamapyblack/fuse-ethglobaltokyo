// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FuseNFT
/// @notice 初期素材と配合で生まれた子を同じコレクションに収めるERC-721。
///         mint / burn / tokenURI設定は Fuse コントラクトだけが呼べる。
contract FuseNFT is ERC721, ERC721Enumerable, ERC721URIStorage, Ownable {
    /// @notice fuse/reroll を実行するコントラクト。一度だけ設定できる。
    address public fuseContract;

    uint256 private _nextTokenId = 1;

    error NotFuseContract();
    error FuseContractAlreadySet();
    error ZeroAddress();

    event FuseContractSet(address fuseContract);

    modifier onlyFuse() {
        if (msg.sender != fuseContract) revert NotFuseContract();
        _;
    }

    constructor(address initialOwner) ERC721("Fuse", "FUSE") Ownable(initialOwner) {}

    /// @notice Fuse コントラクトを紐付ける。差し替えによる乗っ取りを防ぐため再設定は不可。
    function setFuseContract(address fuseContract_) external onlyOwner {
        if (fuseContract != address(0)) revert FuseContractAlreadySet();
        if (fuseContract_ == address(0)) revert ZeroAddress();
        fuseContract = fuseContract_;
        emit FuseContractSet(fuseContract_);
    }

    /// @notice 初期素材のmint。デプロイ時にスクリプトから6〜8体だけ発行する。
    function mintMaterial(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    /// @notice 子NFTのmint。画像生成前なので tokenURI は空のまま。
    function mintChild(address to) external onlyFuse returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }

    /// @notice Reroll で現在の子を焼く。
    function burnChild(uint256 tokenId) external onlyFuse {
        _burn(tokenId);
    }

    /// @notice 画像生成の完了後に tokenURI を確定させる。再設定の禁止は Fuse 側で担保する。
    function setChildTokenURI(uint256 tokenId, string calldata uri) external onlyFuse {
        _setTokenURI(tokenId, uri);
    }

    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice 選択画面用。所有NFTの一覧を1回のcallで返す。
    function tokensOfOwner(address owner) external view returns (uint256[] memory tokenIds) {
        uint256 count = balanceOf(owner);
        tokenIds = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    // --- 多重継承の解決 ---

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
