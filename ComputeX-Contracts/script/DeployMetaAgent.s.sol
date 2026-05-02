// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {KeeperHub}         from "../src/KeeperHub.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";

contract DeployMetaAgent is Script {
    // ── Arbitrum Sepolia addresses ────────────────────────────────────────
    address constant SWAP_ROUTER = 0x101F443B4d1b059569D643917553c771E1b9663E;
    address constant UNI_FACTORY = 0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e;

    // Basket tokens on Arbitrum Sepolia
    address constant WETH = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address constant WBTC = 0x0000000000000000000000000000000000000001; // TODO: real address
    address constant LINK = 0x0000000000000000000000000000000000000002; // TODO: real address
    address constant UNI  = 0x0000000000000000000000000000000000000003; // TODO: real address
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    // Plan 1 contracts — fill in after running Deploy.s.sol on testnet
    address constant MODEL_NFT         = address(0); // TODO: fill from Plan 1 deploy
    address constant MODEL_MARKETPLACE = address(0); // TODO: fill from Plan 1 deploy

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        address[5] memory basket = [WETH, WBTC, LINK, UNI, USDC];

        // 1. Deploy KeeperHub with deployer as temporary owner
        KeeperHub hub = new KeeperHub(deployer, SWAP_ROUTER);
        hub.setFactory(UNI_FACTORY);

        // 2. Deploy MetaAgentRegistry
        MetaAgentRegistry reg = new MetaAgentRegistry(
            deployer,
            USDC,
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
    }
}
