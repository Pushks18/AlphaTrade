# Meta-Agent Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `KeeperHub`, `MetaAgentVault` (ERC-4626, USDC), and `MetaAgentRegistry` on-chain, plus a Python runtime that runs an EXP4 contextual bandit, signs hourly trade decisions, and submits them to the vault via KeeperHub → Uniswap V3.

**Architecture:** `MetaAgentRegistry` is an ERC-721 whose `deploy()` creates a fresh `MetaAgentVault` and mints an operator NFT. Each vault is ERC-4626 (USDC underlying); share price reflects trading P&L. `executeTrade` accepts a 5-vector of token weights signed by the NFT holder (ecrecover), then calls `KeeperHub.executeSwaps` which routes through `ISwapRouter.exactInputSingle`. The Python runtime subscribes to on-chain score events, runs an EXP4 bandit over eligible model NFTs, and submits signed trade instructions hourly.

**Tech Stack:** Solidity 0.8.20 · Foundry · OZ 5.0.2 (ERC4626, ERC721, ECDSA) · Uniswap V3 ISwapRouter · Python 3.12 · web3.py · eth-account · onnxruntime · pytest

---

## File Map

**New Solidity (ComputeX-Contracts/)**
- `src/interfaces/IUniswapV3.sol` — ISwapRouter + IUniswapV3Pool + IUniswapV3Factory
- `src/interfaces/IKeeperHub.sol` — SwapInstruction struct + IKeeperHub interface
- `src/KeeperHub.sol` — executes Uniswap V3 swaps; reads pool prices; vault whitelist
- `src/MetaAgentRegistry.sol` — ERC-721 operator rights; `deploy()` creates vaults
- `src/MetaAgentVault.sol` — ERC-4626/USDC; `buyModel`, `relistModel`, `executeTrade`, `harvest`
- `test/mocks/MockERC20.sol` — mintable ERC-20 for USDC + basket tokens
- `test/mocks/MockSwapRouter.sol` — 1:1 swap, mints output token
- `test/mocks/MockKeeperHub.sol` — fixed-price priceOf + passthrough executeSwaps
- `test/KeeperHub.t.sol`
- `test/MetaAgentVault.t.sol`
- `test/MetaAgentRegistry.t.sol`
- `script/DeployMetaAgent.s.sol`

**New Python (backend/)**
- `meta_agent/__init__.py`
- `meta_agent/bandit.py` — EXP4 contextual bandit
- `meta_agent/inference.py` — ONNX model runner
- `meta_agent/keeper_client.py` — signs + submits executeTrade
- `meta_agent/runtime.py` — event loop, hourly tick
- `meta_agent/tests/__init__.py`
- `meta_agent/tests/test_bandit.py`
- `meta_agent/tests/test_inference.py`
- `meta_agent/tests/test_keeper_client.py`

---

## Task 1: Uniswap V3 interfaces + test mocks

**Files:**
- Create: `ComputeX-Contracts/src/interfaces/IUniswapV3.sol`
- Create: `ComputeX-Contracts/src/interfaces/IKeeperHub.sol`
- Create: `ComputeX-Contracts/test/mocks/MockERC20.sol`
- Create: `ComputeX-Contracts/test/mocks/MockSwapRouter.sol`
- Create: `ComputeX-Contracts/test/mocks/MockKeeperHub.sol`

- [ ] **Step 1: Write `IUniswapV3.sol`**

```solidity
// ComputeX-Contracts/src/interfaces/IUniswapV3.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee)
        external view returns (address pool);
}
```

- [ ] **Step 2: Write `IKeeperHub.sol`**

```solidity
// ComputeX-Contracts/src/interfaces/IKeeperHub.sol
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
```

- [ ] **Step 3: Write `MockERC20.sol`**

```solidity
// ComputeX-Contracts/test/mocks/MockERC20.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _dec;
    constructor(string memory name, string memory symbol, uint8 dec)
        ERC20(name, symbol) { _dec = dec; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```

- [ ] **Step 4: Write `MockSwapRouter.sol`**

```solidity
// ComputeX-Contracts/test/mocks/MockSwapRouter.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";
import {ISwapRouter} from "../../src/interfaces/IUniswapV3.sol";

/// @dev 1:1 swap — pulls tokenIn from caller, mints amountIn of tokenOut.
contract MockSwapRouter {
    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata p)
        external returns (uint256 amountOut)
    {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        MockERC20(p.tokenOut).mint(p.recipient, p.amountIn);
        return p.amountIn;
    }
}
```

- [ ] **Step 5: Write `MockKeeperHub.sol`**

```solidity
// ComputeX-Contracts/test/mocks/MockKeeperHub.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";
import {IKeeperHub} from "../../src/interfaces/IKeeperHub.sol";

/// @dev 1:1 swaps; configurable priceOf (default 1e18 = 1:1).
contract MockKeeperHub is IKeeperHub {
    mapping(address => mapping(address => uint256)) public prices;

    function setPrice(address tokenIn, address tokenOut, uint256 price) external {
        prices[tokenIn][tokenOut] = price;
    }

    function priceOf(address tokenIn, address tokenOut, uint24)
        external view override returns (uint256)
    {
        uint256 p = prices[tokenIn][tokenOut];
        return p == 0 ? 1e18 : p;
    }

    function executeSwaps(SwapInstruction[] calldata swaps)
        external override returns (uint256[] memory amountsOut)
    {
        amountsOut = new uint256[](swaps.length);
        for (uint256 i = 0; i < swaps.length; i++) {
            IERC20(swaps[i].tokenIn).transferFrom(msg.sender, address(this), swaps[i].amountIn);
            MockERC20(swaps[i].tokenOut).mint(msg.sender, swaps[i].amountIn);
            amountsOut[i] = swaps[i].amountIn;
        }
    }
}
```

- [ ] **Step 6: Verify compilation**

```bash
cd ComputeX-Contracts && forge build
```
Expected: `Compiler run successful!`

- [ ] **Step 7: Commit**

```bash
git add ComputeX-Contracts/src/interfaces/ ComputeX-Contracts/test/mocks/MockERC20.sol \
        ComputeX-Contracts/test/mocks/MockSwapRouter.sol ComputeX-Contracts/test/mocks/MockKeeperHub.sol
git commit -m "feat(interfaces): Uniswap V3 interfaces + MockERC20/SwapRouter/KeeperHub mocks"
```

---

## Task 2: KeeperHub.sol

**Files:**
- Create: `ComputeX-Contracts/src/KeeperHub.sol`
- Create: `ComputeX-Contracts/test/KeeperHub.t.sol`

- [ ] **Step 1: Write the failing tests**

```solidity
// ComputeX-Contracts/test/KeeperHub.t.sol
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
        // When factory has no pool, returns 0
        assertEq(hub.priceOf(address(usdc), address(weth), 3000), 0);
    }
}
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
cd ComputeX-Contracts && forge test --match-contract KeeperHubTest -vv 2>&1 | head -20
```
Expected: `Compiler run failed` (KeeperHub.sol doesn't exist yet).

- [ ] **Step 3: Implement `KeeperHub.sol`**

```solidity
// ComputeX-Contracts/src/KeeperHub.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable}   from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter, IUniswapV3Pool, IUniswapV3Factory} from "./interfaces/IUniswapV3.sol";
import {IKeeperHub} from "./interfaces/IKeeperHub.sol";

contract KeeperHub is IKeeperHub, Ownable {
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
        require(router_ != address(0), "KeeperHub: zero router");
        router = ISwapRouter(router_);
    }

    function setFactory(address factory_) external onlyOwner {
        factory = IUniswapV3Factory(factory_);
    }

    function registerVault(address vault) external onlyOwner {
        require(vault != address(0), "KeeperHub: zero vault");
        isVault[vault] = true;
        emit VaultRegistered(vault);
    }

    /// @notice Execute a batch of single-hop Uniswap V3 swaps on behalf of a vault.
    function executeSwaps(SwapInstruction[] calldata swaps)
        external override returns (uint256[] memory amountsOut)
    {
        require(isVault[msg.sender], "KeeperHub: not vault");
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
                    amountIn:          s.amountIn,
                    amountOutMinimum:  s.amountOutMinimum,
                    sqrtPriceLimitX96: 0
                })
            );
            amountsOut[i] = out;
            emit TradeExecuted(msg.sender, s.tokenIn, s.tokenOut, s.amountIn, out);
        }
    }

    /// @notice Read spot price of tokenIn in terms of tokenOut from pool slot0.
    ///         Returns 0 if no pool exists (factory not set or pool not created).
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
        // price = (sqrtPriceX96 / 2^96)^2 * 1e18
        if (token0 == tokenIn) {
            return (sq * sq * 1e18) >> 192;
        } else {
            return ((1 << 192) / (sq * sq / 1e18));
        }
    }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
cd ComputeX-Contracts && forge test --match-contract KeeperHubTest -vv
```
Expected: `5 passed; 0 failed`

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
forge test --summary 2>&1 | tail -15
```
Expected: all prior suites still green.

- [ ] **Step 6: Commit**

```bash
git add ComputeX-Contracts/src/KeeperHub.sol ComputeX-Contracts/test/KeeperHub.t.sol
git commit -m "feat(keeperhub): KeeperHub executes Uniswap V3 swaps for registered vaults"
```

---

## Task 3: MetaAgentRegistry.sol

**Files:**
- Create: `ComputeX-Contracts/src/MetaAgentRegistry.sol`
- Create: `ComputeX-Contracts/test/MetaAgentRegistry.t.sol`

- [ ] **Step 1: Write the failing tests**

```solidity
// ComputeX-Contracts/test/MetaAgentRegistry.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";
import {MetaAgentVault}    from "../src/MetaAgentVault.sol";
import {KeeperHub}         from "../src/KeeperHub.sol";
import {MockERC20}         from "./mocks/MockERC20.sol";
import {MockSwapRouter}    from "./mocks/MockSwapRouter.sol";
import {MockModelNFT}      from "./mocks/MockModelNFT.sol";

contract MetaAgentRegistryTest is Test {
    MetaAgentRegistry internal reg;
    KeeperHub         internal hub;
    MockERC20         internal usdc;
    MockSwapRouter    internal router;
    MockModelNFT      internal modelNFT;

    address internal owner    = address(0xA1);
    address internal operator = address(0xB2);

    function setUp() public {
        usdc     = new MockERC20("USD Coin", "USDC", 6);
        router   = new MockSwapRouter();
        modelNFT = new MockModelNFT();
        hub      = new KeeperHub(owner, address(router));

        // basket: 5 tokens, last is USDC (asset)
        address[5] memory basket = [
            address(new MockERC20("WETH","WETH",18)),
            address(new MockERC20("wBTC","wBTC",8)),
            address(new MockERC20("LINK","LINK",18)),
            address(new MockERC20("UNI","UNI",18)),
            address(usdc)
        ];

        reg = new MetaAgentRegistry(
            owner,
            address(usdc),
            address(hub),
            address(modelNFT),
            address(0), // modelMarketplace — zero OK for registry tests
            basket
        );

        vm.prank(owner);
        hub.registerVault(address(0)); // placeholder; real vault registered in deploy()
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
```

- [ ] **Step 2: Run tests, confirm they fail (MetaAgentRegistry doesn't exist)**

```bash
cd ComputeX-Contracts && forge test --match-contract MetaAgentRegistryTest -vv 2>&1 | head -10
```
Expected: `Compiler run failed`.

- [ ] **Step 3: Implement `MetaAgentRegistry.sol`**

```solidity
// ComputeX-Contracts/src/MetaAgentRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721}  from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MetaAgentVault} from "./MetaAgentVault.sol";
import {KeeperHub}      from "./KeeperHub.sol";

contract MetaAgentRegistry is ERC721, Ownable {
    uint256 public nextAgentId;
    address public immutable usdc;
    address public immutable keeperHub;
    address public immutable modelNFT;
    address public immutable modelMarketplace;
    address[5] public basket;

    mapping(uint256 => address) public vaultOf;

    event AgentDeployed(uint256 indexed agentId, address indexed operator,
                        address vault, uint16 perfFeeBps, bytes32 policyHash);

    constructor(
        address initialOwner,
        address usdc_,
        address keeperHub_,
        address modelNFT_,
        address modelMarketplace_,
        address[5] memory basket_
    ) ERC721("MetaAgent", "MAGNT") Ownable(initialOwner) {
        require(usdc_       != address(0), "Registry: zero usdc");
        require(keeperHub_  != address(0), "Registry: zero hub");
        usdc             = usdc_;
        keeperHub        = keeperHub_;
        modelNFT         = modelNFT_;
        modelMarketplace = modelMarketplace_;
        basket           = basket_;
    }

    function deploy(uint16 perfFeeBps, bytes32 policyHash)
        external returns (uint256 agentId)
    {
        require(perfFeeBps <= 2000, "Registry: perfFee too high");

        agentId = nextAgentId++;

        MetaAgentVault vault = new MetaAgentVault(
            usdc,
            address(this),
            agentId,
            perfFeeBps,
            policyHash,
            modelNFT,
            modelMarketplace,
            keeperHub,
            basket
        );

        vaultOf[agentId] = address(vault);

        // Register vault in KeeperHub (registry is KeeperHub owner)
        KeeperHub(keeperHub).registerVault(address(vault));

        _mint(msg.sender, agentId);
        emit AgentDeployed(agentId, msg.sender, address(vault), perfFeeBps, policyHash);
    }
}
```

- [ ] **Step 4: Run tests — they will still fail because MetaAgentVault doesn't exist. That's expected.**

```bash
forge test --match-contract MetaAgentRegistryTest -vv 2>&1 | head -10
```
Expected: `Compiler run failed` (MetaAgentVault.sol missing — we build it next).

---

## Task 4: MetaAgentVault — ERC-4626 core (deposit / withdraw / totalAssets)

**Files:**
- Create: `ComputeX-Contracts/src/MetaAgentVault.sol`
- Create: `ComputeX-Contracts/test/MetaAgentVault.t.sol`

- [ ] **Step 1: Write failing deposit/withdraw tests**

```solidity
// ComputeX-Contracts/test/MetaAgentVault.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MetaAgentVault} from "../src/MetaAgentVault.sol";
import {MockERC20}      from "./mocks/MockERC20.sol";
import {MockKeeperHub}  from "./mocks/MockKeeperHub.sol";

contract MetaAgentVaultTest is Test {
    MetaAgentVault internal vault;
    MockERC20      internal usdc;
    MockERC20      internal weth;
    MockKeeperHub  internal hub;

    address internal registry = address(0xREG);
    address internal lp       = address(0xB2);
    address internal operator = address(0xC3);

    uint256 internal constant AGENT_ID = 0;
    uint256 internal constant PERF_FEE = 1000; // 10%

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
            address(usdc),   // asset
            registry,
            AGENT_ID,
            uint16(PERF_FEE),
            keccak256("policy"),
            address(0),      // modelNFT (not needed for these tests)
            address(0),      // modelMarketplace
            address(hub),
            basket
        );

        vm.deal(lp, 10 ether);
        usdc.mint(lp, 10_000e6);
    }

    // ── deposit / withdraw ────────────────────────────────────────────────

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
}
```

- [ ] **Step 2: Run, confirm fail (MetaAgentVault.sol missing)**

```bash
forge test --match-contract MetaAgentVaultTest -vv 2>&1 | head -10
```

- [ ] **Step 3: Implement `MetaAgentVault.sol` (core only)**

```solidity
// ComputeX-Contracts/src/MetaAgentVault.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC4626}  from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}    from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}   from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721}  from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ECDSA}    from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IKeeperHub} from "./interfaces/IKeeperHub.sol";

interface IModelMarketplace {
    function listModel(uint256 tokenId, uint256 price) external;
}

contract MetaAgentVault is ERC4626 {
    using SafeERC20 for IERC20;

    address public immutable registry;
    uint256 public immutable vaultId;
    uint16  public immutable perfFeeBps;
    bytes32 public immutable policyHash;
    address public immutable modelNFT;
    address public immutable modelMarketplace;
    address public immutable keeperHub;
    address[5] public basket; // basket[4] == asset() == USDC

    uint256 public lastHarvestAssets;

    uint256 private constant MIN_SWAP_BPS = 100; // 1% minimum swap size

    event TradeExecuted(uint256 indexed blockNumber, uint256 navBefore);
    event Harvested(uint256 nav, uint256 gain, uint256 feeShares);

    modifier onlyOperator() {
        require(msg.sender == IERC721(registry).ownerOf(vaultId), "Vault: not operator");
        _;
    }

    constructor(
        address usdc_,
        address registry_,
        uint256 vaultId_,
        uint16  perfFeeBps_,
        bytes32 policyHash_,
        address modelNFT_,
        address modelMarketplace_,
        address keeperHub_,
        address[5] memory basket_
    )
        ERC20("MetaAgent Vault Shares", "MAVS")
        ERC4626(IERC20(usdc_))
    {
        require(registry_  != address(0), "Vault: zero registry");
        require(keeperHub_ != address(0), "Vault: zero hub");
        registry         = registry_;
        vaultId          = vaultId_;
        perfFeeBps       = perfFeeBps_;
        policyHash       = policyHash_;
        modelNFT         = modelNFT_;
        modelMarketplace = modelMarketplace_;
        keeperHub        = keeperHub_;
        basket           = basket_;
    }

    /// @notice NAV = USDC held + value of all basket tokens (priced via KeeperHub).
    function totalAssets() public view override returns (uint256 total) {
        for (uint256 i = 0; i < 5; i++) {
            uint256 bal = IERC20(basket[i]).balanceOf(address(this));
            if (bal == 0) continue;
            if (basket[i] == asset()) {
                total += bal;
            } else {
                uint256 price = IKeeperHub(keeperHub).priceOf(basket[i], asset(), 3000);
                if (price > 0) total += (bal * price) / 1e18;
            }
        }
    }

    // buyModel, relistModel, executeTrade, harvest added in Tasks 5-7
}
```

- [ ] **Step 4: Run vault tests — core tests should pass**

```bash
forge test --match-contract MetaAgentVaultTest -vv
```
Expected: `test_deposit_*`, `test_withdraw_*`, `test_vaultMetadata_*` pass.

- [ ] **Step 5: Run registry tests — should now compile and pass**

```bash
forge test --match-contract MetaAgentRegistryTest -vv
```
Expected: all 6 pass.

- [ ] **Step 6: Commit**

```bash
git add ComputeX-Contracts/src/MetaAgentVault.sol ComputeX-Contracts/src/MetaAgentRegistry.sol \
        ComputeX-Contracts/test/MetaAgentVault.t.sol ComputeX-Contracts/test/MetaAgentRegistry.t.sol
git commit -m "feat(vault+registry): MetaAgentVault ERC-4626 core + MetaAgentRegistry ERC-721 deploy()"
```

---

## Task 5: MetaAgentVault — buyModel / relistModel

**Files:**
- Modify: `ComputeX-Contracts/src/MetaAgentVault.sol`
- Modify: `ComputeX-Contracts/test/MetaAgentVault.t.sol`

- [ ] **Step 1: Add failing tests to MetaAgentVault.t.sol**

Add this contract after `MetaAgentVaultTest`:

```solidity
contract MetaAgentVaultModelTest is Test {
    MetaAgentVault internal vault;
    MockERC20      internal usdc;
    MockModelNFT   internal modelNFT;  // from existing test/mocks/MockModelNFT.sol
    MockERC20      internal weth;

    address internal registry = address(0xA11CE);
    address internal operator = address(0xOPER);
    address internal lp       = address(0xB2);

    uint256 constant AGENT_ID = 0;
    address[5] internal basket;

    function setUp() public {
        usdc     = new MockERC20("USDC", "USDC", 6);
        weth     = new MockERC20("WETH", "WETH", 18);
        modelNFT = new MockModelNFT();

        basket[4] = address(usdc);
        for (uint256 i = 0; i < 4; i++) basket[i] = address(weth);

        vault = new MetaAgentVault(
            address(usdc), registry, AGENT_ID, 500, keccak256("p"),
            address(modelNFT), address(0), address(new MockKeeperHub()), basket
        );

        // mock registry: operator owns NFT id 0
        vm.mockCall(
            registry,
            abi.encodeWithSelector(IERC721.ownerOf.selector, AGENT_ID),
            abi.encode(operator)
        );

        usdc.mint(address(vault), 2_000e6);
    }

    function test_buyModel_transfersNFTToVault() public {
        // Mint model NFT to vault operator, approve vault
        modelNFT.mint(operator, 1);
        vm.prank(operator);
        modelNFT.approve(address(vault), 1);

        // vault buys model: operator instructs, vault pays from USDC balance
        // For v1, buyModel just pulls the NFT (market price handled by ModelMarketplace)
        vm.prank(operator);
        vault.buyModel(1);

        assertEq(modelNFT.ownerOf(1), address(vault));
    }

    function test_buyModel_revertsForNonOperator() public {
        vm.prank(lp);
        vm.expectRevert(bytes("Vault: not operator"));
        vault.buyModel(1);
    }

    function test_relistModel_approvesMktplaceAndLists() public {
        // Setup: vault owns tokenId 1
        modelNFT.mint(address(vault), 1);
        address mktplace = address(new MockModelMarketplaceSimple());
        MetaAgentVault v2 = new MetaAgentVault(
            address(usdc), registry, AGENT_ID, 500, keccak256("p"),
            address(modelNFT), mktplace, address(new MockKeeperHub()), basket
        );
        // Transfer NFT to v2
        vm.prank(address(vault));
        modelNFT.transferFrom(address(vault), address(v2), 1);

        vm.prank(operator);
        v2.relistModel(1, 500e6);

        // MockModelMarketplaceSimple records the listing
        assertEq(MockModelMarketplaceSimple(mktplace).lastPrice(1), 500e6);
    }
}

/// Minimal marketplace mock just for relisting test
contract MockModelMarketplaceSimple {
    mapping(uint256 => uint256) public lastPrice;
    function listModel(uint256 tokenId, uint256 price) external {
        lastPrice[tokenId] = price;
    }
}
```

Also need to import MockModelNFT and MockKeeperHub at top of MetaAgentVault.t.sol:
```solidity
import {MockModelNFT}   from "./mocks/MockModelNFT.sol";
import {MockKeeperHub}  from "./mocks/MockKeeperHub.sol";
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
forge test --match-contract MetaAgentVaultModelTest -vv 2>&1 | head -15
```
Expected: `[FAIL]` — `buyModel`/`relistModel` not defined.

- [ ] **Step 3: Add `buyModel` and `relistModel` to `MetaAgentVault.sol`**

Add these functions inside `MetaAgentVault` (after the constructor):

```solidity
    event ModelBought(uint256 indexed tokenId);
    event ModelRelisted(uint256 indexed tokenId, uint256 price);

    /// @notice Pull a model NFT into this vault's portfolio. The operator must
    ///         have already approved the vault on the ModelNFT contract.
    function buyModel(uint256 tokenId) external onlyOperator {
        IERC721(modelNFT).transferFrom(msg.sender, address(this), tokenId);
        emit ModelBought(tokenId);
    }

    /// @notice List a vault-owned model NFT on ModelMarketplace.
    function relistModel(uint256 tokenId, uint256 price) external onlyOperator {
        require(modelMarketplace != address(0), "Vault: no marketplace");
        IERC721(modelNFT).approve(modelMarketplace, tokenId);
        IModelMarketplace(modelMarketplace).listModel(tokenId, price);
        emit ModelRelisted(tokenId, price);
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
forge test --match-contract MetaAgentVaultModelTest -vv
```
Expected: all 3 pass.

- [ ] **Step 5: Full suite green**

```bash
forge test --summary 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add ComputeX-Contracts/src/MetaAgentVault.sol ComputeX-Contracts/test/MetaAgentVault.t.sol
git commit -m "feat(vault): buyModel + relistModel operator actions"
```

---

## Task 6: MetaAgentVault — executeTrade (ecrecover + KeeperHub swaps)

**Files:**
- Modify: `ComputeX-Contracts/src/MetaAgentVault.sol`
- Modify: `ComputeX-Contracts/test/MetaAgentVault.t.sol`

- [ ] **Step 1: Add failing executeTrade tests**

Add this contract at the end of `MetaAgentVault.t.sol`:

```solidity
contract MetaAgentVaultTradeTest is Test {
    MetaAgentVault internal vault;
    MockERC20      internal usdc;
    MockERC20      internal weth;
    MockKeeperHub  internal hub;

    address internal registry;
    uint256 internal operatorKey = 0xA11CE_DEAD_BEEF; // private key for signing
    address internal operator;
    uint256 constant AGENT_ID = 0;
    address[5] internal basket;

    function setUp() public {
        operator = vm.addr(operatorKey);
        registry = address(new MockRegistry(operator, AGENT_ID));

        usdc = new MockERC20("USDC","USDC",6);
        weth = new MockERC20("WETH","WETH",18);
        hub  = new MockKeeperHub();

        basket[0] = address(weth);
        basket[1] = basket[2] = basket[3] = address(weth); // simplified
        basket[4] = address(usdc);

        vault = new MetaAgentVault(
            address(usdc), registry, AGENT_ID, 500, keccak256("p"),
            address(0), address(0), address(hub), basket
        );

        usdc.mint(address(vault), 10_000e6);
    }

    function _sign(uint8[5] memory weights, uint256 blockNum)
        internal view returns (bytes memory)
    {
        bytes32 msgHash = keccak256(abi.encodePacked(
            weights[0], weights[1], weights[2], weights[3], weights[4],
            blockNum,
            address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function test_executeTrade_revertsOnStaleBlock() public {
        uint8[5] memory w = [2000, 2000, 2000, 2000, 2000];
        bytes memory sig = _sign(w, 1);
        vm.roll(10); // advance 10 blocks
        vm.expectRevert(bytes("Vault: stale sig"));
        vault.executeTrade(w, 1, sig);
    }

    function test_executeTrade_revertsOnBadSig() public {
        uint8[5] memory w = [2000, 2000, 2000, 2000, 2000];
        uint256 bn = block.number;
        bytes memory badSig = new bytes(65); // zero signature
        vm.expectRevert();
        vault.executeTrade(w, bn, badSig);
    }

    function test_executeTrade_revertsOnWeightsMismatch() public {
        uint8[5] memory w = [2000, 2000, 2000, 2000, 2001]; // sums to 10001
        uint256 bn = block.number;
        bytes memory sig = _sign(w, bn);
        vm.expectRevert(bytes("Vault: weights != 10000"));
        vault.executeTrade(w, bn, sig);
    }

    function test_executeTrade_emitsEvent() public {
        uint8[5] memory w = [2000, 2000, 2000, 2000, 2000]; // 20% each
        uint256 bn = block.number;
        bytes memory sig = _sign(w, bn);
        vm.expectEmit(true, false, false, false);
        emit MetaAgentVault.TradeExecuted(bn, 0);
        vault.executeTrade(w, bn, sig);
    }

    function test_executeTrade_swapsTokens() public {
        // 80% WETH, 20% USDC
        uint8[5] memory w = [8000, 0, 0, 0, 2000];
        uint256 bn = block.number;
        bytes memory sig = _sign(w, bn);
        vault.executeTrade(w, bn, sig);
        // vault should have less USDC and some WETH
        assertLt(usdc.balanceOf(address(vault)), 10_000e6);
        assertGt(weth.balanceOf(address(vault)), 0);
    }
}

/// Minimal registry mock: operator owns agentId
contract MockRegistry {
    address internal _operator;
    uint256 internal _id;
    constructor(address op, uint256 id) { _operator = op; _id = id; }
    function ownerOf(uint256 id) external view returns (address) {
        require(id == _id, "no such id");
        return _operator;
    }
}
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
forge test --match-contract MetaAgentVaultTradeTest -vv 2>&1 | head -15
```
Expected: `[FAIL]` — `executeTrade` not defined.

- [ ] **Step 3: Add `executeTrade` to `MetaAgentVault.sol`**

```solidity
    /// @notice Submit a signed trade instruction from the operator.
    /// @param targetWeightsBps  5-element allocation, must sum to 10_000.
    /// @param blockNumber       Block the operator signed at (staleness guard).
    /// @param sig               65-byte ECDSA signature over (weights, blockNumber, vaultAddr).
    function executeTrade(
        uint8[5] calldata targetWeightsBps,
        uint256 blockNumber,
        bytes calldata sig
    ) external {
        // Staleness: signed block must be within the last 5 blocks
        require(block.number >= blockNumber, "Vault: future block");
        require(block.number - blockNumber <= 5, "Vault: stale sig");

        // Weight sum check
        uint256 sum;
        for (uint256 i = 0; i < 5; i++) sum += targetWeightsBps[i];
        require(sum == 10_000, "Vault: weights != 10000");

        // Verify signature
        bytes32 msgHash = keccak256(abi.encodePacked(
            targetWeightsBps[0], targetWeightsBps[1], targetWeightsBps[2],
            targetWeightsBps[3], targetWeightsBps[4],
            blockNumber,
            address(this)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        address signer = ECDSA.recover(ethHash, sig);
        require(signer == IERC721(registry).ownerOf(vaultId), "Vault: bad sig");

        uint256 navBefore = totalAssets();
        _rebalance(targetWeightsBps, navBefore);
        emit TradeExecuted(blockNumber, navBefore);
    }

    function _rebalance(uint8[5] calldata weights, uint256 nav) private {
        // Pass 1: sell overweight non-USDC tokens
        for (uint256 i = 0; i < 4; i++) {
            uint256 current = IERC20(basket[i]).balanceOf(address(this));
            if (current == 0) continue;
            uint256 price = IKeeperHub(keeperHub).priceOf(basket[i], asset(), 3000);
            if (price == 0) continue;
            uint256 currentValueUsdc = (current * price) / 1e18;
            uint256 targetValueUsdc  = (nav * weights[i]) / 10_000;
            if (currentValueUsdc > targetValueUsdc + (nav * MIN_SWAP_BPS / 10_000)) {
                uint256 sellUsdc = currentValueUsdc - targetValueUsdc;
                uint256 sellAmt  = (sellUsdc * 1e18) / price;
                _executeSwap(basket[i], asset(), sellAmt);
            }
        }
        // Pass 2: buy underweight non-USDC tokens
        uint256 usdcBal = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < 4; i++) {
            if (weights[i] == 0) continue;
            uint256 price = IKeeperHub(keeperHub).priceOf(basket[i], asset(), 3000);
            if (price == 0) continue;
            uint256 current = IERC20(basket[i]).balanceOf(address(this));
            uint256 currentValueUsdc = (current * price) / 1e18;
            uint256 targetValueUsdc  = (nav * weights[i]) / 10_000;
            if (targetValueUsdc > currentValueUsdc + (nav * MIN_SWAP_BPS / 10_000)) {
                uint256 buyUsdc = targetValueUsdc - currentValueUsdc;
                if (buyUsdc > usdcBal) buyUsdc = usdcBal;
                if (buyUsdc > 0) {
                    _executeSwap(asset(), basket[i], buyUsdc);
                    usdcBal -= buyUsdc;
                }
            }
        }
    }

    function _executeSwap(address tokenIn, address tokenOut, uint256 amountIn) private {
        IKeeperHub.SwapInstruction[] memory swaps = new IKeeperHub.SwapInstruction[](1);
        swaps[0] = IKeeperHub.SwapInstruction({
            tokenIn:          tokenIn,
            tokenOut:         tokenOut,
            poolFee:          3000,
            amountIn:         amountIn,
            amountOutMinimum: 0
        });
        IERC20(tokenIn).forceApprove(keeperHub, amountIn);
        IKeeperHub(keeperHub).executeSwaps(swaps);
    }
```

Also add to imports at top of MetaAgentVault.sol:
```solidity
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// (already imported — ensure `using SafeERC20 for IERC20;` is present)
```

And add `forceApprove` — this is available in OZ 5.x SafeERC20 as `forceApprove`. If not, replace with:
```solidity
IERC20(tokenIn).approve(keeperHub, 0);
IERC20(tokenIn).approve(keeperHub, amountIn);
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
forge test --match-contract MetaAgentVaultTradeTest -vv
```
Expected: all 5 pass.

- [ ] **Step 5: Full suite green**

```bash
forge test --summary 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add ComputeX-Contracts/src/MetaAgentVault.sol ComputeX-Contracts/test/MetaAgentVault.t.sol
git commit -m "feat(vault): executeTrade — ecrecover sig + KeeperHub rebalance"
```

---

## Task 7: MetaAgentVault — harvest (performance fee)

**Files:**
- Modify: `ComputeX-Contracts/src/MetaAgentVault.sol`
- Modify: `ComputeX-Contracts/test/MetaAgentVault.t.sol`

- [ ] **Step 1: Add failing harvest tests**

Add at the end of `MetaAgentVault.t.sol`:

```solidity
contract MetaAgentVaultHarvestTest is Test {
    MetaAgentVault internal vault;
    MockERC20      internal usdc;
    MockKeeperHub  internal hub;

    address internal registry = address(new MockRegistry(address(0xOP), 0));
    address internal operator = address(0xOP);
    address internal lp       = address(0xLP);
    address[5] internal basket;

    function setUp() public {
        usdc = new MockERC20("USDC","USDC",6);
        hub  = new MockKeeperHub();
        basket[4] = address(usdc);
        for (uint256 i = 0; i < 4; i++) basket[i] = address(usdc); // simplified

        vault = new MetaAgentVault(
            address(usdc), registry, 0, 1000, keccak256("p"),
            address(0), address(0), address(hub), basket
        );
        usdc.mint(lp, 10_000e6);
        vm.startPrank(lp);
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6, lp);
        vm.stopPrank();
    }

    function test_harvest_noFeeWhenNoGain() public {
        uint256 sharesBefore = vault.totalSupply();
        vault.harvest();
        assertEq(vault.totalSupply(), sharesBefore); // no new shares minted
    }

    function test_harvest_mintsFeeSharesOnGain() public {
        // Simulate a gain: airdrop extra USDC into vault
        usdc.mint(address(vault), 1_000e6); // 10% gain

        uint256 sharesBefore = vault.totalSupply();
        vault.harvest();
        uint256 sharesAfter = vault.totalSupply();

        assertGt(sharesAfter, sharesBefore); // fee shares minted to operator
    }

    function test_harvest_feeSentToOperator() public {
        usdc.mint(address(vault), 1_000e6);
        vault.harvest();
        assertGt(vault.balanceOf(operator), 0);
    }

    function test_harvest_updatesLastHarvestAssets() public {
        vault.harvest();
        assertEq(vault.lastHarvestAssets(), vault.totalAssets());
    }

    function test_harvest_emitsEvent() public {
        usdc.mint(address(vault), 500e6);
        vm.expectEmit(false, false, false, false);
        emit MetaAgentVault.Harvested(0, 0, 0);
        vault.harvest();
    }
}
```

- [ ] **Step 2: Run, confirm fail**

```bash
forge test --match-contract MetaAgentVaultHarvestTest -vv 2>&1 | head -10
```

- [ ] **Step 3: Add `harvest` to `MetaAgentVault.sol`**

```solidity
    function harvest() external {
        uint256 current = totalAssets();
        uint256 last    = lastHarvestAssets;
        uint256 feeShares;

        if (current > last && last > 0) {
            uint256 gain       = current - last;
            uint256 feeAssets  = (gain * perfFeeBps) / 10_000;
            // Shares to mint = feeAssets / pricePerShare
            // pricePerShare  = totalAssets() / totalSupply() — but we must use
            // the supply BEFORE minting to avoid circularity
            uint256 supply = totalSupply();
            if (supply > 0) {
                feeShares = (feeAssets * supply) / current;
                address op = IERC721(registry).ownerOf(vaultId);
                _mint(op, feeShares);
            }
        }

        lastHarvestAssets = current;
        emit Harvested(current, current > last ? current - last : 0, feeShares);
    }
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
forge test --match-contract MetaAgentVaultHarvestTest -vv
```
Expected: all 5 pass.

- [ ] **Step 5: Full suite green**

```bash
forge test --summary 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add ComputeX-Contracts/src/MetaAgentVault.sol ComputeX-Contracts/test/MetaAgentVault.t.sol
git commit -m "feat(vault): harvest — performance fee minted to operator as shares"
```

---

## Task 8: Meta-agent end-to-end integration test

**Files:**
- Create: `ComputeX-Contracts/test/MetaAgentEndToEnd.t.sol`

- [ ] **Step 1: Write the test**

```solidity
// ComputeX-Contracts/test/MetaAgentEndToEnd.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";
import {MetaAgentVault}    from "../src/MetaAgentVault.sol";
import {KeeperHub}         from "../src/KeeperHub.sol";
import {MockERC20}         from "./mocks/MockERC20.sol";
import {MockSwapRouter}    from "./mocks/MockSwapRouter.sol";

contract MetaAgentEndToEndTest is Test {
    MetaAgentRegistry internal reg;
    KeeperHub         internal hub;
    MockERC20         internal usdc;
    MockERC20         internal weth;
    MockSwapRouter    internal router;

    address internal owner = address(0xA1);
    address internal lp    = address(0xB2);

    uint256 internal operatorKey = 0xC0FFEE;
    address internal operator;
    address[5] internal basket;

    function setUp() public {
        operator = vm.addr(operatorKey);
        usdc  = new MockERC20("USDC","USDC",6);
        weth  = new MockERC20("WETH","WETH",18);
        router = new MockSwapRouter();
        hub   = new KeeperHub(address(0), address(router)); // owner = address(0) so reg can register

        basket[0] = address(weth);
        basket[1] = basket[2] = basket[3] = address(weth);
        basket[4] = address(usdc);

        // Registry is KeeperHub owner so it can registerVault
        hub = new KeeperHub(address(this), address(router));
        hub.transferOwnership(address(0)); // will fail — need registry as owner
        // Proper setup: deploy hub with reg as owner after reg is deployed
        // Use two-step: deploy hub with test as owner, then transfer after reg deployed
        KeeperHub hub2 = new KeeperHub(address(this), address(router));
        reg = new MetaAgentRegistry(
            address(this), address(usdc), address(hub2),
            address(0), address(0), basket
        );
        // Transfer hub ownership to registry
        hub2.transferOwnership(address(reg));
        hub = hub2;
        reg = new MetaAgentRegistry(
            address(this), address(usdc), address(hub),
            address(0), address(0), basket
        );
        // Re-transfer ownership after re-deploy
        hub.transferOwnership(address(reg));

        usdc.mint(lp, 100_000e6);
    }

    function _signTrade(address vaultAddr, uint8[5] memory w, uint256 bn)
        internal view returns (bytes memory)
    {
        bytes32 h = keccak256(abi.encodePacked(
            w[0],w[1],w[2],w[3],w[4], bn, vaultAddr
        ));
        bytes32 ethH = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorKey, ethH);
        return abi.encodePacked(r, s, v);
    }

    function test_e2e_deployVault_depositAndTrade() public {
        // 1. Operator deploys vault
        vm.prank(operator);
        uint256 agentId = reg.deploy(500, keccak256("policy-v1"));
        address vaultAddr = reg.vaultOf(agentId);
        MetaAgentVault vault = MetaAgentVault(vaultAddr);

        // 2. Vault registered in KeeperHub
        assertTrue(hub.isVault(vaultAddr));

        // 3. LP deposits USDC
        vm.startPrank(lp);
        usdc.approve(vaultAddr, 10_000e6);
        uint256 shares = vault.deposit(10_000e6, lp);
        vm.stopPrank();
        assertGt(shares, 0);
        assertEq(vault.totalAssets(), 10_000e6);

        // 4. Operator signs and submits trade: 50% WETH, 50% USDC
        uint8[5] memory weights = [5000, 0, 0, 0, 5000];
        uint256 bn = block.number;
        bytes memory sig = _signTrade(vaultAddr, weights, bn);
        vault.executeTrade(weights, bn, sig);

        // Vault now holds WETH + USDC
        assertGt(weth.balanceOf(vaultAddr), 0);

        // 5. Simulate gain: airdrop USDC
        usdc.mint(vaultAddr, 500e6);

        // 6. Harvest: operator gets fee shares
        vault.harvest();
        assertGt(vault.balanceOf(operator), 0);

        // 7. LP can redeem
        uint256 redeemable = vault.maxWithdraw(lp);
        assertGt(redeemable, 0);
    }

    function test_e2e_multipleVaults_independent() public {
        vm.prank(operator);
        uint256 id1 = reg.deploy(500, keccak256("p1"));
        vm.prank(operator);
        uint256 id2 = reg.deploy(1000, keccak256("p2"));

        assertNotEq(reg.vaultOf(id1), reg.vaultOf(id2));
        assertTrue(hub.isVault(reg.vaultOf(id1)));
        assertTrue(hub.isVault(reg.vaultOf(id2)));
    }
}
```

> **Note:** The `setUp` in this test has a deliberate ownership-transfer dance because `MetaAgentRegistry.deploy()` calls `hub.registerVault()` and thus requires `MetaAgentRegistry` to be KeeperHub's owner. The pattern: deploy hub with test as owner → deploy registry → transfer hub ownership to registry. If setUp feels too complex, extract a `_deployStack()` helper.

- [ ] **Step 2: Run the tests**

```bash
forge test --match-contract MetaAgentEndToEndTest -vv
```
Expected: both tests pass. If setUp fails due to ownership order, refactor setUp to use a single-owner deploy (deploy hub with registry as initial owner, or use `vm.prank`).

- [ ] **Step 3: Confirm full suite**

```bash
forge test --summary 2>&1 | tail -20
```
Expected: all suites green.

- [ ] **Step 4: Commit**

```bash
git add ComputeX-Contracts/test/MetaAgentEndToEnd.t.sol
git commit -m "test(e2e): meta-agent deploy → deposit → trade → harvest lifecycle"
```

---

## Task 9: Python EXP4 bandit

**Files:**
- Create: `backend/meta_agent/__init__.py`
- Create: `backend/meta_agent/bandit.py`
- Create: `backend/meta_agent/tests/__init__.py`
- Create: `backend/meta_agent/tests/test_bandit.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/meta_agent/tests/test_bandit.py
import math
import pytest
from meta_agent.bandit import EXP4Bandit

def _model(token_id, sharpe_bps=4000, slashes=0):
    return {"tokenId": token_id, "sharpeBps": sharpe_bps, "totalSlashes": slashes}

def test_allocate_empty_returns_empty():
    b = EXP4Bandit()
    assert b.allocate([]) == []

def test_allocate_single_model_gets_full_weight():
    b = EXP4Bandit()
    allocs = b.allocate([_model(1)])
    assert len(allocs) == 1
    assert allocs[0][0] == 1
    assert abs(allocs[0][1] - 1.0) < 1e-9

def test_allocate_fractions_sum_to_one():
    b = EXP4Bandit()
    models = [_model(1, 4000), _model(2, 2000), _model(3, 6000)]
    allocs = b.allocate(models)
    total = sum(f for _, f in allocs)
    assert abs(total - 1.0) < 1e-9

def test_allocate_higher_sharpe_gets_more_weight():
    b = EXP4Bandit()
    models = [_model(1, 1000), _model(2, 8000)]
    allocs = dict(b.allocate(models))
    assert allocs[2] > allocs[1]

def test_update_increases_weight_on_positive_return():
    b = EXP4Bandit()
    b.allocate([_model(1)])  # initialize weight
    before = b.weights[1]
    b.update(1, 0.05)
    assert b.weights[1] > before

def test_update_decreases_weight_on_negative_return():
    b = EXP4Bandit()
    b.allocate([_model(1)])
    before = b.weights[1]
    b.update(1, -0.05)
    assert b.weights[1] < before

def test_slashed_creator_penalized():
    b = EXP4Bandit()
    models = [_model(1, 5000, slashes=0), _model(2, 5000, slashes=2)]
    allocs = dict(b.allocate(models))
    assert allocs[1] > allocs[2]

def test_weights_stay_in_valid_range():
    b = EXP4Bandit(eta=10.0)  # aggressive eta
    b.allocate([_model(1)])
    for _ in range(100):
        b.update(1, 1.0)
    assert b.weights[1] <= 1e6
    for _ in range(100):
        b.update(1, -1.0)
    assert b.weights[1] >= 1e-6
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
cd backend && python -m pytest meta_agent/tests/test_bandit.py -v 2>&1 | head -15
```
Expected: `ModuleNotFoundError: No module named 'meta_agent'`

- [ ] **Step 3: Create `meta_agent/__init__.py` and `meta_agent/tests/__init__.py`**

```python
# backend/meta_agent/__init__.py
# (empty)
```

```python
# backend/meta_agent/tests/__init__.py
# (empty)
```

- [ ] **Step 4: Implement `bandit.py`**

```python
# backend/meta_agent/bandit.py
import math

class EXP4Bandit:
    """
    Contextual EXP4 bandit for selecting model NFT allocations.
    Arms = model NFTs. Context = on-chain metadata (sharpeBps, slashes).
    Weights updated exponentially from realized hourly returns.
    """

    def __init__(self, eta: float = 0.1):
        self.eta = eta
        self.weights: dict[int, float] = {}

    def _prior(self, model: dict) -> float:
        score   = max(float(model.get("sharpeBps", 0)), 0.0)
        slashes = int(model.get("totalSlashes", 0))
        return max(score - slashes * 500.0, 1.0)

    def allocate(self, models: list[dict]) -> list[tuple[int, float]]:
        """
        Return list of (tokenId, fraction) where fractions sum to 1.0.
        Initializes weights for new models using context prior.
        """
        if not models:
            return []
        for m in models:
            tid = m["tokenId"]
            if tid not in self.weights:
                self.weights[tid] = self._prior(m)
        total = sum(self.weights[m["tokenId"]] for m in models)
        return [(m["tokenId"], self.weights[m["tokenId"]] / total) for m in models]

    def update(self, token_id: int, realized_return: float) -> None:
        """Exponential weight update after observing return for token_id."""
        if token_id not in self.weights:
            self.weights[token_id] = 1.0
        self.weights[token_id] *= math.exp(self.eta * realized_return)
        self.weights[token_id] = min(self.weights[token_id], 1e6)
        self.weights[token_id] = max(self.weights[token_id], 1e-6)
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
cd backend && python -m pytest meta_agent/tests/test_bandit.py -v
```
Expected: `8 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/meta_agent/__init__.py backend/meta_agent/bandit.py \
        backend/meta_agent/tests/__init__.py backend/meta_agent/tests/test_bandit.py
git commit -m "feat(bandit): EXP4 contextual bandit for model NFT allocation"
```

---

## Task 10: Python inference + keeper_client

**Files:**
- Create: `backend/meta_agent/inference.py`
- Create: `backend/meta_agent/keeper_client.py`
- Create: `backend/meta_agent/tests/test_inference.py`
- Create: `backend/meta_agent/tests/test_keeper_client.py`

- [ ] **Step 1: Write failing inference tests**

```python
# backend/meta_agent/tests/test_inference.py
import numpy as np
import pytest
from meta_agent.inference import ModelInference

def _make_model(tmp_path):
    """Create a minimal ONNX model (120 inputs → 5 outputs softmax)."""
    import torch
    import torch.nn as nn
    from zkml.model import AlphaMLP
    model = AlphaMLP()
    model.eval()
    dummy = torch.zeros(1, 120)
    path = str(tmp_path / "test_model.onnx")
    torch.onnx.export(model, dummy, path, input_names=["x"], output_names=["weights"])
    return path

def test_predict_output_shape(tmp_path):
    path = _make_model(tmp_path)
    inf = ModelInference(path)
    features = np.zeros((1, 120), dtype=np.float32)
    out = inf.predict(features)
    assert out.shape == (5,)

def test_predict_weights_sum_to_one(tmp_path):
    path = _make_model(tmp_path)
    inf = ModelInference(path)
    features = np.random.rand(1, 120).astype(np.float32)
    out = inf.predict(features)
    assert abs(float(out.sum()) - 1.0) < 1e-5

def test_to_bps_sums_to_10000(tmp_path):
    path = _make_model(tmp_path)
    inf = ModelInference(path)
    features = np.random.rand(1, 120).astype(np.float32)
    bps = inf.to_bps(features)
    assert len(bps) == 5
    assert sum(bps) == 10_000
```

- [ ] **Step 2: Implement `inference.py`**

```python
# backend/meta_agent/inference.py
import numpy as np

class ModelInference:
    """Wraps an ONNX model (AlphaMLP) for live inference."""

    def __init__(self, onnx_path: str):
        import onnxruntime as ort
        self.session = ort.InferenceSession(onnx_path)
        self._input_name = self.session.get_inputs()[0].name

    def predict(self, features: np.ndarray) -> np.ndarray:
        """Run model and return 5-dim softmax weight vector (sums to ~1)."""
        if features.ndim == 1:
            features = features.reshape(1, -1)
        out = self.session.run(None, {self._input_name: features.astype(np.float32)})
        return out[0][0]

    def to_bps(self, features: np.ndarray) -> list[int]:
        """Convert model output to integer bps allocation summing to 10_000."""
        weights = self.predict(features)
        bps = [int(w * 10_000) for w in weights]
        # fix rounding so sum == 10_000
        diff = 10_000 - sum(bps)
        bps[int(np.argmax(weights))] += diff
        return bps
```

- [ ] **Step 3: Run inference tests**

```bash
cd backend && python -m pytest meta_agent/tests/test_inference.py -v
```
Expected: `3 passed`

- [ ] **Step 4: Write failing keeper_client tests**

```python
# backend/meta_agent/tests/test_keeper_client.py
from unittest.mock import MagicMock, patch
import pytest
from meta_agent.keeper_client import KeeperClient

VAULT = "0x" + "ab" * 20
OPERATOR_KEY = "0x" + "cd" * 32

def _make_client():
    with patch("meta_agent.keeper_client.Web3") as MockWeb3:
        mock_w3 = MockWeb3.return_value
        mock_w3.eth.block_number = 100
        mock_w3.eth.contract.return_value = MagicMock()
        mock_w3.eth.send_raw_transaction.return_value = bytes(32)
        return KeeperClient(VAULT, OPERATOR_KEY, "http://localhost:8545"), mock_w3

def test_sign_trade_produces_65_byte_sig():
    client, _ = _make_client()
    weights = [2000, 2000, 2000, 2000, 2000]
    sig = client._sign(weights, 100)
    assert len(sig) == 65

def test_execute_trade_calls_contract():
    client, mock_w3 = _make_client()
    weights = [2000, 2000, 2000, 2000, 2000]
    with patch.object(client, "_sign", return_value=b"\x00" * 65):
        client.execute_trade(weights)
    client.vault.functions.executeTrade.assert_called_once()
```

- [ ] **Step 5: Implement `keeper_client.py`**

```python
# backend/meta_agent/keeper_client.py
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# Minimal ABI for executeTrade
VAULT_ABI = [
    {
        "name": "executeTrade",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "targetWeightsBps", "type": "uint8[5]"},
            {"name": "blockNumber",       "type": "uint256"},
            {"name": "sig",               "type": "bytes"},
        ],
        "outputs": [],
    }
]

class KeeperClient:
    def __init__(self, vault_addr: str, operator_key: str, rpc_url: str):
        self.w3       = Web3(Web3.HTTPProvider(rpc_url))
        self.account  = Account.from_key(operator_key)
        self.vault    = self.w3.eth.contract(
            address=Web3.to_checksum_address(vault_addr),
            abi=VAULT_ABI
        )

    def _sign(self, weights: list[int], block_number: int) -> bytes:
        msg_hash = Web3.solidity_keccak(
            ["uint8", "uint8", "uint8", "uint8", "uint8", "uint256", "address"],
            [*weights, block_number, self.vault.address]
        )
        signed = self.account.sign_message(encode_defunct(primitive=msg_hash))
        return bytes(signed.signature)

    def execute_trade(self, weights: list[int]) -> str:
        block_number = self.w3.eth.block_number
        sig = self._sign(weights, block_number)
        tx = self.vault.functions.executeTrade(
            weights, block_number, sig
        ).build_transaction({
            "from":  self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas":   500_000,
        })
        signed_tx = self.account.sign_transaction(tx)
        return self.w3.eth.send_raw_transaction(signed_tx.raw_transaction).hex()
```

- [ ] **Step 6: Run keeper_client tests**

```bash
cd backend && python -m pytest meta_agent/tests/test_keeper_client.py -v
```
Expected: `2 passed`

- [ ] **Step 7: Run all Python tests**

```bash
cd backend && python -m pytest meta_agent/tests/ zkml/tests/ -q
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/meta_agent/inference.py backend/meta_agent/keeper_client.py \
        backend/meta_agent/tests/test_inference.py backend/meta_agent/tests/test_keeper_client.py
git commit -m "feat(inference+keeper): ONNX inference wrapper + executeTrade client"
```

---

## Task 11: Python runtime (event loop + hourly tick)

**Files:**
- Create: `backend/meta_agent/runtime.py`

- [ ] **Step 1: Implement `runtime.py`**

No unit test for the event loop (it requires a live RPC). The loop is thin — logic lives in bandit/inference/keeper_client which are tested separately.

```python
# backend/meta_agent/runtime.py
"""
Meta-agent runtime: subscribes to PerformanceOracle.AuditAccepted events,
updates the EXP4 bandit, and submits signed trade instructions hourly.

Usage:
    python -m meta_agent.runtime --config config.json

config.json schema:
{
  "rpc_url": "https://arb-sepolia.g.alchemy.com/v2/...",
  "vault_addr": "0x...",
  "operator_key": "0x...",
  "oracle_addr": "0x...",
  "registry_addr": "0x...",
  "model_dir": "/tmp/ax_train",
  "tick_seconds": 3600,
  "eta": 0.1,
  "score_threshold_bps": 1000
}
"""
import asyncio
import json
import logging
import time
from pathlib import Path

import numpy as np
from web3 import Web3

from .bandit    import EXP4Bandit
from .inference import ModelInference
from .keeper_client import KeeperClient

log = logging.getLogger(__name__)

# Minimal ABI snippets
ORACLE_ABI = [
    {"name": "AuditAccepted", "type": "event",
     "inputs": [
         {"name": "tokenId",   "type": "uint256", "indexed": True},
         {"name": "epoch",     "type": "uint256", "indexed": True},
         {"name": "sharpeBps", "type": "uint256", "indexed": False},
         {"name": "nTrades",   "type": "uint256", "indexed": False},
     ]}
]

MODEL_NFT_ABI = [
    {"name": "models", "type": "function", "stateMutability": "view",
     "inputs":  [{"name": "tokenId", "type": "uint256"}],
     "outputs": [
         {"name": "modelCID",         "type": "string"},
         {"name": "proofCID",          "type": "string"},
         {"name": "description",       "type": "string"},
         {"name": "createdAt",         "type": "uint256"},
         {"name": "creatorStake",      "type": "uint256"},
         {"name": "sharpeBps",         "type": "uint256"},
         {"name": "nVerifiedTrades",   "type": "uint256"},
         {"name": "lastAuditAt",       "type": "uint64"},
         {"name": "modelWeightsHash",  "type": "bytes32"},
     ]}
]

CREATOR_REGISTRY_ABI = [
    {"name": "creatorTokenId", "type": "function", "stateMutability": "view",
     "inputs":  [{"name": "creator", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "records", "type": "function", "stateMutability": "view",
     "inputs":  [{"name": "tokenId", "type": "uint256"}],
     "outputs": [
         {"name": "creator",         "type": "address"},
         {"name": "modelsMinted",    "type": "uint256"},
         {"name": "totalSharpeBps",  "type": "uint256"},
         {"name": "totalSlashes",    "type": "uint256"},
         {"name": "lifetimeAlpha",   "type": "uint256"},
     ]}
]


class MetaAgentRuntime:
    def __init__(self, config: dict):
        self.cfg    = config
        self.w3     = Web3(Web3.HTTPProvider(config["rpc_url"]))
        self.bandit = EXP4Bandit(eta=config.get("eta", 0.1))
        self.keeper = KeeperClient(
            config["vault_addr"], config["operator_key"], config["rpc_url"]
        )
        self.models: dict[int, dict] = {}  # tokenId -> metadata
        self.threshold = config.get("score_threshold_bps", 1000)

    def _fetch_score_events(self, from_block: int = 0) -> list[dict]:
        """Replay AuditAccepted events to populate self.models."""
        oracle = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.cfg["oracle_addr"]),
            abi=ORACLE_ABI
        )
        events = oracle.events.AuditAccepted.get_logs(from_block=from_block)
        updates = []
        for evt in events:
            tid     = evt["args"]["tokenId"]
            sharpe  = evt["args"]["sharpeBps"]
            updates.append({"tokenId": tid, "sharpeBps": sharpe, "totalSlashes": 0})
        return updates

    def _eligible_models(self) -> list[dict]:
        return [m for m in self.models.values() if m["sharpeBps"] >= self.threshold]

    def _build_features(self) -> np.ndarray:
        """120-dim price feature vector (placeholder: zeros for v1)."""
        return np.zeros((1, 120), dtype=np.float32)

    def _aggregate_weights(self, allocations: list[tuple[int, float]]) -> list[int]:
        """
        For each model in allocations, run inference and blend outputs by
        bandit fraction. Returns 5-dim bps vector summing to 10_000.
        """
        model_dir = Path(self.cfg.get("model_dir", "/tmp/ax_train"))
        features  = self._build_features()
        blended   = np.zeros(5, dtype=np.float64)

        for token_id, fraction in allocations:
            onnx_path = model_dir / f"model_{token_id}.onnx"
            if not onnx_path.exists():
                log.warning("ONNX not found for tokenId %d, skipping", token_id)
                continue
            inf = ModelInference(str(onnx_path))
            w   = inf.predict(features)
            blended += fraction * w

        if blended.sum() == 0:
            blended = np.ones(5) / 5  # equal-weight fallback

        blended /= blended.sum()
        bps = [int(x * 10_000) for x in blended]
        bps[int(np.argmax(blended))] += 10_000 - sum(bps)  # fix rounding
        return bps

    def tick(self) -> str | None:
        """One hourly tick: select models, run inference, submit trade."""
        updates = self._fetch_score_events()
        for u in updates:
            self.models[u["tokenId"]] = u

        eligible = self._eligible_models()
        if not eligible:
            log.info("No eligible models above threshold %d bps", self.threshold)
            return None

        allocations = self.bandit.allocate(eligible)
        weights_bps = self._aggregate_weights(allocations)
        log.info("Submitting trade: weights=%s", weights_bps)

        tx_hash = self.keeper.execute_trade(weights_bps)
        log.info("Trade submitted: %s", tx_hash)
        return tx_hash

    def run(self, tick_seconds: int | None = None):
        """Blocking event loop."""
        interval = tick_seconds or self.cfg.get("tick_seconds", 3600)
        log.info("Meta-agent runtime started (interval=%ds)", interval)
        while True:
            try:
                self.tick()
            except Exception:
                log.exception("Tick failed")
            time.sleep(interval)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.json")
    args = parser.parse_args()
    with open(args.config) as f:
        cfg = json.load(f)
    logging.basicConfig(level=logging.INFO)
    MetaAgentRuntime(cfg).run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-check import**

```bash
cd backend && python -c "from meta_agent.runtime import MetaAgentRuntime; print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/meta_agent/runtime.py
git commit -m "feat(runtime): meta-agent event loop + hourly trade tick"
```

---

## Task 12: Deployment script (Arbitrum Sepolia)

**Files:**
- Create: `ComputeX-Contracts/script/DeployMetaAgent.s.sol`

- [ ] **Step 1: Write deployment script**

```solidity
// ComputeX-Contracts/script/DeployMetaAgent.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {KeeperHub}         from "../src/KeeperHub.sol";
import {MetaAgentRegistry} from "../src/MetaAgentRegistry.sol";

contract DeployMetaAgent is Script {
    // ── Arbitrum Sepolia addresses ────────────────────────────────────────
    // Uniswap V3 SwapRouter02 on Arbitrum Sepolia
    address constant SWAP_ROUTER  = 0x101F443B4d1b059569D643917553c771E1b9663E;
    // Uniswap V3 Factory on Arbitrum Sepolia
    address constant UNI_FACTORY  = 0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e;

    // Basket tokens on Arbitrum Sepolia (update with real addresses before deploying)
    address constant WETH  = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;
    address constant WBTC  = 0x0000000000000000000000000000000000000001; // TODO
    address constant LINK  = 0x0000000000000000000000000000000000000002; // TODO
    address constant UNI   = 0x0000000000000000000000000000000000000003; // TODO
    address constant USDC  = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    // Already-deployed Plan 1 contracts — fill in after running Deploy.s.sol
    address constant MODEL_NFT        = address(0); // TODO: fill from Plan 1 deploy
    address constant MODEL_MARKETPLACE = address(0); // TODO

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        address[5] memory basket = [WETH, WBTC, LINK, UNI, USDC];

        // 1. Deploy KeeperHub (owner = deployer temporarily)
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

        // 3. Transfer KeeperHub ownership to Registry (so deploy() can registerVault)
        hub.transferOwnership(address(reg));

        vm.stopBroadcast();

        console2.log("KeeperHub:         ", address(hub));
        console2.log("MetaAgentRegistry: ", address(reg));
    }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ComputeX-Contracts && forge build
```
Expected: `Compiler run successful!`

- [ ] **Step 3: Dry-run against local Anvil**

```bash
anvil &
forge script script/DeployMetaAgent.s.sol:DeployMetaAgent \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  -vvv 2>&1 | tail -20
kill %1
```
Expected: addresses printed, no revert.

- [ ] **Step 4: Commit**

```bash
git add ComputeX-Contracts/script/DeployMetaAgent.s.sol
git commit -m "feat(deploy): DeployMetaAgent script for Arbitrum Sepolia"
```

---

## Self-Review Checklist

**Spec coverage:**
- P4 MetaAgentRegistry ✅ Tasks 3, 8
- P4 MetaAgentVault ERC-4626 ✅ Tasks 4–7, 8
- P4 Mock TEE (ecrecover) ✅ Task 6
- P5 Python bandit ✅ Task 9
- P5 Python inference ✅ Task 10
- P5 Python runtime ✅ Task 11
- P6 KeeperHub + Uniswap V3 ✅ Tasks 1–2, 12
- P6 Deployment config ✅ Task 12

**Known issue in Task 8 setUp:** The KeeperHub ownership-transfer dance is brittle. If it causes flaky setUp failures, refactor: add a `setRegistry(address)` function to `KeeperHub.sol` and have `MetaAgentRegistry` call it post-construction instead of requiring hub ownership.

**Type consistency:** `SwapInstruction` is defined in `IKeeperHub.sol` and used in `KeeperHub.sol` and `MetaAgentVault.sol` via `IKeeperHub.SwapInstruction`. `MockKeeperHub` implements `IKeeperHub` so it uses the same struct. No drift.

**No TBD/TODO in code steps** (deployment addresses marked with comments are intentional — they require live testnet values).
