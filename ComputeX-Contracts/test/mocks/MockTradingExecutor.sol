// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";
import {ITradingExecutor} from "../../src/interfaces/ITradingExecutor.sol";

/// @dev 1:1 swaps; configurable priceOf (default 1e18 = 1:1).
contract MockTradingExecutor is ITradingExecutor {
    mapping(address => mapping(address => uint256)) public prices;
    mapping(address => bool) public isVault;

    event VaultRegistered(address indexed vault);

    /// @notice No-op for selector compat with TradingExecutor. Anyone may call.
    function registerVault(address vault) external {
        isVault[vault] = true;
        emit VaultRegistered(vault);
    }

    function setPrice(address tokenIn, address tokenOut, uint256 price) external {
        prices[tokenIn][tokenOut] = price;
    }

    function priceOf(address tokenIn, address tokenOut, uint24)
        external view override returns (uint256)
    {
        uint256 p = prices[tokenIn][tokenOut];
        return p == 0 ? 1e18 : p;
    }

    function executeSwaps(SwapInstruction[] calldata swaps)
        external override returns (uint256[] memory amountsOut)
    {
        amountsOut = new uint256[](swaps.length);
        for (uint256 i = 0; i < swaps.length; i++) {
            IERC20(swaps[i].tokenIn).transferFrom(msg.sender, address(this), swaps[i].amountIn);
            MockERC20(swaps[i].tokenOut).mint(msg.sender, swaps[i].amountIn);
            amountsOut[i] = swaps[i].amountIn;
        }
    }
}
