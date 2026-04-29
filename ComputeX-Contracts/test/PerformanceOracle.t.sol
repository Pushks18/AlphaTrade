// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PerformanceOracle} from "../src/PerformanceOracle.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockModelNFT} from "./mocks/MockModelNFT.sol";

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
    MockModelNFT      nft;

    address constant ADMIN  = address(0xA1);
    address constant SIGNER = address(0xB2);

    bytes32 leafA;
    bytes32 leafB;
    bytes32 root;

    function setUp() public {
        verifier = new MockVerifier();
        nft = new MockModelNFT();
        nft.setWeightsHash(1, keccak256("weights"));
        oracle = new PerformanceOracle(ADMIN, SIGNER, address(nft), address(verifier));

        // 2-leaf Merkle tree over flat-market price bars; sufficient for
        // exercising every check in submitAudit without contriving Sharpe.
        leafA = keccak256(abi.encodePacked(uint32(0), int256(100e8)));
        leafB = keccak256(abi.encodePacked(uint32(1), int256(100e8)));
        root  = leafA < leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));
        vm.prank(ADMIN);
        oracle.publishFeedRoot(1, root);
    }

    function _validSubmission() internal view returns (PerformanceOracle.AuditSubmission memory s) {
        s.tokenId          = 1;
        s.epoch            = 1;
        s.modelWeightsHash = keccak256("weights");
        int256[] memory outputs = new int256[](2);
        outputs[0] = 5000; outputs[1] = 5000;
        s.outputs     = outputs;
        s.outputsHash = keccak256(abi.encodePacked(outputs));
        s.publicInputs    = new uint256[](3);
        s.publicInputs[0] = uint256(s.modelWeightsHash);
        s.publicInputs[1] = uint256(s.outputsHash);
        s.publicInputs[2] = uint256(root);
        s.priceFeedBars   = new int256[](2);
        s.priceFeedBars[0] = 100e8; s.priceFeedBars[1] = 100e8;
        s.priceFeedIndexes = new uint32[](2);
        s.priceFeedIndexes[0] = 0; s.priceFeedIndexes[1] = 1;
        s.priceFeedSiblings = new bytes32[](2);
        s.priceFeedSiblings[0] = leafB;
        s.priceFeedSiblings[1] = leafA;
        s.snarkProof = hex"";
    }

    function test_submitAudit_revertsOnUnknownEpoch() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        s.epoch = 999;
        vm.expectRevert(bytes("Oracle: unknown epoch"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_revertsOnRootMismatch() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        s.publicInputs[2] = uint256(keccak256("WRONG"));
        vm.expectRevert(bytes("Oracle: root mismatch"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_revertsOnBadProof() public {
        verifier.setAnswer(false);
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        vm.expectRevert(bytes("Oracle: bad proof"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_emitsOnSuccess() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        vm.expectEmit(true, true, false, false);
        emit AuditAccepted(s.tokenId, s.epoch, 0, 0);
        oracle.submitAudit(s);
    }

    // C3 — outputs / weights / merkle / sharpe -----------------------

    function test_submitAudit_revertsOnWeightsHashMismatch() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        s.modelWeightsHash = keccak256("WRONG");
        s.publicInputs[0]  = uint256(keccak256("WRONG"));
        vm.expectRevert(bytes("Oracle: weights mismatch"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_revertsOnOutputsHashMismatch() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        s.outputsHash      = keccak256("WRONG");
        s.publicInputs[1]  = uint256(keccak256("WRONG"));
        vm.expectRevert(bytes("Oracle: outputs mismatch"));
        oracle.submitAudit(s);
    }

    function test_submitAudit_writesScoreOnSuccess() public {
        // Flat market => sharpe == 0; stronger values covered in D4 parity.
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        oracle.submitAudit(s);
        assertEq(nft.scores(1), 0);
    }

    function test_submitAudit_recordsLastSharpeAndEpoch() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        oracle.submitAudit(s);
        assertEq(oracle.lastSharpe(1), 0); // flat
        assertEq(oracle.lastEpoch(1),  1);
    }

    // C4 — slashing -------------------------------------------------

    event Slashed(uint256 indexed tokenId, address indexed slasher, uint256 stakeSplitToSlasher);

    function test_setSlashTolerance_admin_works() public {
        vm.prank(ADMIN);
        oracle.setSlashTolerance(50);
        assertEq(oracle.slashToleranceBps(), 50);
    }

    function test_setSlashTolerance_revertsForNonAdmin() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(bytes("Oracle: not admin"));
        oracle.setSlashTolerance(50);
    }

    function test_setSlashTolerance_revertsAboveCeiling() public {
        vm.prank(ADMIN);
        vm.expectRevert(bytes("Oracle: tolerance too large"));
        oracle.setSlashTolerance(2_001);
    }

    function test_slash_revertsIfNoPriorAudit() public {
        PerformanceOracle.AuditSubmission memory s = _validSubmission();
        vm.expectRevert(bytes("Oracle: no prior audit"));
        oracle.slash(1, payable(address(0xBEEF)), s);
    }

    function test_slash_revertsBelowTolerance() public {
        // Honest audit puts lastSharpe=0; slasher submits same flat fixture
        // → diff = 0 → below default 200 bps tolerance.
        oracle.submitAudit(_validSubmission());
        PerformanceOracle.AuditSubmission memory challenge = _validSubmission();
        vm.expectRevert(bytes("Oracle: within tolerance"));
        oracle.slash(1, payable(address(0xBEEF)), challenge);
    }

    function test_slash_revertsOnTokenIdMismatch() public {
        oracle.submitAudit(_validSubmission());
        PerformanceOracle.AuditSubmission memory challenge = _validSubmission();
        challenge.tokenId = 2;
        vm.expectRevert(bytes("Oracle: tokenId mismatch"));
        oracle.slash(1, payable(address(0xBEEF)), challenge);
    }

    function test_slash_callsSlashStakeOnDivergence() public {
        // First, a normal audit so lastEpoch[1] is set.
        oracle.submitAudit(_validSubmission());

        // Force a divergent prior Sharpe so the challenger's sharpe (=0)
        // differs by more than the tolerance. We can't reach this state
        // organically with a 2-leaf flat-market fixture (single-sibling
        // Merkle proofs are limited to 2 bars, where Sharpe always = 0),
        // so we patch the storage slot. This is a test-only shortcut;
        // production divergence comes from genuinely contradicting audits
        // once multi-level proofs land in a follow-up task.
        bytes32 slot = keccak256(abi.encode(uint256(1), uint256(4))); // lastSharpe[1] @ slot 4
        vm.store(address(oracle), slot, bytes32(uint256(500))); // > 200 bps tolerance

        address payable slasher = payable(address(0xBEEF));
        PerformanceOracle.AuditSubmission memory challenge = _validSubmission();

        vm.expectEmit(true, true, false, true);
        emit Slashed(1, slasher, nft.slashPaidStub());
        oracle.slash(1, slasher, challenge);

        assertEq(nft.lastSlasher(1),    slasher);
        assertEq(nft.lastSlasherBps(1), 8000);
    }
}
