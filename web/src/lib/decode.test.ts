import { test } from "node:test";
import assert from "node:assert/strict";
import type { Abi } from "viem";
import { decodeQuote, decodeLatestPrice } from "./decode.ts";

// Minimal inline ABI — injected via the optional `abi` parameter, so these tests
// never touch the real Monoracle.json (which plain node cannot import unattributed).
const quoteOutputs = [
  { name: "provider", type: "address" },
  { name: "baseToken", type: "address" },
  { name: "quoteToken", type: "address" },
  { name: "baseAmount", type: "uint256" },
  { name: "quoteAmount", type: "uint256" },
  { name: "price", type: "uint256" },
  { name: "startSlot", type: "uint32" },
  { name: "expiryBlock", type: "uint32" },
  { name: "settledSlot", type: "uint32" },
  { name: "status", type: "uint8" },
] as const;

const fakeQuotesAbi = [
  { type: "function", name: "quotes", inputs: [], outputs: quoteOutputs },
] as unknown as Abi;

const PROVIDER = "0x1111111111111111111111111111111111111111";
const BASE = "0x2222222222222222222222222222222222222222";
const QUOTE = "0x3333333333333333333333333333333333333333";

// Tuple built in exactly the fake ABI's declared order.
const rawTuple = [
  PROVIDER,
  BASE,
  QUOTE,
  "1000", // string amount → BigInt normalization
  2000n,
  "3000000000000000000",
  7, // number slot → Number
  999, // number expiryBlock, heterogeneous on purpose
  9,
  2,
];

test("decodeQuote maps the tuple positionally per the derived ABI order", () => {
  const q = decodeQuote(rawTuple, fakeQuotesAbi);
  assert.equal(q.provider, PROVIDER);
  assert.equal(q.baseToken, BASE);
  assert.equal(q.quoteToken, QUOTE);
  assert.equal(q.baseAmount, 1000n);
  assert.equal(q.quoteAmount, 2000n);
  assert.equal(q.price, 3000000000000000000n);
  assert.equal(q.startSlot, 7);
  assert.equal(q.expiryBlock, 999n);
  assert.equal(q.settledSlot, 9);
  assert.equal(q.status, 2);
  assert.equal(typeof q.baseAmount, "bigint");
  assert.equal(typeof q.quoteAmount, "bigint");
  assert.equal(typeof q.price, "bigint");
  assert.equal(typeof q.expiryBlock, "bigint");
  assert.equal(typeof q.startSlot, "number");
  assert.equal(typeof q.settledSlot, "number");
  assert.equal(typeof q.status, "number");
});

test("decodeQuote throws when two outputs' names are swapped (order-bend caught)", () => {
  // Swap the NAMES of provider (address) and baseAmount (uint256): by-name decoding
  // then reads the bigint as provider and must fail the 0x-address guard.
  const swapped = [
    {
      type: "function",
      name: "quotes",
      inputs: [],
      outputs: quoteOutputs.map((o, i) =>
        i === 0 ? { ...o, name: "baseAmount" } : i === 3 ? { ...o, name: "provider" } : { ...o },
      ),
    },
  ] as unknown as Abi;
  assert.throws(() => decodeQuote(rawTuple, swapped), /"provider" is not an 0x address/);
});

test("decodeQuote throws with rule string when expiryBlock output is missing", () => {
  const without = [
    { type: "function", name: "quotes", inputs: [], outputs: quoteOutputs.filter((o) => o.name !== "expiryBlock") },
  ] as unknown as Abi;
  assert.throws(
    () => decodeQuote(rawTuple, without),
    /missing output "expiryBlock".*migrate the oracle, never bend the ABI \(script\/oracle-doctor\.js\)/,
  );
});

test("decodeLatestPrice works with unnamed outputs (documented positional path)", () => {
  const unnamed = [
    {
      type: "function",
      name: "getLatestPrice",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint32" }, { name: "", type: "bool" }],
    },
  ] as unknown as Abi;
  const d = decodeLatestPrice([123n * 10n ** 18n, 42, true], unnamed);
  assert.equal(d.price, 123n * 10n ** 18n);
  assert.equal(d.settledSlot, 42);
  assert.equal(d.exists, true);
  assert.equal(typeof d.price, "bigint");
  assert.equal(typeof d.settledSlot, "number");
});

test("decodeLatestPrice works with named outputs (name path, reordered)", () => {
  const named = [
    {
      type: "function",
      name: "getLatestPrice",
      inputs: [],
      outputs: [
        { name: "exists", type: "bool" },
        { name: "settledSlot", type: "uint32" },
        { name: "price", type: "uint256" },
      ],
    },
  ] as unknown as Abi;
  // Note the reordered tuple — indexes are DERIVED from the names, so this decodes correctly.
  const d = decodeLatestPrice([false, 17, 55n], named);
  assert.equal(d.price, 55n);
  assert.equal(d.settledSlot, 17);
  assert.equal(d.exists, false);
});
