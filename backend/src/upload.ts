/**
 * upload.ts — Upload model weights and zkML proof to 0G Storage.
 *
 * For MVP: if ZG_STORAGE_URL is set to the real 0G testnet, we POST the file
 * via their upload API. Otherwise we write locally and return a deterministic
 * fake CID (safe for anvil demos).
 *
 * Real 0G upload docs: https://docs.0g.ai/build-with-0g/storage-sdk
 */

import fs   from "fs";
import path from "path";
import crypto from "crypto";

const ZG_URL = process.env.ZG_STORAGE_URL ?? "";

/**
 * Compute a sha256-based "fake CID" for local/demo use.
 * Format: bafybeif<hex32> (mimics IPFS CIDv1 structure).
 */
function fakeCid(content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `bafybeif${hash.slice(0, 48)}`;
}

/**
 * Upload a file to 0G Storage or return a simulated CID.
 * @param filePath Absolute path to the file to upload
 * @param label    Human-readable label for logging
 */
export async function uploadToStorage(filePath: string, label: string): Promise<string> {
  const content = fs.readFileSync(filePath, "utf8");

  if (ZG_URL && ZG_URL.startsWith("http")) {
    try {
      // 0G Storage REST upload (v0 API — adjust path per current docs)
      const FormData = (await import("form-data")).default;
      const axios    = (await import("axios")).default;
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath));
      const res = await axios.post(`${ZG_URL}/upload`, form, {
        headers: form.getHeaders(),
        timeout: 30_000,
      });
      const cid: string = res.data?.root ?? res.data?.cid ?? res.data?.hash;
      if (!cid) throw new Error("No CID in response: " + JSON.stringify(res.data));
      console.log(`  ✅ [0G Storage] ${label} uploaded → ${cid}`);
      return cid;
    } catch (err: any) {
      console.warn(`  ⚠️  0G upload failed (${err.message?.slice(0,60)}), falling back to simulated CID`);
    }
  }

  // Simulated CID (deterministic, safe for demos)
  const cid = fakeCid(content);
  console.log(`  📦 [Simulated] ${label} → ${cid}`);
  return cid;
}
