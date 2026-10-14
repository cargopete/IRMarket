/**
 * sync-oracle-abi.js — copy the UPSTREAM Monoracle build's ABI into the repo's two ABI copies.
 *
 * One build → two copies → zero drift. Run this after any upstream ABI change; never hand-edit
 * the generated files (see `script/oracle-doctor.js`).
 *
 * Usage: node script/sync-oracle-abi.js [path/to/upstream/Monoracle.json]
 * Default source: ../monoracle/artifacts/contracts/Monoracle.sol/Monoracle.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const SRC =
  process.argv[2] ||
  path.resolve(rootDir, "..", "monoracle", "artifacts", "contracts", "Monoracle.sol", "Monoracle.json");

const parsed = JSON.parse(fs.readFileSync(SRC, "utf8"));
const abi = parsed.abi || parsed;
if (!Array.isArray(abi)) throw new Error(`No ABI array found in ${SRC}`);

const NOTE = "GENERATED from the upstream Monoracle build — do not edit by hand; run `node script/sync-oracle-abi.js`.";

// 1) abi/Monoracle.abi.json — plain ABI array (consumed by bot/verifier.py + scripts).
fs.writeFileSync(
  path.join(rootDir, "abi", "Monoracle.abi.json"),
  JSON.stringify(abi, null, 2) + "\n",
);

// 2) web/src/lib/abis/Monoracle.json — { abi } (consumed by web/src/lib/abis/oracle.ts).
fs.writeFileSync(
  path.join(rootDir, "web", "src", "lib", "abis", "Monoracle.json"),
  JSON.stringify({ _generated: NOTE, abi }, null, 2) + "\n",
);

const f = abi.find((x) => x.type === "function" && x.name === "submitQuote");
const q = abi.find((x) => x.name === "quotes");
console.log(`synced from ${SRC}`);
console.log(`  submitQuote: ${f.inputs.map((i) => i.type).join(",")}`);
console.log(`  quotes order: ${q.outputs.map((c) => c.name).join(", ")}`);
console.log("  wrote abi/Monoracle.abi.json + web/src/lib/abis/Monoracle.json");
