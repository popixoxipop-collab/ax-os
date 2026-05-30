/**
 * Zero-dependency test harness for ax-os.
 *
 * Re-exports `describe`/`it` from node's built-in test runner and provides a
 * minimal Jest/vitest-compatible `expect` backed by node:assert/strict.
 *
 * Why not vitest: the repo's manifest is committed as `ax-os-package.json`
 * (not `package.json`) and shares the home `node_modules`, so a clean clone
 * cannot `npm install` vitest. Using node:test keeps `npm test` reproducible
 * with zero external dependencies — matching ax-os-verify-build.mjs.
 *
 * Supported matchers: toBe, toEqual, toHaveLength, toContain, toBeNull,
 * toBeGreaterThan(OrEqual), toBeLessThan(OrEqual), toThrow — each negatable
 * via `.not`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

export { describe, it };

function makeMatchers(received, negated) {
  const ok = (pass, msg) => {
    if (negated ? pass : !pass) {
      assert.fail(msg);
    }
  };
  const fmt = (v) => {
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const tag = negated ? "not " : "";

  const m = {
    toBe(expected) {
      ok(Object.is(received, expected),
        `expected ${fmt(received)} ${tag}to be ${fmt(expected)}`);
    },
    toEqual(expected) {
      let equal = true;
      try { assert.deepStrictEqual(received, expected); } catch { equal = false; }
      ok(equal, `expected ${fmt(received)} ${tag}to equal ${fmt(expected)}`);
    },
    toHaveLength(n) {
      ok(received != null && received.length === n,
        `expected length ${tag}to be ${n}, got ${received == null ? received : received.length}`);
    },
    toContain(sub) {
      ok(received != null && received.includes(sub),
        `expected ${fmt(received)} ${tag}to contain ${fmt(sub)}`);
    },
    toBeNull() {
      ok(received === null, `expected ${fmt(received)} ${tag}to be null`);
    },
    toBeGreaterThan(n) {
      ok(received > n, `expected ${fmt(received)} ${tag}to be > ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      ok(received >= n, `expected ${fmt(received)} ${tag}to be >= ${n}`);
    },
    toBeLessThan(n) {
      ok(received < n, `expected ${fmt(received)} ${tag}to be < ${n}`);
    },
    toBeLessThanOrEqual(n) {
      ok(received <= n, `expected ${fmt(received)} ${tag}to be <= ${n}`);
    },
    toThrow(expected) {
      let threw = false;
      let err;
      try { received(); } catch (e) { threw = true; err = e; }
      if (!negated) {
        ok(threw, `expected function to throw`);
        if (threw && expected != null) {
          const msg = err && err.message != null ? String(err.message) : String(err);
          ok(msg.includes(expected),
            `expected thrown message to contain ${fmt(expected)}, got ${fmt(msg)}`);
        }
      } else {
        ok(threw, `expected function not to throw`);
      }
    },
  };
  return m;
}

export function expect(received) {
  const matchers = makeMatchers(received, false);
  matchers.not = makeMatchers(received, true);
  return matchers;
}
