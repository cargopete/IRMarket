"use client";

import { useReadContracts } from "wagmi";
import { useMemo } from "react";
import { ERC20_ABI } from "@/lib/abis/market";

export interface TokenMeta {
  symbol: string;
  decimals: number;
}

/**
 * Batch-fetch symbol() + decimals() for a set of token addresses.
 * Returns a Map keyed by lowercase address for O(1) lookup.
 * Falls back to { symbol: "???", decimals: 18 } when a call fails.
 */
export function useTokenMeta(addresses: `0x${string}`[]) {
  // Drop invalid/placeholder addresses ("0x"): a batch containing them errors on viem's
  // isAddress assert and the entry gets stuck (symbols render "???" forever).
  const valid = useMemo(
    () => [...new Set(addresses.filter((a) => a && a !== "0x").map((a) => a.toLowerCase()))],
    [addresses],
  );

  const { data } = useReadContracts({
    contracts: valid.flatMap((addr) => [
      { address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "symbol", args: [] as never[] },
      { address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "decimals", args: [] as never[] },
    ]),
    query: { enabled: valid.length > 0 },
  });

  const metaMap = useMemo(() => {
    const map = new Map<string, TokenMeta>();
    for (let i = 0; i < valid.length; i++) {
      const symbolResult = data?.[i * 2]?.result as string | undefined;
      const decimalsResult = data?.[i * 2 + 1]?.result as number | undefined;
      map.set(valid[i], {
        symbol: symbolResult ?? "???",
        decimals: decimalsResult ?? 18,
      });
    }
    return map;
  }, [data, valid]);

  return metaMap;
}
