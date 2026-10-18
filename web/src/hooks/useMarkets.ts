"use client";

import { useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { decodeEventLog, getAddress, type AbiEvent } from "viem";
import { IRMARKET_ABI } from "@/lib/abis/market";
import { getLogsChunked } from "@/lib/logs";
import { useCurrentBlock } from "./useCurrentBlock";
import { useTokenMeta } from "./useTokenMeta";
import { MARKET_ADDRESS, MARKET_ADDRESS_RAW, SELECTED_BASE_TOKENS, hasWrapper } from "@/lib/config";
import { TOKEN_META_PENDING } from "@/lib/types";
import type { Market, MarketWithMeta } from "@/lib/types";

// Whitelist path: the current-round set comes from chunked `MarketCreated` getLogs with a
// baseToken topic filter (RPC-side filtering), NOT from a 1..nextMarketId multicall. The
// full enumeration is O(all markets ever created) per poll — 165+ calls — and gets the
// batch throttled by the RPC ("Market not found." flakes). The event carries every field
// markets() returns (baseToken/quoteToken/marketMaker/expiryBlock/feeBps are emitted,
// createdAtBlock = log block), so zero per-market reads are needed. History depth is the
// lookback window (the bot rolls short rounds, so ~50 chunk requests cover several hours
// of rounds — same budget usePositions is proven at).
const MARKET_CREATED_EVENT = IRMARKET_ABI.find(
  (e): e is Extract<(typeof IRMARKET_ABI)[number], { type: "event" }> => e.type === "event" && e.name === "MarketCreated",
) as AbiEvent;
const MARKET_LOOKBACK_BLOCKS = 5000n;

/** Markets: whitelist-filtered event scan when curated; legacy full enumeration otherwise. */
export function useMarkets(): MarketWithMeta[] {
  const publicClient = usePublicClient();
  const blockNumber = useCurrentBlock();
  const curatedOnly = hasWrapper && SELECTED_BASE_TOKENS.length > 0;
  const configuredForWrapper = hasWrapper && MARKET_ADDRESS_RAW !== "";

  // --- legacy path (no whitelist configured): enumerate 1..nextMarketId-1 --------------
  const { data } = useReadContracts({
    contracts: !curatedOnly && configuredForWrapper
      ? ([
          {
            address: MARKET_ADDRESS as `0x${string}`,
            abi: IRMARKET_ABI,
            functionName: "nextMarketId",
          },
        ] as const)
      : [],
    query: { enabled: !curatedOnly && configuredForWrapper },
  });

  // nextMarketId is the NEXT unused id, so valid markets are 1..nextMarketId-1.
  // (Enumerating up to nextMarketId inclusive reads a non-existent market → ???/???.
  const nextMarketId = (data?.[0]?.result as bigint | undefined) ?? 0n;

  const marketIds = useMemo(() => {
    if (!configuredForWrapper || curatedOnly || nextMarketId <= 1n) return [];
    const ids: bigint[] = [];
    for (let id = 1n; id < nextMarketId; id++) ids.push(id);
    return ids;
  }, [configuredForWrapper, curatedOnly, nextMarketId]);

  const { data: marketsData } = useReadContracts({
    contracts: marketIds.map((marketId) => ({
      address: MARKET_ADDRESS as `0x${string}`,
      abi: IRMARKET_ABI,
      functionName: "markets",
      args: [marketId],
    })),
    query: { enabled: !curatedOnly && marketIds.length > 0 },
  });

  const legacyMarkets: Market[] = useMemo(() => {
    if (curatedOnly) return [];
    return (marketsData ?? [])
      .map((entry, i) => {
        const r = entry.result;
        if (!r) return null;
        const base = Array.isArray(r) ? (r[0] as `0x${string}`) : (r as unknown as { baseToken: `0x${string}` }).baseToken;
        const quote = Array.isArray(r) ? (r[1] as `0x${string}`) : (r as unknown as { quoteToken: `0x${string}` }).quoteToken;
        return {
          marketId: marketIds[i],
          baseToken: base,
          quoteToken: quote,
          marketMaker: Array.isArray(r) ? (r[2] as `0x${string}`) : (r as unknown as { marketMaker: `0x${string}` }).marketMaker,
          // uint16 → viem decodes it as a JS number, not a bigint; coerce so the
          // declared `bigint` type holds at runtime (computeFee does bigint math).
          feeBps: BigInt(Array.isArray(r) ? (r[3] as bigint | number) : (r as unknown as { feeBps: bigint | number }).feeBps),
          expiryBlock: Array.isArray(r) ? (r[4] as bigint) : (r as unknown as { expiryBlock: bigint }).expiryBlock,
          createdAtBlock: Array.isArray(r) ? (r[5] as bigint) : (r as unknown as { createdAtBlock: bigint }).createdAtBlock,
        } satisfies Market;
      })
      .filter((m): m is Market => m !== null);
  }, [curatedOnly, marketsData, marketIds]);

  // --- whitelist path: chunked MarketCreated scan with a baseToken topic filter --------
  const eventQuery = useQuery({
    queryKey: ["markets-curated", MARKET_ADDRESS_RAW, SELECTED_BASE_TOKENS.join(",")],
    queryFn: async (): Promise<Market[]> => {
      if (!publicClient || !configuredForWrapper) return [];
      const latest = blockNumber ?? (await publicClient.getBlockNumber());
      const fromBlock = latest > MARKET_LOOKBACK_BLOCKS ? latest - MARKET_LOOKBACK_BLOCKS : 0n;
      const logs = await getLogsChunked(publicClient, {
        address: MARKET_ADDRESS as `0x${string}`,
        event: MARKET_CREATED_EVENT,
        args: { baseToken: SELECTED_BASE_TOKENS.map((a) => getAddress(a)) },
        fromBlock,
        toBlock: latest,
      });
      // One createMarket per marketId; keep the newest if a log repeats.
      const byId = new Map<string, Market>();
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: IRMARKET_ABI,
            data: log.data,
            topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          });
          if (decoded.eventName !== "MarketCreated") continue;
          const a = decoded.args as unknown as Record<string, unknown>;
          const marketId = a.marketId as bigint;
          const market: Market = {
            marketId,
            baseToken: a.baseToken as `0x${string}`,
            quoteToken: a.quoteToken as `0x${string}`,
            marketMaker: a.marketMaker as `0x${string}`,
            feeBps: BigInt(a.feeBps as bigint | number),
            expiryBlock: a.expiryBlock as bigint,
            createdAtBlock: log.blockNumber,
          };
          byId.set(marketId.toString(), market);
        } catch {
          continue;
        }
      }
      return [...byId.values()];
    },
    enabled: publicClient !== undefined && curatedOnly,
    refetchInterval: blockNumber !== undefined ? 15000 : 5000,
    staleTime: 5000,
  });

  const wrapperMarkets = curatedOnly ? eventQuery.data ?? [] : legacyMarkets;

  const tokenAddresses = useMemo(
    () =>
      wrapperMarkets.reduce<`0x${string}`[]>((acc, m) => {
        if (!acc.includes(m.baseToken)) acc.push(m.baseToken);
        if (!acc.includes(m.quoteToken)) acc.push(m.quoteToken);
        return acc;
      }, []),
    [wrapperMarkets],
  );
  const metaMap = useTokenMeta(tokenAddresses);

  const enriched = useMemo(
    () =>
      wrapperMarkets.map((m) => {
        const baseMeta = metaMap.get(m.baseToken.toLowerCase());
        const quoteMeta = metaMap.get(m.quoteToken.toLowerCase());
        const baseSymbol = baseMeta?.symbol ?? TOKEN_META_PENDING;
        const quoteSymbol = quoteMeta?.symbol ?? TOKEN_META_PENDING;
        return {
          ...m,
          baseSymbol,
          quoteSymbol,
          baseDecimals: baseMeta?.decimals ?? 18,
          quoteDecimals: quoteMeta?.decimals ?? 18,
          name: `${baseSymbol}/${quoteSymbol}`,
          ticker: `${baseSymbol}/${quoteSymbol}`,
        };
      }),
    [wrapperMarkets, metaMap],
  );

  // Curation (frontend-only registry, per-pair vault model - docs/architecture.md §7):
  // keep only markets whose base token is on the selected list; absent/empty shows all.
  // The event path is already filtered RPC-side; the filter stays as a cheap invariant.
  const curated = useMemo(() => {
    if (SELECTED_BASE_TOKENS.length === 0) return enriched;
    const set = new Set(SELECTED_BASE_TOKENS);
    return enriched.filter((m) => set.has(m.baseToken.toLowerCase()));
  }, [enriched]);
  // Sort so markets still in their quote window come first (soonest-expiring first), then
  // expired ones last. A market is "active" while its expiryBlock is still ahead of now.
  const sorted = useMemo(() => {
    if (blockNumber === undefined) return curated;
    return [...curated].sort((a, b) => {
      const aActive = a.expiryBlock > blockNumber ? 0 : 1;
      const bActive = b.expiryBlock > blockNumber ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.expiryBlock < b.expiryBlock ? -1 : a.expiryBlock > b.expiryBlock ? 1 : 0;
    });
  }, [curated, blockNumber]);

  return sorted;
}
