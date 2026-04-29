// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title  CreatorRegistry
/// @notice Soulbound (non-transferable) ERC-721 capturing each creator's
///         lifetime track record. One token per address, lazy-minted on
///         first model mint. Aggregate scores and slashes accumulate across
///         every model the creator publishes.
/// @dev    Gated to a single ModelNFT — the registry trusts ModelNFT to call
///         the recordMint / recordScore / recordSlash hooks at the right
///         points in its mint / oracle-write / slash flows.
contract CreatorRegistry is ERC721 {
    address public admin;
    address public immutable modelNFT;

    struct Record {
        address creator;
        uint256 modelsMinted;
        uint256 totalSharpeBps;
        uint256 totalSlashes;
        uint256 lifetimeAlphaBps;
    }

    mapping(uint256 => Record)  public records;
    mapping(address => uint256) public creatorTokenId;
    uint256 public nextId = 1;

    event RecordMinted(address indexed creator, uint256 indexed tokenId);
    event RecordUpdated(uint256 indexed tokenId, uint256 modelsMinted, uint256 totalSharpeBps);
    event SlashRecorded(uint256 indexed tokenId);

    modifier onlyModelNFT() {
        require(msg.sender == modelNFT, "Creator: not modelNFT");
        _;
    }

    constructor(address _admin, address _modelNFT)
        ERC721("AlphaTrade Creator", "ATCREATOR")
    {
        require(_admin    != address(0), "Creator: zero admin");
        require(_modelNFT != address(0), "Creator: zero modelNFT");
        admin    = _admin;
        modelNFT = _modelNFT;
    }

    /// @notice Lazy-mint on a model mint or bump the existing record's count.
    function recordMint(address creator, uint256 /* modelTokenId */) external onlyModelNFT {
        uint256 id = creatorTokenId[creator];
        if (id == 0) {
            id = nextId++;
            creatorTokenId[creator] = id;
            records[id].creator = creator;
            _safeMint(creator, id);
            emit RecordMinted(creator, id);
        }
        records[id].modelsMinted += 1;
        emit RecordUpdated(id, records[id].modelsMinted, records[id].totalSharpeBps);
    }

    function recordScore(address creator, uint256 sharpeBps) external onlyModelNFT {
        uint256 id = creatorTokenId[creator];
        require(id != 0, "Creator: no record");
        records[id].totalSharpeBps += sharpeBps;
        emit RecordUpdated(id, records[id].modelsMinted, records[id].totalSharpeBps);
    }

    function recordSlash(address creator) external onlyModelNFT {
        uint256 id = creatorTokenId[creator];
        require(id != 0, "Creator: no record");
        records[id].totalSlashes += 1;
        emit SlashRecorded(id);
    }

    // ---- Soulbound: block transfers post-mint --------------------------

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("Creator: soulbound");
        }
        return super._update(to, tokenId, auth);
    }
}
