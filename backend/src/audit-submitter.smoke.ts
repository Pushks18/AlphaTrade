/**
 * Smoke test for audit-submitter encoding.
 *
 *   ts-node src/audit-submitter.smoke.ts /tmp/ax_prove /tmp/ax_train
 *
 * Verifies packSubmission produces a tuple with the right shape against real
 * artifacts produced by prove.py. Does NOT submit on chain — that's gated by
 * the EZKL public-input + multi-level-Merkle limitations documented in
 * audit-submitter.ts.
 */
import fs from "fs";
import path from "path";
import { loadProofArtifacts, packSubmission } from "./audit-submitter";

function main() {
  const proveDir = process.argv[2] ?? "/tmp/ax_prove";
  const trainDir = process.argv[3] ?? "/tmp/ax_train";

  const meta = JSON.parse(fs.readFileSync(path.join(trainDir, "meta.json"), "utf8")) as { weightsHash: string };
  const { bundle, feed } = loadProofArtifacts(proveDir);

  const sub = packSubmission({
    tokenId: 1n,
    modelWeightsHash: meta.weightsHash,
    bundle, feed,
  });

  const checks = [
    ["tokenId is bigint",            typeof sub.tokenId === "bigint"],
    ["epoch is bigint",              typeof sub.epoch === "bigint"],
    ["modelWeightsHash 0x… 64hex",   /^0x[0-9a-f]{64}$/i.test(sub.modelWeightsHash)],
    ["outputsHash 0x… 64hex",        /^0x[0-9a-f]{64}$/i.test(sub.outputsHash)],
    ["publicInputs len 3",           sub.publicInputs.length === 3],
    ["snarkProof starts 0x",         sub.snarkProof.startsWith("0x")],
    ["snarkProof non-empty",         sub.snarkProof.length > 2],
    ["outputs all bigint",           sub.outputs.every(o => typeof o === "bigint")],
    ["priceFeedBars all bigint",     sub.priceFeedBars.every(b => typeof b === "bigint")],
    ["priceFeedIndexes all bigint",  sub.priceFeedIndexes.every(i => typeof i === "bigint")],
    ["priceFeedSiblings all 0x… 64", sub.priceFeedSiblings.every((s: string) => /^0x[0-9a-f]{64}$/i.test(s))],
  ] as const;

  // KNOWN MISMATCH (F1 scope): the contract requires bars.len === outputs.len,
  // but prove.py emits multi-asset outputs ((n_rows, 5) flattened to n_rows*5)
  // while bars is one-per-bar (n_audit_bars). Reconciling the shapes requires
  // either contract-side multi-asset Sharpe (out of scope) or pipeline-side
  // reshaping at the audit boundary. F1 does the literal encoding; the
  // orchestrator catches the resulting on-chain revert and logs a warning
  // rather than failing the whole pipeline.
  console.log(`\nKnown shape mismatch (NOT a smoke failure):`);
  console.log(`  outputs.length             = ${sub.outputs.length}    (n_rows × NUM_TOKENS)`);
  console.log(`  priceFeedBars.length       = ${sub.priceFeedBars.length}    (n_audit_bars, basket-mean)`);
  console.log(`  → contract submitAudit will revert "Oracle: bars/outputs len"`);
  console.log(`  → tracked as v2 follow-up: contract multi-asset sharpe OR`);
  console.log(`    pipeline collapse to scalar weights per bar`);

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}`);
    if (!pass) ok = false;
  }
  console.log(`\nSubmission summary:`);
  console.log(`  outputs.length      = ${sub.outputs.length}`);
  console.log(`  proof bytes         = ${(sub.snarkProof.length - 2) / 2}`);
  console.log(`  modelWeightsHash    = ${sub.modelWeightsHash.slice(0, 14)}…`);
  console.log(`  outputsHash         = ${sub.outputsHash.slice(0, 14)}…`);

  if (!ok) process.exit(1);
}

main();
