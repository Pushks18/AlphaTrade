// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GPUMarketplace}    from "../src/GPUMarketplace.sol";
import {ModelNFT}          from "../src/ModelNFT.sol";
import {ModelMarketplace}  from "../src/ModelMarketplace.sol";
import {PerformanceOracle} from "../src/PerformanceOracle.sol";
import {CreatorRegistry}   from "../src/CreatorRegistry.sol";
import {MockVerifier}      from "./mocks/MockVerifier.sol";

/// @title  EndToEnd integration test (G1)
/// @notice Exercises the full lifecycle without EZKL proof artifacts:
///         GPU list → rent → complete → ModelNFT mint → audit submission →
///         performance score written → secondary sale via ModelMarketplace.
///         Uses MockVerifier so the SNARK step always passes.
contract EndToEndTest is Test {
    // ── contracts ──────────────────────────────────────────────────────────
    GPUMarketplace    internal gpu;
    ModelNFT          internal nft;
    ModelMarketplace  internal mktplace;
    PerformanceOracle internal oracle;
    CreatorRegistry   internal reg;
    MockVerifier      internal verifier;

    // ── actors ─────────────────────────────────────────────────────────────
    address internal owner    = address(0xA11CE);
    address internal provider = address(0xB0B);
    address internal creator  = address(0xC12EA70);
    address internal buyer    = address(0xBEEF);
    address internal feeRecip = address(0xFEE5);

    // ── price-feed fixtures (2-leaf Merkle, flat market → Sharpe=0 ok) ────
    bytes32 internal leafA;
    bytes32 internal leafB;
    bytes32 internal feedRoot;
    uint256 internal constant EPOCH = 42;

    // ── misc ───────────────────────────────────────────────────────────────
    uint256 internal constant GPU_PRICE  = 0.01 ether;
    uint256 internal constant DURATION   = 2;          // hours
    uint256 internal constant JOB_COST   = GPU_PRICE * DURATION;
    uint256 internal constant CREATOR_STAKE = 0.05 ether;
    bytes32 internal constant WEIGHTS_HASH = keccak256("model-weights-v1");

    // ── events to assert ───────────────────────────────────────────────────
    event JobCreated(uint256 indexed jobId, address indexed renter,
                     uint256 indexed gpuId, uint256 duration, uint256 totalCost);
    event JobCompleted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId);
    event ModelMinted(uint256 indexed tokenId, uint256 indexed jobId, address indexed creator,
                      string modelCID, string proofCID);
    event AuditAccepted(uint256 indexed tokenId, uint256 indexed epoch,
                        uint256 sharpeBps, uint256 nTrades);

    // ── setup ──────────────────────────────────────────────────────────────

    function setUp() public {
        vm.deal(provider, 10 ether);
        vm.deal(creator,  10 ether);
        vm.deal(buyer,    10 ether);

        // Deploy core contracts
        gpu      = new GPUMarketplace(owner);
        nft      = new ModelNFT(owner, address(gpu));
        mktplace = new ModelMarketplace(owner, address(nft));
        verifier = new MockVerifier();
        oracle   = new PerformanceOracle(owner, owner, address(nft), address(verifier));
        reg      = new CreatorRegistry(owner, address(nft));

        // Wire together (all setters are onlyOwner)
        vm.startPrank(owner);
        gpu.setModelNFT(address(nft));
        nft.setOracle(address(oracle));
        nft.setCreatorRegistry(address(reg));
        mktplace.setFeeRecipient(feeRecip);
        vm.stopPrank();

        // Build 2-leaf Merkle price-feed tree (flat market: both bars = 100e8)
        leafA    = keccak256(abi.encodePacked(uint32(0), int256(100e8)));
        leafB    = keccak256(abi.encodePacked(uint32(1), int256(100e8)));
        feedRoot = leafA < leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));

        // Admin publishes feed root for epoch 42
        vm.prank(owner);
        oracle.publishFeedRoot(EPOCH, feedRoot);
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /// @dev Lists a GPU, rents it, and completes the job. Returns jobId.
    function _completedJob() internal returns (uint256 jobId, uint256 gpuId) {
        vm.prank(provider);
        gpuId = gpu.listGPU("ipfs://gpu-specs", GPU_PRICE);

        vm.prank(creator);
        jobId = gpu.rentGPU{value: JOB_COST}(gpuId, DURATION);

        vm.prank(provider);
        gpu.completeJob(jobId);
    }

    /// @dev Mints a model NFT for a completed job. Returns tokenId.
    function _mintedModel(uint256 jobId) internal returns (uint256 tokenId) {
        vm.prank(creator);
        tokenId = nft.mintModel{value: CREATOR_STAKE}(
            jobId,
            "ipfs://model-cid",
            "ipfs://proof-cid",
            "AlphaMLP v1",
            WEIGHTS_HASH
        );
    }

    /// @dev Builds a valid AuditSubmission for tokenId using fixed flat-market fixtures.
    function _validAudit(uint256 tokenId)
        internal view returns (PerformanceOracle.AuditSubmission memory s)
    {
        s.tokenId          = tokenId;
        s.epoch            = EPOCH;
        s.modelWeightsHash = WEIGHTS_HASH;

        int256[] memory outputs = new int256[](2);
        outputs[0] = 5000; outputs[1] = 5000;
        s.outputs     = outputs;
        s.outputsHash = keccak256(abi.encodePacked(outputs));

        s.publicInputs    = new uint256[](3);
        s.publicInputs[0] = uint256(WEIGHTS_HASH);
        s.publicInputs[1] = uint256(s.outputsHash);
        s.publicInputs[2] = uint256(feedRoot);

        s.priceFeedBars      = new int256[](2);
        s.priceFeedBars[0]   = 100e8;
        s.priceFeedBars[1]   = 100e8;
        s.priceFeedIndexes   = new uint32[](2);
        s.priceFeedIndexes[0] = 0;
        s.priceFeedIndexes[1] = 1;
        s.priceFeedSiblings  = new bytes32[](2);
        s.priceFeedSiblings[0] = leafB;
        s.priceFeedSiblings[1] = leafA;
        s.snarkProof = hex"";
    }

    // ── lifecycle tests ────────────────────────────────────────────────────

    function test_e2e_gpuListAndRent_emitsJobCreated() public {
        vm.prank(provider);
        uint256 gpuId = gpu.listGPU("ipfs://gpu-specs", GPU_PRICE);

        vm.expectEmit(true, true, true, true);
        emit JobCreated(0, creator, gpuId, DURATION, JOB_COST);

        vm.prank(creator);
        gpu.rentGPU{value: JOB_COST}(gpuId, DURATION);
    }

    function test_e2e_completeJob_emitsJobCompleted() public {
        vm.prank(provider);
        uint256 gpuId = gpu.listGPU("ipfs://gpu-specs", GPU_PRICE);
        vm.prank(creator);
        uint256 jobId = gpu.rentGPU{value: JOB_COST}(gpuId, DURATION);

        vm.expectEmit(true, true, true, false);
        emit JobCompleted(jobId, creator, gpuId);

        vm.prank(provider);
        gpu.completeJob(jobId);
    }

    function test_e2e_mintModel_emitsModelMinted() public {
        (uint256 jobId, ) = _completedJob();

        vm.expectEmit(true, true, true, false);
        emit ModelMinted(1, jobId, creator, "ipfs://model-cid", "ipfs://proof-cid");

        vm.prank(creator);
        nft.mintModel{value: CREATOR_STAKE}(
            jobId, "ipfs://model-cid", "ipfs://proof-cid", "AlphaMLP v1", WEIGHTS_HASH
        );
    }

    function test_e2e_mintModel_registersCreatorSBT() public {
        (uint256 jobId, ) = _completedJob();
        _mintedModel(jobId);

        // CreatorRegistry issues a soulbound token to the creator
        assertEq(reg.balanceOf(creator), 1);
    }

    function test_e2e_mintModel_blocksSecondMintSameJob() public {
        (uint256 jobId, ) = _completedJob();
        _mintedModel(jobId);

        vm.expectRevert();
        vm.prank(creator);
        nft.mintModel{value: CREATOR_STAKE}(
            jobId, "ipfs://model-cid-2", "ipfs://proof-cid-2", "dup", WEIGHTS_HASH
        );
    }

    function test_e2e_submitAudit_writesPerformanceScore() public {
        (uint256 jobId, ) = _completedJob();
        uint256 tokenId = _mintedModel(jobId);

        vm.expectEmit(true, true, false, false);
        emit AuditAccepted(tokenId, EPOCH, 0, 0); // flat market → Sharpe 0

        oracle.submitAudit(_validAudit(tokenId));

        // Score is set on the NFT
        (, , , , , uint256 sharpeBps, , , ) = nft.models(tokenId);
        assertEq(sharpeBps, 0); // flat market: mean==0 → Sharpe clamped to 0
        assertEq(oracle.lastEpoch(tokenId), EPOCH);
    }

    function test_e2e_submitAudit_recordsScoreInCreatorRegistry() public {
        (uint256 jobId, ) = _completedJob();
        uint256 tokenId = _mintedModel(jobId);
        oracle.submitAudit(_validAudit(tokenId));

        // CreatorRegistry.records updated via recordScore hook
        uint256 sbtId = reg.creatorTokenId(creator);
        (, , uint256 totalSharpeBps, , ) = reg.records(sbtId);
        assertEq(totalSharpeBps, 0); // flat market Sharpe
    }

    function test_e2e_secondarySale_splitsPaymentCorrectly() public {
        (uint256 jobId, ) = _completedJob();
        uint256 tokenId = _mintedModel(jobId);

        uint256 listPrice = 1 ether;

        // Creator lists on secondary marketplace
        vm.prank(creator);
        nft.approve(address(mktplace), tokenId);
        vm.prank(creator);
        mktplace.listModel(tokenId, listPrice);

        uint256 creatorBefore  = creator.balance;
        uint256 feeRecipBefore = feeRecip.balance;

        vm.prank(buyer);
        mktplace.buyModel{value: listPrice}(tokenId);

        // Royalty 5% → creator, fee 2.5% → feeRecip, rest → seller (creator=seller here)
        uint256 royalty = (listPrice * 500)  / 10_000; // 5%
        uint256 fee     = (listPrice * 250)  / 10_000; // 2.5%
        uint256 sellerCut = listPrice - royalty - fee;

        // creator gets royalty + seller proceeds (same address in this test)
        assertEq(creator.balance,  creatorBefore + royalty + sellerCut);
        assertEq(feeRecip.balance, feeRecipBefore + fee);

        // Marketplace holds zero ETH after sale
        assertEq(address(mktplace).balance, 0);
    }

    function test_e2e_fullLifecycle_stateConsistency() public {
        // Single test asserting key post-conditions across the entire flow
        (uint256 jobId, uint256 gpuId) = _completedJob();

        // Job is marked completed
        assertTrue(gpu.jobCompleted(jobId));
        assertFalse(gpu.modelMinted(jobId));

        uint256 tokenId = _mintedModel(jobId);

        // Mint right consumed
        assertTrue(gpu.modelMinted(jobId));

        // NFT ownership
        assertEq(nft.ownerOf(tokenId), creator);
        assertEq(nft.creator(tokenId), creator);
        assertEq(nft.tokenIdForJob(jobId), tokenId);

        // Stake locked in NFT
        (, , , , uint256 stake, , , , ) = nft.models(tokenId);
        assertEq(stake, CREATOR_STAKE);

        // Submit audit
        oracle.submitAudit(_validAudit(tokenId));
        assertEq(oracle.lastEpoch(tokenId), EPOCH);

        // GPU is available again after job completion
        GPUMarketplace.GPU memory g = gpu.getGPU(gpuId);
        assertTrue(g.available);

        // GPU suppressed warnings for unused variable
        assertEq(g.provider, provider);
    }
}
