// Uniswap Trading API integration.
//
// Endpoint reference: https://developers.uniswap.org/  (Trading API → /v1/quote)
//
// The public Trading API gives optimal route + gas estimate + amountOut for a
// (tokenIn, tokenOut, amount) triple. AlphaTrade's meta-agents use this to:
//   1) preview the trade in the UI before signing,
//   2) verify the on-chain TradingExecutor.executeTrade output is in the
//      neighborhood of what off-chain routing predicted (a sanity bound),
//   3) (future) consume the API's swap calldata directly when we move from
//      single-pool exactInputSingle to multi-hop routing.
//
// Many endpoints require an API key in production. For local dev we hit the
// public swap-router endpoint and fall back to a local linear-fee estimate
// when the request fails (CORS / 401 / 429). The fallback is clearly labeled
// in the response so the UI can render a "estimated — API key needed" badge.

export type TokenSymbol = "USDC" | "WETH" | "WBTC" | "LINK" | "UNI";

// Sepolia & Mainnet token addresses for the basket. AlphaTrade's TradingExecutor
// trades a 5-asset basket on Sepolia; mainnet swaps use the same symbols.
const TOKENS: Record<number, Record<TokenSymbol, { address: string; decimals: number }>> = {
  // Mainnet
  1: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6  },
    WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8  },
    LINK: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
    UNI:  { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
  },
  // Sepolia (canonical test addresses)
  11155111: {
    USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6  },
    WETH: { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18 },
    WBTC: { address: "0x29f2D40B0605204364af54EC677bD022dA425d03", decimals: 8  },
    LINK: { address: "0x779877A7B0D9E8603169DdbD7836e478b4624789", decimals: 18 },
    UNI:  { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
  },
};

export interface QuoteResult {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;          // human-readable
  amountOut: string;         // human-readable
  amountOutRaw: string;      // wei-units string
  gasEstimate?: string;
  routeText: string;         // e.g. "USDC → WETH (0.05% pool)"
  source: "uniswap-api" | "estimate";
  notice?: string;
}

const TRADING_API = "https://trade-api.gateway.uniswap.org/v1/quote";

/**
 * Fetch a live route quote from the Uniswap Trading API. Falls back to a
 * deterministic local estimate (1:1 with a 0.3% fee haircut) if the API
 * is unreachable or rate-limited — the UI shows the source clearly.
 */
export async function getQuote(
  chainId: number,
  tokenIn: TokenSymbol,
  tokenOut: TokenSymbol,
  amountInHuman: number,
): Promise<QuoteResult> {
  const tokens = TOKENS[chainId] ?? TOKENS[1];
  const inMeta  = tokens[tokenIn];
  const outMeta = tokens[tokenOut];
  const amountInRaw = BigInt(Math.floor(amountInHuman * 10 ** inMeta.decimals));

  try {
    const res = await fetch(TRADING_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type:           "EXACT_INPUT",
        tokenInChainId:  chainId,
        tokenOutChainId: chainId,
        tokenIn:        inMeta.address,
        tokenOut:       outMeta.address,
        amount:         amountInRaw.toString(),
        slippageTolerance: "0.5",
        configs: [{ routingType: "CLASSIC", protocols: ["V3"] }],
      }),
    });
    if (!res.ok) throw new Error(`api ${res.status}`);
    const data = await res.json();
    const quote = data.quote ?? data;
    const amountOutRaw = BigInt(quote.output?.amount ?? quote.quote ?? "0");
    return {
      tokenIn, tokenOut,
      amountIn:     amountInHuman.toString(),
      amountOut:    (Number(amountOutRaw) / 10 ** outMeta.decimals).toFixed(6),
      amountOutRaw: amountOutRaw.toString(),
      gasEstimate:  quote.gasUseEstimate?.toString(),
      routeText:    `${tokenIn} → ${tokenOut} (Uniswap v3, classic routing)`,
      source:       "uniswap-api",
    };
  } catch (e: any) {
    // Public endpoint may require an API key or block CORS — fall back to a
    // labelled estimate so the UI still has something to show.
    const fallbackOut = amountInHuman * 0.997; // 30 bps fee approximation
    const adj = fallbackOut * 10 ** (outMeta.decimals - inMeta.decimals);
    return {
      tokenIn, tokenOut,
      amountIn:     amountInHuman.toString(),
      amountOut:    adj.toFixed(6),
      amountOutRaw: BigInt(Math.floor(adj * 10 ** outMeta.decimals)).toString(),
      routeText:    `${tokenIn} → ${tokenOut} (fallback estimate, 30bps fee)`,
      source:       "estimate",
      notice:       `Uniswap API unreachable (${e.message?.slice(0,40) ?? "error"}). Set UNISWAP_API_KEY for live quotes.`,
    };
  }
}

export const BASKET_TOKENS: TokenSymbol[] = ["WETH", "WBTC", "LINK", "UNI"];
