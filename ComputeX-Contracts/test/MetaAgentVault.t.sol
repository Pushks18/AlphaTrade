// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MetaAgentVault} from "../src/MetaAgentVault.sol";
import {MockERC20}      from "./mocks/MockERC20.sol";
import {MockKeeperHub}  from "./mocks/MockKeeperHub.sol";
import {MockModelNFT}   from "./mocks/MockModelNFT.sol";

contract MetaAgentVaultCoreTest is Test {
    MetaAgentVault internal vault;
    MockERC20      internal usdc;
    MockERC20      internal weth;
    MockKeeperHub  internal hub;

    address internal registry = address(0xAA01);
    address internal lp       = address(0xB2);

    uint256 internal constant AGENT_ID  = 0;
    uint256 internal constant PERF_FEE  = 1000; // 10%

    address[5] internal basket;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("WETH", "WETH", 18);
        hub  = new MockKeeperHub();

        basket[0] = address(weth);
        basket[1] = address(new MockERC20("wBTC","wBTC",8));
        basket[2] = address(new MockERC20("LINK","LINK",18));
        basket[3] = address(new MockERC20("UNI","UNI",18));
        basket[4] = address(usdc);

        vault = new MetaAgentVault(
            address(usdc),
            registry,
            AGENT_ID,
            uint16(PERF_FEE),
            keccak256("policy"),
            address(0),
            address(0),
            address(hub),
            basket
        );

        usdc.mint(lp, 10_000e6);
    }

    function test_deposit_mintsShares() public {
        vm.startPrank(lp);
        usdc.approve(address(vault), 1_000e6);
        uint256 shares = vault.deposit(1_000e6, lp);
        vm.stopPrank();

        assertEq(shares, vault.balanceOf(lp));
        assertGt(shares, 0);
    }

    function test_deposit_totalAssets_increases() public {
        vm.startPrank(lp);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6, lp);
        vm.stopPrank();

        assertEq(vault.totalAssets(), 1_000e6);
    }

    function test_withdraw_returnsUSDC() public {
        vm.startPrank(lp);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6, lp);
        uint256 before = usdc.balanceOf(lp);
        vault.withdraw(500e6, lp, lp);
        vm.stopPrank();

        assertEq(usdc.balanceOf(lp), before + 500e6);
    }

    function test_vaultMetadata_stored() public view {
        assertEq(vault.vaultId(),    AGENT_ID);
        assertEq(vault.perfFeeBps(), PERF_FEE);
        assertEq(vault.registry(),   registry);
    }

    function test_totalAssets_includesNonUSDCTokens() public {
        // Deposit some USDC
        vm.startPrank(lp);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6, lp);
        vm.stopPrank();

        // Airdrop WETH into the vault (simulates a previous swap)
        // MockKeeperHub.priceOf returns 1e18 by default (1 WETH = 1 USDC unit)
        weth.mint(address(vault), 500e6); // 500 WETH (in 18-decimal units but priced 1:1)

        // totalAssets = USDC + (WETH * price / 1e18) = 1000e6 + (500e6 * 1e18 / 1e18) = 1500e6
        assertEq(vault.totalAssets(), 1_500e6);
    }
}
