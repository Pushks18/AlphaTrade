// Frontend client for the KeeperHub proxy route at /api/keeperhub.
// Calls our own Next.js endpoint, which holds KEEPERHUB_API_KEY and forwards
// to KeeperHub's /v1/workflows endpoint. Returns either a real workflow id
// + tx hash (live mode) or a demo response when the key isn't configured.

export interface KeeperhubResponse {
  mode:        "live" | "demo";
  txHash?:     string;
  workflowId?: string;
  route?:      string;
  notice?:     string;
  error?:      string;
}

export async function submitTradeViaKeeperhub(req: {
  tokenIn:  string;
  tokenOut: string;
  amount:   string;     // human-readable
  slippage?: number;    // percent
  vault?:   string;
}): Promise<KeeperhubResponse> {
  const r = await fetch("/api/keeperhub", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(req),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { mode: "demo", error: data?.error ?? `http ${r.status}` };
  }
  return data as KeeperhubResponse;
}
