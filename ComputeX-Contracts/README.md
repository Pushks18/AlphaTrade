# ComputeX-Contracts

Onchain layer for **ComputeX** — a decentralized compute + AI-model economy.
GPU providers list compute, traders rent it to train models, the resulting
models are minted as iNFTs (ERC-7857 style) tied to a verified job, and those
NFTs are tradable on a fixed-price secondary market with creator royalties.

```
┌─────────────┐   listGPU     ┌──────────────────┐  rentGPU      ┌───────────┐
│  Provider   │──────────────▶│                  │◀──────────────│  Renter   │
└─────────────┘               │  GPUMarketplace  │   (escrow ETH) └───────────┘
       ▲                      │                  │                     │
       │ completeJob()        │  ┌────────────┐  │                     │
       │ (paid from escrow)   │  │  Job state │  │                     │
       └──────────────────────│  │ machine +  │  │                     │
                              │  │ jobOwner[] │  │                     │
                              │  └────────────┘  │                     │
                              │         │        │                     │
                              │ consumeMintRight │                     │
                              │  (atomic, gated  │                     │
                              │   to ModelNFT)   │                     │
                              └────────┬─────────┘                     │
                                       ▼                               │
                              ┌──────────────────┐                     │
                              │     ModelNFT     │  mintModel(jobId,…) │
                              │  (modelCID +     │◀────────────────────┘
                              │   proofCID + zk) │       returns NFT to renter
                              └────────┬─────────┘
                                       │ approve + listModel
                                       ▼
┌─────────┐    buyModel{value}  ┌──────────────────┐
│  Buyer  │────────────────────▶│ ModelMarketplace │ ──┐
└─────────┘                     │  (escrow NFT,    │   │ split:
                                │   non-custodial  │   │  • royalty → creator
                                │   ETH)           │   │  • fee     → recipient
                                └──────────────────┘   │  • rest    → seller
                                                       ▼
                                             three ETH transfers
                                             in a single tx
```

---

## A. Architecture

| Contract | Responsibility |
|---|---|
| **`GPUMarketplace.sol`** | Provider listings, renter escrow, job state machine (`Created → Running → Completed | Cancelled`), atomic mint-right vending to ModelNFT. |
| **`ModelNFT.sol`** | ERC-721 representation of trained models. Each token references `modelCID` + `proofCID` on 0G Storage and is bound to its originating `jobId`. Inline base64 `tokenURI`. |
| **`ModelMarketplace.sol`** | Fixed-price secondary market with NFT escrow, protocol fee, creator royalty, batch view, price updates. No minting. |

Layout:

```
src/      Solidity contracts
test/     Foundry tests (forge-std)
script/   Deploy.s.sol, Interact.s.sol
abi/      Generated ABIs for backend / frontend
lib/      forge-std + openzeppelin-contracts (v5.0.2, solc 0.8.20)
```

```bash
forge build && forge test           # 70 tests pass
forge snapshot                       # gas profile → .gas-snapshot
```

Deployment: see [`DEPLOY.md`](./DEPLOY.md).
End-to-end proof: see [`INTERACTION_PROOF.md`](./INTERACTION_PROOF.md).

---

## B. Trust model — "How trust works"

The whole stack is engineered so **no off-chain backend role can spoof model
ownership, double-mint, or skim escrow.**

1. **Escrow lives onchain.** `rentGPU` locks `pricePerHour * duration` wei.
   The provider can only earn it via `completeJob`; the renter can only
   reclaim it via `cancelJob`. Both follow strict checks-effects-interactions
   and are protected by `ReentrancyGuard`.
2. **Job → owner mapping is immutable.** `jobOwner[jobId]` is set in
   `rentGPU` to `msg.sender` and never overwritten.
3. **Model minting is a pull, not a push.** `ModelNFT.mintModel(jobId, ...)`
   calls `GPUMarketplace.consumeMintRight(jobId)`, which:
   - is gated to `msg.sender == modelNFT` — only this NFT contract can claim;
   - reverts if the job hasn't completed;
   - reverts on a second attempt for the same `jobId`;
   - returns `jobOwner[jobId]` so the NFT is always minted to the renter.
4. **Permissionless `mintModel` is safe.** Anyone can submit (modelCID,
   proofCID) for a completed job, but the recipient is always the renter and
   each `jobId` mints exactly one NFT. Off-chain proof verification guarantees
   *content* validity; the chain guarantees *ownership* validity.
5. **Marketplace is non-custodial except active escrow.** It only ever holds
   listed NFTs. ETH is never accumulated — `buyModel` splits payment in the
   same tx (royalty → creator, fee → recipient, remainder → seller). Verified
   by `test_invariant_marketHoldsNoEth_*`.

**Admin surface:**
- `GPUMarketplace.setModelNFT(addr)` — one-time wiring (zero-addr guard).
- `ModelMarketplace.{setFee, setRoyaltyBps, setFeeRecipient}` — capped at 10%
  each via `BPS_DENOMINATOR / MAX_*_BPS` constants.
- No admin keys on `ModelMarketplace.modelNFT` (immutable) or on any path
  that touches escrow.

---

## C. Economic model

**Compute market** (`GPUMarketplace`)
- Provider quotes `pricePerHour`. Renter pre-pays `pricePerHour * duration`
  in wei; funds escrow until `completeJob` (paid to provider) or `cancelJob`
  (refunded to renter).
- No protocol fee on compute — providers receive the full quoted amount.

**Model market** (`ModelMarketplace`)
- Fixed-price ETH listings. Each `buyModel` splits payment three ways:

  | Recipient        | Default | Cap | Notes |
  |---|---|---|---|
  | Creator royalty  | 5.00%   | 10% | Goes to `ModelNFT.creator(tokenId)` — the original renter. Persists across resales. |
  | Protocol fee     | 2.50%   | 10% | Goes to configurable `feeRecipient`. |
  | Seller           | 92.50%  | —   | Remainder. |

- If a creator address is missing, royalty folds back into the seller payout
  (defensive; canonical-flow NFTs always have a creator).
- `updatePrice` lets sellers re-quote without re-escrowing the NFT.

**Composability**
- `getActiveListings(uint256[])` — batched listing fetch for frontends.
- `getJob`, `getGPU`, `getJobProvider`, `isJobActive` — single-call backend
  helpers; no nested struct decoding.
- All state changes emit indexed events (`gpuId` / `jobId` / `tokenId` /
  actor addresses) for cheap `eth_getLogs`.

---

## D. Demo narration (90 seconds)

> **Compute market.** "Here's the GPU marketplace. Providers list hardware
> with a price-per-hour. A trader rents two hours of a GPU and the contract
> escrows the payment — you can see the contract balance go up, and the job
> is created in the `Created` state."
>
> **Job completes.** "When the off-chain orchestrator finishes training and
> generates the zkML proof, the provider calls `completeJob`. Escrow is
> released to the provider in the same transaction, and the job flips to
> `Completed`. A boolean flag `jobCompleted[jobId]` is set on-chain — that's
> the gate the NFT contract reads next."
>
> **Atomic mint.** "Now the model NFT can be minted. `ModelNFT.mintModel`
> reaches into the marketplace and atomically *consumes the mint right* for
> that job. The marketplace verifies: job is complete, hasn't already been
> minted, and returns the renter's address. The NFT can only ever go to that
> renter, and only once. There's no admin signer in this path — it's enforced
> by the contracts."
>
> **Trade.** "The renter now owns an iNFT pointing at the trained weights and
> the proof on 0G Storage. They list it for 0.05 ETH. A buyer purchases it.
> In one transaction the contract splits the ETH: 5% royalty to the original
> creator — which persists across every future resale — 2.5% protocol fee,
> rest to the seller. The marketplace never holds ETH between transactions."

---

## E. What judges can verify in 30 seconds

- Click any deployed contract on the explorer — sources are verified.
- Click the latest job on `GPUMarketplace` → see status, escrow flow,
  `JobCompleted` event.
- Click the model token on `ModelNFT` → `tokenURI` returns inline base64
  metadata with `modelCID`, `proofCID`, `creator`, `jobId`.
- Click the latest sale on `ModelMarketplace` → see the three internal ETH
  transfers (royalty / fee / seller) in one tx.
- Run `forge test` locally → all 70 tests pass.
- Run `script/Interact.s.sol` against any RPC → reproducible end-to-end run.
