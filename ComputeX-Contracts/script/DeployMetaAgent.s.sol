// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {KeeperHub}         from "../src/KeeperHub.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";
import {MockERC20}         from "../test/mocks/MockERC20.sol";

contract DeployMetaAgent is Script {
    // ── Ethereum Sepolia (chain 11155111) ─────────────────────────────────
    address constant SWAP_ROUTER = 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E;
    address constant UNI_FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;

    // Canonical WETH on Ethereum Sepolia
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    // Plan 1 contracts deployed on Ethereum Sepolia via Deploy.s.sol
    address constant MODEL_NFT         = 0x7695a2e4D5314116F543a89CF6eF74084aa5d0d9;
    address constant MODEL_MARKETPLACE = 0xF602913E809140B9D067caEEAF37Df0Bdd9db806;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy mock stable + basket tokens (no canonical Sepolia addresses for these)
        address usdc = address(new MockERC20("USD Coin",         "USDC", 6));
        address wbtc = address(new MockERC20("Wrapped Bitcoin",  "WBTC", 8));
        address link = address(new MockERC20("Chainlink",        "LINK", 18));
        address uni  = address(new MockERC20("Uniswap",          "UNI",  18));

        address[5] memory basket = [WETH, wbtc, link, uni, usdc];

        // 1. Deploy KeeperHub with deployer as temporary owner
        KeeperHub hub = new KeeperHub(deployer, SWAP_ROUTER);
        hub.setFactory(UNI_FACTORY);

        // 2. Deploy MetaAgentRegistry
        MetaAgentRegistry reg = new MetaAgentRegistry(
            deployer,
            usdc,
            address(hub),
            MODEL_NFT,
            MODEL_MARKETPLACE,
            basket
        );

        // 3. Transfer KeeperHub ownership to Registry so deploy() can registerVault
        hub.transferOwnership(address(reg));

        vm.stopBroadcast();

        console2.log("KeeperHub:         ", address(hub));
        console2.log("MetaAgentRegistry: ", address(reg));
        console2.log("MockUSDC:          ", usdc);
        console2.log("MockWBTC:          ", wbtc);
        console2.log("MockLINK:          ", link);
        console2.log("MockUNI:           ", uni);
    }
}
