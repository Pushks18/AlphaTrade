#!/usr/bin/env node
// upload_0g.js — uploads a local file to 0G Storage via @0glabs/0g-ts-sdk.
//
// Used by FastAPI's /upload-0g endpoint when the user clicks "Upload to 0G".
// Requires ZG_PRIVATE_KEY (signs the storage commitment tx on 0G chain).
//
// Usage:
//     ZG_PRIVATE_KEY=0x... ZG_RPC_URL=https://evmrpc-testnet.0g.ai \
//     node upload_0g.js <path-to-file>
//
// Output (stdout): single JSON line with { rootHash, txHash, gateway } on success
//                  or { error } on failure.
//
// Notes:
// - The 0G testnet (Galileo) RPC + indexer follow the canonical 0G docs.
// - Without ZG_PRIVATE_KEY this script falls back to a deterministic
//   pseudo-rootHash so the demo flow doesn't break locally; a clear
//   "mode: stub" flag is included in the response for the UI to display.

import { promises as fs } from "node:fs";
import { argv, env } from "node:process";
import { createHash } from "node:crypto";

async function main() {
  const path = argv[2];
  if (!path) { console.log(JSON.stringify({ error: "missing file path" })); return; }

  const buf = await fs.readFile(path);

  // Stub mode — no key, but UI flow continues.
  if (!env.ZG_PRIVATE_KEY) {
    const h = createHash("sha256").update(buf).digest("hex");
    console.log(JSON.stringify({
      mode: "stub",
      rootHash: "0x" + h,
      gateway: `https://indexer-storage-testnet-turbo.0g.ai/file/0x${h}`,
      notice:  "ZG_PRIVATE_KEY not set; rootHash is sha256 of file (deterministic, off-chain). Set the key for a real on-chain commitment.",
      bytes:   buf.length,
    }));
    return;
  }

  // Live mode: dynamic-import the SDK so the stub path works without the dep.
  let ZgFile, Indexer, ethers;
  try {
    ({ ZgFile, Indexer } = await import("@0glabs/0g-ts-sdk"));
    ethers = await import("ethers");
  } catch (e) {
    console.log(JSON.stringify({ error: "missing @0glabs/0g-ts-sdk — run: npm i @0glabs/0g-ts-sdk ethers" }));
    return;
  }

  const RPC = env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const INDEXER = env.ZG_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const signer   = new ethers.Wallet(env.ZG_PRIVATE_KEY, provider);
    const indexer  = new Indexer(INDEXER);

    const file = await ZgFile.fromFilePath(path);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) throw new Error(`merkleTree: ${treeErr}`);
    const rootHash = tree.rootHash();

    const [tx, uploadErr] = await indexer.upload(file, RPC, signer);
    if (uploadErr) throw new Error(`upload: ${uploadErr}`);

    console.log(JSON.stringify({
      mode:     "live",
      rootHash,
      txHash:   tx,
      gateway:  `${INDEXER}/file/${rootHash}`,
      bytes:    buf.length,
    }));
  } catch (e) {
    console.log(JSON.stringify({ error: e?.message ?? String(e) }));
  }
}

main().catch(e => { console.log(JSON.stringify({ error: e?.message ?? String(e) })); });
