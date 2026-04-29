/**
 * orchestrator.ts — Main event listener + job coordinator.
 *
 * Watches GPUMarketplace for JobCreated events, then:
 *   1. Runs train.py     → weights.json
 *   2. Runs prove.py     → proof.json
 *   3. Uploads both to 0G Storage → modelCID + proofCID
 *   4. Calls ModelNFT.mintModel(jobId, modelCID, proofCID)
 *
 * Also watches JobCompleted so it knows when the provider has settled.
 */

import "dotenv/config";
import path                          from "path";
import fs                            from "fs";
import { execFileSync }              from "child_process";
import { ethers }                    from "ethers";
import { ANVIL_ADDRESSES, GPU_MARKETPLACE_ABI, PERFORMANCE_ORACLE_ABI } from "./contracts";
import { uploadToStorage }           from "./upload";
import { mintModelNFT }              from "./mint";
import { loadProofArtifacts, submitAudit } from "./audit-submitter";

// ── Config ────────────────────────────────────────────────────────────────
const RPC_URL     = process.env.RPC_URL     ?? "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SCRIPTS_DIR = path.resolve(__dirname, "..", "..", "backend");
const TMP_DIR     = path.resolve(__dirname, "..", "tmp");

fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Provider / signer ─────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);

const gpuMarket = new ethers.Contract(
  ANVIL_ADDRESSES.GPUMarketplace,
  GPU_MARKETPLACE_ABI,
  provider,
);

// ── Job processor ─────────────────────────────────────────────────────────
const processing = new Set<string>(); // guard against duplicate events

async function processJob(jobId: bigint, renter: string, gpuId: bigint) {
  const id = jobId.toString();
  if (processing.has(id)) return;
  processing.add(id);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🎯 Job #${id} received (renter=${renter}, gpuId=${gpuId})`);

  const trainDir = path.join(TMP_DIR, `train_${id}`);
  const proveDir = path.join(TMP_DIR, `prove_${id}`);

  try {
    // ── Step 1: Training ─────────────────────────────────────────────────
    console.log(`\n🐍 [Step 1] Running train.py…`);
    execFileSync("python3", [
      path.join(SCRIPTS_DIR, "train.py"),
      "--job-id",  id,
      "--output",  trainDir,
    ], { stdio: "inherit" });
    const meta = JSON.parse(fs.readFileSync(path.join(trainDir, "meta.json"), "utf8")) as {
      weightsHash: string; jobId: number;
    };
    console.log(`  ✅ Training complete → ${trainDir} (weightsHash=${meta.weightsHash.slice(0, 14)}…)`);

    // ── Step 2: Proof generation ──────────────────────────────────────────
    console.log(`\n🔐 [Step 2] Running prove.py…`);
    execFileSync("python3", [
      path.join(SCRIPTS_DIR, "prove.py"),
      "--weights", trainDir,
      "--output",  proveDir,
    ], { stdio: "inherit" });
    console.log(`  ✅ Proof generated → ${proveDir}`);

    // ── Step 3: Upload to 0G Storage ─────────────────────────────────────
    console.log(`\n📡 [Step 3] Uploading to 0G Storage…`);
    const [modelCID, proofCID] = await Promise.all([
      uploadToStorage(path.join(trainDir, "model.onnx"), "model weights"),
      uploadToStorage(path.join(proveDir, "proof.json"), "zkML proof"),
    ]);
    console.log(`  modelCID = ${modelCID}`);
    console.log(`  proofCID = ${proofCID}`);

    // ── Step 4: Wait for completeJob (poll, max 60s) ──────────────────────
    console.log(`\n⏳ [Step 4] Waiting for job #${id} to be marked completed…`);
    const completed = await waitForJobCompletion(jobId, 60_000);
    if (!completed) {
      console.warn(`  ⚠️  Job #${id} not completed within timeout — skipping mint`);
      processing.delete(id);
      return;
    }

    // ── Step 5: Mint ModelNFT ─────────────────────────────────────────────
    console.log(`\n⛏  [Step 5] Minting ModelNFT…`);
    // Reformat the ONNX weights hash from SHA3 (64 hex chars) to bytes32. The
    // contract requires a non-zero modelWeightsHash. We use the SHA3 hash as
    // the canonical identity; future tasks can switch to keccak parity if
    // proofs need to verify it on-chain (out of scope for v1).
    const weightsHashBytes32 = meta.weightsHash;
    const stake = process.env.CREATOR_STAKE_WEI ? BigInt(process.env.CREATOR_STAKE_WEI) : 0n;
    const { tokenId, txHash } = await mintModelNFT({
      jobId, modelCID, proofCID,
      description:      `AlphaTrade model for job #${id}`,
      modelWeightsHash: weightsHashBytes32,
      stake,
      provider, signer,
    });

    // ── Step 6: Submit audit to PerformanceOracle ─────────────────────────
    console.log(`\n📜 [Step 6] Submitting EZKL audit to PerformanceOracle…`);
    try {
      const { bundle, feed } = loadProofArtifacts(proveDir);
      const oracle = new ethers.Contract(
        ANVIL_ADDRESSES.PerformanceOracle, PERFORMANCE_ORACLE_ABI, signer,
      );
      const auditTx = await submitAudit({
        oracle, tokenId, modelWeightsHash: weightsHashBytes32, bundle, feed,
      });
      console.log(`  ✅ Audit accepted in tx ${auditTx}`);
    } catch (e: any) {
      // Audit submission can fail for known reasons (single-sibling Merkle
      // limit, public-input mismatch with EZKL circuit). Surface the error
      // but don't fail the whole pipeline — the model NFT is already minted.
      console.warn(`  ⚠️  Audit submission failed (non-fatal): ${e?.shortMessage ?? e?.message ?? e}`);
    }

    console.log(`\n🏆 Pipeline complete for job #${id}:`);
    console.log(`   tokenId      = ${tokenId}`);
    console.log(`   txHash       = ${txHash}`);
    console.log(`   modelCID     = ${modelCID}`);
    console.log(`   proofCID     = ${proofCID}`);
    console.log(`   weightsHash  = ${weightsHashBytes32.slice(0, 14)}…`);
  } catch (err: any) {
    console.error(`\n❌ Pipeline failed for job #${id}: ${err.message}`);
  } finally {
    processing.delete(id);
  }
}

async function waitForJobCompletion(jobId: bigint, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const done = await (gpuMarket as any).jobCompleted(jobId);
      if (done) return true;
    } catch {}
    await sleep(3000);
  }
  return false;
}

// ── Event listeners ───────────────────────────────────────────────────────
function start() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🚀 ComputeX Orchestrator starting…`);
  console.log(`   RPC     : ${RPC_URL}`);
  console.log(`   Wallet  : ${signer.address}`);
  console.log(`   GPU Mkt : ${ANVIL_ADDRESSES.GPUMarketplace}`);
  console.log(`   NFT     : ${ANVIL_ADDRESSES.ModelNFT}`);
  console.log(`   Oracle  : ${ANVIL_ADDRESSES.PerformanceOracle}`);
  console.log(`${"═".repeat(60)}\n`);

  gpuMarket.on("JobCreated", (jobId: bigint, renter: string, gpuId: bigint) => {
    processJob(jobId, renter, gpuId).catch(console.error);
  });

  console.log(`👂 Listening for JobCreated events…`);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

start();
