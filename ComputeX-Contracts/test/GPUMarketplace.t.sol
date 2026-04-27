// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GPUMarketplace} from "../src/GPUMarketplace.sol";

contract GPUMarketplaceTest is Test {
    GPUMarketplace internal market;

    address internal owner    = address(0xA11CE);
    address internal provider = address(0xB0B);
    address internal renter   = address(0xCAFE);
    address internal stranger = address(0xDEAD);

    uint256 internal constant PRICE = 0.01 ether;
    string  internal constant META  = "ipfs://gpu-specs";

    event GPUListed(uint256 indexed gpuId, address indexed provider, uint256 pricePerHour, string metadata);
    event JobCreated(
        uint256 indexed jobId,
        address indexed renter,
        uint256 indexed gpuId,
        uint256 duration,
        uint256 totalCost
    );
    event JobStarted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId);
    event JobCompleted(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId);
    event JobCancelled(uint256 indexed jobId, address indexed renter, uint256 indexed gpuId, uint256 refund);
    event ModelMintedMarked(uint256 indexed jobId);

    function setUp() public {
        market = new GPUMarketplace(owner);
        vm.deal(renter, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    // ------------------------------------------------------------------
    // listGPU
    // ------------------------------------------------------------------

    function test_listGPU_recordsListing_andEmits() public {
        vm.expectEmit(true, true, false, true);
        emit GPUListed(0, provider, PRICE, META);

        vm.prank(provider);
        uint256 gpuId = market.listGPU(META, PRICE);

        assertEq(gpuId, 0);
        assertEq(market.nextGpuId(), 1);

        GPUMarketplace.GPU memory g = market.getGPU(gpuId);
        assertEq(g.provider, provider);
        assertEq(g.pricePerHour, PRICE);
        assertEq(g.metadata, META);
        assertTrue(g.available);
    }

    function test_listGPU_revertsOnZeroPrice() public {
        vm.prank(provider);
        vm.expectRevert(bytes("GPU: price=0"));
        market.listGPU(META, 0);
    }

    function test_listGPU_revertsOnEmptyMetadata() public {
        vm.prank(provider);
        vm.expectRevert(bytes("GPU: empty metadata"));
        market.listGPU("", PRICE);
    }

    // ------------------------------------------------------------------
    // rentGPU
    // ------------------------------------------------------------------

    function _list() internal returns (uint256 gpuId) {
        vm.prank(provider);
        gpuId = market.listGPU(META, PRICE);
    }

    function test_rentGPU_escrowsFunds_andCreatesJob() public {
        uint256 gpuId = _list();
        uint256 duration = 3;
        uint256 cost = PRICE * duration;

        vm.expectEmit(true, true, true, true);
        emit JobCreated(0, renter, gpuId, duration, cost);

        vm.prank(renter);
        uint256 jobId = market.rentGPU{value: cost}(gpuId, duration);

        assertEq(jobId, 0);
        assertEq(address(market).balance, cost);

        GPUMarketplace.Job memory j = market.getJob(jobId);
        assertEq(j.renter, renter);
        assertEq(j.gpuId, gpuId);
        assertEq(j.duration, duration);
        assertEq(j.totalCost, cost);
        assertEq(uint256(j.status), uint256(GPUMarketplace.JobStatus.Created));

        assertEq(market.jobOwner(jobId), renter);
        assertFalse(market.jobCompleted(jobId));
        assertFalse(market.getGPU(gpuId).available);
    }

    function test_rentGPU_revertsIfUnknown() public {
        vm.prank(renter);
        vm.expectRevert(bytes("GPU: not found"));
        market.rentGPU{value: PRICE}(999, 1);
    }

    function test_rentGPU_revertsIfUnavailable() public {
        uint256 gpuId = _list();
        vm.prank(renter);
        market.rentGPU{value: PRICE}(gpuId, 1);

        vm.prank(stranger);
        vm.expectRevert(bytes("GPU: unavailable"));
        market.rentGPU{value: PRICE}(gpuId, 1);
    }

    function test_rentGPU_revertsOnZeroDuration() public {
        uint256 gpuId = _list();
        vm.prank(renter);
        vm.expectRevert(bytes("GPU: duration=0"));
        market.rentGPU{value: 0}(gpuId, 0);
    }

    function test_rentGPU_revertsOnBadPayment() public {
        uint256 gpuId = _list();
        vm.prank(renter);
        vm.expectRevert(bytes("GPU: bad payment"));
        market.rentGPU{value: PRICE - 1}(gpuId, 1);
    }

    function test_rentGPU_revertsIfProviderRentsSelf() public {
        uint256 gpuId = _list();
        vm.deal(provider, 1 ether);
        vm.prank(provider);
        vm.expectRevert(bytes("GPU: provider cannot rent self"));
        market.rentGPU{value: PRICE}(gpuId, 1);
    }

    // ------------------------------------------------------------------
    // completeJob
    // ------------------------------------------------------------------

    function _rent(uint256 gpuId, uint256 duration) internal returns (uint256 jobId) {
        vm.prank(renter);
        jobId = market.rentGPU{value: PRICE * duration}(gpuId, duration);
    }

    function test_completeJob_paysProvider_andReleasesGPU() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 4);
        uint256 cost = PRICE * 4;

        uint256 providerBalBefore = provider.balance;

        vm.expectEmit(true, true, true, true);
        emit JobCompleted(jobId, renter, gpuId);

        vm.prank(provider);
        market.completeJob(jobId);

        assertEq(provider.balance, providerBalBefore + cost);
        assertEq(address(market).balance, 0);
        assertTrue(market.jobCompleted(jobId));
        assertEq(uint256(market.getJob(jobId).status), uint256(GPUMarketplace.JobStatus.Completed));
        assertTrue(market.getGPU(gpuId).available);
    }

    function test_completeJob_callableByOwner() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(owner);
        market.completeJob(jobId);

        assertTrue(market.jobCompleted(jobId));
    }

    function test_completeJob_revertsForUnauthorized() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(stranger);
        vm.expectRevert(bytes("Job: not authorized"));
        market.completeJob(jobId);
    }

    function test_completeJob_revertsOnUnknownJob() public {
        vm.prank(provider);
        vm.expectRevert(bytes("Job: not found"));
        market.completeJob(42);
    }

    function test_completeJob_preventsDoubleCompletion() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(provider);
        market.completeJob(jobId);

        vm.prank(provider);
        vm.expectRevert(bytes("Job: not active"));
        market.completeJob(jobId);
    }

    // ------------------------------------------------------------------
    // cancelJob
    // ------------------------------------------------------------------

    function test_cancelJob_refundsRenter_andFreesGPU() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 2);
        uint256 cost = PRICE * 2;

        uint256 renterBalBefore = renter.balance;

        vm.expectEmit(true, true, true, true);
        emit JobCancelled(jobId, renter, gpuId, cost);

        vm.prank(renter);
        market.cancelJob(jobId);

        assertEq(renter.balance, renterBalBefore + cost);
        assertEq(address(market).balance, 0);
        assertEq(uint256(market.getJob(jobId).status), uint256(GPUMarketplace.JobStatus.Cancelled));
        assertTrue(market.getGPU(gpuId).available);
        assertFalse(market.jobCompleted(jobId));
    }

    function test_cancelJob_revertsForNonRenter() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(stranger);
        vm.expectRevert(bytes("Job: only renter"));
        market.cancelJob(jobId);
    }

    function test_cancelJob_revertsAfterCompletion() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(provider);
        market.completeJob(jobId);

        vm.prank(renter);
        vm.expectRevert(bytes("Job: already completed"));
        market.cancelJob(jobId);
    }

    function test_cancelJob_cannotBeCalledTwice() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(renter);
        market.cancelJob(jobId);

        vm.prank(renter);
        vm.expectRevert(bytes("Job: already cancelled"));
        market.cancelJob(jobId);
    }

    // ------------------------------------------------------------------
    // re-listing post-completion
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // startJob
    // ------------------------------------------------------------------

    function test_startJob_flipsToRunning_andEmits() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.expectEmit(true, true, true, false);
        emit JobStarted(jobId, renter, gpuId);

        vm.prank(owner);
        market.startJob(jobId);

        assertEq(uint256(market.getJob(jobId).status), uint256(GPUMarketplace.JobStatus.Running));
        assertTrue(market.isJobActive(jobId));
    }

    function test_startJob_revertsForNonOwner() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(stranger);
        vm.expectRevert();
        market.startJob(jobId);
    }

    function test_startJob_revertsIfAlreadyRunning() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(owner);
        market.startJob(jobId);

        vm.prank(owner);
        vm.expectRevert(bytes("Job: not pending"));
        market.startJob(jobId);
    }

    function test_completeJob_acceptsRunningStatus() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(owner);
        market.startJob(jobId);

        vm.prank(provider);
        market.completeJob(jobId);

        assertTrue(market.jobCompleted(jobId));
        assertFalse(market.isJobActive(jobId));
    }

    // ------------------------------------------------------------------
    // setModelNFT + consumeMintRight
    // ------------------------------------------------------------------

    address internal modelNFTMock = address(0xF00D);

    function _wireMintRight() internal {
        vm.prank(owner);
        market.setModelNFT(modelNFTMock);
    }

    function test_setModelNFT_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        market.setModelNFT(modelNFTMock);
    }

    function test_setModelNFT_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(bytes("GPU: zero address"));
        market.setModelNFT(address(0));
    }

    function test_consumeMintRight_returnsOwner_andFlipsFlag() public {
        _wireMintRight();
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(provider);
        market.completeJob(jobId);

        vm.expectEmit(true, false, false, false);
        emit ModelMintedMarked(jobId);

        vm.prank(modelNFTMock);
        address claimed = market.consumeMintRight(jobId);

        assertEq(claimed, renter);
        assertTrue(market.modelMinted(jobId));
    }

    function test_consumeMintRight_revertsIfNotModelNFT() public {
        _wireMintRight();
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);
        vm.prank(provider);
        market.completeJob(jobId);

        vm.prank(stranger);
        vm.expectRevert(bytes("GPU: not modelNFT"));
        market.consumeMintRight(jobId);
    }

    function test_consumeMintRight_revertsIfJobNotCompleted() public {
        _wireMintRight();
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(modelNFTMock);
        vm.expectRevert(bytes("Job: not completed"));
        market.consumeMintRight(jobId);
    }

    function test_consumeMintRight_revertsOnDuplicate() public {
        _wireMintRight();
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);
        vm.prank(provider);
        market.completeJob(jobId);

        vm.prank(modelNFTMock);
        market.consumeMintRight(jobId);

        vm.prank(modelNFTMock);
        vm.expectRevert(bytes("Job: model already minted"));
        market.consumeMintRight(jobId);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function test_getJobProvider_returnsGPUProvider() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);
        assertEq(market.getJobProvider(jobId), provider);
    }

    function test_isJobActive_lifecycle() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        assertTrue(market.isJobActive(jobId));

        vm.prank(provider);
        market.completeJob(jobId);
        assertFalse(market.isJobActive(jobId));
    }

    function test_isJobActive_falseForCancelled() public {
        uint256 gpuId = _list();
        uint256 jobId = _rent(gpuId, 1);

        vm.prank(renter);
        market.cancelJob(jobId);
        assertFalse(market.isJobActive(jobId));
    }

    function test_gpuCanBeRentedAgain_afterCompletion() public {
        uint256 gpuId = _list();
        uint256 firstJob = _rent(gpuId, 1);

        vm.prank(provider);
        market.completeJob(firstJob);

        // second renter
        uint256 secondJob = _rent(gpuId, 2);
        assertEq(secondJob, 1);
        assertFalse(market.getGPU(gpuId).available);
    }
}
