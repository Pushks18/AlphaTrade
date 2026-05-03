# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: AlphaTrade

Decentralized GPU compute + AI-trading-model marketplace with autonomous
meta-agents (ETHGlobal Open Agents, approach C). Single-developer scope —
**all layers live in this repo**: onchain marketplace (Solidity), zkML
verification pipeline (Python + EZKL), backend orchestrator (TypeScript),
and a planned meta-agent layer + frontend.

**Master plan:** `docs/superpowers/plans/2026-04-29-master-plan.md` —
read this first. It captures the full flow, feature list, status, and
the 3-plan structure (Verification Layer ✅ / Meta-Agent Layer ⏳ / Polish ⏳).

The actual contracts live in `ComputeX-Contracts/`. Run `forge` commands from
that subdirectory, not the AlphaTrade root.

## Stack

Foundry + Solidity ^0.8.20, OpenZeppelin v5.0.2 (pinned — v5.6+ requires
solc 0.8.24).

```bash
cd ComputeX-Contracts
forge build
forge test                      # 70 tests, all passing
forge test --match-test <name>  # single test
forge snapshot                  # → .gas-snapshot
```

End-to-end interaction proof against any RPC:

```bash
forge script script/Interact.s.sol:Interact \
  --rpc-url $RPC_URL --broadcast --via-ir -vvv
```

`--via-ir` is required only for `Interact.s.sol` (many locals); production
contracts compile without it.

Deploy + verify (one-shot): see `ComputeX-Contracts/DEPLOY.md`.

## Architecture (the part that matters)

Six contracts, one trust loop:

```
GPUMarketplace ── completeJob ──► jobCompleted[jobId]=true, jobOwner[jobId]=renter
       │
       │ consumeMintRight(jobId)   ◄── ONLY callable by ModelNFT (modelNFT addr)
       ▼
ModelNFT.mintModel (payable, with creator stake)
       │ ───────► CreatorRegistry.recordMint  (soulbound SBT)
       ▼
PerformanceOracle.submitAudit  ── verifies SNARK (EzklVerifier / Halo2)
       │                       ── checks epoch feed root + ECDSA sig
       │                       ── recomputes Sharpe (bps) on-chain
       ▼
ModelNFT.setPerformanceScore  (oracle-gated)
       │ ───────► CreatorRegistry.recordScore
       ▼
ModelMarketplace.buyModel  ──► splits ETH: royalty 5% → creator, fee 2.5% → recipient, rest → seller
                                contract holds ZERO eth between txs (invariant tested)

Slashing path: PerformanceOracle.slash → ModelNFT.slashStake (oracle-gated)
               → burns ETH to 0xdEaD → CreatorRegistry.recordSlash
```

Critical invariants enforced by tests, do not break:

1. `consumeMintRight` is gated to `msg.sender == modelNFT`. Without that, any
   caller could brick a job's mint right. See
   `test_consumeMintRight_revertsIfNotModelNFT`.
2. Each `jobId` mints exactly one NFT. Guarded both in `consumeMintRight`
   (`!modelMinted[jobId]`) and in `mintModel` (`tokenIdForJob[jobId] == 0`).
3. `ModelMarketplace` holds zero ETH between transactions. `buyModel` splits
   payment in the same call; verified by
   `test_invariant_marketHoldsNoEth_acrossLifecycle`.
4. `nextTokenId` starts at 1 so `tokenIdForJob[jobId] == 0` cleanly means
   "unminted".

## Conventions specific to this repo

- **Custom errors over revert strings** in `ModelMarketplace` (gas + judge
  signal). `GPUMarketplace` and `ModelNFT` still use string reverts —
  intentional, the gas savings are not worth the test churn at this stage.
- **Checks-effects-interactions strictly:** every state mutation that
  precedes ETH transfer flips its flag *before* the `call`. Don't reorder.
- **Public mappings + struct-returning view helpers:** auto-getters return
  tuples; `getJob`/`getGPU`/`getActiveListings` exist so the backend doesn't
  have to decode tuples.
- **Indexed events to the max** — every state-changing event indexes
  `gpuId` / `jobId` / `tokenId` and the relevant actor address. Cheap log
  filtering is part of the integration contract with Person B.
- **No protocol fee on compute.** Providers receive the full quoted amount.
  Fees only apply on the model marketplace (royalty 5% / fee 2.5%, both
  capped at 10%).

## Status

**Plan 1 — Verification Layer:** 18/18 tasks ✅ COMPLETE
**Plan 2 — Meta-Agent Layer:** ⏳ not started
**Plan 3 — Production Polish:** ⏳ not started

Test gates: **130/130 forge** + **13/13 pytest** all green. TS smoke requires prior train.py/prove.py run.

| Component | State |
|---|---|
| GPUMarketplace / ModelNFT / ModelMarketplace | ✅ |
| PerformanceOracle (audit + slash + Sharpe-bps) | ✅ |
| CreatorRegistry (soulbound SBT) | ✅ |
| EzklVerifier (auto-generated Halo2) | ✅ |
| Python zkML pipeline (AlphaMLP, EZKL, ~38s, 29 KB proofs) | ✅ |
| TS orchestrator + audit-submitter | ✅ |
| MetaAgentRegistry / MetaAgentVault | ⏳ Plan 2 |
| TradingExecutor + Uniswap V3 trading runtime | ⏳ Plan 2 |
| Render/RunPod cloud GPU adapter | ⏳ Plan 3 |
| Frontend additions (model browser, leaderboard) | ⏳ Plan 3 |

Known v2 follow-ups documented in master plan §5 (EZKL public-input bridge,
multi-level Merkle, output/bars reshape, macOS arm64 SRS bug).

## Workspace context

This repo is one project inside the `/Users/pushkaraj/Documents` monorepo.
The parent `Documents/CLAUDE.md` lists the broader project map. Implementation
plans for sibling projects (coastal-run, sushi-master, lifeOS, etc.) live in
`Docs/superpowers/plans/` — do not put AlphaTrade plans there unless asked.

## Code-review-graph note

The MCP knowledge graph (`mcp__code-review-graph__*`) does **not** parse
Solidity. For this repo, fall back to `grep`/`Read`. The graph is still the
right tool for the Python/TS sibling projects.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
