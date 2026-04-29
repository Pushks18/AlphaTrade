// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";

contract CreatorRegistryTest is Test {
    CreatorRegistry reg;
    address constant ADMIN     = address(0xA1);
    address constant MODEL_NFT = address(0xC3);
    address constant CREATOR   = address(0xBEEF);

    function setUp() public {
        reg = new CreatorRegistry(ADMIN, MODEL_NFT);
    }

    function test_constructor_setsImmutables() public view {
        assertEq(reg.admin(),    ADMIN);
        assertEq(reg.modelNFT(), MODEL_NFT);
    }

    function test_recordMint_revertsForNonModelNFT() public {
        vm.expectRevert(bytes("Creator: not modelNFT"));
        reg.recordMint(CREATOR, 0);
    }

    function test_recordMint_firstCallMintsSBT() public {
        vm.prank(MODEL_NFT);
        reg.recordMint(CREATOR, 0);
        assertEq(reg.balanceOf(CREATOR), 1);
        assertEq(reg.creatorTokenId(CREATOR), 1);
    }

    function test_recordMint_secondCallDoesNotMintAgain() public {
        vm.startPrank(MODEL_NFT);
        reg.recordMint(CREATOR, 0);
        reg.recordMint(CREATOR, 1);
        vm.stopPrank();
        assertEq(reg.balanceOf(CREATOR), 1);
        (, uint256 modelsMinted, , , ) = reg.records(reg.creatorTokenId(CREATOR));
        assertEq(modelsMinted, 2);
    }

    function test_transfer_reverts() public {
        vm.prank(MODEL_NFT);
        reg.recordMint(CREATOR, 0);
        vm.prank(CREATOR);
        vm.expectRevert(bytes("Creator: soulbound"));
        reg.transferFrom(CREATOR, address(0xCAFE), 1);
    }

    function test_recordSlash_increments() public {
        vm.prank(MODEL_NFT);
        reg.recordMint(CREATOR, 0);
        vm.prank(MODEL_NFT);
        reg.recordSlash(CREATOR);
        (, , , uint256 slashes, ) = reg.records(reg.creatorTokenId(CREATOR));
        assertEq(slashes, 1);
    }

    function test_recordScore_aggregates() public {
        vm.prank(MODEL_NFT);
        reg.recordMint(CREATOR, 0);
        vm.prank(MODEL_NFT);
        reg.recordScore(CREATOR, 4665);
        vm.prank(MODEL_NFT);
        reg.recordScore(CREATOR, 1000);
        (, , uint256 totalSharpe, , ) = reg.records(reg.creatorTokenId(CREATOR));
        assertEq(totalSharpe, 5665);
    }

    function test_recordScore_revertsBeforeMint() public {
        vm.prank(MODEL_NFT);
        vm.expectRevert(bytes("Creator: no record"));
        reg.recordScore(CREATOR, 100);
    }
}
