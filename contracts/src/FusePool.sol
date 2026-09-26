// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @title FusePool
/// @notice 配合で消費された親NFTの永久保管先。
///         受け取り以外の機能を一切持たないため、ここに入ったNFTは誰も動かせない。
/// @dev 出庫・再承認(approve)・汎用外部実行・アップグレード・owner を意図的に実装しない。
///      この「何もできないこと」が仕様なので、関数を足すときは要件を読み直すこと。
contract FusePool is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
