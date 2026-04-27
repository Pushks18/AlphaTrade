# Interaction Proof — End-to-End Lifecycle

## Live deployment (Sepolia, chain id 11155111)

| Contract            | Address | Etherscan |
|---------------------|---------|-----------|
| GPUMarketplace      | `0xefE063A1876Bf0FB4Bb8BF1566A5B74B000f4654` | [verified](https://sepolia.etherscan.io/address/0xefE063A1876Bf0FB4Bb8BF1566A5B74B000f4654#code) |
| ModelNFT            | `0x7695a2e4D5314116F543a89CF6eF74084aa5d0d9` | [verified](https://sepolia.etherscan.io/address/0x7695a2e4D5314116F543a89CF6eF74084aa5d0d9#code) |
| ModelMarketplace    | `0xF602913E809140B9D067caEEAF37Df0Bdd9db806` | [verified](https://sepolia.etherscan.io/address/0xF602913E809140B9D067caEEAF37Df0Bdd9db806#code) |

Deployer / owner: `0x20411752e8663C8378249331eED919D21f980470`.

---



This is a **reproducible run** of the full ComputeX onchain lifecycle, executed
against a local anvil node via `script/Interact.s.sol:Interact`. It serves as a
backup demo if the UI fails — anyone can reproduce identical results in ~2
seconds.

## How to reproduce

```bash
# Terminal 1
anvil

# Terminal 2 (in ComputeX-Contracts/)
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
PROVIDER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
RENTER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
BUYER_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 \
forge script script/Interact.s.sol:Interact \
    --rpc-url http://127.0.0.1:8545 --broadcast --via-ir
```

(Keys are anvil's deterministic accounts 0–3. `--via-ir` is required only
because the script has many locals; the contracts themselves compile cleanly
without it.)

---

## Captured run

**Accounts**
| Role     | Address |
|----------|---------|
| owner    | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| provider | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| renter   | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| buyer    | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

**Deployed addresses** (deterministic on a fresh anvil)
| Contract           | Address |
|--------------------|---------|
| GPUMarketplace     | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| ModelNFT           | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| ModelMarketplace   | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

**Transaction trail** (`broadcast/Interact.s.sol/31337/run-latest.json`)

| # | Step                | Tx hash |
|---|---------------------|---------|
| — | CREATE GPUMarketplace   | `0x778a836d31538c2f405d61407e21bf0c31579912a90048361174b4c32762c7e7` |
| — | CREATE ModelNFT         | `0x0fa325ec60b022afd619f8842110e334fb45659f9ca9f9e2bf11605aaa83385f` |
| — | CREATE ModelMarketplace | `0x0f15624b5858c81853c3985ca040e974f9342ed0df37336d1136b0cfaeb632b2` |
| — | wire `setModelNFT`      | `0xb6b429326f434ee2af28e1c581aecc200180b385a235611c3981daf61a70e391` |
| 1 | `listGPU`               | `0x1c8b18c6574eee820f63ac186eecaedc2b4552e78082926e8116cd78247e5bf2` |
| 2 | `rentGPU`               | `0xceff62630474681d8b283ee112dccfe88cc695e69ec14cf965fdf17bd44efd82` |
| 3 | `completeJob`           | `0xd0c162f4d6a212a5546eb9230c7b83020ee86f0e658c29d06e1c29e52d510a16` |
| 4 | `mintModel`             | `0xcbc15bfddd10a4b1f52ad7b43851671d178788aa7e5aaf76342c850bbb5ac55f` |
| 5a | `nft.approve`          | `0x6c22042801d80959ae5a70074327f506ccffa1500f01a543dde3f419c616304f` |
| 5b | `listModel`            | `0x33d91f662dd4417fdcbc654ab591f1ad3c43ad88e7e97606865f70b593749af6` |
| 6 | `buyModel`              | `0xbd0ac25d27873844def729e75fdf719ca95f62eced470782993e94318a9bef59` |

---

## State at each step

```
[1] listGPU
    gpuId        = 0
    pricePerHour = 0.001 ETH
    available    = true

[2] rentGPU (duration = 2h, totalCost = 0.002 ETH)
    jobId             = 0
    escrowed in mkt   = 0.002 ETH
    jobOwner[0]       = renter

[3] completeJob
    jobCompleted[0]   = true
    provider payout   = 0.002 ETH         (escrow fully released)
    market balance    = 0

[4] mintModel  (atomic via gpu.consumeMintRight)
    tokenId           = 1
    NFT owner         = renter
    NFT creator       = renter
    jobIdOfToken[1]   = 0
    modelMinted[0]    = true              (set inside consumeMintRight)

[5] listModel  (price = 0.05 ETH)
    NFT escrow owner  = ModelMarketplace
    listing.active    = true

[6] buyModel  (msg.value = 0.05 ETH)
    NFT new owner     = buyer
    fee paid          = 0.00125 ETH       → owner (feeRecipient)
    royalty paid      = 0.0025 ETH        → renter (creator)
    seller received   = 0.04625 ETH       → renter (seller)
    market eth held   = 0                 (invariant: no custody)
```

Final invariants asserted in the script log:
- `token 1 owned by buyer = true`
- `job 0 completed       = true`
- `job 0 model minted    = true`

> Note on this run: the renter is also the original creator and the seller, so
> on this leg the `royalty` and `seller` payouts both end up at the renter
> (combined `0.04875 ETH = seller + royalty`). To independently observe the
> royalty path, run a second `listModel`/`buyModel` from `buyer` to a third
> account — `test_buyModel_splitsPayment_seller_creator_recipient` in the
> Foundry suite covers that scenario.
