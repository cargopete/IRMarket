import fs from "fs";
import { decodeFunctionData, decodeFunctionResult, parseAbi } from "viem";

const AGG = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[]) view returns ((bool success, bytes returnData)[])",
]);

const txt = fs.readFileSync("mc3-bodies.txt", "utf8");
const pairs = txt.split("\n\n").filter(Boolean);
console.log("TOTAL batch pairs:", pairs.length);

pairs.forEach((pair, pi) => {
  const [rq, rs] = pair.split("\n");
  if (!rq || !rs) {
    console.log("--- batch", pi, "INCOMPLETE");
    return;
  }
  const calls = decodeFunctionData({ abi: AGG, data: rq.slice(4) }).args[0];
  const hex = rs.slice(5).replace(/^0x/, "");
  if (hex.replace(/0/g, "") === "") {
    console.log("--- batch", pi, "-", calls.length, "sub-calls, RESPONSE ALL ZERO COLLISION");
    calls.forEach((c, i) => console.log("    ", c.target.slice(0, 12), c.callData.slice(2, 10)));
    return;
  }
  const out = decodeFunctionResult({
    abi: AGG,
    functionName: "aggregate3",
    data: new Uint8Array(Buffer.from(hex, "hex")),
  });
  console.log("--- batch", pi, "-", calls.length, "sub-calls");
  calls.forEach((c, i) => {
    const ok = out[i][0];
    const rd = Buffer.from(out[i][1] ?? "").toString("hex");
    console.log("    ", c.target.slice(0, 12), c.callData.slice(2, 10), "success", ok, rd ? "data:0x" + rd.slice(0, 48) : "(empty)");
  });
});
