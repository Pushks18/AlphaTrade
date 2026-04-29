// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleProofPacked} from "./lib/MerkleProofPacked.sol";

interface IEzklVerifier {
    function verifyProof(bytes calldata proof, uint256[] calldata pubInputs)
        external view returns (bool);
}

interface IModelNFTOracleHook {
    function setPerformanceScore(uint256 tokenId, uint256 score) external;
    function models(uint256 tokenId) external view returns (
        string memory modelCID,
        string memory proofCID,
        string memory description,
        uint256 createdAt,
        uint256 creatorStake,
        uint256 sharpeBps,
        uint256 nVerifiedTrades,
        uint64  lastAuditAt,
        bytes32 modelWeightsHash
    );
}

/// @title  PerformanceOracle
/// @notice Accepts EZKL audit submissions for model NFTs, verifies them
///         against a protocol-signed price feed, and writes resulting Sharpe
///         scores into ModelNFT.
/// @dev    `feedSigner` is the off-chain key that produces the signed Merkle
///         root for each audit epoch. `admin` rotates the signer and pushes
///         the published root on chain. The verifier is the Solidity contract
///         emitted by EZKL's CLI for our specific circuit.
contract PerformanceOracle {
    address       public admin;
    address       public feedSigner;
    address       public immutable modelNFT;
    IEzklVerifier public immutable verifier;

    /// @notice epoch => signed Merkle root of the OHLCV slice for that epoch.
    mapping(uint256 => bytes32) public priceFeedRoot;

    event FeedRootPublished(uint256 indexed epoch, bytes32 root);
    event AdminRotated(address indexed previous, address indexed next);
    event SignerRotated(address indexed previous, address indexed next);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Oracle: not admin");
        _;
    }

    constructor(address _admin, address _signer, address _modelNFT, address _verifier) {
        require(_admin    != address(0), "Oracle: zero admin");
        require(_signer   != address(0), "Oracle: zero signer");
        require(_modelNFT != address(0), "Oracle: zero modelNFT");
        require(_verifier != address(0), "Oracle: zero verifier");
        admin       = _admin;
        feedSigner  = _signer;
        modelNFT    = _modelNFT;
        verifier    = IEzklVerifier(_verifier);
    }

    /// @notice Publish a new epoch's signed price-feed Merkle root.
    /// @dev    The signer key signs the root off-chain; admin posts it on
    ///         chain. We don't verify the signature on chain because the
    ///         signer == admin's trusted off-chain process for v1; a real
    ///         deployment would also store/verify the signature.
    function publishFeedRoot(uint256 epoch, bytes32 root) external onlyAdmin {
        require(root != bytes32(0), "Oracle: empty root");
        require(priceFeedRoot[epoch] == bytes32(0), "Oracle: epoch already published");
        priceFeedRoot[epoch] = root;
        emit FeedRootPublished(epoch, root);
    }

    function rotateAdmin(address next) external onlyAdmin {
        require(next != address(0), "Oracle: zero admin");
        emit AdminRotated(admin, next);
        admin = next;
    }

    function rotateSigner(address next) external onlyAdmin {
        require(next != address(0), "Oracle: zero signer");
        emit SignerRotated(feedSigner, next);
        feedSigner = next;
    }

    // ---------------------------------------------------------------------
    // Audit submission
    // ---------------------------------------------------------------------

    struct AuditSubmission {
        uint256       tokenId;
        uint256       epoch;
        bytes32       modelWeightsHash;
        bytes32       outputsHash;
        int256[]      outputs;            // cleartext, used by Sharpe in C3
        uint256[]     publicInputs;       // [weightsHash, outputsHash, priceFeedRoot]
        bytes         snarkProof;
        bytes32[]     priceFeedSiblings;  // per-bar Merkle siblings, used in C3
        uint32[]      priceFeedIndexes;   // used in C3
        int256[]      priceFeedBars;      // used in C3
    }

    event AuditAccepted(uint256 indexed tokenId, uint256 indexed epoch, uint256 sharpeBps, uint256 nTrades);

    /// @notice Submit an EZKL audit proof for a model.
    /// @dev    Full pipeline: proof binds (modelWeightsHash, outputsHash,
    ///         priceFeedRoot) via public inputs; outputs hash binds the
    ///         cleartext outputs; per-bar Merkle proofs bind the price
    ///         history to the protocol-signed root; Sharpe is then
    ///         recomputed deterministically and written to ModelNFT.
    function submitAudit(AuditSubmission calldata sub) external {
        bytes32 root = priceFeedRoot[sub.epoch];
        require(root != bytes32(0), "Oracle: unknown epoch");
        require(sub.publicInputs.length == 3, "Oracle: bad pub inputs");
        require(sub.publicInputs[2] == uint256(root), "Oracle: root mismatch");

        // Bind the proof to the on-chain model identity.
        (, , , , , , , , bytes32 onChainHash)
            = IModelNFTOracleHook(modelNFT).models(sub.tokenId);
        require(onChainHash == sub.modelWeightsHash, "Oracle: weights mismatch");
        require(sub.publicInputs[0] == uint256(sub.modelWeightsHash), "Oracle: pub input 0");

        // Bind the cleartext outputs to the proof.
        require(keccak256(abi.encodePacked(sub.outputs)) == sub.outputsHash, "Oracle: outputs mismatch");
        require(sub.publicInputs[1] == uint256(sub.outputsHash), "Oracle: pub input 1");

        // Verify all price bars belong to the signed feed.
        require(sub.priceFeedBars.length    == sub.outputs.length, "Oracle: bars/outputs len");
        require(sub.priceFeedIndexes.length == sub.outputs.length, "Oracle: indexes len");
        for (uint256 i = 0; i < sub.priceFeedBars.length; i++) {
            bytes32 leaf = keccak256(abi.encodePacked(sub.priceFeedIndexes[i], sub.priceFeedBars[i]));
            bytes32[] memory siblings = new bytes32[](1);
            siblings[0] = sub.priceFeedSiblings[i];
            require(MerkleProofPacked.verify(siblings, root, leaf), "Oracle: bad price proof");
        }

        // Verify the SNARK.
        require(verifier.verifyProof(sub.snarkProof, sub.publicInputs), "Oracle: bad proof");

        // Recompute Sharpe deterministically.
        (uint256 sharpeBps, uint256 nTrades) = _sharpe(sub.outputs, sub.priceFeedBars);

        IModelNFTOracleHook(modelNFT).setPerformanceScore(sub.tokenId, sharpeBps);
        emit AuditAccepted(sub.tokenId, sub.epoch, sharpeBps, nTrades);
    }

    /// @dev Per-bar return = (bars[i+1] - bars[i]) / bars[i] scaled by 1e8,
    ///      weighted by outputs[i] (bps). Returns Sharpe * 10_000 (bps),
    ///      clamped to 0 for non-positive mean (losing strategies).
    function _sharpe(int256[] memory outputs, int256[] memory bars)
        private pure returns (uint256 sharpeBps, uint256 nTrades)
    {
        uint256 n = bars.length;
        if (n < 2) return (0, 0);
        int256[] memory rets = new int256[](n - 1);
        for (uint256 i = 0; i + 1 < n; i++) {
            int256 base = bars[i];
            require(base != 0, "Oracle: zero bar");
            int256 r = ((bars[i+1] - bars[i]) * 1e8) / base;
            rets[i] = (r * outputs[i]) / 10_000;
        }
        nTrades = rets.length;

        int256 sum;
        for (uint256 i = 0; i < rets.length; i++) sum += rets[i];
        int256 mean = sum / int256(rets.length);

        uint256 sqsum;
        for (uint256 i = 0; i < rets.length; i++) {
            int256 d = rets[i] - mean;
            sqsum += uint256(d * d);
        }
        uint256 variance = sqsum / rets.length;
        if (variance == 0 || mean <= 0) return (mean <= 0 ? 0 : 0, nTrades);
        uint256 stddev = _isqrt(variance);
        sharpeBps = (uint256(mean) * 10_000) / stddev;
    }

    function _isqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
        return y;
    }
}
