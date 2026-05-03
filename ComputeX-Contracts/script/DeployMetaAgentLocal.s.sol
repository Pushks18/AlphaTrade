// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2}    from "forge-std/Script.sol";
import {MetaAgentRegistry}   from "../src/MetaAgentRegistry.sol";
import {MockERC20}           from "../test/mocks/MockERC20.sol";
import {MockTradingExecutor}       from "../test/mocks/MockTradingExecutor.sol";

/// @notice Plan 2 deployment for **local Anvil only**.
/// Uses MockTradingExecutor (1:1 swaps) instead of real Uniswap V3 — Anvil has
/// no Uniswap deployed, so the production TradingExecutor would revert on swap.
///
/// Run AFTER Deploy.s.sol, with the same Anvil session running.
/// Plan 1 addresses below are Anvil-deterministic (deployer = account 0).
contract DeployMetaAgentLocal is Script {
    // Anvil-deterministic Plan 1 addresses
    address constant MODEL_NFT         = 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512;
    address constant MODEL_MARKETPLACE = 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // Mock basket tokens (no real ones on Anvil)
        MockERC20 usdc = new MockERC20("USD Coin",        "USDC", 6);
        MockERC20 weth = new MockERC20("Wrapped Ether",   "WETH", 18);
        MockERC20 wbtc = new MockERC20("Wrapped Bitcoin", "WBTC", 8);
        MockERC20 link = new MockERC20("Chainlink",       "LINK", 18);
        MockERC20 uni  = new MockERC20("Uniswap",         "UNI",  18);

        address[5] memory basket = [
            address(weth),
            address(wbtc),
            address(link),
            address(uni),
            address(usdc)
        ];

        // Mock TradingExecutor — implements ITradingExecutor + registerVault no-op.
        MockTradingExecutor hub = new MockTradingExecutor();

        // Registry wired to mock infra
        MetaAgentRegistry reg = new MetaAgentRegistry(
            deployer,
            address(usdc),
            address(hub),
            MODEL_NFT,
            MODEL_MARKETPLACE,
            basket
        );

        // Pre-fund deployer with 10,000 USDC for testing
        usdc.mint(deployer, 10_000 * 1e6);

        vm.stopBroadcast();

        console2.log("MockTradingExecutor:     ", address(hub));
        console2.log("MetaAgentRegistry: ", address(reg));
        console2.log("MockUSDC:          ", address(usdc));
        console2.log("MockWETH:          ", address(weth));
        console2.log("MockWBTC:          ", address(wbtc));
        console2.log("MockLINK:          ", address(link));
        console2.log("MockUNI:           ", address(uni));
    }
}
