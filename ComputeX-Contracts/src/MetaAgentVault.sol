// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC4626}   from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}     from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721}   from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IKeeperHub} from "./interfaces/IKeeperHub.sol";
import {IModelMarketplace} from "./interfaces/IModelMarketplace.sol";

/// @title MetaAgentVault (stub — full implementation in Task 4)
/// @notice ERC-4626 vault that holds USDC on behalf of a MetaAgent NFT.
///         Deployed by MetaAgentRegistry.deploy(); receives swap rights via KeeperHub.
contract MetaAgentVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable registry;
    uint256 public immutable vaultId;
    uint16  public immutable perfFeeBps;
    bytes32 public immutable policyHash;
    address public immutable modelNFT;
    address public immutable modelMarketplace;
    address public immutable keeperHub;
    address[5] public basket;

    uint256 public lastHarvestAssets;

    uint256 private constant MIN_SWAP_BPS = 100;

    event TradeExecuted(uint256 indexed blockNumber, uint256 navBefore);
    event Harvested(uint256 nav, uint256 gain, uint256 feeShares);
    event ModelDeposited(uint256 indexed tokenId);
    event ModelRelisted(uint256 indexed tokenId, uint256 price);

    modifier onlyOperator() {
        require(msg.sender == IERC721(registry).ownerOf(vaultId), "Vault: not operator");
        _;
    }

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

    function totalAssets() public view override returns (uint256 total) {
        for (uint256 i = 0; i < 5; i++) {
            uint256 bal = IERC20(basket[i]).balanceOf(address(this));
            if (bal == 0) continue;
            if (basket[i] == asset()) {
                total += bal;
            } else {
                uint256 price = IKeeperHub(keeperHub).priceOf(basket[i], asset(), 3000);
                if (price > 0) total += (bal * price) / 1e18;
            }
        }
    }

    /// @notice Pull a model NFT the operator already owns into this vault's portfolio.
    ///         The operator must approve the vault on the ModelNFT contract first.
    function depositModel(uint256 tokenId) external onlyOperator nonReentrant {
        IERC721(modelNFT).transferFrom(msg.sender, address(this), tokenId);
        emit ModelDeposited(tokenId);
    }

    /// @notice Approve and list a vault-owned model NFT on ModelMarketplace.
    function relistModel(uint256 tokenId, uint256 price) external onlyOperator nonReentrant {
        require(modelMarketplace != address(0), "Vault: no marketplace");
        require(IERC721(modelNFT).ownerOf(tokenId) == address(this), "Vault: not owner");
        IERC721(modelNFT).approve(modelMarketplace, tokenId);
        IModelMarketplace(modelMarketplace).listModel(tokenId, price);
        emit ModelRelisted(tokenId, price);
    }
}
