# AlphaTrade — Meta-Agent Marketplace Design

**Status:** Draft v1
**Date:** 2026-04-28
**Authors:** Pushkaraj, Atharva
**Branch in scope:** new work on top of `main` @ `4f5f5b3` (existing contracts + orchestrator + frontend)

---

## 1. One-paragraph pitch

AlphaTrade is a marketplace for **tokenized AI trading alpha**. GPU providers rent compute (cloud-backed via Render/RunPod/Modal). Renters train small ML models on signed historical price data, get a **zk-audited performance score**, and mint the model as an ERC-7857 iNFT. Anyone can deploy a **meta-agent** — an autonomous on-chain agent whose job is to read scores, buy underpriced high-performance model NFTs, run them inside an attested execution environment, and trade a basket of tokens on Uniswap V3. Meta-agents are themselves scored, ranked, and tradable. The result is a self-organizing market where AI strategies compete for capital and other agents arbitrage them — a fund-of-funds where every layer is on chain.

The novel contribution: an autonomous, permissionless market for tokenized strategies in which the *buyers* are themselves agents. No prior art (verified, see §11).

---

## 2. Non-goals

To prevent scope creep:

- No real Phala/Marlin TEE enclave for v1 — the execution attestation is a hot-key signed message, architected as a drop-in replacement.
- No L1 mainnet deployment. 0G testnet + Sepolia (or Arbitrum Sepolia) for Uniswap.
- No transformer-class models. Models are capped at ~10k parameters so EZKL audit proofs remain tractable.
- No order book or AMM for the model marketplace. Fixed-price listings stay.
- No off-chain order matching for trades. KeeperHub → Uniswap V3 only.
- No real GPU mining or decentralized compute network. Providers are cloud-backed.
- No ERC-20 payment paths. ETH only.

---

## 3. Architecture overview

```
                     ┌──────────────────────────────────────┐
                     │          Frontend (Next.js)          │
                     │  marketplace · agent dashboards · LP │
                     └──────────────────┬───────────────────┘
                                        │
   ┌────────────────────────────────────┼─────────────────────────────────────┐
   │                                ON-CHAIN (0G testnet for protocol,        │
   │                                 Sepolia for Uniswap V3 settlement)       │
   │                                                                          │
   │   GPUMarketplace ── JobCreated ───────────► (off-chain orchestrator)     │
   │      ▲                       ▲                                           │
   │      │ rent / completeJob    │ consumeMintRight                          │
   │      │                       │                                           │
   │   ModelNFT (ERC-7857) ◄──────┘                                           │
   │      │  performanceScore, creatorStake, modelCID, proofCID               │
   │      │                                                                   │
   │      ▼                                                                   │
   │   PerformanceOracle ──── verifies EZKL proof, writes score ───┐          │
   │      ▲                                                        │          │
   │      │ daily zk audit submission                              │          │
   │      │                                                        ▼          │
   │   ModelMarketplace ◄───── buy/sell model NFTs ──────► CreatorRegistry    │
   │      ▲                                                  (SBT track       │
   │      │ buys/relists                                      record)         │
   │      │                                                                   │
   │   MetaAgentRegistry ◄── deploys ── MetaAgentVault (per agent)            │
   │                                       │                                  │
   │                                       │ deposit / withdraw               │
   │                                       │ executeTrade(signedDecision)     │
   │                                       │                                  │
   └───────────────────────────────────────┼──────────────────────────────────┘
                                           │
                                  ┌────────┴────────┐
                                  │  KeeperHub      │
                                  │  → Uniswap V3   │
                                  └─────────────────┘

   ┌──────────────────────────────────────────────────────────────────────────┐
   │                              OFF-CHAIN                                   │
   │                                                                          │
   │  Orchestrator (Node):  watches JobCreated → calls Render API             │
   │  Render container:     train.py (small MLP) + prove.py (EZKL)            │
   │  0G Storage:           model weights + proof artifacts                   │
   │                                                                          │
   │  Meta-agent runtime (Python):                                            │
   │    - subscribes to PerformanceOracle.ScoreUpdated events                 │
   │    - runs EXP4 contextual bandit over registered models                  │
   │    - hourly: loads models → "TEE" inference → signs decision             │
   │    - submits to MetaAgentVault.executeTrade()                            │
   │                                                                          │
   │  Pyth/Chainlink:    signed price feeds for trading and for backtests     │
   └──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Components

### 4.1 GPUMarketplace.sol — *existing, unchanged*

Already implemented (`ComputeX-Contracts/src/GPUMarketplace.sol`, 309 LOC, 32 passing tests). No changes required.

The only change is **off-chain**: the provider orchestrator gains a Render-backed compute adapter (see §4.10).

### 4.2 ModelNFT.sol — *existing, minor extension*

Today: ERC-7857-style iNFT with `modelCID`, `proofCID`, `performanceScore`, mint guarded by `consumeMintRight`.

Add (additive, won't break tests):

```solidity
struct ModelMeta {
    string  modelCID;        // existing
    string  proofCID;        // existing
    uint256 performanceScore;// existing
    uint256 creatorStake;    // NEW: ETH locked at mint, slashable
    uint256 sharpeBps;       // NEW: 100 * Sharpe ratio, basis points
    uint256 nVerifiedTrades; // NEW: trades covered by latest zk audit
    uint64  lastAuditAt;     // NEW: block.timestamp of last score update
}
```

`creatorStake` is set by `mintModel(...)` from `msg.value`. Stake is held by the contract until released (see §4.6 slashing).

`setPerformanceScore` becomes callable **only by `PerformanceOracle`** (currently any owner). Score updates flow exclusively through verified zk proofs.

### 4.3 ModelMarketplace.sol — *existing, unchanged*

Already implemented (5% royalty + 2.5% protocol fee, 27 tests). No code changes; meta-agents are just one more category of buyer/seller.

### 4.4 PerformanceOracle.sol — *NEW*

Interface:

```solidity
interface IPerformanceOracle {
    /// Submit an EZKL audit proof for a model's recent trading window.
    /// Public inputs include: tokenId, pnlBps, sharpeBps, nTrades,
    /// priceFeedMerkleRoot, modelWeightsHash.
    function submitAudit(
        uint256 tokenId,
        bytes calldata snarkProof,
        uint256[] calldata publicInputs
    ) external;

    /// Slash creator stake if claimed score (off-chain) and on-chain
    /// verified score diverge beyond `slashTolerance`.
    function slash(uint256 tokenId, address slasher) external;

    function slashTolerance() external view returns (uint256); // bps
    function priceFeedRoot(uint256 epoch) external view returns (bytes32);
}
```

**Verifier:** generated by EZKL from a fixed circuit committed at deployment. The circuit takes:
- public: `pnlBps`, `sharpeBps`, `nTrades`, `priceFeedMerkleRoot`, `modelWeightsHash`
- private: model weights, trade log, price-feed leaves

and proves: "running these weights against this signed price feed produces this trade log with this realized P&L".

**Gas:** protocol pays via a small fee-pool wallet funded from the 2.5% marketplace fee. Scale path: aggregate N proofs into one verification call (Halo2 → Plonk aggregation, plonky3 verifier on-chain). Architecture supports this from day one because `submitAudit` is a single function the protocol can re-implement against an aggregating verifier without breaking callers.

**Slashing:** anyone can submit a contradicting proof on the same epoch's price feed. If it diverges beyond `slashTolerance` (e.g. 200 bps Sharpe difference), the original creator's stake is split: 80% to slasher (incentive), 20% burned.

### 4.5 CreatorRegistry.sol — *NEW*

Soulbound, non-transferable. One token per creator address (lazy-minted on first model mint).

```solidity
struct CreatorRecord {
    uint256 modelsMinted;
    uint256 totalSharpeBps;     // sum across models
    uint256 totalSlashes;
    uint256 lifetimeAlphaBps;   // weighted by stake
}
```

Marketplace UI displays `creator.eth` (ENS) + their `CreatorRecord` next to every listing. Models authored by a previously-slashed creator are flagged.

### 4.6 MetaAgentRegistry.sol + MetaAgentVault.sol — *NEW (the headline)*

**`MetaAgentRegistry`** is itself an ERC-721. Calling `deploy(...)` clones a `MetaAgentVault` and mints a registry NFT to the deployer; the NFT represents **operator rights** over that vault (the right to call `executeTrade`, `buyModel`, `relistModel`, and to receive the operator share of fees). Transferring the registry NFT transfers operator rights — this is the recursion: meta-agents themselves are tradable NFTs.

The vault itself is **ERC-4626**, where shares represent LP claims on the vault's USDC + held-model-NFTs portfolio. The two token types are distinct: registry NFT = operator rights (one per vault), ERC-4626 shares = LP claims (fungible).

```solidity
contract MetaAgentVault is ERC4626 /* shares are LP tokens */ {
    address public registry;     // MetaAgentRegistry; canonical operator = NFT holder
    bytes32 public policyHash;   // commitment: keccak256 of published runtime + IPFS CID
    uint16  public perfFeeBps;   // performance fee, capped at 2000

    modifier onlyOperator() {
        require(msg.sender == IERC721(registry).ownerOf(vaultId), "not operator");
        _;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);

    /// Buy a model NFT into this vault's portfolio.
    function buyModel(uint256 tokenId, uint256 maxPrice) external onlyOperator;

    /// Sell or relist a model NFT held by this vault.
    function relistModel(uint256 tokenId, uint256 price) external onlyOperator;

    /// Execute a basket trade. Called once per cadence with a signed
    /// decision blob from the operator's "TEE-attested" runtime.
    /// Signature path:
    ///   - mock for v1: ecrecover(operator)
    ///   - real later:  Phala enclave attestation verification
    function executeTrade(
        uint8[5] calldata targetWeightsBps, // sums to 10_000
        bytes calldata attestation
    ) external;

    /// Pulled hourly to materialize realized P&L into share price.
    function harvest() external;
}
```

The on-chain bandit *policy* is left off-chain (in the operator's runtime) — the contract just enforces fund flows, fees, and execution rights. The `policyHash` commits to the runtime code so depositors can verify what policy they're depositing into.

**Meta-agent reputation:** a parallel `MetaAgentScore` mapping (lifetime Sharpe, AUM, drawdown) accrues automatically from `harvest()` and is queryable like a model's score. Frontend leaderboards rank vaults.

**Meta-agents are themselves tradable.** Selling the parent ERC-721 transfers operator rights and the perf-fee stream to a new owner. (Optional in v1 — the contract supports it, the UI can defer.)

### 4.7 Trading universe and price feed

Locked: **WETH / wBTC / LINK / UNI / USDC** on Uniswap V3 testnet. USDC is the cash leg. Models output a 5-vector of target weights summing to 10_000 bps.

Price feed:
- **Live trading:** Pyth pull-based feed on the trading chain. Sub-second updates.
- **Backtest / zk audit:** signed Merkle commitment to an OHLCV history (1h bars, last 90 days). The price-feed Merkle root is published per epoch by the oracle and is a public input to the EZKL proof. This stops a creator from training on cherry-picked synthetic data.

### 4.8 Model class

**Small MLP, 64 → 32 → 5, ReLU, ~3.4k params, exported to ONNX.** Inputs: rolling features (returns, vol, momentum) over 24 hourly bars × 5 tokens = 120 features. Output: 5-dim weight vector through a softmax.

This shape is verified to prove in EZKL in <30s on a consumer laptop and to verify in ~500k gas on EVM. (Source: EZKL benchmarks May 2024, ref [5].)

### 4.9 Cadence

**Hourly rebalance.** Per-block is MEV-vulnerable and burns gas without alpha at this model class. Daily loses demo feel.

Audit cadence: **daily** zk-proof submission per active model (covers the previous 24 hourly trades).

### 4.10 Render-backed compute adapter

Off-chain only. New `backend/src/compute/render-adapter.ts`:

```ts
interface ComputeBackend {
  startJob(spec: JobSpec): Promise<JobHandle>;
  awaitArtifacts(handle: JobHandle): Promise<{ weightsPath: string; logsPath: string }>;
}
```

Implementations: `RenderBackend`, later `RunPodBackend`, `LocalBackend`. The orchestrator picks one based on env config; the protocol layer is unaware. For the demo, one Render GPU instance ($1–3/hr, billed by the second) covers all training runs.

---

## 5. Verification architecture (the dual-trust)

```
   ┌──────────────────────────────────────────────────────────────┐
   │                       SCORE LAYER (slow)                     │
   │                                                              │
   │   creator   ──ezkl prove──►   PerformanceOracle              │
   │      │       (off-chain,      verifyProof + updateScore      │
   │      │        ~10–30s)        gas: ~500k, paid by protocol   │
   │      │                                                       │
   │      └─► score is cryptographically sound                    │
   │          (slashable if challenged with stronger proof)       │
   └──────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────┐
   │                   EXECUTION LAYER (fast)                     │
   │                                                              │
   │   meta-agent ──signed decision──► MetaAgentVault             │
   │      │        (TEE-attested in    .executeTrade()            │
   │      │         prod, hot-key sig  → KeeperHub → Uniswap      │
   │      │         in v1)             ~sub-second                │
   │      │                                                       │
   │      └─► trust assumption: TEE provider honest               │
   │          (bounded, not cryptographic)                        │
   └──────────────────────────────────────────────────────────────┘
```

The two are independent — `PerformanceOracle.verifyProof()` and `MetaAgentVault.executeTrade()` are separate code paths with separate trust assumptions. Only the combined system has the property: "the score I see is cryptographically real, and the trades that produced it ran on the model the score belongs to."

---

## 6. End-to-end flows

### 6.1 Creator path (mint a model)

1. Provider lists a GPU on `GPUMarketplace`.
2. Renter calls `rentGPU(gpuId, hours)`, locking ETH in escrow.
3. Off-chain orchestrator catches `JobCreated`, calls `RenderBackend.startJob()`.
4. Inside Render container:
   - `train.py` trains the 3.4k-param MLP on the signed price-feed history.
   - `backtest.py` runs the trained model over the last 90 days, produces a trade log.
   - `prove.py` runs EZKL to generate an audit proof for the trade log.
   - All artifacts uploaded to 0G Storage; CIDs returned.
5. Renter calls `completeJob(jobId)` → escrow released → `consumeMintRight` flips.
6. Creator calls `ModelNFT.mintModel(jobId, modelCID, proofCID)` with `msg.value = creatorStake`.
7. Creator submits zk audit via `PerformanceOracle.submitAudit(...)` → score written into ModelNFT.
8. `CreatorRegistry` lazy-mints SBT for `msg.sender` if first model.

### 6.2 Meta-agent path (deploy and operate)

1. Operator calls `MetaAgentRegistry.deploy(perfFeeBps, policyHash)` → new vault deployed; operator gets vault NFT.
2. LPs deposit USDC into vault → receive ERC-4626 shares.
3. Operator's runtime:
   - subscribes to `PerformanceOracle.ScoreUpdated` events.
   - runs EXP4 bandit over models filtered by `score > threshold && creator not slashed`.
   - calls `vault.buyModel(tokenId, maxPrice)` for picks → vault holds NFTs.
4. Hourly tick:
   - Operator runtime fetches latest Pyth prices, runs each held model, aggregates per bandit weights into a final 5-vector.
   - Runtime signs `(targetWeights, blockNumber, vaultAddr)` with operator key.
   - Calls `vault.executeTrade(targetWeights, signature)`.
   - Vault decodes, computes swap diffs against current holdings, fires KeeperHub workflow → Uniswap V3 swaps.
   - On callback, vault updates internal accounting; share price moves.
5. Daily: vault calls `harvest()` → realizes P&L into share price → updates MetaAgentScore.
6. Periodically: operator calls `vault.relistModel(...)` if a model's score drops or a better model appears.

### 6.3 Slashing path

1. Anyone (slasher) recomputes the trade log for a published model on the same epoch's price-feed Merkle root.
2. If their EZKL proof shows >`slashTolerance` divergence in Sharpe, they call `PerformanceOracle.slash(tokenId, msg.sender)`.
3. Creator's stake on that ModelNFT is split: 80% → slasher, 20% burned.
4. `CreatorRegistry` increments `totalSlashes` for the creator's SBT.
5. ModelMarketplace UI flags listings from previously-slashed creators.

---

## 7. Trust assumptions and threat model

| Assumption | What relies on it | Mitigation if it breaks |
|---|---|---|
| EZKL / Halo2 SNARK soundness | All published model scores | Cryptographic — break implies P=NP-adjacent |
| Pyth signed feed honest | Backtest data + live trading prices | Multi-source aggregation in v2 (add Chainlink redundancy) |
| Operator hot key not compromised (v1) | All trades via that meta-agent | Capped per-trade slippage; vault owner can rotate operator key; Phala enclave drop-in for v2 |
| 0G Storage availability | Model weights retrievable | Pin to IPFS as backup; orchestrator caches weights locally |
| Uniswap V3 testnet pools liquid | Trades execute without absurd slippage | Cap basket weight changes to ≤5% per hour to bound slippage |
| KeeperHub reliability | Trades land | Vault tracks expected vs realized swaps; can fall back to direct Uniswap call after N missed deadlines |

**Adversarial scenarios considered:**
- **Cherry-picked training data.** Mitigated: zk audit proof is bound to the protocol's signed price-feed Merkle root, not the creator's data.
- **Sybil minting of fake high-score models.** Mitigated: creator stake required at mint; slashing pays slasher.
- **Operator rugs vault.** Partially mitigated: operator can only call `executeTrade` (capped slippage) and `buyModel/relistModel`; cannot withdraw LP deposits directly. Worst case: bad swaps drain vault gradually.
- **Meta-agent front-runs its own model purchases.** Acceptable for v1; future: commit-reveal on `buyModel` calls.

---

## 8. Tokenomics summary

| Flow | Split |
|---|---|
| Initial NFT mint sale | 100% creator |
| NFT resale on ModelMarketplace | 92.5% seller / 5% creator royalty / 2.5% protocol |
| Vault deposit | 100% goes to working capital (no front-load fee) |
| Vault performance fee (on harvested gain) | 90% LP / 8% NFT holder / 2% protocol |
| Slashing | 80% slasher / 20% burned |
| Verification gas | Paid from protocol fee pool |

---

## 9. Implementation phases

(Detailed plan generated separately by the writing-plans skill — these are coarse milestones.)

- **P0** Spec lock (this doc).
- **P1** Real EZKL pipeline. `prove.py` becomes a real EZKL invocation on the 3.4k-param MLP. Local verifier contract generated. Replace existing stub.
- **P2** `PerformanceOracle.sol` + integration with `ModelNFT.setPerformanceScore`. Constraint: `setPerformanceScore` callable only by oracle.
- **P3** `CreatorRegistry.sol` + lazy SBT mint hook in `mintModel`.
- **P4** `MetaAgentRegistry.sol` + `MetaAgentVault.sol` (ERC-4626). Operator-signed `executeTrade`. Mock TEE.
- **P5** Off-chain meta-agent runtime (Python). EXP4 bandit. Hourly tick.
- **P6** KeeperHub workflow integration; real Uniswap V3 swaps on Sepolia.
- **P7** Render-backed compute adapter for the orchestrator.
- **P8** Frontend additions: PerformanceOracle status, vault dashboards, leaderboards, slashing UI.
- **P9** ENS integration for creator and agent identities.
- **P10** Demo polish: scripted E2E walkthrough, fallback recordings, pitch deck.

The order of P1–P5 is not strictly sequential — the contracts can be developed in parallel to the off-chain runtime since interfaces are fixed by this doc.

---

## 10. File layout (additive)

```
ComputeX-Contracts/
  src/
    PerformanceOracle.sol          NEW
    CreatorRegistry.sol            NEW
    MetaAgentRegistry.sol          NEW
    MetaAgentVault.sol             NEW
    verifiers/
      EzklVerifier.sol             NEW (generated by EZKL CLI)
  test/
    PerformanceOracle.t.sol        NEW
    CreatorRegistry.t.sol          NEW
    MetaAgentVault.t.sol           NEW

backend/
  prove.py                         REWRITE (real EZKL)
  backtest.py                      NEW
  meta_agent/                      NEW
    runtime.py                     (subscribes, runs bandit, signs trades)
    bandit.py                      (EXP4 / Corral)
    inference.py                   (loads ONNX models, runs hourly)
    keeper_client.py
  src/
    compute/
      backend.ts                   NEW (interface)
      render-adapter.ts            NEW
      local-adapter.ts             NEW

frontend/app/
  components/
    OracleStatus.tsx               NEW
    VaultDashboard.tsx             NEW
    AgentLeaderboard.tsx           NEW
    SlashingPanel.tsx              NEW
```

Existing files (`GPUMarketplace.sol`, `ModelMarketplace.sol`, orchestrator, train.py) stay; only `ModelNFT.sol` and `prove.py` see modifications.

---

## 11. Research grounding and novelty claim

The architecture composes existing primitives:

- Performance scoring of AI models on chain → **Bittensor Yuma Consensus** [10]
- Model-as-NFT wrapper → **Ocean Protocol** data NFTs (cited in research dump)
- Verifiable inference toolchain → **EZKL** [5], **ZKML paper** [4]
- Stake-and-slash for off-chain compute → **Truebit** [7], **EigenLayer** AVS pattern
- Soulbound creator reputation → **DeSoc / SBT** [8]
- Bandit-based selection from a model pool → **Corral / EXP4** [1, 2], **algorithm portfolios** [3]
- Vault composition of strategies → **Yearn V3, Enzyme** (cited in research dump)

The composition itself — **autonomous, permissionless on-chain agents that buy and sell tokenized AI strategies as NFTs while themselves being scored and tradable** — has no direct prior art per the research dump, verified across Bittensor, Ocean, SingularityNET, Gensyn, Ritual, 0G, Giza, Modulus, Yearn, Enzyme, and the relevant arxiv literature as of late 2025.

---

## 12. Open questions (to resolve before P1)

1. Which testnet for Uniswap V3 settlement: Sepolia, Arbitrum Sepolia, or Base Sepolia? (Affects KeeperHub support.)
2. Single price-feed root publisher in v1 (you / protocol multisig) vs immediate Pyth integration. Recommended: protocol-signed root in v1 backed by Pyth data, real Pyth integration in v2.
3. Bandit class: pure EXP4 (adversarial) or contextual EXP4 (uses model metadata as context). Recommended: contextual; metadata is already on-chain.
4. Slash tolerance value (Sharpe bps). Recommended: start at 200 bps, tunable via protocol governance.

---

## 13. Glossary

- **Alpha** — return in excess of a baseline (e.g. ETH HODL or basket-weighted index).
- **Sharpe ratio** — alpha per unit of return volatility.
- **EXP4** — exponential-weighting bandit algorithm for selecting from a pool of experts/policies.
- **EZKL** — open-source toolchain for compiling ONNX neural nets to Halo2 SNARKs.
- **iNFT** — "Intelligent NFT" (ERC-7857 family) — NFTs whose payload is a portable AI model.
- **SBT** — Soulbound Token, non-transferable ERC-721.
- **TEE** — Trusted Execution Environment (Intel SGX, AWS Nitro, Phala enclave).
- **Slash tolerance** — max divergence (in bps) between claimed and verified score before a model's stake is slashable.

---

*End of design doc. Implementation plan to follow via writing-plans skill.*
