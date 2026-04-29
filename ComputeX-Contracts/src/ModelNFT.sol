// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @notice Minimal interface to the GPUMarketplace's atomic mint-right pull.
interface IGPUMarketplace {
    function consumeMintRight(uint256 jobId) external returns (address owner);
}

interface ICreatorRegistry {
    function recordMint(address creator, uint256 modelTokenId) external;
    function recordScore(address creator, uint256 sharpeBps) external;
    function recordSlash(address creator) external;
}

/// @title  ModelNFT
/// @notice This NFT represents a verifiable AI model trained via decentralized
///         compute. Each token is bound to a specific compute job on the
///         GPUMarketplace, references the trained weights and zkML proof on
///         0G Storage, and carries reputation metadata (creator + performance).
/// @dev    Trustless minting via a pull pattern: this contract reaches into
///         the GPUMarketplace and atomically claims the mint right for a job,
///         which guarantees:
///           - the job exists and was paid for (escrow released)
///           - the recipient is the original renter
///           - exactly one NFT can be minted per jobId
///         No off-chain authority is required to gate `mintModel`.
contract ModelNFT is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;
    using Strings for address;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct ModelMetadata {
        string  modelCID;          // 0G Storage CID for trained weights
        string  proofCID;          // 0G Storage CID for the EZKL proof bundle
        string  description;       // human-readable model card
        uint256 createdAt;         // block.timestamp at mint
        uint256 creatorStake;      // wei locked at mint, slashable by oracle
        uint256 sharpeBps;         // 100 * Sharpe ratio in bps; 0 until first audit
        uint256 nVerifiedTrades;   // trades covered by latest zk audit
        uint64  lastAuditAt;       // block.timestamp of most recent score update
        bytes32 modelWeightsHash;  // keccak256 of the ONNX weights file
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The compute marketplace this NFT contract is bound to.
    IGPUMarketplace public immutable gpuMarketplace;

    /// @notice tokenId starts at 1 so `tokenIdForJob[jobId] == 0` reliably
    ///         means "not yet minted".
    uint256 public nextTokenId = 1;

    /// @notice tokenId => off-chain pointers + description + timestamp.
    mapping(uint256 => ModelMetadata) public models;

    /// @notice tokenId => original creator/trainer (the job's renter).
    ///         Immutable post-mint; powers reputation + royalty flows even
    ///         after the NFT trades on the secondary market.
    mapping(uint256 => address) public creator;

    /// @notice tokenId => off-chain performance score (e.g. backtest Sharpe * 1e4).
    ///         Owner-set after evaluation; powers ranking on the marketplace.
    mapping(uint256 => uint256) public performanceScore;

    /// @notice tokenId => originating GPUMarketplace jobId.
    mapping(uint256 => uint256) public jobIdOfToken;

    /// @notice jobId => tokenId minted for that job (0 means none).
    mapping(uint256 => uint256) public tokenIdForJob;

    /// @notice The PerformanceOracle authorized to write performance scores.
    /// @dev    Settable by owner; allows post-deployment wiring.
    address public oracle;

    /// @notice The CreatorRegistry that mirrors per-creator lifetime stats.
    /// @dev    Optional; if zero, no SBT bookkeeping happens.
    address public creatorRegistry;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ModelMinted(
        uint256 indexed tokenId,
        uint256 indexed jobId,
        address indexed creator,
        string modelCID,
        string proofCID
    );

    event PerformanceUpdated(uint256 indexed tokenId, uint256 score);

    event OracleSet(address indexed previousOracle, address indexed newOracle);

    event CreatorRegistrySet(address indexed previous, address indexed next);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialOwner, address gpuMarketplaceAddress)
        ERC721("ComputeX Model", "CXMODEL")
        Ownable(initialOwner)
    {
        require(gpuMarketplaceAddress != address(0), "Model: zero marketplace");
        gpuMarketplace = IGPUMarketplace(gpuMarketplaceAddress);
    }

    /// @notice Set or rotate the PerformanceOracle.
    function setOracle(address newOracle) external onlyOwner {
        emit OracleSet(oracle, newOracle);
        oracle = newOracle;
    }

    /// @notice Set or rotate the CreatorRegistry. Optional; pass address(0)
    ///         to disable SBT bookkeeping.
    function setCreatorRegistry(address r) external onlyOwner {
        emit CreatorRegistrySet(creatorRegistry, r);
        creatorRegistry = r;
    }

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------

    /// @notice Mint a ModelNFT for a completed compute job.
    /// @dev    Permissionless: anyone may submit the proof / weight CIDs,
    ///         but ownership is dictated by `gpuMarketplace.consumeMintRight`,
    ///         which atomically:
    ///           - reverts if the job is not completed
    ///           - reverts on duplicate mint
    ///           - returns the renter (= rightful model owner)
    /// @param  jobId       GPUMarketplace job that produced this model.
    /// @param  modelCID    0G Storage CID for the trained weights.
    /// @param  proofCID    0G Storage CID for the zkML proof.
    /// @param  description Human-readable model card / description.
    /// @return tokenId     Newly minted token id.
    function mintModel(
        uint256 jobId,
        string memory modelCID,
        string memory proofCID,
        string memory description,
        bytes32 modelWeightsHash
    ) external payable nonReentrant returns (uint256 tokenId) {
        require(bytes(modelCID).length > 0, "Model: empty modelCID");
        require(bytes(proofCID).length > 0, "Model: empty proofCID");
        require(modelWeightsHash != bytes32(0), "Model: empty weightsHash");

        address owner_ = gpuMarketplace.consumeMintRight(jobId);
        require(owner_ != address(0), "Model: no owner");
        require(tokenIdForJob[jobId] == 0, "Model: job already minted");

        tokenId = nextTokenId++;

        models[tokenId] = ModelMetadata({
            modelCID:         modelCID,
            proofCID:         proofCID,
            description:      description,
            createdAt:        block.timestamp,
            creatorStake:     msg.value,
            sharpeBps:        0,
            nVerifiedTrades:  0,
            lastAuditAt:      0,
            modelWeightsHash: modelWeightsHash
        });
        creator[tokenId] = owner_;
        jobIdOfToken[tokenId] = jobId;
        tokenIdForJob[jobId] = tokenId;

        _safeMint(owner_, tokenId);

        if (creatorRegistry != address(0)) {
            ICreatorRegistry(creatorRegistry).recordMint(owner_, tokenId);
        }

        emit ModelMinted(tokenId, jobId, owner_, modelCID, proofCID);
    }

    // ---------------------------------------------------------------------
    // Performance / reputation
    // ---------------------------------------------------------------------

    /// @notice Industry-standard burn address (0x…dEaD). Some chains reject
    ///         `address(0)` transfers, so we route slash burns here instead.
    address payable internal constant BURN = payable(0x000000000000000000000000000000000000dEaD);

    event StakeSlashed(uint256 indexed tokenId, address indexed slasher, uint256 paid, uint256 burned);

    /// @notice Oracle-only: slash a model's creator stake. Payment is split
    ///         `slasherBps` to the slasher; the remainder is sent to BURN
    ///         which retires it from the active stake pool.
    function slashStake(uint256 tokenId, address payable slasher, uint16 slasherBps)
        external returns (uint256 paid)
    {
        require(oracle != address(0) && msg.sender == oracle, "Model: not oracle");
        require(_ownerOf(tokenId) != address(0), "Model: nonexistent token");
        require(slasherBps <= 10_000, "Model: bad bps");
        uint256 stake = models[tokenId].creatorStake;
        require(stake > 0, "Model: no stake");

        models[tokenId].creatorStake = 0; // checks-effects-interactions
        if (creatorRegistry != address(0)) {
            ICreatorRegistry(creatorRegistry).recordSlash(creator[tokenId]);
        }
        paid = (stake * slasherBps) / 10_000;
        uint256 burned = stake - paid;

        (bool okSlasher, ) = slasher.call{value: paid}("");
        require(okSlasher, "Model: slasher pay failed");
        if (burned > 0) {
            (bool okBurn, ) = BURN.call{value: burned}("");
            require(okBurn, "Model: burn failed");
        }
        emit StakeSlashed(tokenId, slasher, paid, burned);
    }

    /// @notice Performance score writer.
    /// @dev    If `oracle` is configured (non-zero), only the oracle may write.
    ///         If unset, the contract owner is the fallback writer (used during
    ///         deployment and tests). The PerformanceOracle is the production
    ///         source of truth — it accepts audits guarded by EZKL proofs.
    function setPerformanceScore(uint256 tokenId, uint256 score) external {
        require(_ownerOf(tokenId) != address(0), "Model: nonexistent token");
        if (oracle != address(0)) {
            require(msg.sender == oracle, "Model: not oracle");
        } else {
            require(msg.sender == owner(), "Model: not owner");
        }
        performanceScore[tokenId] = score;
        if (creatorRegistry != address(0)) {
            ICreatorRegistry(creatorRegistry).recordScore(creator[tokenId], score);
        }
        emit PerformanceUpdated(tokenId, score);
    }

    // ---------------------------------------------------------------------
    // Metadata (ERC-7857-compatible JSON, encoded inline)
    // ---------------------------------------------------------------------

    function _bytes32ToHex(bytes32 b) private pure returns (string memory) {
        bytes memory chars = "0123456789abcdef";
        bytes memory s = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            s[2*i]   = chars[uint8(b[i] >> 4)];
            s[2*i+1] = chars[uint8(b[i] & 0x0f)];
        }
        return string(s);
    }

    /// @notice Returns a base64-encoded data URI containing the model card.
    /// @dev    Embeds modelCID + proofCID + creator + jobId inline so wallets
    ///         can render the token without any off-chain service.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Model: nonexistent token");

        ModelMetadata memory m = models[tokenId];
        bytes memory head = abi.encodePacked(
            '{"name":"ComputeX Model #', tokenId.toString(),
            '","description":"', m.description,
            '","modelCID":"', m.modelCID,
            '","proofCID":"', m.proofCID,
            '","modelWeightsHash":"0x', _bytes32ToHex(m.modelWeightsHash),
            '"'
        );
        bytes memory mid = abi.encodePacked(
            ',"creator":"', creator[tokenId].toHexString(),
            '","jobId":', jobIdOfToken[tokenId].toString(),
            ',"performanceScore":', performanceScore[tokenId].toString(),
            ',"sharpeBps":', m.sharpeBps.toString(),
            ',"nVerifiedTrades":', m.nVerifiedTrades.toString()
        );
        bytes memory tail = abi.encodePacked(
            ',"creatorStake":', m.creatorStake.toString(),
            ',"lastAuditAt":', uint256(m.lastAuditAt).toString(),
            ',"createdAt":', m.createdAt.toString(),
            '}'
        );
        bytes memory json = abi.encodePacked(head, mid, tail);

        return string(
            abi.encodePacked("data:application/json;base64,", Base64.encode(json))
        );
    }
}
