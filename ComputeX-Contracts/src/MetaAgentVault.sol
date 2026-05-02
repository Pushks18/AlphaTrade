// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC4626}  from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}    from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}   from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MetaAgentVault (stub — full implementation in Task 4)
/// @notice ERC-4626 vault that holds USDC on behalf of a MetaAgent NFT.
///         Deployed by MetaAgentRegistry.deploy(); receives swap rights via KeeperHub.
contract MetaAgentVault is ERC4626 {
    address public immutable registry;
    uint256 public immutable vaultId;
    uint16  public immutable perfFeeBps;
    bytes32 public immutable policyHash;
    address public immutable modelNFT;
    address public immutable modelMarketplace;
    address public immutable keeperHub;
    address[5] public basket;

    uint256 public lastHarvestAssets;

    constructor(
        address usdc_,
        address registry_,
        uint256 vaultId_,
        uint16  perfFeeBps_,
        bytes32 policyHash_,
        address modelNFT_,
        address modelMarketplace_,
        address keeperHub_,
        address[5] memory basket_
    )
        ERC20("MetaAgent Vault Shares", "MAVS")
        ERC4626(IERC20(usdc_))
    {
        require(registry_  != address(0), "Vault: zero registry");
        require(keeperHub_ != address(0), "Vault: zero hub");
        registry         = registry_;
        vaultId          = vaultId_;
        perfFeeBps       = perfFeeBps_;
        policyHash       = policyHash_;
        modelNFT         = modelNFT_;
        modelMarketplace = modelMarketplace_;
        keeperHub        = keeperHub_;
        basket           = basket_;
    }
}
