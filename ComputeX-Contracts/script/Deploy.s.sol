// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {GPUMarketplace}    from "../src/GPUMarketplace.sol";
import {ModelNFT}          from "../src/ModelNFT.sol";
import {ModelMarketplace}  from "../src/ModelMarketplace.sol";
import {PerformanceOracle} from "../src/PerformanceOracle.sol";
import {Halo2Verifier}     from "../src/verifiers/EzklVerifier.sol";

/// @title  Deploy
/// @notice One-shot deployment of the AlphaTrade onchain stack.
/// @dev    Anvil bring-up uses anvil's account 0 as deployer/admin; the
///         FEED_SIGNER env var defaults to anvil's account 1 so the
///         off-chain orchestrator has a canonical signer key.
///         Usage:
///             forge script script/Deploy.s.sol:Deploy \
///                 --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    /// Anvil account 1 (publicly known dev key) — used as the feed signer
    /// when FEED_SIGNER env var is not set.
    address constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address feedSigner = vm.envOr("FEED_SIGNER", ANVIL_ACCOUNT_1);

        vm.startBroadcast(pk);

        GPUMarketplace   gpuMarket   = new GPUMarketplace(deployer);
        ModelNFT         modelNFT    = new ModelNFT(deployer, address(gpuMarket));
        ModelMarketplace modelMarket = new ModelMarketplace(deployer, address(modelNFT));
        Halo2Verifier    verifier    = new Halo2Verifier();
        PerformanceOracle oracle     = new PerformanceOracle(
            deployer, feedSigner, address(modelNFT), address(verifier)
        );

        // Wire the atomic mint-right pull: only this ModelNFT can call
        // gpuMarket.consumeMintRight(jobId).
        gpuMarket.setModelNFT(address(modelNFT));

        // Authorize the oracle to write performance scores; once set, the
        // owner is no longer the score writer.
        modelNFT.setOracle(address(oracle));

        vm.stopBroadcast();

        console2.log("GPUMarketplace:    ", address(gpuMarket));
        console2.log("ModelNFT:          ", address(modelNFT));
        console2.log("ModelMarketplace:  ", address(modelMarket));
        console2.log("EzklVerifier:      ", address(verifier));
        console2.log("PerformanceOracle: ", address(oracle));
        console2.log("feedSigner:        ", feedSigner);
    }
}
