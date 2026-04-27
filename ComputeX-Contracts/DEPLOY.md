# Deployment & Verification

Single-shot deploy of `GPUMarketplace`, `ModelNFT`, `ModelMarketplace` to any
EVM network supported by Foundry, with automatic source verification.

## 1. Configure

```bash
cp .env.example .env
# fill PRIVATE_KEY, RPC_URL, ETHERSCAN_API_KEY
source .env
```

Suggested networks (pick one):

| Network          | RPC                                | Faucet |
|------------------|------------------------------------|--------|
| Base Sepolia     | `https://sepolia.base.org`         | https://www.alchemy.com/faucets/base-sepolia |
| Sepolia          | `https://rpc.sepolia.org`          | https://sepoliafaucet.com |

## 2. Deploy + verify in one command

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  -vvv
```

Output ends with three lines like:

```
GPUMarketplace:    0x...
ModelNFT:          0x...
ModelMarketplace:  0x...
```

The `--verify` flag uploads source to the explorer automatically. If
verification fails (rate limits, etc.), re-run just the verify step:

```bash
forge verify-contract <address> src/GPUMarketplace.sol:GPUMarketplace \
  --chain-id <chain> \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" $YOUR_DEPLOYER)
```

(For `ModelNFT`: `constructor(address,address)` with `(deployer, gpuAddr)`;
for `ModelMarketplace`: `constructor(address,address)` with `(deployer,
nftAddr)`.)

## 3. Sanity-check on-chain state

```bash
# GPU market is wired to the NFT
cast call $GPU_ADDR "modelNFT()(address)" --rpc-url $RPC_URL

# NFT knows the marketplace
cast call $NFT_ADDR "gpuMarketplace()(address)" --rpc-url $RPC_URL

# Marketplace knows the NFT
cast call $MARKET_ADDR "modelNFT()(address)" --rpc-url $RPC_URL

# Defaults
cast call $MARKET_ADDR "feeBps()(uint256)" --rpc-url $RPC_URL      # 250
cast call $MARKET_ADDR "royaltyBps()(uint256)" --rpc-url $RPC_URL  # 500
```

## 4. Run the end-to-end interaction proof against testnet

Same script as the local proof, just point at the testnet RPC. Fund all four
keys with a small amount of testnet ETH first.

```bash
forge script script/Interact.s.sol:Interact \
  --rpc-url $RPC_URL --broadcast --via-ir -vvv
```

The script self-deploys a fresh stack — for a "verify against the existing
deployment" run, switch the script to read addresses from env and skip the
deploy section.

## 5. Export ABIs for the backend / frontend

```bash
mkdir -p abi
forge inspect GPUMarketplace abi   > abi/GPUMarketplace.json
forge inspect ModelNFT abi         > abi/ModelNFT.json
forge inspect ModelMarketplace abi > abi/ModelMarketplace.json
```

Hand the `abi/` folder + the three deployed addresses to Person B / Person C.
