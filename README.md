# AlphaTrade

> **Decentralized GPU compute × AI model ownership × autonomous on-chain trading.**
> Built for ETHGlobal Open Agents 2026.

A three-sided marketplace where:
1. **GPU providers** list compute power.
2. **Model creators** rent it, train zkML-verifiable trading models, and mint them as ERC-7857 iNFTs.
3. **Capital allocators** deposit into ERC-4626 meta-agent vaults that pick among the verified model NFTs and trade autonomously via Uniswap, with execution guaranteed by KeeperHub.

Every step is on chain. The model weights live in 0G Storage. The agent's identity lives on ENS.

---

## Sponsor track integration map

| Track | Where it lives in this repo | What it does |
|---|---|---|
| **0G — iNFT track** | `backend/upload_0g.mjs`, `frontend/app/components/NFTPanel.tsx`, `ComputeX-Contracts/src/ModelNFT.sol` | Model weights + EZKL proofs uploaded to 0G Storage; root hash committed on-chain in ERC-7857 iNFT. Contracts deployable to 0G Galileo via `script/DeployZeroG.s.sol`. |
| **Uniswap Foundation** | `frontend/app/lib/uniswap.ts`, `frontend/app/components/VaultDetail.tsx`, `ComputeX-Contracts/src/TradingExecutor.sol`, `FEEDBACK.md` | Trading API for live route quotes shown in the Vault Detail drawer; on-chain settlement via SwapRouter02. |
| **KeeperHub** | `frontend/app/api/keeperhub/route.ts`, `frontend/app/lib/keeperhub.ts`, `backend/agent.py`, `KEEPERHUB.md` | Trades route through KeeperHub's `/v1/workflows` endpoint for guaranteed execution; UI button per quote, server-side proxy keeps the API key secret. |
| **ENS** | `frontend/app/lib/ens.ts`, `frontend/app/components/AgentPanel.tsx`, `frontend/app/components/VaultDetail.tsx` | Each meta-agent vault binds to an ENS name. Custom text records (`eth.alphatrade.vault`, `eth.alphatrade.modelnft`, `eth.alphatrade.sharpe`, `eth.alphatrade.proofcid`) store verifiable agent identity — qualifies for both ENS sub-tracks (identity + creative use). |

---

## Architecture

```
              ┌──────────────────────────────────────────────────┐
              │                                                  │
              ▼                                                  │
   ┌─────────────────────┐    ERC-7857 mint right                │
   │   GPUMarketplace    │ ───────────────────────────┐          │
   │   (rental escrow)   │                            │          │
   └─────────┬───────────┘                            ▼          │
             │ JobCreated                  ┌────────────────────┐│
             │                             │     ModelNFT       ││
             ▼                             │  (model weights +  ││
   ┌─────────────────────┐                 │   zkML proof CID)  ││
   │   gpu_adapter.ts    │                 └────────┬───────────┘│
   │  (provider daemon)  │                          │            │
   └─────────┬───────────┘                          │            │
             │ shells out to                        │            │
             ▼                                      ▼            │
   ┌─────────────────────┐                 ┌────────────────────┐│
   │ server.py (FastAPI) │                 │ PerformanceOracle  ││
   │  /train  /prove     │                 │  (EZKL audit ⇒    ││
   │  /upload-0g         │ ◄── proof ──── │    Sharpe bps)     ││
   └─────────┬───────────┘                 └────────────────────┘│
             │                                                   │
             └──── 0G Storage ──── modelCID + proofCID ──────────┘

   ┌──────────────────────────────────────────────────────────────┐
   │                  Meta-agent layer                            │
   │  ┌──────────────────┐    ERC-4626 share accounting           │
   │  │ MetaAgentRegistry│ ─► MetaAgentVault   ◄─── deposits      │
   │  └────┬─────────────┘    (USDC underlying)                   │
   │       │                          │                           │
   │       │ operator NFT             │ rebalance signal          │
   │       ▼                          ▼                           │
   │  ENS subname           TradingExecutor ───► SwapRouter02     │
   │  (eth.alphatrade.*)    + Uniswap API quote  (Uniswap V3)     │
   │                                  │                           │
   │                                  │  guaranteed execution     │
   │                                  ▼                           │
   │                              KeeperHub                       │
   │                          /v1/workflows                       │
   └──────────────────────────────────────────────────────────────┘
```

---

## Quick start (local Anvil)

Four terminals.

```bash
# 1) Anvil
anvil

# 2) Deploy
cd ~/Documents/AlphaTrade/ComputeX-Contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/DeployMetaAgentLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# 3) FastAPI ML shim (real train + prove)
cd ~/Documents/AlphaTrade/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r zkml/requirements.txt
python3 -m uvicorn server:app --reload --port 8001

# 4) Frontend
cd ~/Documents/AlphaTrade/frontend
npm install && npm run dev
# open http://localhost:3000
```

Optional 5th terminal — provider daemon:
```bash
cd ~/Documents/AlphaTrade/backend
PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d npm run gpu-adapter
```

---

## Account flow (4 MetaMask accounts)

| Role | Anvil # | Tasks |
|---|---|---|
| **D** Deployer / Oracle | acc0 | Submit demo audits |
| **A** GPU Provider | acc1 | List GPU, complete jobs |
| **B** Renter / Creator / Seller | acc2 | Rent GPU, mint NFT, list NFT |
| **C** Buyer / LP | acc3 | Buy NFT, deposit to vault |

Anvil prints test private keys at startup; import all four into MetaMask. After every Anvil restart, MetaMask → Settings → Advanced → Clear activity tab data.

---

## Per-chain deploy

```bash
# Sepolia
SEPOLIA_RPC_URL=<...> PRIVATE_KEY=0x<...> \
  forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify

# 0G Galileo testnet (single-shot Plan 1 + Plan 2)
ZG_RPC_URL=https://evmrpc-testnet.0g.ai PRIVATE_KEY=0x<funded on 0G> \
  forge script script/DeployZeroG.s.sol:DeployZeroG --rpc-url $ZG_RPC_URL --broadcast --legacy
```

After deploy, paste printed addresses into:
- `frontend/app/lib/contracts.ts` → `SEPOLIA_ADDRESSES` / `ZEROG_ADDRESSES`.

---

## Configuration (env vars)

`backend/.env.example` lists every key. Demo-mode fallbacks are documented so the app works without any keys, but live integrations need:

| Var | Why | Where to get it |
|---|---|---|
| `KEEPERHUB_API_KEY` | Live KeeperHub workflow execution | https://app.keeperhub.com |
| `ZG_PRIVATE_KEY` | Real on-chain commits to 0G Storage | https://faucet.0g.ai |
| `SEPOLIA_RPC_URL` | Sepolia deploy + ENS testing | Alchemy / Infura |
| `ETHERSCAN_API_KEY` | Contract verification on Sepolia | etherscan.io |

Without any of these, the corresponding feature falls into a labelled demo/stub mode (clearly marked in the UI).

---

## The 12 user-facing flows

```
Tab 01 GPU Market    list / browse / rent
Tab 02 Compute Jobs  start / complete / cancel
Tab 03 Model NFTs    train+prove → upload to 0G → mint → audit (Submit Audit demo)
Tab 04 Trade         list NFT / buy NFT
Tab 05 Meta-Agents   deploy vault / deposit USDC / details (Vault Detail drawer):
                       └─ NAV chart (live event-derived)
                       └─ Basket Holdings
                       └─ ENS Identity (bind, set text records)
                       └─ Live Uniswap Routing (Trading API + KeeperHub exec)
                       └─ Recent trades, Recent deposits
Tab 06 Portfolio     all on-chain assets per connected wallet, sidebar grouped
```

Plus the standalone `/docs` route — full developer docs with sticky sidebar nav.

---

## Tests

```bash
cd ComputeX-Contracts
forge test --no-match-contract Interact   # 166 / 166 pass
forge test --match-test test_invariant     # marketplace ETH invariant
```

```bash
cd backend
pytest zkml/tests                           # 13/13 pass
```

---

## Demo video script (under 3 min)

1. **0:00–0:20** — open `/`. Show the architecture diagram + tab strip. Mention "everything on chain except the actual GPU compute, which I'll show running on this M4 in a second."
2. **0:20–0:50** — Tab 01: List a GPU as acc1. Tab 02: Rent it as acc2. The provider daemon's terminal scrolls live with `▶ POST /train`, `▶ POST /prove`, `▶ completeJob`.
3. **0:50–1:20** — Tab 03: Mint the model NFT. Show the inspector: real 0G rootHash for both `modelCID` and `proofCID`. Click "Submit Audit (demo)" — Sharpe score appears in the gallery.
4. **1:20–1:50** — Tab 04: List the NFT for sale as acc2. Switch to acc3, click the row, buy. Royalty + fee split shown.
5. **1:50–2:30** — Tab 05: Deposit USDC to a vault. Open Details. Walk through:
   - NAV chart populating from on-chain events.
   - **ENS Identity card** — bind `myagent.eth`, click "Update text records" — three setText txs.
   - **Live Uniswap Routing** — type `1000`, click Get Quotes, click "Exec via KeeperHub" on WETH row → workflow ID + tx hash.
6. **2:30–3:00** — Tab 06 Portfolio: switch accounts in MetaMask, watch the inventory rebuild from chain. End on `/docs`.

---

## Status & known gaps

| Component | State |
|---|---|
| GPU marketplace + iNFT mint + audit | ✅ |
| 0G Storage upload (live with key, stub without) | ✅ |
| Uniswap Trading API + on-chain settlement | ✅ |
| KeeperHub proxy + UI execution | ✅ |
| ENS read + write (Sepolia) | ✅ |
| FastAPI ML shim + provider daemon | ✅ |
| Vault NAV chart from events | ✅ |
| 0G Galileo deploy script | ✅ (script ready, live deploy pending funded key) |
| Multi-hop Uniswap routing through Universal Router | ⏳ v2 |
| Subgraph indexer | ⏳ v2 (uses `queryFilter` for now) |
| KeeperHub MCP server registration (vs. REST) | ⏳ v2 |

Documented v1 limitations:
- EZKL public-input bridge: weights hash uses SHA3 from train.py, on-chain expects keccak — current code stores SHA3 in the iNFT and uses it as canonical identity, parity migration is documented in `docs/superpowers/plans/2026-04-29-master-plan.md` §5.
- macOS arm64 SRS bug: fall back to local-generated SRS — proofs verify but don't interoperate with KZG ceremony deployments. `prove.py` notes this inline.

---

## Repo map

```
ComputeX-Contracts/      Foundry project — Solidity 0.8.22, OZ 5.0.2 pinned
  src/                   GPUMarketplace, ModelNFT, ModelMarketplace,
                         PerformanceOracle, CreatorRegistry,
                         MetaAgentRegistry, MetaAgentVault, TradingExecutor
  test/                  166 forge tests, gas snapshots
  script/                Deploy / DeployMetaAgent / DeployMetaAgentLocal /
                         DeployZeroG / Interact

backend/                 Python ML pipeline + Node 0G uploader + TS runtime
  zkml/                  AlphaMLP, EZKL pipeline, oracle feed, Sharpe
  server.py              FastAPI shim — /train /prove /upload-0g
  upload_0g.mjs          @0glabs/0g-ts-sdk uploader (ESM)
  src/orchestrator.ts    Renter-side coordinator (event-driven)
  src/gpu_adapter.ts     Provider-side daemon (event-driven)
  src/agent.ts           Trading agent (KeeperHub integration)

frontend/                Next.js 14, React 18, ethers v6
  app/page.tsx           Tab router (6 tabs)
  app/lib/               contracts, ens, uniswap, keeperhub, zkmlApi
  app/components/        GPUPanel, JobPanel, NFTPanel, MarketPanel,
                         AgentPanel, VaultDetail, PortfolioPanel,
                         Header, PipelineViz
  app/api/keeperhub/     Server-side KeeperHub proxy
  app/docs/page.tsx      In-app documentation

FEEDBACK.md              Uniswap track required submission
KEEPERHUB.md             KeeperHub integration writeup
README.md                this file
```

---

## Team

Pushkaraj Baradkar — solo build over the hackathon weekend.
Telegram: @pushkarajbaradkar · X: [@PushkarajB](https://x.com/PushkarajB)

## License

MIT.
