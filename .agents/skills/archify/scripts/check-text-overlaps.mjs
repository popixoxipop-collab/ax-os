#!/usr/bin/env node
// D2 (companion to check-line-overlaps.mjs, see that file's header for the full case
// study this pair came from): text overlap (label-vs-label, label-vs-node, label-vs-
// connector) can't be checked reliably by parsing SVG source alone the way
// check-line-overlaps.mjs checks line/shape geometry -- a <text> element's real width
// depends on character count, font-weight, and CJK-vs-Latin mixing, none of which a
// static estimate (see check-render-output.mjs's own estimatedTextWidth heuristic: a
// flat 0.62/1.8 unit-per-character approximation) captures precisely. This script
// instead loads the diagram in a real headless browser and reads each element's ACTUAL
// rendered bounding box via SVGGraphicsElement.getBBox() + getCTM() (the browser's own
// layout engine, ground truth -- includes every ancestor <g transform>, not just the
// immediate one).
//   WHY: building a real 30+ node hand-placed diagram (P02/P03 service-flow slides,
//   2026-07-16) surfaced 29 real text-vs-text/text-vs-box/text-vs-line defects across 2
//   rounds that a static-estimate check would have both missed (labels that looked fine
//   by character count but collided at the actual rendered font-weight) and
//   false-flagged (labels the estimate thought would collide but didn't, once the real
//   glyphs rendered narrower than estimated).
//   COST: requires an actual browser (playwright + a downloaded Chromium binary) --
//   NOT a dependency of this skill by default (see Setup in SKILL.md: "no dependency
//   installation required"). This script is opt-in: `npm install --no-save playwright &&
//   npx playwright install chromium` once, then run it directly. It intentionally is not
//   wired into `npm test` or bin/archify.mjs's own check command for this reason.
//   EXIT: if archify's renderers eventually track their own precomputed label bounding
//   boxes at generation time (they already do the font-width math once, server-side, to
//   lay text out in the first place) and expose them in a debug/inspect mode, that
//   internal data would make a browser round-trip unnecessary for archify-NATIVE output
//   -- this script would stay relevant only for the Hand-placed fallback mode, same as
//   check-line-overlaps.mjs.
//
// Detects three overlap categories via real rendered geometry:
//   - text-vs-text: any two <text> elements whose actual bounding boxes intersect.
//   - text-vs-box: a <text> element overlapping a shape's bounding box, EXCLUDING the
//     shape that is its own container (a label sitting inside its own node is expected).
//   - text-vs-line: a <text> element overlapping a top-level connector segment (the same
//     "not nested in a shape's <g transform>" convention check-line-overlaps.mjs uses to
//     tell connectors apart from shape geometry).
// Zero findings in all three = clean.
//
// Usage:
//   npm install --no-save playwright && npx playwright install chromium   # one-time
//   node scripts/check-text-overlaps.mjs <path-to-html>

import fs from "node:fs";

const file = process.argv[2];
if (!file || file === "-h" || file === "--help") {
  console.error("Usage: node scripts/check-text-overlaps.mjs <diagram.html>");
  process.exit(file ? 0 : 2);
}
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "This check needs a real browser to measure text (see this file's header for why a " +
    "static estimate isn't good enough). playwright isn't installed.\n\n" +
    "  npm install --no-save playwright && npx playwright install chromium\n\n" +
    "This is an intentionally optional dependency, not part of the skill's default install."
  );
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${fs.realpathSync(file)}`, { waitUntil: "networkidle" });

const result = await page.evaluate(() => {
  const svg = document.querySelector("svg[viewBox]");
  if (!svg) return { error: "no <svg viewBox=...> element found on the page" };
  const svgPoint = svg.createSVGPoint();

  function absBBox(el) {
    const bb = el.getBBox();
    const ctm = el.getCTM(); // local-space -> svg viewport space, includes all ancestor transforms
    const corners = [
      [bb.x, bb.y], [bb.x + bb.width, bb.y],
      [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height],
    ].map(([x, y]) => {
      svgPoint.x = x; svgPoint.y = y;
      const p = svgPoint.matrixTransform(ctm);
      return [p.x, p.y];
    });
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  function overlap(a, b, pad = 0) {
    return !(a.x1 + pad <= b.x0 || b.x1 + pad <= a.x0 || a.y1 + pad <= b.y0 || b.y1 + pad <= a.y0);
  }

  // --- collect texts (each with its bbox + which <g> it's inside, for own-box exclusion) ---
  const texts = [...svg.querySelectorAll("text")].map((el) => ({
    el, content: el.textContent.trim(), bbox: absBBox(el), parentG: el.closest("g[transform]"),
  }));

  // --- collect box-like shapes: first shape child of each <g transform> (rect/polygon/gate path) ---
  const shapeGs = [...svg.querySelectorAll("g[transform]")].filter((g) => {
    const first = g.firstElementChild;
    return first && ["rect", "polygon", "path"].includes(first.tagName);
  });
  const boxes = shapeGs.map((g) => {
    const shape = g.firstElementChild;
    return { g, bbox: absBBox(shape), kind: shape.tagName, label: g.textContent.trim().slice(0, 30) };
  });

  // --- collect connector line segments: top-level <path> with a real stroke (same
  // "not nested in a <g transform>" rule check-line-overlaps.mjs uses) ---
  const arrowPaths = [...svg.querySelectorAll("path")].filter((p) => {
    const stroke = p.getAttribute("stroke");
    return stroke && stroke !== "none" && !p.closest("g[transform]");
  });
  const segments = [];
  for (const p of arrowPaths) {
    const d = p.getAttribute("d");
    const pts = [...d.matchAll(/[ML](-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
    const sw = parseFloat(p.getAttribute("stroke-width") || "1");
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const half = sw / 2 + 1; // +1px slack for anti-aliasing
      segments.push({
        bbox: {
          x0: Math.min(x1, x2) - half, x1: Math.max(x1, x2) + half,
          y0: Math.min(y1, y2) - half, y1: Math.max(y1, y2) + half,
        },
        d: d.slice(0, 40),
      });
    }
  }

  const findings = { textVsText: [], textVsBox: [], textVsLine: [] };

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (overlap(texts[i].bbox, texts[j].bbox)) {
        findings.textVsText.push({ a: texts[i].content, b: texts[j].content, bboxA: texts[i].bbox, bboxB: texts[j].bbox });
      }
    }
  }

  for (const t of texts) {
    for (const b of boxes) {
      if (t.parentG === b.g) continue; // own label, expected
      if (overlap(t.bbox, b.bbox)) {
        findings.textVsBox.push({ text: t.content, box: b.label, textBbox: t.bbox, boxBbox: b.bbox });
      }
    }
  }

  for (const t of texts) {
    for (const seg of segments) {
      if (overlap(t.bbox, seg.bbox)) {
        findings.textVsLine.push({ text: t.content, line: seg.d, textBbox: t.bbox, lineBbox: seg.bbox });
      }
    }
  }

  return findings;
});

await browser.close();

if (result.error) {
  console.error(result.error);
  process.exit(2);
}

console.log(`=== text-vs-text: ${result.textVsText.length} ===`);
for (const f of result.textVsText) console.log(`  "${f.a}"  <->  "${f.b}"`);
console.log(`\n=== text-vs-box: ${result.textVsBox.length} ===`);
for (const f of result.textVsBox) console.log(`  "${f.text}"  overlaps box  "${f.box}"`);
console.log(`\n=== text-vs-line: ${result.textVsLine.length} ===`);
for (const f of result.textVsLine) console.log(`  "${f.text}"  overlaps line  ${f.line}...`);

const total = result.textVsText.length + result.textVsBox.length + result.textVsLine.length;
console.log(total ? `\n${total} total finding(s).` : "\n0 findings. Clean.");
process.exit(total ? 1 : 0);
