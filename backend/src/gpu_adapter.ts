/**
 * gpu_adapter.ts — Provider-side keeper daemon.
 *
 * AlphaTrade's "GPU provider" is the role that:
 *   1. Lists hardware on GPUMarketplace.
 *   2. Receives JobCreated events when a renter rents that hardware.
 *   3. Runs the actual compute (training) on the rented job.
 *   4. Calls completeJob() to settle and receive payment.
 *
 * For the M4 / local-machine setup this daemon is the GPU provider. It
 * listens for JobCreated events on chain, filters to events where its
 * own wallet is the listed provider, drives train + prove via the FastAPI
 * shim at port 8001, then calls completeJob to mark the job done.
 *
 * Usage (provider account):
 *     export PRIVATE_KEY=0x<provider key>          # Anvil acc1 or your real key
 *     export RPC_URL=http://127.0.0.1:8545         # Anvil; use $ZG_RPC_URL for 0G
 *     export ZKML_SHIM_URL=http://localhost:8001   # default
 *     ts-node src/gpu_adapter.ts
 *
 * If the FastAPI shim isn't running, the daemon still calls completeJob
 * (so the renter can mint) but logs a warning that no real artifacts were
 * produced — useful for demo recordings where you want the on-chain flow
 * to finish without the 90-second EZKL prove.
 */

import "dotenv/config";
import { ethers } from "ethers";
import { ANVIL_ADDRESSES, GPU_MARKETPLACE_ABI } from "./contracts";

const RPC_URL       = process.env.RPC_URL       ?? "http://127.0.0.1:8545";
const PRIVATE_KEY   = process.env.PRIVATE_KEY   ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Anvil acc1
const ZKML_SHIM_URL = process.env.ZKML_SHIM_URL ?? "http://localhost:8001";
const SKIP_COMPUTE  = process.env.SKIP_COMPUTE === "1";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
const gpu      = new ethers.Contract(
  ANVIL_ADDRESSES.GPUMarketplace, GPU_MARKETPLACE_ABI, signer,
);

const inflight = new Set<string>();

async function shimReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${ZKML_SHIM_URL}/`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function trainAndProve(jobId: bigint): Promise<{ trainDir: string; proofDir: string } | null> {
  if (SKIP_COMPUTE) {
    console.log(`  ⏩ SKIP_COMPUTE=1 — pretending compute is done`);
    return null;
  }
  if (!(await shimReachable())) {
    console.warn(`  ⚠️  zkML shim at ${ZKML_SHIM_URL} not reachable — skipping compute, will still call completeJob`);
    return null;
  }
  console.log(`  ▶ POST /train  (job_id=${jobId})`);
  const tRes = await fetch(`${ZKML_SHIM_URL}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: Number(jobId), epochs: 20 }),
  });
  if (!tRes.ok) { console.error(`  ✗ train failed: ${tRes.status}`); return null; }
  const t = await tRes.json();
  console.log(`  ✓ trained → ${t.weights_dir} (weightsHash ${(t.weights_hash ?? "").slice(0, 14)}…)`);

  console.log(`  ▶ POST /prove`);
  const pRes = await fetch(`${ZKML_SHIM_URL}/prove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weights_dir: t.weights_dir, epoch: 1 }),
  });
  if (!pRes.ok) { console.error(`  ✗ prove start failed: ${pRes.status}`); return null; }
  const job = await pRes.json();

  // Poll until done
  const start = Date.now();
  while (Date.now() - start < 5 * 60_000) {
    const r = await fetch(`${ZKML_SHIM_URL}/jobs/${job.job_id}`);
    const s = await r.json();
    if (s.status === "done")  {
      console.log(`  ✓ proof generated in ${Math.round(s.elapsed)}s`);
      return { trainDir: t.weights_dir, proofDir: s.proof_dir };
    }
    if (s.status === "failed") { console.error(`  ✗ prove failed: ${JSON.stringify(s.error).slice(0, 200)}`); return null; }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.warn(`  ⚠️  prove timeout`);
  return null;
}

async function handleJob(jobId: bigint, gpuId: bigint, renter: string) {
  const id = jobId.toString();
  if (inflight.has(id)) return;
  inflight.add(id);

  try {
    // Confirm we're the listed provider for this GPU.
    const gpuRow = await gpu.getGPU(gpuId);
    const providerAddr = gpuRow[0] as string;
    if (providerAddr.toLowerCase() !== signer.address.toLowerCase()) {
      console.log(`  (skipping job #${id} — provider is ${providerAddr.slice(0, 10)}…, not us)`);
      return;
    }

    console.log(`\n▶ Job #${id} on GPU #${gpuId} from ${renter.slice(0, 10)}…`);
    await trainAndProve(jobId);

    console.log(`  ▶ completeJob(${id})`);
    const tx = await gpu.completeJob(jobId);
    console.log(`  tx: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✓ Job #${id} settled`);
  } catch (e: any) {
    console.error(`✗ Job #${id} failed: ${e.shortMessage ?? e.message ?? e}`);
  } finally {
    inflight.delete(id);
  }
}

async function main() {
  console.log(`══════════════════════════════════════════════════════════`);
  console.log(`AlphaTrade GPU adapter — local provider daemon`);
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Provider: ${signer.address}`);
  console.log(`  Shim:     ${ZKML_SHIM_URL} ${(await shimReachable()) ? "✓" : "(unreachable — will still settle on chain)"}`);
  console.log(`  Skip ML:  ${SKIP_COMPUTE ? "yes" : "no"}`);
  console.log(`══════════════════════════════════════════════════════════`);

  // Catch up on any unprocessed jobs from past blocks (last 1000)
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - 1000);
  const past = await gpu.queryFilter(gpu.filters.JobCreated(), from, head);
  console.log(`Backfill: ${past.length} JobCreated events in last 1000 blocks`);
  for (const ev of past) {
    const args = (ev as any).args;
    if (!args) continue;
    const completed = await gpu.jobCompleted(args.jobId).catch(() => false);
    if (completed) continue;
    await handleJob(args.jobId, args.gpuId, args.renter);
  }

  // Live subscription
  gpu.on(gpu.filters.JobCreated(), (jobId: bigint, renter: string, gpuId: bigint) => {
    handleJob(jobId, gpuId, renter);
  });
  console.log("Listening for JobCreated…\n");
}

main().catch(e => { console.error(e); process.exit(1); });
