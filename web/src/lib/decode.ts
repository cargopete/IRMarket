/**
 * Name-based decoding for Monoracle read results (`quotes()`, `getLatestPrice()`).
 *
 * viem/wagmi read results are POSITIONAL tuples with no named access — the fragile
 * pattern that caused a past outage when a fork build stored the `quotes()` fields
 * in a different order (PR #10 review; the bot side was hardened to name-based
 * decoding back then, this module brings the web side to the same bar).
 *
 * We therefore derive field indexes from the doctor-gated ABI itself and fail
 * loudly (descriptive Error, never a silent mis-decode) if an expected field is
 * missing or the read result no longer matches the ABI's declared shape.
 *
 * NOTE on the default ABI: `@/lib/abis/oracle` (→ `MONORACLE_ABI`) cannot be
 * imported statically from this module, because `node --test src/lib/decode.test.ts`
 * imports this file under plain Node, where the `@/*` tsconfig path does not
 * resolve and a JSON import needs `with { type: "json" }` attributes. So we read
 * the SAME `Monoracle.json` that oracle.ts wraps (identical value: the JSON's
 * `abi` key) via a relative, attribute-carrying import — valid for both the
 * bundler (Turbopack/next build) and plain Node ≥24. Every public decode function
 * takes an optional `abi` parameter so tests can inject a minimal inline ABI and
 * never depend on the real file's contents.
 */
import type { Abi, AbiFunction } from "viem";
import type { QuoteStatus } from "@/lib/types";
import monoracleJson from "./abis/Monoracle.json" with { type: "json" };

const MISSING_ABI_RULE = "migrate the oracle, never bend the ABI (script/oracle-doctor.js)";

/** Same value as `MONORACLE_ABI` in "@/lib/abis/oracle" (see module docstring). */
const DEFAULT_MONORACLE_ABI = monoracleJson.abi as unknown as Abi;

function findAbiFunction(abi: Abi, functionName: string): AbiFunction {
  const entry = (abi as readonly unknown[]).find(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      (e as { type?: unknown }).type === "function" &&
      (e as { name?: unknown }).name === functionName,
  );
  if (!entry) {
    throw new Error(`Monoracle ABI is missing function "${functionName}" — ${MISSING_ABI_RULE}`);
  }
  return entry as AbiFunction;
}

/**
 * Builds a `{ field name → output index }` map from the function's outputs.
 * Throws if ANY output is unnamed — positional decoding of `quotes()` is forbidden.
 */
function namedOutputIndex(f: AbiFunction): Map<string, number> {
  const idx = new Map<string, number>();
  f.outputs.forEach((output, i) => {
    if (!output.name) {
      throw new Error(
        `Monoracle ABI function "${f.name}" output #${i} is unnamed — positional decoding is forbidden — ${MISSING_ABI_RULE}`,
      );
    }
    idx.set(output.name, i);
  });
  return idx;
}

const INDEX_CACHE = new WeakMap<Abi, Map<string, Map<string, number>>>();

function cachedOutputIndex(abi: Abi, functionName: string): Map<string, number> {
  let perFunction = INDEX_CACHE.get(abi);
  if (!perFunction) {
    perFunction = new Map();
    INDEX_CACHE.set(abi, perFunction);
  }
  let idx = perFunction.get(functionName);
  if (!idx) {
    idx = namedOutputIndex(findAbiFunction(abi, functionName));
    perFunction.set(functionName, idx);
  }
  return idx;
}

/**
 * `{ field name → output index }` for the given function's outputs.
 * Throws if the function is absent or any output is unnamed.
 */
export function fieldIndex(abi: Abi, functionName: string): Record<string, number> {
  return Object.fromEntries(namedOutputIndex(findAbiFunction(abi, functionName)));
}

export type DecodedQuote = {
  provider: `0x${string}`;
  baseToken: `0x${string}`;
  quoteToken: `0x${string}`;
  baseAmount: bigint;
  quoteAmount: bigint;
  price: bigint;
  startSlot: number;
  expiryBlock: bigint;
  settledSlot: number;
  status: QuoteStatus;
};

const QUOTE_FIELD_NAMES = [
  "provider",
  "baseToken",
  "quoteToken",
  "baseAmount",
  "quoteAmount",
  "price",
  "startSlot",
  "expiryBlock",
  "settledSlot",
  "status",
] as const;

/** Expected `quotes()` field→index map, derived from the doctor-gated ABI at load. */
export const QUOTE_FIELDS: Record<string, number> = fieldIndex(DEFAULT_MONORACLE_ABI, "quotes");

function asAddress(value: unknown, field: string, fn: string): `0x${string}` {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error(`Monoracle ${fn}() read field "${field}" is not an 0x address (${typeof value}) — ${MISSING_ABI_RULE}`);
  }
  return value as `0x${string}`;
}

function asBigInt(value: unknown, field: string, fn: string): bigint {
  try {
    return BigInt(value as bigint);
  } catch {
    throw new Error(`Monoracle ${fn}() read field "${field}" is not a BigInt-coercible value (${typeof value}) — ${MISSING_ABI_RULE}`);
  }
}

/**
 * Decodes a raw `quotes(quoteId)` read result into named fields, using the ABI's
 * own output ordering. Normalizes: addresses kept as-is, uint256 amounts →
 * BigInt, uint32 slots / uint8 status → Number. Throws a descriptive Error if
 * any expected field is missing or type-incompatible.
 */
export function decodeQuote(raw: readonly unknown[], abi: Abi = DEFAULT_MONORACLE_ABI): DecodedQuote {
  const idx = cachedOutputIndex(abi, "quotes");
  const pick = (field: string): unknown => {
    const i = idx.get(field);
    if (i === undefined || i >= raw.length) {
      throw new Error(
        `Monoracle quotes() read is missing output "${field}" (index ${i ?? "absent from ABI"}, tuple length ${raw.length}) — ${MISSING_ABI_RULE}`,
      );
    }
    return raw[i];
  };
  for (const field of QUOTE_FIELD_NAMES) pick(field); // fail fast on ANY missing field
  return {
    provider: asAddress(pick("provider"), "provider", "quotes"),
    baseToken: asAddress(pick("baseToken"), "baseToken", "quotes"),
    quoteToken: asAddress(pick("quoteToken"), "quoteToken", "quotes"),
    baseAmount: asBigInt(pick("baseAmount"), "baseAmount", "quotes"),
    quoteAmount: asBigInt(pick("quoteAmount"), "quoteAmount", "quotes"),
    price: asBigInt(pick("price"), "price", "quotes"),
    startSlot: Number(pick("startSlot")),
    expiryBlock: asBigInt(pick("expiryBlock"), "expiryBlock", "quotes"),
    settledSlot: Number(pick("settledSlot")),
    status: Number(pick("status")) as QuoteStatus,
  };
}

export type DecodedLatestPrice = {
  price: bigint;
  settledSlot: number;
  exists: boolean;
};

/**
 * Documented positional constant for `getLatestPrice(address,address)` when its
 * outputs are unnamed (checked: the current ABI entry in
 * web/src/lib/abis/Monoracle.json has them NAMED — price, settledSlot, exists —
 * so the name path is used; the positional path is only a fallback for a
 * re-generated ABI that loses names). Encode-known order (0,1,2) =
 * (price uint256, settledSlot/settledBlock uint32, exists bool), mirrored from
 * the vault's oracle read in web/src/hooks/useVault.ts (useVaultPrice).
 */
const LATEST_PRICE_POSITIONAL: Record<string, number> = { price: 0, settledSlot: 1, exists: 2 };

const LATEST_PRICE_FIELDS = ["price", "settledSlot", "exists"] as const;

function latestPriceIndex(abi: Abi): Record<string, number> {
  const f = findAbiFunction(abi, "getLatestPrice");
  const names = f.outputs.map((o) => o.name);
  if (LATEST_PRICE_FIELDS.every((name) => names.includes(name))) {
    return Object.fromEntries(LATEST_PRICE_FIELDS.map((name) => [name, names.indexOf(name)]));
  }
  return { ...LATEST_PRICE_POSITIONAL };
}

/**
 * Decodes a raw `getLatestPrice(base, quote)` read result into named fields:
 * by output name when the ABI names them, else positionally (0=price,
 * 1=settledSlot/Block, 2=exists — see comment above). Normalizes
 * BigInt / Number / boolean.
 */
export function decodeLatestPrice(raw: readonly unknown[], abi: Abi = DEFAULT_MONORACLE_ABI): DecodedLatestPrice {
  const idx = latestPriceIndex(abi);
  const pick = (field: string): unknown => {
    const i = idx[field];
    if (i === undefined || i >= raw.length) {
      throw new Error(
        `Monoracle getLatestPrice() read is missing output "${field}" (index ${i ?? "absent"}, tuple length ${raw.length}) — ${MISSING_ABI_RULE}`,
      );
    }
    return raw[i];
  };
  return {
    price: asBigInt(pick("price"), "price", "getLatestPrice"),
    settledSlot: Number(pick("settledSlot")),
    exists: Boolean(pick("exists")),
  };
}
