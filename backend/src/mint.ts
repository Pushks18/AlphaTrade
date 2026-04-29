/**
 * mint.ts — Mint a ModelNFT for a completed job.
 *
 * Called by the orchestrator after:
 *   1. completeJob() has been confirmed onchain
 *   2. model weights + proof have been uploaded to 0G Storage
 *
 * The mint is permissionless: anyone can call it (wallet = orchestrator key).
 * GPUMarketplace.consumeMintRight enforces job ownership atomically.
 */

import { ethers }  from "ethers";
import { ANVIL_ADDRESSES, MODEL_NFT_ABI } from "./contracts";

export async function mintModelNFT(params: {
  jobId:            bigint;
  modelCID:         string;
  proofCID:         string;
  description:      string;
  modelWeightsHash: string;   // 0x… 32-byte hex; from train.py meta.json
  stake?:           bigint;   // optional creator stake (wei) sent with mint
  provider:         ethers.JsonRpcProvider;
  signer:           ethers.Wallet;
}): Promise<{ tokenId: bigint; txHash: string }> {
  const { jobId, modelCID, proofCID, description, modelWeightsHash, stake, provider, signer } = params;

  const nft = new ethers.Contract(
    ANVIL_ADDRESSES.ModelNFT,
    MODEL_NFT_ABI,
    signer,
  );

  const existing = await nft.tokenIdForJob(jobId);
  if (existing !== 0n) {
    console.log(`  ℹ️  Job #${jobId} already has tokenId=${existing}, skipping mint`);
    return { tokenId: existing, txHash: "(already minted)" };
  }

  console.log(`  ⛏  Minting ModelNFT for job #${jobId} (stake=${stake ?? 0n} wei)…`);
  const tx = await nft.mintModel(
    jobId, modelCID, proofCID, description, modelWeightsHash,
    { value: stake ?? 0n },
  );
  console.log(`  Tx: ${tx.hash}`);
  const rc = await tx.wait();

  const ev = rc.logs.find((l: any) => l.fragment?.name === "ModelMinted");
  const tokenId: bigint = ev ? ev.args[0] : 0n;

  console.log(`  ✅ ModelNFT minted! tokenId=${tokenId}`);
  return { tokenId, txHash: tx.hash };
}
