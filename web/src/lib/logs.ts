// Shared chunked eth_getLogs helper. Monad testnet RPCs cap eth_getLogs at a ~100-block
// range, so event history must be fetched in chunked windows (verified: "eth_getLogs is
// limited to a 100 range"). Extracted from usePositions so other event-derived hooks
// (useMarkets whitelist path) reuse the same transport without duplicating it.
import type { Address, AbiEvent } from "viem";
import { usePublicClient } from "wagmi";

// Chunk width. The provider caps eth_getLogs ranges itself (QuikNode testnet measures
// "eth_getLogs is limited to a 1,000 range"), so 975-block chunks are legal and cut a
// 5,000-block scan from 50 requests to 6 — the whole difference between a burst that
// survives the RPC's rate cap and one that gets 429ed. Widen within the cap, never past it.
const LOG_CHUNK_BLOCKS = 975n;

export type PublicClientT = NonNullable<ReturnType<typeof usePublicClient>>;

export interface RawLog {
  data: `0x${string}`;
  topics: `0x${string}`[];
  blockNumber: bigint;
}

/**
 * Inclusive [from,to] block windows covering [fromBlock,toBlock] in ≤chunk steps.
 * `newestFirst` returns the windows in descending order (latest window first), which lets
 * callers scan for the newest data and stop early.
 */
export function blockWindows(fromBlock: bigint, toBlock: bigint, chunk = LOG_CHUNK_BLOCKS, newestFirst = false) {
  const windows: Array<{ from: bigint; to: bigint }> = [];
  for (let from = fromBlock; from <= toBlock; from += chunk) {
    const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n;
    windows.push({ from, to });
  }
  return newestFirst ? windows.reverse() : windows;
}

/** eth_getLogs helper that paginates in ≤100-block chunks to satisfy RPC range limits. */
export async function getLogsChunked(
  publicClient: PublicClientT,
  params: { address: Address; event?: AbiEvent; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint },
): Promise<RawLog[]> {
  const ranges = blockWindows(params.fromBlock, params.toBlock);

  // Fetch in small batches with per-chunk retries: firing 50 getLogs at once trips
  // provider rate limits (429), and silently dropping one chunk silently hides whatever
  // logs it holds (e.g. the newest MarketCreated — exactly the data the user came for).
  const fail = (msg: string, e: unknown) => {
    if (process.env.NODE_ENV !== "production") console.warn(msg, e);
  };
  const one = async (r: { from: bigint; to: bigint }): Promise<RawLog[]> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((res) => setTimeout(res, 400 * attempt));
      try {
        const logs = await publicClient.getLogs({
          address: params.address,
          event: params.event,
          args: params.args,
          fromBlock: r.from,
          toBlock: r.to,
        });
        return logs.map((l) => ({ data: l.data, topics: l.topics as `0x${string}`[], blockNumber: BigInt(l.blockNumber) }));
      } catch (e) {
        if (attempt === 2) fail("getLogsChunked: chunk failed after retries", e);
      }
    }
    return [];
  };

  const GET_LOGS_CONCURRENCY = 6;
  const out: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += GET_LOGS_CONCURRENCY) {
    const batch = ranges.slice(i, i + GET_LOGS_CONCURRENCY);
    const results = await Promise.all(batch.map(one));
    out.push(...results.flat());
  }
  return out;
}
