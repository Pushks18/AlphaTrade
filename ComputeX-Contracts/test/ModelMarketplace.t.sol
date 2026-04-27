// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GPUMarketplace} from "../src/GPUMarketplace.sol";
import {ModelNFT} from "../src/ModelNFT.sol";
import {ModelMarketplace} from "../src/ModelMarketplace.sol";

contract ModelMarketplaceTest is Test {
    GPUMarketplace internal gpu;
    ModelNFT internal nft;
    ModelMarketplace internal market;

    address internal owner    = address(0xA11CE);   // also default feeRecipient
    address internal provider = address(0xB0B);
    address internal renter   = address(0xCAFE);    // also creator after mint
    address internal buyer    = address(0xBEEF);
    address internal stranger = address(0xDEAD);

    uint256 internal constant GPU_PRICE  = 0.01 ether;
    uint256 internal constant LIST_PRICE = 1 ether;

    event ModelListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event ModelSold(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 price,
        uint256 sellerAmount,
        uint256 royalty,
        uint256 fee
    );
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event PriceUpdated(uint256 indexed tokenId, address indexed seller, uint256 newPrice);

    function setUp() public {
        vm.startPrank(owner);
        gpu = new GPUMarketplace(owner);
        nft = new ModelNFT(owner, address(gpu));
        market = new ModelMarketplace(owner, address(nft));
        gpu.setModelNFT(address(nft));
        vm.stopPrank();

        vm.deal(renter, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    // helpers ---------------------------------------------------------

    function _mintModelTo(address to) internal returns (uint256 tokenId) {
        vm.prank(provider);
        uint256 gpuId = gpu.listGPU("ipfs://specs", GPU_PRICE);
        vm.deal(to, to.balance + GPU_PRICE);
        vm.prank(to);
        uint256 jobId = gpu.rentGPU{value: GPU_PRICE}(gpuId, 1);
        vm.prank(provider);
        gpu.completeJob(jobId);
        tokenId = nft.mintModel(jobId, "bafy-model", "bafy-proof", "desc");
        require(nft.ownerOf(tokenId) == to, "setup: bad mint owner");
    }

    function _list(address seller, uint256 tokenId, uint256 price) internal {
        vm.prank(seller);
        nft.approve(address(market), tokenId);
        vm.prank(seller);
        market.listModel(tokenId, price);
    }

    function _assertNoEthHeld() internal view {
        assertEq(address(market).balance, 0, "INVARIANT: market holds no ETH");
    }

    // ---------------------------------------------------------------
    // construction
    // ---------------------------------------------------------------

    function test_deploys_withDefaults() public view {
        assertEq(market.modelNFT(), address(nft));
        assertEq(market.owner(), owner);
        assertEq(market.feeBps(), 250);
        assertEq(market.royaltyBps(), 500);
        assertEq(market.feeRecipient(), owner);
    }

    function test_deploys_revertsOnZeroNFT() public {
        vm.expectRevert(ModelMarketplace.ZeroAddress.selector);
        new ModelMarketplace(owner, address(0));
    }

    // ---------------------------------------------------------------
    // admin
    // ---------------------------------------------------------------

    function test_setFee_updates_andCaps() public {
        vm.prank(owner);
        market.setFee(123);
        assertEq(market.feeBps(), 123);

        vm.prank(owner);
        vm.expectRevert(ModelMarketplace.BpsTooHigh.selector);
        market.setFee(1_001);
    }

    function test_setRoyalty_updates_andCaps() public {
        vm.prank(owner);
        market.setRoyaltyBps(750);
        assertEq(market.royaltyBps(), 750);

        vm.prank(owner);
        vm.expectRevert(ModelMarketplace.BpsTooHigh.selector);
        market.setRoyaltyBps(1_001);
    }

    function test_setFeeRecipient_updates_andRejectsZero() public {
        vm.prank(owner);
        market.setFeeRecipient(stranger);
        assertEq(market.feeRecipient(), stranger);

        vm.prank(owner);
        vm.expectRevert(ModelMarketplace.ZeroAddress.selector);
        market.setFeeRecipient(address(0));
    }

    function test_admin_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        market.setFee(1);
    }

    // ---------------------------------------------------------------
    // listModel
    // ---------------------------------------------------------------

    function test_listModel_escrowsNFT_andStoresListing() public {
        uint256 tokenId = _mintModelTo(renter);

        vm.prank(renter);
        nft.approve(address(market), tokenId);

        vm.expectEmit(true, true, false, true);
        emit ModelListed(tokenId, renter, LIST_PRICE);

        vm.prank(renter);
        market.listModel(tokenId, LIST_PRICE);

        assertEq(nft.ownerOf(tokenId), address(market));

        (uint256 tId, address seller, uint256 price, bool active) = market.listings(tokenId);
        assertEq(tId, tokenId);
        assertEq(seller, renter);
        assertEq(price, LIST_PRICE);
        assertTrue(active);
        _assertNoEthHeld();
    }

    function test_listModel_revertsOnZeroPrice() public {
        uint256 tokenId = _mintModelTo(renter);
        vm.prank(renter);
        nft.approve(address(market), tokenId);

        vm.prank(renter);
        vm.expectRevert(ModelMarketplace.InvalidPrice.selector);
        market.listModel(tokenId, 0);
    }

    function test_listModel_revertsForNonOwner() public {
        uint256 tokenId = _mintModelTo(renter);
        vm.prank(stranger);
        vm.expectRevert(ModelMarketplace.NotOwner.selector);
        market.listModel(tokenId, LIST_PRICE);
    }

    function test_listModel_revertsIfAlreadyListed() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(renter);
        vm.expectRevert(ModelMarketplace.AlreadyListed.selector);
        market.listModel(tokenId, LIST_PRICE);
    }

    // ---------------------------------------------------------------
    // updatePrice
    // ---------------------------------------------------------------

    function test_updatePrice_changesAndEmits() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.expectEmit(true, true, false, true);
        emit PriceUpdated(tokenId, renter, 2 ether);

        vm.prank(renter);
        market.updatePrice(tokenId, 2 ether);

        (, , uint256 price, ) = market.listings(tokenId);
        assertEq(price, 2 ether);
    }

    function test_updatePrice_revertsForNonSeller() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(stranger);
        vm.expectRevert(ModelMarketplace.NotSeller.selector);
        market.updatePrice(tokenId, 2 ether);
    }

    function test_updatePrice_revertsIfNotActive() public {
        vm.prank(renter);
        vm.expectRevert(ModelMarketplace.NotActive.selector);
        market.updatePrice(99, 1 ether);
    }

    function test_updatePrice_revertsOnZero() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(renter);
        vm.expectRevert(ModelMarketplace.InvalidPrice.selector);
        market.updatePrice(tokenId, 0);
    }

    // ---------------------------------------------------------------
    // buyModel — splits ETH into seller / royalty / fee
    // ---------------------------------------------------------------

    function test_buyModel_splitsPayment_seller_creator_recipient() public {
        // Mint to renter (creator). Renter sells to buyer1, who later resells
        // to buyer2 — so on buyer2's purchase, creator != seller and we can
        // observe the royalty path independently.
        uint256 tokenId = _mintModelTo(renter);

        // First sale: renter → buyer (creator == seller, royalty effectively
        // goes back to seller, but we still verify accounting).
        _list(renter, tokenId, LIST_PRICE);
        vm.prank(buyer);
        market.buyModel{value: LIST_PRICE}(tokenId);
        assertEq(nft.ownerOf(tokenId), buyer);
        _assertNoEthHeld();

        // Second sale: buyer → stranger.
        _list(buyer, tokenId, LIST_PRICE);

        uint256 price = LIST_PRICE;
        uint256 expectedRoyalty = (price * 500) / 10_000;     // 5% to renter (creator)
        uint256 expectedFee     = (price * 250) / 10_000;     // 2.5% to owner (feeRecipient)
        uint256 expectedSeller  = price - expectedRoyalty - expectedFee;

        uint256 ownerBefore   = owner.balance;
        uint256 creatorBefore = renter.balance;
        uint256 sellerBefore  = buyer.balance;

        vm.expectEmit(true, true, false, true);
        emit ModelSold(tokenId, stranger, price, expectedSeller, expectedRoyalty, expectedFee);

        vm.prank(stranger);
        market.buyModel{value: price}(tokenId);

        assertEq(nft.ownerOf(tokenId), stranger);
        assertEq(owner.balance,   ownerBefore   + expectedFee,     "fee");
        assertEq(renter.balance,  creatorBefore + expectedRoyalty, "royalty");
        assertEq(buyer.balance,   sellerBefore  + expectedSeller,  "seller");
        _assertNoEthHeld();
    }

    function test_buyModel_revertsIfNotListed() public {
        vm.prank(buyer);
        vm.expectRevert(ModelMarketplace.NotActive.selector);
        market.buyModel{value: LIST_PRICE}(42);
    }

    function test_buyModel_revertsOnBadPayment() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(buyer);
        vm.expectRevert(ModelMarketplace.InvalidPayment.selector);
        market.buyModel{value: LIST_PRICE - 1}(tokenId);
    }

    function test_buyModel_revertsIfSellerBuysSelf() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(renter);
        vm.expectRevert(ModelMarketplace.SelfTrade.selector);
        market.buyModel{value: LIST_PRICE}(tokenId);
    }

    function test_buyModel_cannotBeBoughtTwice() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(buyer);
        market.buyModel{value: LIST_PRICE}(tokenId);

        vm.prank(stranger);
        vm.expectRevert(ModelMarketplace.NotActive.selector);
        market.buyModel{value: LIST_PRICE}(tokenId);
    }

    function test_buyModel_zeroFeesPayFullToSeller() public {
        vm.prank(owner); market.setFee(0);
        vm.prank(owner); market.setRoyaltyBps(0);

        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        uint256 sellerBefore = renter.balance;
        vm.prank(buyer);
        market.buyModel{value: LIST_PRICE}(tokenId);

        assertEq(renter.balance, sellerBefore + LIST_PRICE);
        _assertNoEthHeld();
    }

    // ---------------------------------------------------------------
    // cancelListing
    // ---------------------------------------------------------------

    function test_cancelListing_returnsNFT() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.expectEmit(true, true, false, false);
        emit ListingCancelled(tokenId, renter);

        vm.prank(renter);
        market.cancelListing(tokenId);

        assertEq(nft.ownerOf(tokenId), renter);
        (, , , bool active) = market.listings(tokenId);
        assertFalse(active);
        _assertNoEthHeld();
    }

    function test_cancelListing_revertsForNonSeller() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(stranger);
        vm.expectRevert(ModelMarketplace.NotSeller.selector);
        market.cancelListing(tokenId);
    }

    function test_cancelListing_revertsIfNotActive() public {
        vm.prank(renter);
        vm.expectRevert(ModelMarketplace.NotActive.selector);
        market.cancelListing(99);
    }

    function test_cancelledListing_canBeRelisted() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        vm.prank(renter);
        market.cancelListing(tokenId);

        _list(renter, tokenId, 2 ether);
        assertEq(nft.ownerOf(tokenId), address(market));
        (, , uint256 price, bool active) = market.listings(tokenId);
        assertEq(price, 2 ether);
        assertTrue(active);
    }

    // ---------------------------------------------------------------
    // getActiveListings
    // ---------------------------------------------------------------

    function test_getActiveListings_returnsBatch() public {
        uint256 t1 = _mintModelTo(renter);
        uint256 t2 = _mintModelTo(renter);
        _list(renter, t1, LIST_PRICE);
        // t2 not listed

        uint256[] memory ids = new uint256[](3);
        ids[0] = t1;
        ids[1] = t2;
        ids[2] = 9999; // unknown

        ModelMarketplace.Listing[] memory out = market.getActiveListings(ids);
        assertEq(out.length, 3);
        assertTrue(out[0].active);
        assertEq(out[0].seller, renter);
        assertFalse(out[1].active);
        assertFalse(out[2].active);
    }

    // ---------------------------------------------------------------
    // Invariant-style: market never accumulates ETH across full lifecycle
    // ---------------------------------------------------------------

    function test_invariant_marketHoldsNoEth_acrossLifecycle() public {
        uint256 a = _mintModelTo(renter);
        uint256 b = _mintModelTo(renter);
        uint256 c = _mintModelTo(renter);

        _list(renter, a, 1 ether);  _assertNoEthHeld();
        _list(renter, b, 2 ether);  _assertNoEthHeld();
        _list(renter, c, 3 ether);  _assertNoEthHeld();

        vm.prank(buyer);
        market.buyModel{value: 1 ether}(a); _assertNoEthHeld();

        vm.prank(renter);
        market.updatePrice(b, 5 ether);     _assertNoEthHeld();

        vm.prank(stranger);
        market.buyModel{value: 5 ether}(b); _assertNoEthHeld();

        vm.prank(renter);
        market.cancelListing(c);            _assertNoEthHeld();
    }

    function test_invariant_activeListingImpliesMarketOwnsNFT() public {
        uint256 tokenId = _mintModelTo(renter);
        _list(renter, tokenId, LIST_PRICE);

        (, , , bool active) = market.listings(tokenId);
        assertTrue(active);
        assertEq(nft.ownerOf(tokenId), address(market));

        vm.prank(buyer);
        market.buyModel{value: LIST_PRICE}(tokenId);

        (, , , active) = market.listings(tokenId);
        assertFalse(active);
        assertEq(nft.ownerOf(tokenId), buyer);
    }
}
