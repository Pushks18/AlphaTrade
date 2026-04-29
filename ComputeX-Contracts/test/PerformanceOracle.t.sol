// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PerformanceOracle} from "../src/PerformanceOracle.sol";

contract PerformanceOracleSkeletonTest is Test {
    PerformanceOracle oracle;
    address constant ADMIN     = address(0xA1);
    address constant SIGNER    = address(0xB2);
    address constant MODEL_NFT = address(0xC3);
    address constant VERIFIER  = address(0xD4);

    function setUp() public {
        oracle = new PerformanceOracle(ADMIN, SIGNER, MODEL_NFT, VERIFIER);
    }

    function test_constructor_setsImmutables() public view {
        assertEq(oracle.admin(),       ADMIN);
        assertEq(oracle.feedSigner(),  SIGNER);
        assertEq(oracle.modelNFT(),    MODEL_NFT);
        assertEq(address(oracle.verifier()), VERIFIER);
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(bytes("Oracle: zero admin"));
        new PerformanceOracle(address(0), SIGNER, MODEL_NFT, VERIFIER);
    }

    function test_constructor_revertsOnZeroSigner() public {
        vm.expectRevert(bytes("Oracle: zero signer"));
        new PerformanceOracle(ADMIN, address(0), MODEL_NFT, VERIFIER);
    }

    function test_publishFeedRoot_admin_storesRoot() public {
        bytes32 root = keccak256("epoch-1");
        vm.prank(ADMIN);
        oracle.publishFeedRoot(1, root);
        assertEq(oracle.priceFeedRoot(1), root);
    }

    function test_publishFeedRoot_revertsForNonAdmin() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(bytes("Oracle: not admin"));
        oracle.publishFeedRoot(1, keccak256("x"));
    }

    function test_publishFeedRoot_revertsOnRepublish() public {
        vm.prank(ADMIN);
        oracle.publishFeedRoot(1, keccak256("x"));
        vm.prank(ADMIN);
        vm.expectRevert(bytes("Oracle: epoch already published"));
        oracle.publishFeedRoot(1, keccak256("y"));
    }

    function test_publishFeedRoot_revertsOnEmptyRoot() public {
        vm.prank(ADMIN);
        vm.expectRevert(bytes("Oracle: empty root"));
        oracle.publishFeedRoot(1, bytes32(0));
    }
}
