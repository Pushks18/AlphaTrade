// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PerformanceOracle} from "../src/PerformanceOracle.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

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

contract PerformanceOracleAuditTest is Test {
    event AuditAccepted(uint256 indexed tokenId, uint256 indexed epoch, uint256 sharpeBps, uint256 nTrades);

    PerformanceOracle oracle;
    MockVerifier      verifier;

    address constant ADMIN     = address(0xA1);
    address constant SIGNER    = address(0xB2);
    address constant MODEL_NFT = address(0xC3);

    function setUp() public {
        verifier = new MockVerifier();
        oracle = new PerformanceOracle(ADMIN, SIGNER, MODEL_NFT, address(verifier));
        vm.prank(ADMIN);
        oracle.publishFeedRoot(1, keccak256("epoch-1"));
    }

    function _baseSubmission() internal pure returns (PerformanceOracle.AuditSubmission memory s) {
        s.tokenId            = 1;
        s.epoch              = 1;
        s.modelWeightsHash   = keccak256("weights");
        s.outputsHash        = keccak256("outputs");
        s.snarkProof         = hex"";
        s.publicInputs       = new uint256[](3);
        s.publicInputs[0]    = uint256(keccak256("weights"));
        s.publicInputs[1]    = uint256(keccak256("outputs"));
        s.publicInputs[2]    = uint256(keccak256("epoch-1"));
    }

    function test_submitAudit_revertsOnUnknownEpoch() public {
        PerformanceOracle.AuditSubmission memory s = _baseSubmission();
        s.epoch = 999;
        vm.expectRevert(bytes("Oracle: unknown epoch"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_revertsOnRootMismatch() public {
        PerformanceOracle.AuditSubmission memory s = _baseSubmission();
        s.publicInputs[2] = uint256(keccak256("WRONG"));
        vm.expectRevert(bytes("Oracle: root mismatch"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_revertsOnBadProof() public {
        verifier.setAnswer(false);
        PerformanceOracle.AuditSubmission memory s = _baseSubmission();
        vm.expectRevert(bytes("Oracle: bad proof"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_emitsOnSuccess() public {
        PerformanceOracle.AuditSubmission memory s = _baseSubmission();
        vm.expectEmit(true, true, false, false);
        emit AuditAccepted(s.tokenId, s.epoch, 0, 0);
        oracle.submitAudit(s);
    }
}
