// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {GPUMarketplace} from "../src/GPUMarketplace.sol";
import {ModelNFT} from "../src/ModelNFT.sol";
import {ModelMarketplace} from "../src/ModelMarketplace.sol";

/// @title Interact
/// @notice End-to-end "interaction proof" script. Runs the full ComputeX
///         lifecycle in a single broadcast bundle and logs each tx + the
///         resulting on-chain state. Intended as a backup demo if the UI
///         fails — judges can re-run it against any RPC and reproduce the
///         exact same final state.
///
///         Three accounts (deployer/owner, provider, renter, buyer) are
///         derived from the env keys. The deployer also acts as the buyer
///         on the second leg to keep env config small.
///
///         Usage (local anvil):
///             anvil &
///             OWNER_PK=$ANVIL_KEY_0 \
///             PROVIDER_PK=$ANVIL_KEY_1 \
///             RENTER_PK=$ANVIL_KEY_2 \
///             BUYER_PK=$ANVIL_KEY_3 \
///                 forge script script/Interact.s.sol:Interact \
///                     --rpc-url http://127.0.0.1:8545 --broadcast -vvv
contract Interact is Script {
    GPUMarketplace internal gpu;
    ModelNFT internal nft;
    ModelMarketplace internal market;

    function run() external {
        // Owner key always comes from PRIVATE_KEY in .env. The other three
        // roles default to the well-known anvil burner keys 1/2/3 — fine to
        // expose since they have no real value. If you funded dedicated keys,
        // override via PROVIDER_PK / RENTER_PK / BUYER_PK env vars.
        uint256 ownerPk    = vm.envUint("PRIVATE_KEY");
        uint256 providerPk = vm.envOr("PROVIDER_PK",
            uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d));
        uint256 renterPk   = vm.envOr("RENTER_PK",
            uint256(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a));
        uint256 buyerPk    = vm.envOr("BUYER_PK",
            uint256(0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6));

        address owner    = vm.addr(ownerPk);
        address provider = vm.addr(providerPk);
        address renter   = vm.addr(renterPk);
        address buyer    = vm.addr(buyerPk);

        console2.log("=== Accounts ===");
        console2.log("owner    :", owner);
        console2.log("provider :", provider);
        console2.log("renter   :", renter);
        console2.log("buyer    :", buyer);

        // ---------------- Auto-fund burner roles from owner ----------------
        // Each role needs ~0.005 ETH for the lifecycle txs. Skip if already
        // funded (lets the same script run repeatedly without over-funding).
        uint256 minBal = 0.005 ether;
        vm.startBroadcast(ownerPk);
        if (provider.balance < minBal) payable(provider).transfer(minBal);
        if (renter.balance   < minBal) payable(renter).transfer(minBal);
        if (buyer.balance    < minBal) payable(buyer).transfer(minBal);
        vm.stopBroadcast();

        // ---------------- Deploy ----------------
        vm.startBroadcast(ownerPk);
        gpu = new GPUMarketplace(owner);
        nft = new ModelNFT(owner, address(gpu));
        market = new ModelMarketplace(owner, address(nft));
        gpu.setModelNFT(address(nft));
        vm.stopBroadcast();

        console2.log("\n=== Deployed ===");
        console2.log("GPUMarketplace   :", address(gpu));
        console2.log("ModelNFT         :", address(nft));
        console2.log("ModelMarketplace :", address(market));

        // ---------------- 1. listGPU ----------------
        uint256 pricePerHour = 0.001 ether;
        vm.startBroadcast(providerPk);
        uint256 gpuId = gpu.listGPU("ipfs://QmGpuSpecsExample", pricePerHour);
        vm.stopBroadcast();

        console2.log("\n[1] listGPU");
        console2.log("    gpuId       :", gpuId);
        GPUMarketplace.GPU memory g = gpu.getGPU(gpuId);
        console2.log("    provider    :", g.provider);
        console2.log("    pricePerHour:", g.pricePerHour);
        console2.log("    available   :", g.available);

        // ---------------- 2. rentGPU ----------------
        uint256 duration = 2;
        uint256 cost = pricePerHour * duration;
        vm.startBroadcast(renterPk);
        uint256 jobId = gpu.rentGPU{value: cost}(gpuId, duration);
        vm.stopBroadcast();

        console2.log("\n[2] rentGPU");
        console2.log("    jobId           :", jobId);
        console2.log("    totalCost (wei) :", cost);
        console2.log("    escrowed in mkt :", address(gpu).balance);
        console2.log("    jobOwner        :", gpu.jobOwner(jobId));

        // ---------------- 3. completeJob ----------------
        uint256 providerBefore = provider.balance;
        vm.startBroadcast(providerPk);
        gpu.completeJob(jobId);
        vm.stopBroadcast();

        console2.log("\n[3] completeJob");
        console2.log("    jobCompleted    :", gpu.jobCompleted(jobId));
        console2.log("    provider payout :", provider.balance - providerBefore);
        console2.log("    market balance  :", address(gpu).balance);

        // ---------------- 4. mintModel (permissionless, atomic via consumeMintRight) ----------------
        // Anyone can submit; we use the renter's key to demonstrate.
        vm.startBroadcast(renterPk);
        uint256 tokenId = nft.mintModel(
            jobId,
            "ipfs://QmModelWeightsExample",
            "ipfs://QmZkProofExample",
            "Trend-following predictor v1"
        );
        vm.stopBroadcast();

        console2.log("\n[4] mintModel");
        console2.log("    tokenId       :", tokenId);
        console2.log("    NFT owner     :", nft.ownerOf(tokenId));
        console2.log("    NFT creator   :", nft.creator(tokenId));
        console2.log("    jobIdOfToken  :", nft.jobIdOfToken(tokenId));
        console2.log("    modelMinted   :", gpu.modelMinted(jobId));

        // ---------------- 5. listModel ----------------
        uint256 listPrice = 0.05 ether;
        vm.startBroadcast(renterPk);
        nft.approve(address(market), tokenId);
        market.listModel(tokenId, listPrice);
        vm.stopBroadcast();

        console2.log("\n[5] listModel");
        console2.log("    listPrice (wei)  :", listPrice);
        console2.log("    NFT escrow owner :", nft.ownerOf(tokenId));
        (, address seller, uint256 priceStored, bool active) = market.listings(tokenId);
        console2.log("    listing.seller   :", seller);
        console2.log("    listing.price    :", priceStored);
        console2.log("    listing.active   :", active);

        // ---------------- 6. buyModel ----------------
        uint256 ownerFeeBefore   = owner.balance;
        uint256 sellerBefore     = renter.balance;
        // creator == renter, so royalty folds back to seller path on this leg.
        vm.startBroadcast(buyerPk);
        market.buyModel{value: listPrice}(tokenId);
        vm.stopBroadcast();

        uint256 expectedFee     = (listPrice * 250) / 10_000;
        uint256 expectedRoyalty = (listPrice * 500) / 10_000;
        uint256 expectedSeller  = listPrice - expectedFee - expectedRoyalty;

        console2.log("\n[6] buyModel");
        console2.log("    NFT new owner    :", nft.ownerOf(tokenId));
        console2.log("    fee paid         :", owner.balance - ownerFeeBefore);
        console2.log("    seller received  :", renter.balance - sellerBefore);
        console2.log("    expected fee     :", expectedFee);
        console2.log("    expected royalty :", expectedRoyalty);
        console2.log("    expected seller  :", expectedSeller);
        console2.log("    market eth held  :", address(market).balance);

        console2.log("\n=== Final state ===");
        console2.log("token", tokenId, "owned by buyer:", nft.ownerOf(tokenId) == buyer);
        console2.log("job",   jobId,   "completed     :", gpu.jobCompleted(jobId));
        console2.log("job",   jobId,   "model minted  :", gpu.modelMinted(jobId));
    }
}
