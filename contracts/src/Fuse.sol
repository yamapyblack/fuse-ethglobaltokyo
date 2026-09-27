// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FuseNFT} from "./FuseNFT.sol";

/// @title Fuse
/// @notice Genesisの販売と、2体を配合して1体を生む処理。
///
/// @dev レアリティを意図的に作っていない。数値は umami ひとつだけで、
///      Genesisは一律50、子は均等乱数。排出率に偏りをつけず、階級も大当たりも設けない。
///      日本法人が有償のランダム性を扱うための設計なので、
///      「盛り上がるから」という理由でレア度を足さないこと。
contract Fuse is Ownable, ReentrancyGuard {
    enum GenState {
        None,
        Pending,
        Ready,
        Burned
    }

    enum Family {
        Creature,
        Sushi,
        Engimono
    }

    /// @notice 1体が配合に使える回数。使い切るとburnされる。
    uint8 public constant FUSE_CHARGES = 3;
    /// @notice 1体をRemintできる回数。
    uint8 public constant MAX_REMINTS = 3;
    /// @notice Genesisのumamiは全体で同じ。販売時点で数値の当たり外れを作らないため。
    uint8 public constant GENESIS_UMAMI = 50;

    uint256 public constant MINT_PRICE = 0.05 ether;
    uint256 public constant FUSE_FEE = 0.005 ether;
    uint256 public constant MAX_MINT_PER_TX = 10;

    struct Child {
        uint32 parentA;
        uint32 parentB;
        uint32 prevTokenId;
        uint8 generation;
        uint8 remintCount;
        uint16 creatureBps;
        uint16 sushiBps;
        GenState state;
        uint256 requestId;
        uint256 seed;
    }

    /// @notice オンチェーンで真である属性。GenesisでもChildでも引ける。
    struct Attributes {
        uint8 generation;
        uint8 umami;
        uint16 creatureBps;
        uint16 sushiBps;
        uint16 engimonoBps;
    }

    /// @notice 見た目のトレイト。seedから導出するので子だけが持つ。
    /// @dev Genesisの見た目は事前生成した画像で決まっており、チェーン上には無い。
    ///      偽のseedをでっち上げて返すとメタデータと絵が食い違うので、Genesisでは revert する。
    struct Traits {
        uint8 mood;
        uint8 accent;
        uint8 charm;
        uint8 pose;
    }

    FuseNFT public immutable nft;

    /// @notice tokenURI を確定できるバックエンドのアドレス。mintもburnも出金もできない。
    address public metadataSigner;
    bool public saleOpen;

    uint256 private _nextRequestId = 1;
    /// @dev 既に何回配合に使ったか。未使用は0なので初期化不要。
    mapping(uint256 tokenId => uint8 used) public fusesUsed;
    mapping(uint256 tokenId => Child info) private _children;
    /// @dev Genesisのfamilyを2bitずつ詰める。1000体で8ワード。
    uint256[8] private _genesisFamilyBits;

    mapping(uint256 requestId => uint256 tokenId) public tokenIdOfRequest;

    error IncorrectPayment();
    error SaleClosed();
    error InvalidQuantity();
    error SameParent();
    error NotOwner();
    error NoChargesLeft();
    error ParentNotReady();
    error NotChild();
    error GenerationInProgress();
    error AlreadyBurned();
    error RemintLimitReached();
    error NotMetadataSigner();
    error NotPending();
    error ZeroAddress();
    error WithdrawFailed();
    error GenesisTraitsAreOffchain();

    event GenesisMinted(address indexed to, uint256 indexed tokenId);
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
        uint256 seed,
        uint8 remintCount
    );
    event ParentConsumed(uint256 indexed tokenId, uint8 usedTotal, bool burned);
    event MetadataFinalized(uint256 indexed requestId, uint256 indexed childTokenId, string tokenURI);

    constructor(FuseNFT nft_, address metadataSigner_, address initialOwner) Ownable(initialOwner) {
        if (address(nft_) == address(0) || metadataSigner_ == address(0)) revert ZeroAddress();
        nft = nft_;
        metadataSigner = metadataSigner_;
    }

    // --- Genesis 販売 ---

    function mintGenesis(uint256 quantity) external payable nonReentrant {
        if (!saleOpen) revert SaleClosed();
        if (quantity == 0 || quantity > MAX_MINT_PER_TX) revert InvalidQuantity();
        if (msg.value != MINT_PRICE * quantity) revert IncorrectPayment();

        for (uint256 i; i < quantity; ++i) {
            uint256 tokenId = nft.mintGenesis(msg.sender);
            emit GenesisMinted(msg.sender, tokenId);
        }
    }

    function setSaleOpen(bool open) external onlyOwner {
        saleOpen = open;
    }

    /// @notice Genesisのfamilyを2bitずつ詰めた値を入れる。販売開始前に1回だけ。
    function setGenesisFamilies(uint256 wordIndex, uint256 word) external onlyOwner {
        _genesisFamilyBits[wordIndex] = word;
    }

    // --- 配合 ---

    /// @notice 2体を配合して1体生む。親は転送せず、配合回数を1ずつ消費する。
    ///         3回使い切った親はこのtxでburnされる。
    /// @dev 親を転送しないので、事前の approve / setApprovalForAll は不要。
    function fuse(uint256 parentA, uint256 parentB)
        external
        payable
        nonReentrant
        returns (uint256 childTokenId, uint256 requestId)
    {
        if (msg.value != FUSE_FEE) revert IncorrectPayment();
        if (parentA == parentB) revert SameParent();
        if (nft.ownerOf(parentA) != msg.sender || nft.ownerOf(parentB) != msg.sender) revert NotOwner();
        // 生成中の子は親にできない。画像がまだ無いので、配合してもバックエンドが
        // 親画像を引けず永久にPendingのままになる。
        if (_children[parentA].state == GenState.Pending) revert ParentNotReady();
        if (_children[parentB].state == GenState.Pending) revert ParentNotReady();

        // burnすると読めなくなるので、属性は先に確定させる。
        // ブロックで囲って一時変数を早く捨てないとスタックが溢れる。
        Child memory c;
        {
            (uint16 cA, uint16 sA,) = familyBpsOf(parentA);
            (uint16 cB, uint16 sB,) = familyBpsOf(parentB);
            c.creatureBps = (cA + cB) / 2;
            c.sushiBps = (sA + sB) / 2;
        }
        {
            uint8 genA = generationOf(parentA);
            uint8 genB = generationOf(parentB);
            c.generation = (genA > genB ? genA : genB) + 1;
        }

        _consumeCharge(parentA);
        _consumeCharge(parentB);

        childTokenId = nft.mintChild(msg.sender);
        requestId = _nextRequestId++;

        c.parentA = uint32(parentA);
        c.parentB = uint32(parentB);
        c.state = GenState.Pending;
        c.requestId = requestId;
        c.seed = _seed(requestId, childTokenId);
        _children[childTokenId] = c;
        tokenIdOfRequest[requestId] = childTokenId;

        emit FuseRequested(requestId, childTokenId, msg.sender, parentA, parentB, c.seed);
    }

    /// @dev 配合回数を1消費し、使い切っていたらburnする。
    function _consumeCharge(uint256 tokenId) private {
        uint8 used = fusesUsed[tokenId] + 1;
        if (used > FUSE_CHARGES) revert NoChargesLeft();
        fusesUsed[tokenId] = used;

        bool willBurn = used == FUSE_CHARGES;
        if (willBurn) {
            if (_children[tokenId].state != GenState.None) _children[tokenId].state = GenState.Burned;
            nft.burn(tokenId);
        }
        emit ParentConsumed(tokenId, used, willBurn);
    }

    /// @notice 今の子を焼いて、別tokenIdの子を新しく生む。親は再投入しないので無料。
    /// @dev 配合回数は引き継ぐ。リセットできると無料で繁殖力を回復できてしまう。
    function remint(uint256 tokenId) external payable nonReentrant returns (uint256 newTokenId, uint256 requestId) {
        if (msg.value != 0) revert IncorrectPayment();

        Child memory p = _children[tokenId];
        if (p.state == GenState.None) revert NotChild();
        if (p.state == GenState.Burned) revert AlreadyBurned();
        if (p.state == GenState.Pending) revert GenerationInProgress();
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (p.remintCount >= MAX_REMINTS) revert RemintLimitReached();

        _children[tokenId].state = GenState.Burned;
        uint8 carried = fusesUsed[tokenId];

        nft.burn(tokenId);
        newTokenId = nft.mintChild(msg.sender);
        requestId = _nextRequestId++;
        // 配合回数は引き継ぐ。リセットできると無料で繁殖力を回復できてしまう。
        fusesUsed[newTokenId] = carried;

        p.prevTokenId = uint32(tokenId);
        p.remintCount += 1;
        p.state = GenState.Pending;
        p.requestId = requestId;
        p.seed = _seed(requestId, newTokenId);
        _children[newTokenId] = p;
        tokenIdOfRequest[requestId] = newTokenId;

        emit RemintRequested(requestId, newTokenId, msg.sender, tokenId, p.seed, p.remintCount);
    }

    /// @notice 生成完了後にバックエンドが tokenURI を確定させる。Pending以外は受け付けない。
    function finalizeMetadata(uint256 tokenId, string calldata uri) external {
        if (msg.sender != metadataSigner) revert NotMetadataSigner();

        Child storage info = _children[tokenId];
        if (info.state != GenState.Pending) revert NotPending();
        info.state = GenState.Ready;

        nft.setChildTokenURI(tokenId, uri);
        emit MetadataFinalized(info.requestId, tokenId, uri);
    }

    // --- 属性の導出 ---

    /// @notice Genesisは一律50、子はseedからの均等乱数。親からは継承しない。
    /// @dev 継承させると「強い親を掛け合わせる」戦略が生まれ、そこに価値差ができる。
    function umamiOf(uint256 tokenId) public view returns (uint8) {
        if (tokenId <= nft.GENESIS_SUPPLY()) return GENESIS_UMAMI;
        return uint8(1 + (_children[tokenId].seed % 100));
    }

    function generationOf(uint256 tokenId) public view returns (uint8) {
        if (tokenId <= nft.GENESIS_SUPPLY()) return 0;
        return _children[tokenId].generation;
    }

    function genesisFamily(uint256 tokenId) public view returns (Family) {
        uint256 index = tokenId - 1;
        uint256 bits = (_genesisFamilyBits[index / 128] >> ((index % 128) * 2)) & 3;
        return Family(bits == 3 ? 0 : bits);
    }

    function familyBpsOf(uint256 tokenId) public view returns (uint16 creature, uint16 sushi, uint16 engimono) {
        if (tokenId <= nft.GENESIS_SUPPLY()) {
            Family f = genesisFamily(tokenId);
            if (f == Family.Creature) return (10000, 0, 0);
            if (f == Family.Sushi) return (0, 10000, 0);
            return (0, 0, 10000);
        }
        Child storage c = _children[tokenId];
        creature = c.creatureBps;
        sushi = c.sushiBps;
        engimono = 10000 - creature - sushi;
    }

    function attributesOf(uint256 tokenId) external view returns (Attributes memory a) {
        (a.creatureBps, a.sushiBps, a.engimonoBps) = familyBpsOf(tokenId);
        a.generation = generationOf(tokenId);
        a.umami = umamiOf(tokenId);
    }

    /// @notice 子の見た目トレイト。すべて均等確率で、優劣はない。
    /// @dev Genesisは事前生成した画像が正なので、ここでは返さない。
    function traitsOf(uint256 tokenId) external view returns (Traits memory t) {
        if (tokenId <= nft.GENESIS_SUPPLY()) revert GenesisTraitsAreOffchain();
        uint256 s = _children[tokenId].seed;
        t.mood = uint8((s >> 16) % 5);
        t.accent = uint8((s >> 32) % 6);
        t.charm = uint8((s >> 48) % 8);
        t.pose = uint8((s >> 64) % 5);
    }

    function childInfo(uint256 tokenId) external view returns (Child memory) {
        return _children[tokenId];
    }

    function chargesLeft(uint256 tokenId) external view returns (uint8) {
        return FUSE_CHARGES - fusesUsed[tokenId];
    }

    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }

    // --- 運用 ---

    function setMetadataSigner(address metadataSigner_) external onlyOwner {
        if (metadataSigner_ == address(0)) revert ZeroAddress();
        metadataSigner = metadataSigner_;
    }

    function withdraw(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = payable(to).call{value: address(this).balance}("");
        if (!ok) revert WithdrawFailed();
    }

    /// @dev 取り込まれたブロック情報とrequestIdから算出する。公平な乱数は保証しない。
    function _seed(uint256 requestId, uint256 tokenId) private view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(block.prevrandao, block.number, block.timestamp, requestId, tokenId, address(this))
            )
        );
    }
}
