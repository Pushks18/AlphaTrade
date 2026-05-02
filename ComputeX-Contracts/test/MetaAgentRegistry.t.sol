// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";
import {KeeperHub}         from "../src/KeeperHub.sol";
import {MockERC20}         from "./mocks/MockERC20.sol";
import {MockSwapRouter}    from "./mocks/MockSwapRouter.sol";

contract MetaAgentRegistryTest is Test {
    MetaAgentRegistry internal reg;
    KeeperHub         internal hub;
    MockERC20         internal usdc;

    address internal owner    = address(this); // test contract is deployer/owner
    address internal operator = address(0xB2);

    address[5] internal basket;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);

        basket[0] = address(new MockERC20("WETH","WETH",18));
        basket[1] = address(new MockERC20("wBTC","wBTC",8));
        basket[2] = address(new MockERC20("LINK","LINK",18));
        basket[3] = address(new MockERC20("UNI","UNI",18));
        basket[4] = address(usdc);

        MockSwapRouter router = new MockSwapRouter();
        // Deploy hub with test contract as owner (so we can transfer later)
        hub = new KeeperHub(address(this), address(router));

        // Deploy registry
        reg = new MetaAgentRegistry(
            address(this),       // initialOwner
            address(usdc),
            address(hub),
            address(0),          // modelNFT — zero OK for registry tests
            address(0),          // modelMarketplace — zero OK
            basket
        );

        // Transfer hub ownership to registry so deploy() can registerVault
        hub.transferOwnership(address(reg));
    }

    function test_deploy_mintsNFTToOperator() public {
        vm.prank(operator);
        uint256 agentId = reg.deploy(500, keccak256("policy-v1"));

        assertEq(reg.ownerOf(agentId), operator);
        assertEq(agentId, 0);
    }

    function test_deploy_createsVault() public {
        vm.prank(operator);
        uint256 agentId = reg.deploy(500, keccak256("policy-v1"));

        address vault = reg.vaultOf(agentId);
        assertTrue(vault != address(0));
    }

    function test_deploy_vaultRegisteredInKeeperHub() public {
        vm.prank(operator);
        uint256 agentId = reg.deploy(500, keccak256("policy-v1"));
        address vault = reg.vaultOf(agentId);
        assertTrue(hub.isVault(vault));
    }

    function test_deploy_revertsOnPerfFeeTooHigh() public {
        vm.prank(operator);
        vm.expectRevert(bytes("Registry: perfFee too high"));
        reg.deploy(2001, keccak256("policy"));
    }

    function test_nextAgentId_increments() public {
        vm.prank(operator);
        reg.deploy(100, keccak256("a"));
        vm.prank(operator);
        uint256 id2 = reg.deploy(100, keccak256("b"));
        assertEq(id2, 1);
    }

    event AgentDeployed(uint256 indexed agentId, address indexed operator,
                        address vault, uint16 perfFeeBps, bytes32 policyHash);

    function test_deploy_emitsAgentDeployed() public {
        vm.prank(operator);
        vm.expectEmit(true, true, false, false);
        emit AgentDeployed(0, operator, address(0), 500, keccak256("policy-v1"));
        reg.deploy(500, keccak256("policy-v1"));
    }
}
