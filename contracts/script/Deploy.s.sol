// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Fuse} from "../src/Fuse.sol";
import {FuseNFT} from "../src/FuseNFT.sol";

/// @notice 2本をデプロイして紐付ける。Genesisのfamily設定と販売開始は別途。
contract Deploy is Script {
    /// @notice ロイヤリティ5%。主要マーケットが任意化しているので実収は下振れ前提。
    uint96 constant ROYALTY_BPS = 500;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address metadataSigner = vm.envAddress("METADATA_SIGNER_ADDRESS");
        string memory genesisBaseURI = vm.envString("GENESIS_BASE_URI");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        FuseNFT nft = new FuseNFT(deployer, genesisBaseURI, deployer, ROYALTY_BPS);
        Fuse fuse = new Fuse(nft, metadataSigner, deployer);
        nft.setFuseContract(address(fuse));
        vm.stopBroadcast();

        console.log("FuseNFT :", address(nft));
        console.log("Fuse    :", address(fuse));
        console.log("owner   :", deployer);
        console.log("signer  :", metadataSigner);

        string memory json = string.concat(
            '{\n  "chainId": ',
            vm.toString(block.chainid),
            ',\n  "fuseNFT": "',
            vm.toString(address(nft)),
            '",\n  "fuse": "',
            vm.toString(address(fuse)),
            '"\n}\n'
        );
        vm.writeFile(string.concat("deployments/v2-", vm.toString(block.chainid), ".json"), json);
    }
}
