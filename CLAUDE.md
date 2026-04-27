# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: AlphaTrade / ComputeX

Decentralized GPU compute + AI-model marketplace. Person A's scope (this repo)
is the **onchain layer**: GPU rental escrow, model NFT minting, secondary
model marketplace. Off-chain training, zkML proof generation, and 0G Storage
uploads are separate workstreams (Persons B / C).

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

Three contracts, one trust loop:

```
GPUMarketplace ── completeJob ──► jobCompleted[jobId]=true, jobOwner[jobId]=renter
       │
       │ consumeMintRight(jobId)   ◄── ONLY callable by ModelNFT (modelNFT addr)
       ▼                              returns jobOwner, flips modelMinted[jobId]
ModelNFT.mintModel(jobId,...)     ◄── permissionless; pulls owner atomically
       │
       │ creator(tokenId) = renter  (immutable; persists across resales)
       ▼
ModelMarketplace.buyModel  ──► splits ETH: royalty → creator, fee → recipient, rest → seller
                                contract holds ZERO eth between txs (invariant tested)
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

## Person-A deliverables status

| Item | State |
|---|---|
| GPUMarketplace.sol         | ✅ implemented + 32 tests |
| ModelNFT.sol               | ✅ implemented + 11 tests |
| ModelMarketplace.sol       | ✅ implemented + 27 tests |
| Deploy.s.sol               | ✅ wires all three |
| Interact.s.sol (e2e proof) | ✅ runs end-to-end on local anvil |
| ABIs exported              | ✅ `abi/*.json` |
| Testnet deploy             | ⏳ needs user's `PRIVATE_KEY` + RPC |
| Verified explorer links    | ⏳ produced by `--verify` flag on deploy |

See `ComputeX-Contracts/INTERACTION_PROOF.md` for the captured anvil run
(tx hashes, addresses, per-step state).

## What NOT to add to this repo

- New contracts. Person A's surface is locked at 3.
- AMM / orderbook for the model marketplace. Fixed-price by design.
- ERC-20 payment paths. ETH only for the MVP.
- Backend orchestration code. That's Person B.
- Frontend. That's a separate workstream — only add a thin demo page if
  explicitly asked.

## Workspace context

This repo is one project inside the `/Users/pushkaraj/Documents` monorepo.
The parent `Documents/CLAUDE.md` lists the broader project map. Implementation
plans for sibling projects (coastal-run, sushi-master, lifeOS, etc.) live in
`Docs/superpowers/plans/` — do not put AlphaTrade plans there unless asked.

## Code-review-graph note

The MCP knowledge graph (`mcp__code-review-graph__*`) does **not** parse
Solidity. For this repo, fall back to `grep`/`Read`. The graph is still the
right tool for the Python/TS sibling projects.
