# AlphaTrade — Master Plan & Status

**Date:** 2026-04-29
**Hackathon:** ETHGlobal Open Agents (weeks of runway, no hard deadline)
**Approach:** C — Autonomous meta-agents trade model NFTs and use them to trade a basket on-chain. Permissionless competing meta-agents (option ii). Protocol pays verification gas (scale trick).

---

## 1. Vision (one paragraph)

A decentralized GPU compute + AI-trading-model marketplace. GPU providers list compute on chain; users rent GPUs to train AI trading models; trained models are minted as ERC-7857 iNFTs whose performance scores are zkML-audited (EZKL Halo2). Autonomous "meta-agents" buy/sell these model NFTs and use them to trade a basket of WETH / wBTC / LINK / UNI / USDC on Uniswap via KeeperHub. A creator stake + slashing mechanism, plus a soulbound CreatorRegistry SBT, enforce honest creator behavior. Two-tier verification: zkML (slow, daily) for performance scores + TEE (fast, mocked v1) for live trades.

---

## 2. End-to-end flow

```
┌────────────┐
│  Provider  │ list GPU            ─────► GPUMarketplace
└────────────┘
                                          │ rentGPU
┌────────────┐                            ▼
│  Creator   │ rent + escrow ETH    ─────► JobCreated event
└────────────┘                            │
                                          ▼
                                   ┌─────────────────┐
                                   │  Orchestrator   │  (backend/src)
                                   │   (TS, ethers)  │
                                   └─────────────────┘
                                          │
                       train.py ◄─────────┤
                       prove.py ◄─────────┤            (Python, AlphaMLP + EZKL)
                       0G upload ◄────────┤
                                          ▼
                                   GPUMarketplace.completeJob
                                          │
                                          ▼
                                   ModelNFT.mintModel (payable, with stake)
                                          │ ───────► CreatorRegistry.recordMint
                                          ▼
                                   PerformanceOracle.submitAudit
                                          │ ── verifies SNARK
                                          │ ── checks epoch feed root + signature
                                          │ ── recomputes Sharpe on-chain (bps)
                                          ▼
                                   ModelNFT.setPerformanceScore (oracle-gated)
                                          │ ───────► CreatorRegistry.recordScore
                                          ▼
                              ┌──────────────────────────────┐
                              │  Secondary marketplace flow  │
                              └──────────────────────────────┘
                                          │
                       ModelMarketplace.list ──► ModelMarketplace.buyModel
                          (5% royalty → creator, 2.5% fee → recipient, rest → seller;
                           contract holds zero ETH between txs)
                                          │
                                          ▼
                              ┌──────────────────────────────┐
                              │  Meta-agent layer (PLANNED)  │
                              │  Plan 2 — P4–P6              │
                              └──────────────────────────────┘
                                          │
                                MetaAgentRegistry.register
                                MetaAgentVault (ERC-4626)
                                Python runtime (EXP4/Corral bandit)
                                KeeperHub → Uniswap V3 (Arbitrum Sepolia)
                                          │
                              ┌──────────────────────────────┐
                              │  Slashing path               │
                              └──────────────────────────────┘
                                          │
                  PerformanceOracle.slash (when off-chain Sharpe diverges
                  from on-chain Sharpe by > slashToleranceBps)
                  → ModelNFT.slashStake → ETH burned to 0xdEaD
                  → CreatorRegistry.recordSlash (soulbound)
```

---

## 3. Core features

### Onchain (Solidity 0.8.20, Foundry, OZ v5.0.2)
- **GPUMarketplace** — list/rent/complete; one-shot mint right per job; gated `consumeMintRight` (only ModelNFT can call)
- **ModelNFT** — ERC-721 with 9-field metadata (modelCID, proofCID, description, creator, performanceScore, jobId, creatorStake, sharpeBps, nVerifiedTrades, lastAuditAt, modelWeightsHash); payable mint with stake; oracle-gated `setPerformanceScore` and `slashStake` (burns to 0xdEaD)
- **ModelMarketplace** — fixed-price listings; royalty 5% / fee 2.5% (capped at 10%); custom errors; zero ETH held between txs
- **PerformanceOracle** — `publishFeedRoot` (signed), `submitAudit` (verifies SNARK + binds to epoch root + recomputes Sharpe), `slash` with divergence tolerance, integer-only Sharpe-bps
- **CreatorRegistry** — soulbound ERC-721 SBT; records mint/score/slash; transfers blocked via `_update` override
- **MerkleProofPacked** — sorted-pair verifier (matches OZ)
- **EzklVerifier** — auto-generated 99 KB Halo2 verifier

### Off-chain (Python 3.12 + TypeScript)
- **AlphaMLP** (120→32→16→5 ReLU+softmax, ~3.4k params)
- **train.py** — real PyTorch training, rolling 24-bar windows, exports static + dynamic ONNX, deterministic sha3 weights hash
- **prove.py** — real EZKL Halo2 pipeline (gen_settings → calibrate → compile → gen_srs → witness → setup → prove → EVM verifier); ~38 s, 29 KB proofs
- **oracle_feed.py** — deterministic GBM price feed, sorted-pair Merkle root, ECDSA sign over `keccak(epoch ‖ root)`
- **backtest.py + sharpe.py** — bit-exact Sharpe-bps parity with Solidity `_isqrt` (validated 4665 bps fixture)
- **orchestrator.ts** — listens for `JobCreated`, runs train+prove, uploads to 0G, mints, submits audit
- **audit-submitter.ts** — packs `AuditSubmission` tuple, encodes proof + outputs

---

## 4. Plan structure (3 plans)

### Plan 1 — Verification Layer  ✅ 17/18 tasks DONE
Path: `docs/superpowers/plans/2026-04-28-verification-layer.md`

| Phase | Task | Status |
|---|---|---|
| A | ModelNFT extension (oracle pointer, metadata, slashStake) | ✅ |
| B | PerformanceOracle (skeleton, audit, Sharpe, slash) | ✅ |
| C | CreatorRegistry SBT | ✅ |
| D | ModelNFT ↔ CreatorRegistry hooks | ✅ |
| E | Python zkML pipeline (model, feed, backtest, train, prove) | ✅ |
| F | TS audit-submitter + orchestrator wiring | ✅ |
| G1 | End-to-end Anvil integration test | ⏳ pending scope decision |

**Gates:** 121/121 forge tests, 13/13 pytest, 11/11 TS smoke checks all passing.

### Plan 2 — Meta-Agent Layer (PLANNED, not started)
- `MetaAgentRegistry` — register agents, track NAV / Sharpe
- `MetaAgentVault` — ERC-4626 deposit vault per agent
- Python runtime — EXP4/Corral contextual bandit picks among model NFTs
- KeeperHub integration → Uniswap V3 on Arbitrum Sepolia
- TEE-attested execution (mocked v1; real TEE = stretch)

### Plan 3 — Production Polish (PLANNED, not started)
- Render/RunPod/Modal compute adapter (real cloud GPU)
- Frontend additions: model browser, agent leaderboard, vault deposit UI
- ENS + subname assignment
- Demo video + walkthrough

---

## 5. Known limitations (v2 follow-ups, all documented in commits)

1. **EZKL public-input mismatch** — auto-generated Halo2Verifier expects model input/output samples as public inputs; contract requires `[modelWeightsHash, outputsHash, priceFeedRoot]`. Fix: custom EZKL circuit that exposes those hashes.
2. **Single-sibling Merkle limit** — `PerformanceOracle` uses 1 sibling/bar, so on-chain check works only for 2-leaf trees; audit window has 32+ bars. Fix: extend `AuditSubmission` with `bytes32[] siblings + uint256[] siblingLengths`.
3. **outputs vs bars length mismatch** — `outputs.length = n_rows × NUM_TOKENS = 40`, `bars.length = n_audit_bars = 32`. Fix: pipeline-side collapse (scalar weight per bar) OR contract-side multi-asset Sharpe.
4. **macOS arm64 SRS bug** — `ezkl.get_srs` errors with "field modulus"; we use `gen_srs` (dev SRS, locally generated). For production, run prove.py on x86 Linux for trusted KZG ceremony.
5. **`Interact.s.sol` stack-too-deep** — pre-existing; needs `--via-ir`. Tests don't compile it.

---

## 6. Pending decision

**G1 scope** — full integration test on Anvil. Two options:

- **A)** Solidity-only Foundry test using **MockVerifier** covering list→rent→complete→mint→submitAudit→score-written. Proves orchestration end-to-end without depending on the 3 EZKL mismatches above. Achievable today.
- **B)** Pause and address mismatch #2 (multi-level Merkle) or #3 (output reshape) first, so the integration test runs against a real proof.

Recommendation: **A** for now (unblocks Plan 2), then revisit mismatches as a v1.5 hardening pass before the demo.

---

## 7. Repo layout (for next session)

```
AlphaTrade/
├── ComputeX-Contracts/            # Foundry project — run forge here
│   ├── src/
│   │   ├── GPUMarketplace.sol
│   │   ├── ModelNFT.sol
│   │   ├── ModelMarketplace.sol
│   │   ├── PerformanceOracle.sol
│   │   ├── CreatorRegistry.sol
│   │   ├── lib/MerkleProofPacked.sol
│   │   └── verifiers/EzklVerifier.sol
│   ├── test/                      # 121 tests
│   └── script/Deploy.s.sol
├── backend/
│   ├── zkml/                      # Python pkg
│   │   ├── model.py    oracle_feed.py    backtest.py    sharpe.py
│   │   ├── requirements.txt       # torch, onnx, ezkl 19.x, eth-keys, eth-hash[pycryptodome]
│   │   └── tests/                 # 13 pytest tests
│   ├── train.py    prove.py
│   └── src/                       # TS orchestrator
│       ├── orchestrator.ts    audit-submitter.ts    audit-submitter.smoke.ts
│       ├── contracts.ts    mint.ts    upload.ts
└── docs/superpowers/
    ├── specs/2026-04-28-alphatrade-meta-agent-marketplace-design.md
    └── plans/
        ├── 2026-04-28-verification-layer.md
        └── 2026-04-29-master-plan.md   ← this file
```

---

## 8. Resume checklist (for the next chat)

1. Read this file + `specs/2026-04-28-alphatrade-meta-agent-marketplace-design.md`.
2. Decide G1 scope (recommend MockVerifier route).
3. Write `ComputeX-Contracts/test/EndToEnd.t.sol` covering full lifecycle.
4. Then start **Plan 2 (Meta-Agent Layer)** — write the plan doc first, then execute task-by-task with TDD.
5. Conventions: TDD (failing test → minimal impl → pass → commit), inline execution (subagent timed out previously), commit per task with descriptive message.
