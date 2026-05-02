// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721}         from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable}        from "@openzeppelin/contracts/access/Ownable.sol";
import {KeeperHub}      from "./KeeperHub.sol";
import {MetaAgentVault} from "./MetaAgentVault.sol";

/// @title MetaAgentRegistry
/// @notice Issues soulbound-style ERC-721 NFTs representing on-chain meta-agents.
///         Each deploy() creates a fresh MetaAgentVault, registers it with KeeperHub,
///         and mints an NFT to the caller.
///
///         Ownership of KeeperHub must be transferred to this contract before any
///         deploy() call so that registerVault() succeeds.
contract MetaAgentRegistry is ERC721, Ownable {
    uint256 public nextAgentId;

    address public immutable usdc;
    address public immutable keeperHub;
    address public immutable modelNFT;
    address public immutable modelMarketplace;
    address[5] public basket;

    mapping(uint256 => address) public vaultOf;

    event AgentDeployed(
        uint256 indexed agentId,
        address indexed operator,
        address vault,
        uint16  perfFeeBps,
        bytes32 policyHash
    );

    constructor(
        address initialOwner,
        address usdc_,
        address keeperHub_,
        address modelNFT_,
        address modelMarketplace_,
        address[5] memory basket_
    ) ERC721("MetaAgent", "MAGNT") Ownable(initialOwner) {
        require(usdc_      != address(0), "Registry: zero usdc");
        require(keeperHub_ != address(0), "Registry: zero hub");
        usdc             = usdc_;
        keeperHub        = keeperHub_;
        modelNFT         = modelNFT_;
        modelMarketplace = modelMarketplace_;
        basket           = basket_;
    }

    /// @notice Deploy a new meta-agent vault for msg.sender.
    /// @param perfFeeBps  Performance fee in basis points (max 2000 = 20%).
    /// @param policyHash  keccak256 of the agent's trading policy specification.
    /// @return agentId    Token ID minted to msg.sender.
    function deploy(uint16 perfFeeBps, bytes32 policyHash)
        external
        returns (uint256 agentId)
    {
        require(perfFeeBps <= 2000, "Registry: perfFee too high");

        agentId = nextAgentId++;

        MetaAgentVault vault = new MetaAgentVault(
            usdc,
            address(this),
            agentId,
            perfFeeBps,
            policyHash,
            modelNFT,
            modelMarketplace,
            keeperHub,
            basket
        );

        vaultOf[agentId] = address(vault);
        KeeperHub(keeperHub).registerVault(address(vault));

        _mint(msg.sender, agentId);
        emit AgentDeployed(agentId, msg.sender, address(vault), perfFeeBps, policyHash);
    }
}
