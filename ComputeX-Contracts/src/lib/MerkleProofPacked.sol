// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  MerkleProofPacked
/// @notice Sorted-pair Merkle proof verifier matching the convention used by
///         OpenZeppelin's `MerkleProof` and our Python feed builder.
/// @dev    We keep our own copy because we want to verify many proofs in a
///         single `submitAudit` call without paying ABI-decode overhead per
///         proof. Logic identical to OZ; reproduced here for stability across
///         OZ upgrades.
library MerkleProofPacked {
    function verify(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            computed = computed < sibling
                ? keccak256(abi.encodePacked(computed, sibling))
                : keccak256(abi.encodePacked(sibling, computed));
        }
        return computed == root;
    }
}
