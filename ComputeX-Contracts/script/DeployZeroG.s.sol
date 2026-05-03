// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2}    from "forge-std/Script.sol";
import {GPUMarketplace}      from "../src/GPUMarketplace.sol";
import {ModelNFT}            from "../src/ModelNFT.sol";
import {ModelMarketplace}    from "../src/ModelMarketplace.sol";
import {PerformanceOracle}   from "../src/PerformanceOracle.sol";
import {CreatorRegistry}     from "../src/CreatorRegistry.sol";
import {Halo2Verifier}       from "../src/verifiers/EzklVerifier.sol";
import {MetaAgentRegistry}   from "../src/MetaAgentRegistry.sol";
import {MockERC20}           from "../test/mocks/MockERC20.sol";
import {MockTradingExecutor} from "../test/mocks/MockTradingExecutor.sol";

/// @title  DeployZeroG
/// @notice One-shot deploy of Plan 1 + Plan 2 contracts to 0G Galileo testnet
///         (or any EVM-compatible chain that doesn't have a real Uniswap V3
///         deployment). Uses MockTradingExecutor for swaps so the meta-agent
///         vault flow works without depending on an external DEX. The model
///         NFT + GPU marketplace contracts are unchanged from mainnet.
///
///         Usage:
///             ZG_RPC_URL=https://evmrpc-testnet.0g.ai \
///             PRIVATE_KEY=0x...funded-on-0g... \
///             forge script script/DeployZeroG.s.sol:DeployZeroG \
///                 --rpc-url $ZG_RPC_URL --broadcast --legacy
///
/// @dev    --legacy is required: 0G's testnet doesn't support EIP-1559 type-2
///         transactions yet (see 0G docs). A funded deployer key is required
///         — claim 0G testnet tokens at https://faucet.0g.ai before running.
contract DeployZeroG is Script {
    struct Plan1 {
        GPUMarketplace    gpuMarket;
        ModelNFT          modelNFT;
        ModelMarketplace  modelMarket;
        PerformanceOracle oracle;
        CreatorRegistry   creatorReg;
        Halo2Verifier     verifier;
    }

    function _deployPlan1(address deployer, address feedSigner) internal returns (Plan1 memory p) {
        p.gpuMarket   = new GPUMarketplace(deployer);
        p.modelNFT    = new ModelNFT(deployer, address(p.gpuMarket));
        p.modelMarket = new ModelMarketplace(deployer, address(p.modelNFT));
        p.verifier    = new Halo2Verifier();
        p.oracle      = new PerformanceOracle(
            deployer, feedSigner, address(p.modelNFT), address(p.verifier)
        );
        p.creatorReg  = new CreatorRegistry(deployer, address(p.modelNFT));

        p.gpuMarket.setModelNFT(address(p.modelNFT));
        p.modelNFT.setOracle(address(p.oracle));
        p.modelNFT.setCreatorRegistry(address(p.creatorReg));
    }

    function run() external {
        uint256 pk         = vm.envUint("PRIVATE_KEY");
        address deployer   = vm.addr(pk);
        address feedSigner = vm.envOr("FEED_SIGNER", deployer);

        vm.startBroadcast(pk);

        Plan1 memory p1 = _deployPlan1(deployer, feedSigner);

        // ─── Plan 2: meta-agent vault registry on mock-Uniswap ───────────
        MockERC20 usdc = new MockERC20("0G USD Coin",   "USDC", 6);
        address[5] memory basket = [
            address(new MockERC20("0G Ether",     "WETH", 18)),
            address(new MockERC20("0G Bitcoin",   "WBTC", 8)),
            address(new MockERC20("0G Chainlink", "LINK", 18)),
            address(new MockERC20("0G Uniswap",   "UNI",  18)),
            address(usdc)
        ];
        MockTradingExecutor execr = new MockTradingExecutor();
        MetaAgentRegistry   reg   = new MetaAgentRegistry(
            deployer, address(usdc), address(execr),
            address(p1.modelNFT), address(p1.modelMarket), basket
        );
        usdc.mint(deployer, 10_000 * 1e6);

        vm.stopBroadcast();

        console2.log("==== AlphaTrade on 0G Galileo ====");
        console2.log("Deployer:           ", deployer);
        console2.log("--- Plan 1 ---");
        console2.log("GPUMarketplace:     ", address(p1.gpuMarket));
        console2.log("ModelNFT:           ", address(p1.modelNFT));
        console2.log("ModelMarketplace:   ", address(p1.modelMarket));
        console2.log("PerformanceOracle:  ", address(p1.oracle));
        console2.log("CreatorRegistry:    ", address(p1.creatorReg));
        console2.log("Halo2Verifier:      ", address(p1.verifier));
        console2.log("--- Plan 2 ---");
        console2.log("MetaAgentRegistry:  ", address(reg));
        console2.log("MockTradingExecutor:", address(execr));
        console2.log("MockUSDC:           ", address(usdc));
        console2.log("Basket WETH:        ", basket[0]);
        console2.log("Basket WBTC:        ", basket[1]);
        console2.log("Basket LINK:        ", basket[2]);
        console2.log("Basket UNI:         ", basket[3]);
    }
}
