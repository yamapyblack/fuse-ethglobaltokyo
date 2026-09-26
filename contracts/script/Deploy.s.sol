// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Fuse} from "../src/Fuse.sol";
import {FuseNFT} from "../src/FuseNFT.sol";
import {FusePool} from "../src/FusePool.sol";

/// @notice 3体をデプロイして紐付けるだけ。初期素材のmintは画像をR2へ上げた後に
///         web/scripts/mint-materials.ts で行う。
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address metadataSigner = vm.envAddress("METADATA_SIGNER_ADDRESS");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        FuseNFT nft = new FuseNFT(deployer);
        FusePool pool = new FusePool();
        Fuse fuse = new Fuse(nft, pool, metadataSigner, deployer);
        nft.setFuseContract(address(fuse));
        vm.stopBroadcast();

        console.log("FuseNFT :", address(nft));
        console.log("FusePool:", address(pool));
        console.log("Fuse    :", address(fuse));
        console.log("owner   :", deployer);
        console.log("signer  :", metadataSigner);

        string memory json = string.concat(
            '{\n  "chainId": ',
            vm.toString(block.chainid),
            ',\n  "fuseNFT": "',
            vm.toString(address(nft)),
            '",\n  "fusePool": "',
            vm.toString(address(pool)),
            '",\n  "fuse": "',
            vm.toString(address(fuse)),
            '"\n}\n'
        );
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
    }
}
