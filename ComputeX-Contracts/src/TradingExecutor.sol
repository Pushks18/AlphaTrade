// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable}   from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter, IUniswapV3Pool, IUniswapV3Factory} from "./interfaces/IUniswapV3.sol";
import {ITradingExecutor} from "./interfaces/ITradingExecutor.sol";

contract TradingExecutor is ITradingExecutor, Ownable {
    using SafeERC20 for IERC20;

    ISwapRouter        public immutable router;
    IUniswapV3Factory  public           factory;

    mapping(address => bool) public isVault;

    event VaultRegistered(address indexed vault);
    event TradeExecuted(
        address indexed vault,
        address tokenIn, address tokenOut,
        uint256 amountIn, uint256 amountOut
    );

    constructor(address initialOwner, address router_) Ownable(initialOwner) {
        require(router_ != address(0), "TradingExecutor: zero router");
        router = ISwapRouter(router_);
    }

    function setFactory(address factory_) external onlyOwner {
        factory = IUniswapV3Factory(factory_);
    }

    function registerVault(address vault) external onlyOwner {
        require(vault != address(0), "TradingExecutor: zero vault");
        isVault[vault] = true;
        emit VaultRegistered(vault);
    }

    function executeSwaps(SwapInstruction[] calldata swaps)
        external override returns (uint256[] memory amountsOut)
    {
        require(isVault[msg.sender], "TradingExecutor: not vault");
        amountsOut = new uint256[](swaps.length);
        for (uint256 i = 0; i < swaps.length; i++) {
            SwapInstruction calldata s = swaps[i];
            IERC20(s.tokenIn).safeTransferFrom(msg.sender, address(this), s.amountIn);
            IERC20(s.tokenIn).forceApprove(address(router), s.amountIn);
            uint256 out = router.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn:           s.tokenIn,
                    tokenOut:          s.tokenOut,
                    fee:               s.poolFee,
                    recipient:         msg.sender,
                    deadline:          type(uint256).max,
                    amountIn:          s.amountIn,
                    amountOutMinimum:  s.amountOutMinimum,
                    sqrtPriceLimitX96: 0
                })
            );
            amountsOut[i] = out;
            emit TradeExecuted(msg.sender, s.tokenIn, s.tokenOut, s.amountIn, out);
        }
    }

    function priceOf(address tokenIn, address tokenOut, uint24 fee)
        external view override returns (uint256)
    {
        if (address(factory) == address(0)) return 0;
        address pool = factory.getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) return 0;
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (sqrtPriceX96 == 0) return 0;
        address token0 = IUniswapV3Pool(pool).token0();
        uint256 sq = uint256(sqrtPriceX96);
        if (token0 == tokenIn) {
            return (sq * sq * 1e18) >> 192;
        } else {
            return ((1 << 192) * 1e18) / (sq * sq);
        }
    }
}
