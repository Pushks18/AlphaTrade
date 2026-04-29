// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
}
