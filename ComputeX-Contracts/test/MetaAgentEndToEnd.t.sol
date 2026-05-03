// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";
import {MetaAgentVault}    from "../src/MetaAgentVault.sol";
import {TradingExecutor}         from "../src/TradingExecutor.sol";
import {MockERC20}         from "./mocks/MockERC20.sol";
import {MockSwapRouter}    from "./mocks/MockSwapRouter.sol";

/// @dev Returns a fixed sqrtPriceX96 = 2^96 (price = 1.0) and a configurable token0.
contract MockV3Pool {
    address public token0;
    constructor(address token0_) { token0 = token0_; }
    function slot0() external pure returns (
        uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool
    ) {
        return (uint160(1 << 96), 0, 0, 0, 0, 0, true);
    }
}

contract MockV3Factory {
    address public pool;
    constructor(address pool_) { pool = pool_; }
    function getPool(address, address, uint24) external view returns (address) { return pool; }
}

contract MetaAgentEndToEndTest is Test {
    MetaAgentRegistry internal reg;
    TradingExecutor         internal hub;
    MockERC20         internal usdc;
    MockERC20         internal weth;
    MockSwapRouter    internal router;

    address internal owner = address(this);
    address internal lp    = address(0xB2);

    uint256 internal operatorKey = 0xC0FFEE;
    address internal operator;
    address[5] internal basket;

    function setUp() public {
        operator = vm.addr(operatorKey);

        usdc   = new MockERC20("USDC", "USDC", 6);
        weth   = new MockERC20("WETH", "WETH", 18);
        router = new MockSwapRouter();

        // Hub deployed with test contract as owner
        hub = new TradingExecutor(address(this), address(router));

        basket[0] = address(weth);
        basket[1] = basket[2] = basket[3] = address(weth);
        basket[4] = address(usdc);

        // Set up mock Uniswap V3 factory+pool BEFORE transferring hub ownership.
        // sqrtPriceX96 = 2^96 → price = 1.0; token0 = weth → priceOf(weth, usdc) ≈ 1e18.
        MockV3Pool    v3pool = new MockV3Pool(address(weth));
        MockV3Factory v3fac  = new MockV3Factory(address(v3pool));
        hub.setFactory(address(v3fac));

        reg = new MetaAgentRegistry(
            address(this),
            address(usdc),
            address(hub),
            address(0),
            address(0),
            basket
        );

        hub.transferOwnership(address(reg));

        usdc.mint(lp, 100_000e6);
    }

    function _signTrade(address vaultAddr, uint16[5] memory w, uint256 bn)
        internal view returns (bytes memory)
    {
        bytes32 h = keccak256(abi.encodePacked(
            w[0], w[1], w[2], w[3], w[4], bn, vaultAddr
        ));
        bytes32 ethH = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", h
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorKey, ethH);
        return abi.encodePacked(r, s, v);
    }

    function test_e2e_deployVault_depositAndTrade() public {
        // 1. Operator deploys vault
        vm.prank(operator);
        uint256 agentId = reg.deploy(500, keccak256("policy-v1"));
        address vaultAddr = reg.vaultOf(agentId);
        MetaAgentVault vault = MetaAgentVault(vaultAddr);

        // 2. Vault registered in TradingExecutor
        assertTrue(hub.isVault(vaultAddr));

        // 3. LP deposits USDC
        vm.startPrank(lp);
        usdc.approve(vaultAddr, 10_000e6);
        uint256 shares = vault.deposit(10_000e6, lp);
        vm.stopPrank();
        assertGt(shares, 0);
        assertEq(vault.totalAssets(), 10_000e6);

        // 4. Operator signs and submits trade: 50% WETH, 50% USDC
        uint16[5] memory weights = [5000, 0, 0, 0, 5000];
        uint256 bn = block.number;
        bytes memory sig = _signTrade(vaultAddr, weights, bn);
        vault.executeTrade(weights, bn, sig);

        assertGt(weth.balanceOf(vaultAddr), 0);
        assertLt(usdc.balanceOf(vaultAddr), 10_000e6);

        // 5. Simulate gain: airdrop USDC into vault
        usdc.mint(vaultAddr, 500e6);

        // 6. Harvest: operator gets fee shares (500 bps = 5%)
        vault.harvest();
        assertGt(vault.balanceOf(operator), 0);

        // 7. LP can still redeem
        assertGt(vault.maxWithdraw(lp), 0);
    }

    function test_e2e_multipleVaults_independent() public {
        vm.prank(operator);
        uint256 id1 = reg.deploy(500, keccak256("p1"));
        vm.prank(operator);
        uint256 id2 = reg.deploy(1000, keccak256("p2"));

        address v1 = reg.vaultOf(id1);
        address v2 = reg.vaultOf(id2);

        assertNotEq(v1, v2);
        assertTrue(hub.isVault(v1));
        assertTrue(hub.isVault(v2));

        // Deposits to v1 don't affect v2
        vm.startPrank(lp);
        usdc.approve(v1, 5_000e6);
        MetaAgentVault(v1).deposit(5_000e6, lp);
        vm.stopPrank();

        assertEq(MetaAgentVault(v2).totalAssets(), 0);
    }

    function test_e2e_operatorNFTTransfer_newOwnerCanTrade() public {
        vm.prank(operator);
        uint256 agentId = reg.deploy(500, keccak256("policy-v1"));
        address vaultAddr = reg.vaultOf(agentId);

        // LP deposits
        vm.startPrank(lp);
        usdc.approve(vaultAddr, 10_000e6);
        MetaAgentVault(vaultAddr).deposit(10_000e6, lp);
        vm.stopPrank();

        // Transfer registry NFT to a new operator
        uint256 newKey = 0xDEADBEEF1234;
        address newOperator = vm.addr(newKey);

        vm.prank(operator);
        reg.transferFrom(operator, newOperator, agentId);

        // New operator can sign and execute a trade
        uint16[5] memory weights = [5000, 0, 0, 0, 5000];
        uint256 bn = block.number;
        bytes32 h = keccak256(abi.encodePacked(
            weights[0], weights[1], weights[2], weights[3], weights[4],
            bn, vaultAddr
        ));
        bytes32 ethH = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(newKey, ethH);
        bytes memory sig = abi.encodePacked(r, s, v);

        MetaAgentVault(vaultAddr).executeTrade(weights, bn, sig);
        assertGt(weth.balanceOf(vaultAddr), 0);
    }
}
