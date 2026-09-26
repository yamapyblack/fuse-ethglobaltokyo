// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Fuse} from "../src/Fuse.sol";
import {FuseNFT} from "../src/FuseNFT.sol";
import {FusePool} from "../src/FusePool.sol";

contract FuseTest is Test {
    FuseNFT nft;
    FusePool pool;
    Fuse fuse;

    address owner = makeAddr("owner");
    address backend = makeAddr("backend");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        vm.startPrank(owner);
        nft = new FuseNFT(owner);
        pool = new FusePool();
        fuse = new Fuse(nft, pool, backend, owner);
        nft.setFuseContract(address(fuse));
        // 初期素材6体をaliceへ
        for (uint256 i; i < 6; ++i) {
            nft.mintMaterial(alice, string.concat("https://cdn.example/material/", vm.toString(i + 1), ".json"));
        }
        vm.stopPrank();
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    // --- helpers ---

    function _fuse(address who, uint256 a, uint256 b) internal returns (uint256 childId, uint256 requestId) {
        vm.startPrank(who);
        nft.approve(address(fuse), a);
        nft.approve(address(fuse), b);
        (childId, requestId) = fuse.fuse{value: FEE}(a, b);
        vm.stopPrank();
    }

    function _finalize(uint256 tokenId, string memory uri) internal {
        vm.prank(backend);
        fuse.finalizeMetadata(tokenId, uri);
    }

    // --- ① 選択・承認 / ② 初回Fuse ---

    function test_fuse_locksParentsAndMintsChild() public {
        (uint256 childId, uint256 requestId) = _fuse(alice, 1, 2);

        assertEq(nft.ownerOf(1), address(pool), "parentA locked");
        assertEq(nft.ownerOf(2), address(pool), "parentB locked");
        assertEq(nft.ownerOf(childId), alice, "child owned by caller");
        assertEq(childId, 7, "child follows the 6 materials");
        assertEq(requestId, 1);
        assertEq(fuse.tokenIdOfRequest(requestId), childId);
        assertEq(address(fuse).balance, FEE);

        Fuse.ChildInfo memory info = fuse.childInfo(childId);
        assertEq(info.parentCollection, address(nft));
        assertEq(info.parentA, 1);
        assertEq(info.parentB, 2);
        assertEq(info.requestId, requestId);
        assertEq(info.prevChildTokenId, 0);
        assertEq(info.remintCount, 0);
        assertTrue(info.state == Fuse.GenState.Pending, "pending until metadata is set");
        assertTrue(info.seed != 0, "seed derived from block info + requestId");
    }

    function test_fuse_childHasNoTokenUriWhilePending() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        assertEq(nft.tokenURI(childId), "");
    }

    function test_fuse_revertsOnWrongFee() public {
        vm.startPrank(alice);
        nft.approve(address(fuse), 1);
        nft.approve(address(fuse), 2);
        vm.expectRevert(Fuse.IncorrectFee.selector);
        fuse.fuse{value: FEE - 1}(1, 2);
        vm.expectRevert(Fuse.IncorrectFee.selector);
        fuse.fuse{value: FEE + 1}(1, 2);
        vm.stopPrank();
    }

    function test_fuse_revertsOnSameParentTwice() public {
        vm.startPrank(alice);
        nft.approve(address(fuse), 1);
        vm.expectRevert(Fuse.SameParent.selector);
        fuse.fuse{value: FEE}(1, 1);
        vm.stopPrank();
    }

    function test_fuse_revertsWhenCallerDoesNotOwnParent() public {
        vm.prank(bob);
        vm.expectRevert(Fuse.NotParentOwner.selector);
        fuse.fuse{value: FEE}(1, 2);
    }

    /// 画面は setApprovalForAll を使う。個別approveでなくても配合できること
    function test_fuse_worksWithOperatorApproval() public {
        vm.startPrank(alice);
        nft.setApprovalForAll(address(fuse), true);
        (uint256 childId,) = fuse.fuse{value: FEE}(1, 2);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), address(pool));
        assertEq(nft.ownerOf(2), address(pool));
        assertEq(nft.ownerOf(childId), alice);

        // 一度承認すれば2回目以降は承認なしで配合できる
        vm.prank(alice);
        (uint256 second,) = fuse.fuse{value: FEE}(3, 4);
        assertEq(nft.ownerOf(second), alice);
        assertEq(nft.balanceOf(address(pool)), 4);
    }

    function test_fuse_revertsWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, address(fuse), uint256(1))
        );
        fuse.fuse{value: FEE}(1, 2);
    }

    /// 親はプールに入ったら誰も動かせない（出庫機能が無いため）
    function test_pool_cannotReleaseParents() public {
        _fuse(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, alice, uint256(1))
        );
        nft.transferFrom(address(pool), alice, 1);
    }

    // --- ③ 画像生成・反映 ---

    function test_finalizeMetadata_setsUriAndReadyState() public {
        (uint256 childId, uint256 requestId) = _fuse(alice, 1, 2);
        string memory uri = "https://cdn.example/child/7.json";

        vm.expectEmit(true, true, false, true, address(fuse));
        emit Fuse.MetadataFinalized(requestId, childId, uri);
        _finalize(childId, uri);

        assertEq(nft.tokenURI(childId), uri);
        assertTrue(fuse.childInfo(childId).state == Fuse.GenState.Ready);
    }

    function test_finalizeMetadata_onlyBackend() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(Fuse.NotMetadataSigner.selector);
        fuse.finalizeMetadata(childId, "https://cdn.example/evil.json");
    }

    /// 完成後のメタデータは再設定不可
    function test_finalizeMetadata_cannotOverwrite() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        _finalize(childId, "https://cdn.example/child/7.json");

        vm.prank(backend);
        vm.expectRevert(Fuse.NotPending.selector);
        fuse.finalizeMetadata(childId, "https://cdn.example/child/7-v2.json");
    }

    /// 生成失敗 → 同じrequestIdのまま、追加課金も再mintもなく再試行できる
    function test_failedGeneration_retriesWithSameRequestId() public {
        (uint256 childId, uint256 requestId) = _fuse(alice, 1, 2);
        uint256 supplyBefore = nft.totalSupply();

        // 1回目の生成が落ちてバックエンドが何も呼ばなかった状態
        assertTrue(fuse.childInfo(childId).state == Fuse.GenState.Pending);
        assertEq(fuse.tokenIdOfRequest(requestId), childId);

        _finalize(childId, "https://cdn.example/child/7.json");

        assertEq(nft.totalSupply(), supplyBefore, "no extra mint on retry");
        assertEq(address(fuse).balance, FEE, "no extra charge on retry");
        assertEq(fuse.childInfo(childId).requestId, requestId, "requestId unchanged");
    }

    // --- ⑤ Remint ---

    function test_remint_burnsOldMintsNewAndKeepsParents() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        _finalize(childId, "https://cdn.example/child/7.json");

        vm.prank(alice);
        (uint256 newChildId, uint256 newRequestId) = fuse.remint{value: FEE}(childId);

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, childId));
        nft.ownerOf(childId);
        assertEq(nft.ownerOf(newChildId), alice);
        assertTrue(newChildId != childId, "new tokenId");
        assertEq(address(fuse).balance, 2 * FEE, "remint is charged too");

        Fuse.ChildInfo memory info = fuse.childInfo(newChildId);
        assertEq(info.parentA, 1, "original parents carried over");
        assertEq(info.parentB, 2);
        assertEq(info.prevChildTokenId, childId);
        assertEq(info.remintCount, 1);
        assertEq(info.requestId, newRequestId);
        assertTrue(info.state == Fuse.GenState.Pending);
        assertTrue(fuse.childInfo(childId).state == Fuse.GenState.Burned);

        // 親は再投入されていない = プールの中身は2体のまま
        assertEq(nft.balanceOf(address(pool)), 2);
    }

    function test_remint_twiceIncrementsCount() public {
        (uint256 c1,) = _fuse(alice, 1, 2);
        _finalize(c1, "u1");
        vm.prank(alice);
        (uint256 c2,) = fuse.remint{value: FEE}(c1);
        _finalize(c2, "u2");
        vm.prank(alice);
        (uint256 c3,) = fuse.remint{value: FEE}(c2);

        Fuse.ChildInfo memory info = fuse.childInfo(c3);
        assertEq(info.remintCount, 2);
        assertEq(info.prevChildTokenId, c2);
        assertEq(info.parentA, 1);
        assertEq(info.parentB, 2);
    }

    /// Remintは3回まで。使い切ったらその子で確定する
    function test_remint_stopsAtMaxRemints() public {
        (uint256 child,) = _fuse(alice, 1, 2);
        _finalize(child, "u0");

        for (uint32 i = 1; i <= fuse.MAX_REMINTS(); ++i) {
            vm.prank(alice);
            (uint256 next,) = fuse.remint{value: FEE}(child);
            _finalize(next, "u");
            assertEq(fuse.childInfo(next).remintCount, i);
            child = next;
        }

        vm.prank(alice);
        vm.expectRevert(Fuse.RemintLimitReached.selector);
        fuse.remint{value: FEE}(child);

        // 上限に達しても子NFT自体は健在
        assertEq(nft.ownerOf(child), alice);
        assertTrue(fuse.childInfo(child).state == Fuse.GenState.Ready);
    }

    /// 生成中はRemint不可
    function test_remint_revertsWhilePending() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(Fuse.GenerationInProgress.selector);
        fuse.remint{value: FEE}(childId);
    }

    /// 子NFTのみRemint可能。初期素材は不可
    function test_remint_revertsForMaterial() public {
        vm.prank(alice);
        vm.expectRevert(Fuse.NotChild.selector);
        fuse.remint{value: FEE}(1);
    }

    function test_remint_revertsForNonOwner() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        _finalize(childId, "u1");
        vm.prank(bob);
        vm.expectRevert(Fuse.NotChildOwner.selector);
        fuse.remint{value: FEE}(childId);
    }

    function test_remint_revertsOnWrongFee() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        _finalize(childId, "u1");
        vm.prank(alice);
        vm.expectRevert(Fuse.IncorrectFee.selector);
        fuse.remint{value: 0}(childId);
    }

    function test_remint_revertsForAlreadyBurnedChild() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        _finalize(childId, "u1");
        vm.prank(alice);
        fuse.remint{value: FEE}(childId);
        vm.prank(alice);
        vm.expectRevert(Fuse.AlreadyBurned.selector);
        fuse.remint{value: FEE}(childId);
    }

    /// 子を素材に使うとプール所有になり、Remint権は所有者チェックで自然に消える
    function test_childUsedAsParent_losesRemintRight() public {
        (uint256 childId,) = _fuse(alice, 1, 2);
        _finalize(childId, "u1");

        (uint256 grandChildId,) = _fuse(alice, childId, 3);
        assertEq(nft.ownerOf(childId), address(pool));
        assertEq(fuse.childInfo(grandChildId).parentA, childId);

        vm.prank(alice);
        vm.expectRevert(Fuse.NotChildOwner.selector);
        fuse.remint{value: FEE}(childId);
    }

    // --- 運用 ---

    function test_withdrawFees() public {
        _fuse(alice, 1, 2);
        vm.prank(owner);
        fuse.withdrawFees(owner);
        assertEq(owner.balance, FEE);
        assertEq(address(fuse).balance, 0);
    }

    function test_withdrawFees_onlyOwner() public {
        _fuse(alice, 1, 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        fuse.withdrawFees(alice);
    }

    function test_nft_mintAndBurnRestrictedToFuseContract() public {
        vm.prank(alice);
        vm.expectRevert(FuseNFT.NotFuseContract.selector);
        nft.mintChild(alice);

        vm.prank(alice);
        vm.expectRevert(FuseNFT.NotFuseContract.selector);
        nft.burnChild(1);

        vm.prank(alice);
        vm.expectRevert(FuseNFT.NotFuseContract.selector);
        nft.setChildTokenURI(1, "x");
    }

    function test_nft_fuseContractCannotBeReplaced() public {
        vm.prank(owner);
        vm.expectRevert(FuseNFT.FuseContractAlreadySet.selector);
        nft.setFuseContract(makeAddr("attacker"));
    }

    function test_tokensOfOwner() public {
        uint256[] memory ids = nft.tokensOfOwner(alice);
        assertEq(ids.length, 6);
        assertEq(ids[0], 1);
        assertEq(ids[5], 6);

        _fuse(alice, 1, 2);
        ids = nft.tokensOfOwner(alice);
        assertEq(ids.length, 5, "2 parents left, 1 child arrived");
    }
}
