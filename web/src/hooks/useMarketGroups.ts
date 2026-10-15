"use client";

import { useMemo } from "react";
import type { Market, MarketWithMeta } from "@/lib/types";
import { useCurrentBlock } from "./useCurrentBlock";
import { useMarkets } from "./useMarkets";

/**
 * One entry per asset pair (e.g. NVDA/KD) regardless of how many expiry rounds exist.
 * The Market tab shows a single card per asset instead of every historical round.
 */
export interface MarketGroup {
  baseToken: Market["baseToken"];
  quoteToken: Market["quoteToken"];
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  /** All rounds whose expiryBlock is still ahead of the current block, soonest-expiring first. */
  activeRounds: MarketWithMeta[];
  /** Soonest-expiring live round — the tradeable one (activeRounds[0]). */
  active: MarketWithMeta | null;
  /** Highest-expiryBlock round; the card still needs a target when no round is active. */
  latest: MarketWithMeta;
  /** Total rounds ever created for this pair (active + expired). */
  rounds: number;
}

function pickActiveRounds(markets: MarketWithMeta[], blockNumber: bigint | undefined): MarketWithMeta[] {
  if (blockNumber === undefined) return [];
  return markets
    .filter((m) => m.expiryBlock > blockNumber)
    .sort((a, b) => (a.expiryBlock < b.expiryBlock ? -1 : a.expiryBlock > b.expiryBlock ? 1 : 0));
}

function pickLatest(markets: MarketWithMeta[]): MarketWithMeta {
  return markets.reduce((a, b) => (b.expiryBlock > a.expiryBlock ? b : a));
}

/**
 * Groups the full market list by (baseToken, quoteToken) pair.
 * - `active`: soonest round whose expiryBlock is still ahead of the current block.
 * - `latest`: last round ever created; the display fallback while waiting for the next round.
 */
export function useMarketGroups(): MarketGroup[] {
  const markets = useMarkets();
  const blockNumber = useCurrentBlock();

  return useMemo(() => {
    const groups = new Map<string, { tokens: MarketGroup["baseToken"][]; markets: MarketWithMeta[] }>();
    for (const m of markets) {
      const key = `${m.baseToken.toLowerCase()}/${m.quoteToken.toLowerCase()}`;
      const entry = groups.get(key) ?? { tokens: [m.baseToken, m.quoteToken], markets: [] };
      entry.markets.push(m);
      groups.set(key, entry);
    }

    const result: MarketGroup[] = [];
    for (const { tokens, markets: rounds } of groups.values()) {
      const [baseToken, quoteToken] = tokens;
      const baseSymbol = rounds[0].baseSymbol;
      const quoteSymbol = rounds[0].quoteSymbol;
      const activeRounds = pickActiveRounds(rounds, blockNumber);
      result.push({
        baseToken,
        quoteToken,
        baseSymbol,
        quoteSymbol,
        baseDecimals: rounds[0].baseDecimals,
        quoteDecimals: rounds[0].quoteDecimals,
        activeRounds,
        active: activeRounds[0] ?? null,
        latest: pickLatest(rounds),
        rounds: rounds.length,
      });
    }

    // Active pairs first (soonest-settling first), then pairs awaiting their next round.
    return result.sort((a, b) => {
      const aActive = a.active ? 0 : 1;
      const bActive = b.active ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      if (a.active && b.active) return a.active.expiryBlock < b.active.expiryBlock ? -1 : 1;
      return a.baseSymbol.localeCompare(b.baseSymbol);
    });
  }, [markets, blockNumber]);
}
