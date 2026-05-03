// Server-side proxy for KeeperHub's execution API.
// Keeps KEEPERHUB_API_KEY off the client. Called by the AgentPanel /
// VaultDetail UI to schedule a trade workflow on the user's behalf.
//
// In production a meta-agent vault would have its own KeeperHub workflow
// pre-registered (running every N minutes, gated by a policy hash). This
// endpoint gives the *operator* (NFT owner) a manual trigger for demo and
// emergency purposes — KeeperHub handles retry, gas optimization, MEV
// protection, and audit trail end-to-end.

import { NextRequest } from "next/server";

const KEEPERHUB_URL = process.env.KEEPERHUB_API_URL ?? "https://api.keeperhub.com/v1/workflows";

export async function POST(req: NextRequest) {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  // Validate the operator at least named the swap; we don't try to verify
  // the on-chain signer here — KeeperHub's MCP/CLI flow is the canonical
  // path for that. This is a UI-trigger convenience.
  const { tokenIn, tokenOut, amount, slippage, vault } = body ?? {};
  if (!tokenIn || !tokenOut || !amount) {
    return Response.json({ error: "missing tokenIn/tokenOut/amount" }, { status: 400 });
  }

  // Demo mode (no key configured): return a plausible-looking response so
  // the UI flow still works end-to-end during local dev.
  if (!apiKey) {
    return Response.json({
      mode:   "demo",
      txHash: "0x" + crypto.getRandomValues(new Uint8Array(32))
                       .reduce((s, b) => s + b.toString(16).padStart(2, "0"), ""),
      workflowId: `wf_demo_${Date.now()}`,
      route:  `${tokenIn} → ${tokenOut} via Uniswap V3 (KeeperHub guaranteed exec)`,
      notice: "Set KEEPERHUB_API_KEY in .env.local to hit live api.keeperhub.com",
    });
  }

  const payload = {
    steps: [{
      action: "uniswap.swap",
      params: {
        tokenIn,
        tokenOut,
        amount: String(amount),
        slippage: slippage ?? 0.5,
        recipient: vault,        // KeeperHub credits swap output here
      },
    }],
    metadata: {
      source: "alphatrade-vault",
      vault:   vault ?? null,
      ts:      Date.now(),
    },
  };

  try {
    const r = await fetch(KEEPERHUB_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return Response.json({ error: data?.error ?? `keeperhub ${r.status}`, raw: data }, { status: r.status });
    }
    return Response.json({ mode: "live", ...data });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "fetch failed" }, { status: 502 });
  }
}
