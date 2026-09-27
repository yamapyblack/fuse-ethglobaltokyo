// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Fuse} from "../src/Fuse.sol";
import {FuseNFT} from "../src/FuseNFT.sol";

contract FuseTest is Test {
    FuseNFT nft;
    Fuse fuse;

    address owner = makeAddr("owner");
    address backend = makeAddr("backend");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant PRICE = 0.1 ether;
    uint256 constant FEE = 0.005 ether;

    function setUp() public {
        vm.startPrank(owner);
        nft = new FuseNFT(owner, "https://cdn.example/genesis/", owner, 500);
        fuse = new Fuse(nft, backend, owner);
        nft.setFuseContract(address(fuse));
        fuse.setSaleOpen(true);
        // family: 全tokenをCreature(0)にしておき、必要なテストで個別に上書きする
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // --- helpers ---

    function _mint(address to, uint256 qty) internal {
        vm.prank(to);
        fuse.mintGenesis{value: PRICE * qty}(qty);
    }

    function _fuse(address who, uint256 a, uint256 b) internal returns (uint256 child, uint256 req) {
        vm.prank(who);
        (child, req) = fuse.fuse{value: FEE}(a, b);
    }

    function _finalize(uint256 tokenId, string memory uri) internal {
        vm.prank(backend);
        fuse.finalizeMetadata(tokenId, uri);
    }

    /// wordIndexにfamilyを2bitずつ詰める
    function _setFamily(uint256 tokenId, Fuse.Family f) internal {
        uint256 index = tokenId - 1;
        uint256 wordIndex = index / 128;
        uint256 shift = (index % 128) * 2;
        vm.prank(owner);
        fuse.setGenesisFamilies(wordIndex, uint256(f) << shift);
    }

    // --- Genesis 販売 ---

    function test_mintGenesis() public {
        _mint(alice, 3);
        assertEq(nft.balanceOf(alice), 3);
        assertEq(nft.ownerOf(1), alice);
        assertEq(address(fuse).balance, PRICE * 3);
        assertEq(nft.tokenURI(1), "https://cdn.example/genesis/1.json");
    }

    function test_mintGenesis_revertsOnWrongPayment() public {
        vm.prank(alice);
        vm.expectRevert(Fuse.IncorrectPayment.selector);
        fuse.mintGenesis{value: PRICE}(2);
    }

    function test_mintGenesis_revertsWhenClosed() public {
        vm.prank(owner);
        fuse.setSaleOpen(false);
        vm.prank(alice);
        vm.expectRevert(Fuse.SaleClosed.selector);
        fuse.mintGenesis{value: PRICE}(1);
    }

    function test_mintGenesis_quantityLimits() public {
        vm.startPrank(alice);
        vm.expectRevert(Fuse.InvalidQuantity.selector);
        fuse.mintGenesis{value: 0}(0);
        vm.expectRevert(Fuse.InvalidQuantity.selector);
        fuse.mintGenesis{value: PRICE * 11}(11);
        vm.stopPrank();
    }

    /// Genesisのumamiは全体で同じ。販売時点で数値の当たり外れを作らない
    function test_genesisUmamiIsFlat() public {
        _mint(alice, 10);
        for (uint256 i = 1; i <= 10; ++i) {
            assertEq(fuse.umamiOf(i), 50, "genesis umami must be 50");
            assertEq(fuse.generationOf(i), 0);
        }
    }

    // --- 配合 ---

    function test_fuse_needsNoApproval() public {
        _mint(alice, 2);
        // approve も setApprovalForAll も呼ばずに通ること
        (uint256 child,) = _fuse(alice, 1, 2);
        assertEq(nft.ownerOf(child), alice);
        assertGt(child, nft.GENESIS_SUPPLY());
    }

    function test_fuse_consumesChargesWithoutTransfer() public {
        _mint(alice, 2);
        _fuse(alice, 1, 2);

        // 親は移動していない。所有者のまま
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.ownerOf(2), alice);
        assertEq(fuse.chargesLeft(1), 2);
        assertEq(fuse.chargesLeft(2), 2);
    }

    /// 3回目の配合で親が消える
    function test_fuse_burnsParentOnThirdUse() public {
        _mint(alice, 4);
        _fuse(alice, 1, 2);
        _fuse(alice, 1, 3);
        assertEq(fuse.chargesLeft(1), 1);
        assertEq(nft.ownerOf(1), alice);

        _fuse(alice, 1, 4);
        assertEq(fuse.chargesLeft(1), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(1)));
        nft.ownerOf(1);
    }

    function test_fuse_revertsWhenNoChargesLeft() public {
        _mint(alice, 4);
        _fuse(alice, 1, 2);
        _fuse(alice, 1, 3);
        _fuse(alice, 1, 4);
        // #1 は焼かれているので所有者チェックで落ちる
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(1)));
        fuse.fuse{value: FEE}(1, 2);
    }

    function test_fuse_revertsOnWrongFee() public {
        _mint(alice, 2);
        vm.prank(alice);
        vm.expectRevert(Fuse.IncorrectPayment.selector);
        fuse.fuse{value: 0.001 ether}(1, 2);
    }

    function test_fuse_revertsOnSameParent() public {
        _mint(alice, 2);
        vm.prank(alice);
        vm.expectRevert(Fuse.SameParent.selector);
        fuse.fuse{value: FEE}(1, 1);
    }

    function test_fuse_revertsForNonOwner() public {
        _mint(alice, 2);
        vm.prank(bob);
        vm.expectRevert(Fuse.NotOwner.selector);
        fuse.fuse{value: FEE}(1, 2);
    }

    function test_fuse_generationIsMaxPlusOne() public {
        _mint(alice, 4);
        (uint256 c1,) = _fuse(alice, 1, 2);
        assertEq(fuse.generationOf(c1), 1);
        _finalize(c1, "u1");

        (uint256 c2,) = _fuse(alice, c1, 3);
        assertEq(fuse.generationOf(c2), 2, "max(1,0)+1");
        _finalize(c2, "u2");

        (uint256 c3,) = _fuse(alice, c2, 4);
        assertEq(fuse.generationOf(c3), 3);
    }

    function test_fuse_familyIsAveraged() public {
        _mint(alice, 2);
        _setFamily(2, Fuse.Family.Sushi);

        (uint256 child,) = _fuse(alice, 1, 2);
        (uint16 c, uint16 s, uint16 e) = fuse.familyBpsOf(child);
        assertEq(c, 5000, "creature 50%");
        assertEq(s, 5000, "sushi 50%");
        assertEq(e, 0);
        assertEq(c + s + e, 10000, "bps must sum to 10000");
    }

    /// 子のumamiは1-100の範囲で、親からは継承しない
    function test_childUmamiIsInRangeAndNotInherited() public {
        _mint(alice, 10); // 1txの上限は10体

        bool sawDifferent;
        for (uint256 i = 1; i <= 9; i += 2) {
            (uint256 child,) = _fuse(alice, i, i + 1);
            uint8 u = fuse.umamiOf(child);
            assertGe(u, 1);
            assertLe(u, 100);
            if (u != 50) sawDifferent = true;
            _finalize(child, "u");
        }
        assertTrue(sawDifferent, "children do not converge on the parents value");
    }

    // --- Remint ---

    function test_remint_isFree() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u1");

        uint256 before = alice.balance;
        vm.prank(alice);
        (uint256 newId,) = fuse.remint(child);
        assertEq(alice.balance, before, "no payment beyond gas");
        assertEq(nft.ownerOf(newId), alice);
    }

    function test_remint_revertsIfPaid() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u1");
        vm.prank(alice);
        vm.expectRevert(Fuse.IncorrectPayment.selector);
        fuse.remint{value: FEE}(child);
    }

    /// Remintで配合回数がリセットされない。されると無料で繁殖力を回復できてしまう
    function test_remint_carriesFuseCharges() public {
        _mint(alice, 4);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u1");

        _fuse(alice, child, 3);
        assertEq(fuse.chargesLeft(child), 2);

        vm.prank(alice);
        (uint256 newId,) = fuse.remint(child);
        assertEq(fuse.chargesLeft(newId), 2, "carries the used charges");
    }

    function test_remint_carriesLineage() public {
        _mint(alice, 4);
        _setFamily(2, Fuse.Family.Sushi);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u1");

        vm.prank(alice);
        (uint256 newId,) = fuse.remint(child);

        Fuse.Child memory info = fuse.childInfo(newId);
        assertEq(info.parentA, 1);
        assertEq(info.parentB, 2);
        assertEq(info.prevTokenId, child);
        assertEq(info.remintCount, 1);
        assertEq(fuse.generationOf(newId), 1);
        (uint16 c, uint16 s,) = fuse.familyBpsOf(newId);
        assertEq(c, 5000);
        assertEq(s, 5000);
        assertTrue(fuse.childInfo(child).state == Fuse.GenState.Burned);
    }

    function test_remint_stopsAtMax() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u0");

        for (uint8 i = 1; i <= fuse.MAX_REMINTS(); ++i) {
            vm.prank(alice);
            (uint256 next,) = fuse.remint(child);
            _finalize(next, "u");
            assertEq(fuse.childInfo(next).remintCount, i);
            child = next;
        }
        vm.prank(alice);
        vm.expectRevert(Fuse.RemintLimitReached.selector);
        fuse.remint(child);
    }

    function test_remint_revertsWhilePending() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(Fuse.GenerationInProgress.selector);
        fuse.remint(child);
    }

    function test_remint_revertsForGenesis() public {
        _mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(Fuse.NotChild.selector);
        fuse.remint(1);
    }

    // --- メタデータ ---

    function test_finalizeMetadata() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "https://cdn.example/child/1001.json");
        assertEq(nft.tokenURI(child), "https://cdn.example/child/1001.json");
        assertTrue(fuse.childInfo(child).state == Fuse.GenState.Ready);
    }

    function test_finalizeMetadata_onlyBackend() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(Fuse.NotMetadataSigner.selector);
        fuse.finalizeMetadata(child, "evil");
    }

    function test_finalizeMetadata_cannotOverwrite() public {
        _mint(alice, 2);
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u1");
        vm.prank(backend);
        vm.expectRevert(Fuse.NotPending.selector);
        fuse.finalizeMetadata(child, "u2");
    }

    // --- 運用 ---

    function test_withdraw() public {
        _mint(alice, 2);
        vm.prank(owner);
        fuse.withdraw(owner);
        assertEq(owner.balance, PRICE * 2);
    }

    function test_withdraw_onlyOwner() public {
        _mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        fuse.withdraw(alice);
    }

    function test_royaltyIs5Percent() public view {
        (address receiver, uint256 amount) = nft.royaltyInfo(1, 1 ether);
        assertEq(receiver, owner);
        assertEq(amount, 0.05 ether);
    }

    function test_nft_mintAndBurnRestrictedToFuse() public {
        vm.startPrank(alice);
        vm.expectRevert(FuseNFT.NotFuseContract.selector);
        nft.mintChild(alice);
        vm.expectRevert(FuseNFT.NotFuseContract.selector);
        nft.burn(1);
        vm.stopPrank();
    }

    // --- 属性とトレイト ---

    function test_attributesOf_worksForBoth() public {
        _mint(alice, 2);
        Fuse.Attributes memory g = fuse.attributesOf(1);
        assertEq(g.generation, 0);
        assertEq(g.umami, 50);
        assertEq(g.creatureBps + g.sushiBps + g.engimonoBps, 10000);

        (uint256 child,) = _fuse(alice, 1, 2);
        Fuse.Attributes memory c = fuse.attributesOf(child);
        assertEq(c.generation, 1);
        assertGe(c.umami, 1);
        assertLe(c.umami, 100);
    }

    /// Genesisの見た目は事前生成の画像が正。偽のseedから値を作って返さない
    function test_traitsOf_revertsForGenesis() public {
        _mint(alice, 1);
        vm.expectRevert(Fuse.GenesisTraitsAreOffchain.selector);
        fuse.traitsOf(1);
    }

    function test_traitsOf_inRange() public {
        _mint(alice, 10);
        for (uint256 i = 1; i <= 9; i += 2) {
            (uint256 child,) = _fuse(alice, i, i + 1);
            Fuse.Traits memory t = fuse.traitsOf(child);
            assertLt(t.mood, 5);
            assertLt(t.accent, 6);
            assertLt(t.charm, 8);
            assertLt(t.pose, 5);
            _finalize(child, "u");
        }
    }

    /// 生成中の子を親にできない。画像がまだ無く、配合しても生成が詰む
    function test_fuse_revertsWhenParentIsStillGenerating() public {
        _mint(alice, 3);
        (uint256 child,) = _fuse(alice, 1, 2);
        // child は Pending のまま
        vm.prank(alice);
        vm.expectRevert(Fuse.ParentNotReady.selector);
        fuse.fuse{value: FEE}(child, 3);

        _finalize(child, "u1");
        (uint256 grandchild,) = _fuse(alice, child, 3);
        assertEq(fuse.generationOf(grandchild), 2);
    }
}
