// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MerkleProofPacked} from "../src/lib/MerkleProofPacked.sol";

contract MerkleProofPackedTest is Test {
    function _leaves() internal pure returns (bytes32[4] memory l) {
        l[0] = keccak256("a");
        l[1] = keccak256("b");
        l[2] = keccak256("c");
        l[3] = keccak256("d");
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b))
                     : keccak256(abi.encodePacked(b, a));
    }

    function _root() internal pure returns (bytes32) {
        bytes32[4] memory l = _leaves();
        bytes32 l01 = _hashPair(l[0], l[1]);
        bytes32 l23 = _hashPair(l[2], l[3]);
        return _hashPair(l01, l23);
    }

    function test_verify_returnsTrueForValidProof() public pure {
        bytes32[4] memory l = _leaves();
        bytes32 root = _root();
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = l[1];
        proof[1] = _hashPair(l[2], l[3]);
        assertTrue(MerkleProofPacked.verify(proof, root, l[0]));
    }

    function test_verify_returnsFalseForBadLeaf() public pure {
        bytes32 root = _root();
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = keccak256("b");
        proof[1] = _hashPair(keccak256("c"), keccak256("d"));
        assertFalse(MerkleProofPacked.verify(proof, root, keccak256("BAD")));
    }

    function test_verify_returnsFalseForTamperedSibling() public pure {
        bytes32[4] memory l = _leaves();
        bytes32 root = _root();
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = keccak256("z");
        proof[1] = _hashPair(l[2], l[3]);
        assertFalse(MerkleProofPacked.verify(proof, root, l[0]));
    }
}
