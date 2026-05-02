// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";
import {ISwapRouter} from "../../src/interfaces/IUniswapV3.sol";

/// @dev 1:1 swap — pulls tokenIn from caller, mints amountIn of tokenOut.
contract MockSwapRouter {
    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata p)
        external returns (uint256 amountOut)
    {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        MockERC20(p.tokenOut).mint(p.recipient, p.amountIn);
        return p.amountIn;
    }
}
