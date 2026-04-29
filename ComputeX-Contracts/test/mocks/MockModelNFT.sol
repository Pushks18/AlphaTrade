// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockModelNFT {
    mapping(uint256 => uint256) public scores;
    mapping(uint256 => bytes32) public weightsHashOf;
    mapping(uint256 => address) public lastSlasher;
    mapping(uint256 => uint16)  public lastSlasherBps;
    uint256 public slashPaidStub = 0.05 ether;

    function setWeightsHash(uint256 tokenId, bytes32 h) external { weightsHashOf[tokenId] = h; }
    function setPerformanceScore(uint256 tokenId, uint256 score) external { scores[tokenId] = score; }

    function slashStake(uint256 tokenId, address payable slasher, uint16 slasherBps)
        external returns (uint256 paid)
    {
        lastSlasher[tokenId]    = slasher;
        lastSlasherBps[tokenId] = slasherBps;
        return slashPaidStub;
    }

    function models(uint256 tokenId) external view returns (
        string memory modelCID,
        string memory proofCID,
        string memory description,
        uint256 createdAt,
        uint256 creatorStake,
        uint256 sharpeBps,
        uint256 nVerifiedTrades,
        uint64 lastAuditAt,
        bytes32 modelWeightsHash
    ) {
        modelWeightsHash = weightsHashOf[tokenId];
        // remaining return params default to "" / 0 already
        modelCID; proofCID; description; createdAt;
        creatorStake; sharpeBps; nVerifiedTrades; lastAuditAt;
    }
}
