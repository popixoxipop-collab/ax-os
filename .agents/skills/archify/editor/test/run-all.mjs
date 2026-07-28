// Aggregate runner: runs every editor Playwright test file sequentially and
// sums the "X pass / Y fail" lines. Not part of the shipped suite — a harness
// helper to reproduce the 905-checks baseline count.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(DIR)
  .filter((f) => (/^s\d+.*\.test\.mjs$/.test(f) || f === "run-test.mjs" || f === "run-extra-checks.mjs"))
  .sort((a, b) => {
    const na = (a.match(/^s(\d+)/) || [0, 999])[1];
    const nb = (b.match(/^s(\d+)/) || [0, 999])[1];
    return Number(na) - Number(nb) || a.localeCompare(b);
  });

let totalPass = 0, totalFail = 0;
const rows = [];
for (const f of files) {
  const isNodeTest = /import .*node:test/.test(fs.readFileSync(path.join(DIR, f), "utf8"));
  const args = isNodeTest ? ["--test", path.join(DIR, f)] : [path.join(DIR, f)];
  const r = spawnSync("node", args, { encoding: "utf8", timeout: 180000 });
  const out = ((r.stdout || "") + (r.stderr || "")).replace(/\x1b\[[0-9;]*m/g, "");
  // Two summary formats coexist: (a) custom "PASS/FAIL <name>" console lines,
  // (b) node:test "ℹ pass N / ℹ fail N" summary. Count both so the aggregate == 905.
  let pass = (out.match(/^PASS /gm) || []).length;
  let fail = (out.match(/^FAIL /gm) || []).length;
  for (const m of out.matchAll(/^ℹ pass (\d+)/gm)) pass += Number(m[1]);
  for (const m of out.matchAll(/^ℹ fail (\d+)/gm)) fail += Number(m[1]);
  totalPass += pass; totalFail += fail;
  rows.push(`${f.padEnd(42)} ${String(pass).padStart(4)} pass / ${fail} fail  (exit ${r.status})`);
  console.log(rows[rows.length - 1]);
}
console.log("\n================ AGGREGATE ================");
console.log(`TOTAL: ${totalPass} pass / ${totalFail} fail  across ${files.length} files`);
process.exit(totalFail ? 1 : 0);
