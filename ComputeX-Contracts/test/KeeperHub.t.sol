// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {KeeperHub}        from "../src/KeeperHub.sol";
import {IKeeperHub}       from "../src/interfaces/IKeeperHub.sol";
import {MockERC20}        from "./mocks/MockERC20.sol";
import {MockSwapRouter}   from "./mocks/MockSwapRouter.sol";

contract KeeperHubTest is Test {
    KeeperHub      internal hub;
    MockSwapRouter internal router;
    MockERC20      internal usdc;
    MockERC20      internal weth;

    address internal owner  = address(0xA1);
    address internal vault  = address(0xB2);
    address internal caller = address(0xC3);

    function setUp() public {
        router = new MockSwapRouter();
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        weth   = new MockERC20("Wrapped Ether", "WETH", 18);

        hub = new KeeperHub(owner, address(router));

        vm.prank(owner);
        hub.registerVault(vault);
    }

    function test_registerVault_allowsVaultToCalls() public view {
        assertTrue(hub.isVault(vault));
    }

    function test_registerVault_revertsForNonOwner() public {
        vm.prank(caller);
        vm.expectRevert();
        hub.registerVault(caller);
    }

    function test_executeSwaps_revertsForUnregisteredCaller() public {
        IKeeperHub.SwapInstruction[] memory s = new IKeeperHub.SwapInstruction[](0);
        vm.prank(caller);
        vm.expectRevert(bytes("KeeperHub: not vault"));
        hub.executeSwaps(s);
    }

    function test_executeSwaps_singleSwap_transfersTokens() public {
        usdc.mint(vault, 1000e6);

        IKeeperHub.SwapInstruction[] memory swaps = new IKeeperHub.SwapInstruction[](1);
        swaps[0] = IKeeperHub.SwapInstruction({
            tokenIn:          address(usdc),
            tokenOut:         address(weth),
            poolFee:          3000,
            amountIn:         500e6,
            amountOutMinimum: 0
        });

        vm.startPrank(vault);
        usdc.approve(address(hub), 500e6);
        uint256[] memory out = hub.executeSwaps(swaps);
        vm.stopPrank();

        assertEq(out.length, 1);
        assertEq(out[0], 500e6);           // MockSwapRouter: 1:1
        assertEq(weth.balanceOf(vault), 500e6);
        assertEq(usdc.balanceOf(vault),  500e6);
    }

    function test_executeSwaps_emitsTradeExecuted() public {
        usdc.mint(vault, 1000e6);

        IKeeperHub.SwapInstruction[] memory swaps = new IKeeperHub.SwapInstruction[](1);
        swaps[0] = IKeeperHub.SwapInstruction({
            tokenIn: address(usdc), tokenOut: address(weth),
            poolFee: 3000, amountIn: 100e6, amountOutMinimum: 0
        });

        vm.startPrank(vault);
        usdc.approve(address(hub), 100e6);
        vm.expectEmit(true, false, false, false);
        emit KeeperHub.TradeExecuted(vault, address(usdc), address(weth), 100e6, 100e6);
        hub.executeSwaps(swaps);
        vm.stopPrank();
    }

    function test_priceOf_zeroForUnknownPool() public view {
        assertEq(hub.priceOf(address(usdc), address(weth), 3000), 0);
    }
}
