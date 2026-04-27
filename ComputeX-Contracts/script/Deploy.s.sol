// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {GPUMarketplace} from "../src/GPUMarketplace.sol";
import {ModelNFT} from "../src/ModelNFT.sol";
import {ModelMarketplace} from "../src/ModelMarketplace.sol";

/// @title Deploy
/// @notice One-shot deployment of the ComputeX onchain stack.
///         Usage:
///             forge script script/Deploy.s.sol:Deploy \
///                 --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        GPUMarketplace gpuMarket = new GPUMarketplace(deployer);
        ModelNFT modelNFT = new ModelNFT(deployer, address(gpuMarket));
        ModelMarketplace modelMarket = new ModelMarketplace(deployer, address(modelNFT));

        // Wire the atomic mint-right pull: only this ModelNFT can call
        // gpuMarket.consumeMintRight(jobId).
        gpuMarket.setModelNFT(address(modelNFT));

        vm.stopBroadcast();

        console2.log("GPUMarketplace:    ", address(gpuMarket));
        console2.log("ModelNFT:          ", address(modelNFT));
        console2.log("ModelMarketplace:  ", address(modelMarket));
    }
}
