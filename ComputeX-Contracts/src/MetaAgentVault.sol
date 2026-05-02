// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC4626}   from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}     from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721}   from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
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

    /// @notice Execute a rebalance signed by the registry-NFT operator.
    /// @param targetWeightsBps  5-element array of basis-point weights (must sum to 10 000).
    /// @param blockNumber       Block at which the signature was created (staleness guard ≤ 5 blocks).
    /// @param sig               65-byte ECDSA signature over (weights, blockNumber, address(this)).
    // weights are uint16; Python keeper_client must pack as uint16 in abi.encodePacked
    function executeTrade(
        uint16[5] calldata targetWeightsBps,
        uint256 blockNumber,
        bytes calldata sig
    ) external nonReentrant {
        require(block.number >= blockNumber, "Vault: future block");
        require(block.number - blockNumber <= 5, "Vault: stale sig");

        uint256 sum;
        for (uint256 i = 0; i < 5; i++) sum += targetWeightsBps[i];
        require(sum == 10_000, "Vault: weights != 10000");

        bytes32 msgHash = keccak256(abi.encodePacked(
            targetWeightsBps[0], targetWeightsBps[1], targetWeightsBps[2],
            targetWeightsBps[3], targetWeightsBps[4],
            blockNumber,
            address(this)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        address signer = ECDSA.recover(ethHash, sig);
        require(signer == IERC721(registry).ownerOf(vaultId), "Vault: bad sig");

        uint256 navBefore = totalAssets();
        _rebalance(targetWeightsBps, navBefore);
        emit TradeExecuted(blockNumber, navBefore);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        lastHarvestAssets = totalAssets();
    }

    function harvest() external {
        uint256 current = totalAssets();
        uint256 last    = lastHarvestAssets;
        uint256 feeShares;

        if (current > last) {
            uint256 gain      = current - last;
            uint256 feeAssets = (gain * perfFeeBps) / 10_000;
            uint256 supply    = totalSupply();
            if (supply > 0) {
                feeShares = (feeAssets * supply) / current;
                address op = IERC721(registry).ownerOf(vaultId);
                _mint(op, feeShares);
            }
        }

        lastHarvestAssets = current;
        emit Harvested(current, current > last ? current - last : 0, feeShares);
    }

    function _rebalance(uint16[5] calldata weights, uint256 nav) private {
        // Pass 1: sell overweight non-USDC tokens (basket[0..3])
        for (uint256 i = 0; i < 4; i++) {
            if (basket[i] == asset()) continue; // USDC is the quote currency, handled as residual
            uint256 current = IERC20(basket[i]).balanceOf(address(this));
            if (current == 0) continue;
            uint256 price = IKeeperHub(keeperHub).priceOf(basket[i], asset(), 3000);
            if (price == 0) continue;
            uint256 currentValueUsdc = (current * price) / 1e18;
            uint256 targetValueUsdc  = (nav * weights[i]) / 10_000;
            if (currentValueUsdc > targetValueUsdc + (nav * MIN_SWAP_BPS / 10_000)) {
                uint256 sellUsdc = currentValueUsdc - targetValueUsdc;
                uint256 sellAmt  = (sellUsdc * 1e18) / price;
                _executeSwap(basket[i], asset(), sellAmt);
            }
        }
        // Pass 2: buy underweight non-USDC tokens
        uint256 usdcBal = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < 4; i++) {
            if (basket[i] == asset()) continue; // USDC is the quote currency, handled as residual
            if (weights[i] == 0) continue;
            uint256 price = IKeeperHub(keeperHub).priceOf(basket[i], asset(), 3000);
            if (price == 0) continue;
            uint256 current = IERC20(basket[i]).balanceOf(address(this));
            uint256 currentValueUsdc = (current * price) / 1e18;
            uint256 targetValueUsdc  = (nav * weights[i]) / 10_000;
            if (targetValueUsdc > currentValueUsdc + (nav * MIN_SWAP_BPS / 10_000)) {
                uint256 buyUsdc = targetValueUsdc - currentValueUsdc;
                if (buyUsdc > usdcBal) buyUsdc = usdcBal;
                if (buyUsdc > 0) {
                    _executeSwap(asset(), basket[i], buyUsdc);
                    usdcBal -= buyUsdc;
                }
            }
        }
    }

    function _executeSwap(address tokenIn, address tokenOut, uint256 amountIn) private {
        IKeeperHub.SwapInstruction[] memory swaps = new IKeeperHub.SwapInstruction[](1);
        swaps[0] = IKeeperHub.SwapInstruction({
            tokenIn:          tokenIn,
            tokenOut:         tokenOut,
            poolFee:          3000,
            amountIn:         amountIn,
            amountOutMinimum: 0
        });
        IERC20(tokenIn).forceApprove(keeperHub, amountIn);
        IKeeperHub(keeperHub).executeSwaps(swaps);
    }
}
