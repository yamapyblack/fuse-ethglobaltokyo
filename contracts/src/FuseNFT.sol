// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721Royalty} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title FuseNFT
/// @notice Genesis と配合で生まれた子を同じコレクションに収めるERC-721。
///         mint / burn / tokenURI設定は Fuse コントラクトだけが呼べる。
/// @dev v1と違い親を転送しないので、ユーザーからこのコントラクトへの承認は不要。
contract FuseNFT is ERC721, ERC721Enumerable, ERC721Royalty, Ownable {
    using Strings for uint256;

    /// @notice Genesisの発行上限。これ以下のtokenIdがGenesis、超えたら子。
    uint256 public constant GENESIS_SUPPLY = 1000;

    address public fuseContract;

    /// @dev Genesisは baseURI + tokenId + ".json"。1000件のSSTOREを避ける。
    string private _genesisBaseURI;
    /// @dev 子は生成後に個別設定する。
    mapping(uint256 tokenId => string uri) private _childURI;

    uint256 private _nextTokenId = 1;

    error NotFuseContract();
    error FuseContractAlreadySet();
    error ZeroAddress();
    error GenesisSoldOut();
    error NonexistentToken();

    event FuseContractSet(address fuseContract);
    event GenesisBaseURISet(string baseURI);

    modifier onlyFuse() {
        if (msg.sender != fuseContract) revert NotFuseContract();
        _;
    }

    constructor(address initialOwner, string memory genesisBaseURI_, address royaltyReceiver, uint96 royaltyBps)
        ERC721("Fuse", "FUSE")
        Ownable(initialOwner)
    {
        _genesisBaseURI = genesisBaseURI_;
        _setDefaultRoyalty(royaltyReceiver, royaltyBps);
    }

    /// @notice Fuse コントラクトを紐付ける。差し替えによる乗っ取りを防ぐため再設定は不可。
    function setFuseContract(address fuseContract_) external onlyOwner {
        if (fuseContract != address(0)) revert FuseContractAlreadySet();
        if (fuseContract_ == address(0)) revert ZeroAddress();
        fuseContract = fuseContract_;
        emit FuseContractSet(fuseContract_);
    }

    /// @notice Genesisの画像を差し替える必要が出たときのため。売り切り後は触らない想定。
    function setGenesisBaseURI(string calldata baseURI_) external onlyOwner {
        _genesisBaseURI = baseURI_;
        emit GenesisBaseURISet(baseURI_);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
    }

    function mintGenesis(address to) external onlyFuse returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        if (tokenId > GENESIS_SUPPLY) revert GenesisSoldOut();
        _nextTokenId = tokenId + 1;
        _safeMint(to, tokenId);
    }

    /// @notice 子のmint。画像生成前なので tokenURI は空のまま。
    function mintChild(address to) external onlyFuse returns (uint256 tokenId) {
        tokenId = _nextTokenId;
        // Genesisを売り切る前でも子は作れるよう、子は必ずGENESIS_SUPPLYより後ろに置く
        if (tokenId <= GENESIS_SUPPLY) tokenId = GENESIS_SUPPLY + 1;
        while (_ownerOf(tokenId) != address(0)) tokenId++;
        if (tokenId >= _nextTokenId) _nextTokenId = tokenId + 1;
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external onlyFuse {
        _burn(tokenId);
    }

    /// @notice 生成完了後に tokenURI を確定させる。再設定の禁止は Fuse 側で担保する。
    function setChildTokenURI(uint256 tokenId, string calldata uri) external onlyFuse {
        _childURI[tokenId] = uri;
    }

    function tokenURI(uint256 tokenId) public view override(ERC721) returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken();
        if (tokenId <= GENESIS_SUPPLY) {
            return string.concat(_genesisBaseURI, tokenId.toString(), ".json");
        }
        return _childURI[tokenId];
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

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721Royalty)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
