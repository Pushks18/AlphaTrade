// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IKeeperHub {
    struct SwapInstruction {
        address tokenIn;
        address tokenOut;
        uint24  poolFee;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function executeSwaps(SwapInstruction[] calldata swaps)
        external returns (uint256[] memory amountsOut);
    function priceOf(address tokenIn, address tokenOut, uint24 fee)
        external view returns (uint256 price);
}
