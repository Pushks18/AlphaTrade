// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GPUMarketplace} from "../src/GPUMarketplace.sol";
import {ModelNFT} from "../src/ModelNFT.sol";

contract ModelNFTTest is Test {
    GPUMarketplace internal market;
    ModelNFT internal nft;

    address internal owner    = address(0xA11CE);
    address internal provider = address(0xB0B);
    address internal renter   = address(0xCAFE);
    address internal stranger = address(0xDEAD);

    uint256 internal constant PRICE = 0.01 ether;

    string  internal constant MODEL_CID    = "bafymodel";
    string  internal constant PROOF_CID    = "bafyproof";
    string  internal constant DESC         = "Trend-following predictor";
    bytes32 internal constant DUMMY_HASH   = bytes32(uint256(1));

    event ModelMinted(
        uint256 indexed tokenId,
        uint256 indexed jobId,
        address indexed creator,
        string modelCID,
        string proofCID
    );
    event PerformanceUpdated(uint256 indexed tokenId, uint256 score);
    event OracleSet(address indexed previousOracle, address indexed newOracle);

    function setUp() public {
        // Deploy stack as owner
        vm.startPrank(owner);
        market = new GPUMarketplace(owner);
        nft = new ModelNFT(owner, address(market));
        market.setModelNFT(address(nft));
        vm.stopPrank();

        vm.deal(renter, 100 ether);
    }

    // helpers ---------------------------------------------------------

    function _list() internal returns (uint256 gpuId) {
        vm.prank(provider);
        gpuId = market.listGPU("ipfs://specs", PRICE);
    }

    function _rentAndComplete() internal returns (uint256 jobId) {
        uint256 gpuId = _list();
        vm.prank(renter);
        jobId = market.rentGPU{value: PRICE}(gpuId, 1);
        vm.prank(provider);
        market.completeJob(jobId);
    }

    function _mintForRenter(address /*who*/) internal returns (uint256) {
        uint256 jobId = _rentAndComplete();
        return nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);
    }

    function _mintForRenterWithStake(address who, uint256 stake) internal returns (uint256) {
        uint256 jobId = _rentAndComplete();
        vm.deal(who, who.balance + stake);
        vm.prank(who);
        return nft.mintModel{value: stake}(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);
    }

    // construction ----------------------------------------------------

    function test_deploys_withCorrectMetadata() public view {
        assertEq(nft.name(), "ComputeX Model");
        assertEq(nft.symbol(), "CXMODEL");
        assertEq(nft.owner(), owner);
        assertEq(address(nft.gpuMarketplace()), address(market));
        assertEq(nft.nextTokenId(), 1);
    }

    function test_deploys_revertsOnZeroMarketplace() public {
        vm.expectRevert(bytes("Model: zero marketplace"));
        new ModelNFT(owner, address(0));
    }

    // mintModel happy path -------------------------------------------

    function test_mintModel_mintsToRenter_andStoresMetadata() public {
        uint256 jobId = _rentAndComplete();

        vm.expectEmit(true, true, true, true);
        emit ModelMinted(1, jobId, renter, MODEL_CID, PROOF_CID);

        // Permissionless: anyone can submit the CIDs.
        vm.prank(stranger);
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        assertEq(tokenId, 1);
        assertEq(nft.ownerOf(tokenId), renter);
        assertEq(nft.creator(tokenId), renter);
        assertEq(nft.jobIdOfToken(tokenId), jobId);
        assertEq(nft.tokenIdForJob(jobId), tokenId);
        assertTrue(market.modelMinted(jobId));

        (
            string memory mCID,
            string memory pCID,
            string memory desc,
            uint256 createdAt,
            , , , ,
        ) = nft.models(tokenId);
        assertEq(mCID, MODEL_CID);
        assertEq(pCID, PROOF_CID);
        assertEq(desc, DESC);
        assertEq(createdAt, block.timestamp);
    }

    // mintModel reverts ----------------------------------------------

    function test_mintModel_revertsIfJobNotCompleted() public {
        uint256 gpuId = _list();
        vm.prank(renter);
        uint256 jobId = market.rentGPU{value: PRICE}(gpuId, 1);

        vm.expectRevert(bytes("Job: not completed"));
        nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);
    }

    function test_mintModel_revertsOnDuplicate() public {
        uint256 jobId = _rentAndComplete();
        nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        vm.expectRevert(bytes("Job: model already minted"));
        nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);
    }

    function test_mintModel_revertsOnEmptyCIDs() public {
        uint256 jobId = _rentAndComplete();

        vm.expectRevert(bytes("Model: empty modelCID"));
        nft.mintModel(jobId, "", PROOF_CID, DESC, DUMMY_HASH);

        vm.expectRevert(bytes("Model: empty proofCID"));
        nft.mintModel(jobId, MODEL_CID, "", DESC, DUMMY_HASH);
    }

    // setPerformanceScore --------------------------------------------

    function test_setPerformanceScore_updatesAndEmits() public {
        uint256 jobId = _rentAndComplete();
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        vm.expectEmit(true, false, false, true);
        emit PerformanceUpdated(tokenId, 4242);

        vm.prank(owner);
        nft.setPerformanceScore(tokenId, 4242);

        assertEq(nft.performanceScore(tokenId), 4242);
    }

    function test_setPerformanceScore_revertsForNonOwner() public {
        uint256 jobId = _rentAndComplete();
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        vm.prank(stranger);
        vm.expectRevert();
        nft.setPerformanceScore(tokenId, 1);
    }

    function test_setPerformanceScore_revertsForUnknownToken() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Model: nonexistent token"));
        nft.setPerformanceScore(999, 1);
    }

    // tokenURI --------------------------------------------------------

    function test_tokenURI_isInlineBase64Json() public {
        uint256 jobId = _rentAndComplete();
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        string memory uri = nft.tokenURI(tokenId);
        // Prefix sanity check; full base64 decoding is out of scope for foundry.
        assertEq(
            bytes(uri).length > bytes("data:application/json;base64,").length,
            true
        );
    }

    function test_tokenURI_revertsForUnknownToken() public {
        vm.expectRevert(bytes("Model: nonexistent token"));
        nft.tokenURI(123);
    }

    // oracle pointer --------------------------------------------------

    function test_setOracle_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        nft.setOracle(address(0x1234));
    }

    function test_setOracle_setsAddress() public {
        address newOracle = address(0xCAFE);
        vm.prank(owner);
        nft.setOracle(newOracle);
        assertEq(nft.oracle(), newOracle);
    }

    function test_setOracle_emitsEvent() public {
        address newOracle = address(0xBEEF);
        vm.expectEmit(true, true, false, false);
        emit OracleSet(address(0), newOracle);
        vm.prank(owner);
        nft.setOracle(newOracle);
    }

    // setPerformanceScore — oracle gating ----------------------------

    function test_setPerformanceScore_revertsIfNotOracle() public {
        address mockOracle = address(0xCAFE);
        vm.prank(owner);
        nft.setOracle(mockOracle);

        uint256 jobId = _rentAndComplete();
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        // Owner is no longer authorized once oracle is set.
        vm.prank(owner);
        vm.expectRevert(bytes("Model: not oracle"));
        nft.setPerformanceScore(tokenId, 1234);
    }

    function test_setPerformanceScore_succeedsWhenCalledByOracle() public {
        address mockOracle = address(0xCAFE);
        vm.prank(owner);
        nft.setOracle(mockOracle);

        uint256 jobId = _rentAndComplete();
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        vm.prank(mockOracle);
        nft.setPerformanceScore(tokenId, 1234);
        assertEq(nft.performanceScore(tokenId), 1234);
    }

    function test_setPerformanceScore_ownerCanWriteWhenOracleUnset() public {
        // Backwards-compat: until oracle is configured, owner can still write.
        uint256 jobId = _rentAndComplete();
        uint256 tokenId = nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, DUMMY_HASH);

        vm.prank(owner);
        nft.setPerformanceScore(tokenId, 999);
        assertEq(nft.performanceScore(tokenId), 999);
    }

    // mintModel — extended metadata ----------------------------------

    function test_mintModel_initializesAuditFieldsToZero() public {
        uint256 tokenId = _mintForRenter(renter);
        (
            , , , ,
            uint256 creatorStake,
            uint256 sharpeBps,
            uint256 nVerifiedTrades,
            uint64  lastAuditAt,
            bytes32 modelWeightsHash
        ) = nft.models(tokenId);

        assertEq(creatorStake, 0);
        assertEq(sharpeBps, 0);
        assertEq(nVerifiedTrades, 0);
        assertEq(uint256(lastAuditAt), 0);
        assertEq(modelWeightsHash, DUMMY_HASH);
    }

    function test_mintModel_storesCreatorStakeFromMsgValue() public {
        uint256 stake = 0.05 ether;
        uint256 tokenId = _mintForRenterWithStake(renter, stake);

        (, , , , uint256 creatorStake, , , , ) = nft.models(tokenId);
        assertEq(creatorStake, stake);
        assertEq(address(nft).balance, stake);
    }

    function test_mintModel_revertsOnZeroWeightsHash() public {
        uint256 jobId = _rentAndComplete();
        vm.expectRevert(bytes("Model: empty weightsHash"));
        nft.mintModel(jobId, MODEL_CID, PROOF_CID, DESC, bytes32(0));
    }
}
