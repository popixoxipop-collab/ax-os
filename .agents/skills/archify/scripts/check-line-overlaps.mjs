#!/usr/bin/env node
// D1 (this script's reason for existing): archify's own scripts/check-render-output.mjs
// checks arrows against the LEGEND only (by design -- see that file's collectLegendBoxes),
// and only recognizes arrows carrying archify's own a-default/a-emphasis/a-security/
// a-dashed class convention. Neither of those is a limitation for archify-native
// JSON-generated output (the legend-crossing check is exactly the failure mode that
// pipeline can produce), but the skill's own "Hand-placed fallback" mode explicitly
// produces hand-authored SVG that doesn't carry those classes and can have a connector
// visually cut through ANY sibling node, not just the legend.
//   WHY: found by building a real 30+ node, 9-gate hand-placed diagram (P02/P03 service-
//   flow slides, archify skill v2.10, 2026-07-16) and discovering -- via this exact
//   checker's prototype -- 16 real "line cuts through an unrelated box" defects across
//   4 refinement rounds that no existing tool caught (they were only found by staring at
//   screenshots). Two more rounds against the same diagrams found 29 more text-vs-text/
//   text-vs-box/text-vs-line defects (see check-text-overlaps.mjs).
//   COST: this checker assumes the same structural convention the skill's Design System
//   already documents (a shape lives as the first child of a `<g transform="translate(x
//   y)">`, connectors are top-level `<path>`/`<line>` elements with a real stroke, not
//   nested in any such group) -- a diagram authored some other way won't be checkable by
//   this tool without first conforming to that convention (which the skill asks for
//   anyway, so this is not really a new constraint).
//   EXIT: if archify's own renderers grow native per-shape (not just per-legend) overlap
//   detection, this script becomes redundant for archify-generated output; it stays
//   useful for the Hand-placed fallback mode regardless, since that mode's output isn't
//   validated by the renderer pipeline at all.
//
// Reports every axis-aligned (or, defensively, diagonal) connector segment that passes
// through the REAL geometry of a shape it isn't part of: true polygon containment for
// diamonds/gates (not just their bounding box, which would false-positive near a
// diamond's pointed corners), full bounding box for rects. Zero output under "OVERLAP" =
// clean. Companion: check-text-overlaps.mjs (text-vs-text/box/line, needs a headless
// browser for real measurement -- see that file's own header for why).
//
// Usage: node scripts/check-line-overlaps.mjs <path-to-html-or-svg>

import fs from "node:fs";

const inputPath = process.argv[2];
if (!inputPath || inputPath === "-h" || inputPath === "--help") {
  console.error("Usage: node scripts/check-line-overlaps.mjs <diagram.html>");
  process.exit(inputPath ? 0 : 2);
}

const html = fs.readFileSync(inputPath, "utf8");
const svg = extractSvg(html);
const groupSpans = findGroupSpans(svg);
const shapes = collectShapes(svg, groupSpans);
const arrows = collectTopLevelArrows(svg, groupSpans);

let found = 0;
for (const { d, pts } of arrows) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    if (p1[0] === p2[0] && p1[1] === p2[1]) continue;
    for (const shape of shapes) {
      if (segHitsShape(p1, p2, shape)) {
        found += 1;
        console.log(`OVERLAP: path '${d.slice(0, 50)}...' segment (${p1})->(${p2}) crosses ${shape.kind} '${shape.label}' bbox=${JSON.stringify(shape.bbox)}`);
      }
    }
  }
}

console.error(`\n${shapes.length} shape(s) found, ${arrows.length} arrow(s) checked.`);
console.log(found ? `\n${found} overlap(s) found.` : "\n0 overlaps found. Clean.");
process.exit(found ? 1 : 0);

function extractSvg(source) {
  const start = source.indexOf("<svg");
  const end = source.indexOf("</svg>", start) + "</svg>".length;
  return source.slice(start, end);
}

// Depth-counted <g transform="translate(...)">...</g> spans (handles nested <g>, doesn't
// assume flat structure).
function findGroupSpans(svg) {
  const spans = [];
  const openRe = /<g\s+transform="translate\([^)]*\)"[^>]*>/g;
  let om;
  while ((om = openRe.exec(svg))) {
    const openStart = om.index;
    let depth = 1;
    let pos = openRe.lastIndex;
    const tagRe = /<g\b[^>]*>|<\/g>/g;
    tagRe.lastIndex = pos;
    let nm;
    while (depth > 0 && (nm = tagRe.exec(svg))) {
      if (nm[0].startsWith("</g>")) depth -= 1; else depth += 1;
      pos = tagRe.lastIndex;
    }
    spans.push([openStart, depth > 0 ? svg.length : pos]);
  }
  return spans;
}

function insideAnyGroup(index, spans) {
  return spans.some(([s, e]) => index >= s && index < e);
}

function diamondPolygon(tx, ty, pointsAttr) {
  return pointsAttr.trim().split(/\s+/).map((p) => {
    const [x, y] = p.split(",").map(Number);
    return [tx + x, ty + y];
  });
}

function collectShapes(svg, groupSpans) {
  const shapes = [];
  for (const [gstart, gend] of groupSpans) {
    const block = svg.slice(gstart, gend);
    const tm = block.match(/^<g\s+transform="translate\((-?\d+\.?\d*)[ ,]+(-?\d+\.?\d*)\)"[^>]*>\s*/);
    if (!tm) continue;
    const tx = parseFloat(tm[1]), ty = parseFloat(tm[2]);
    const rest = block.slice(tm[0].length);
    const shapeM = rest.match(/^<(rect|polygon|path)\b([^>]*)>/);
    if (!shapeM) continue;
    const [, tag, attrs] = shapeM;
    const tail = rest.slice(shapeM[0].length, shapeM[0].length + 200);
    const labelM = tail.match(/>([^<]{2,40})</);
    const label = labelM ? labelM[1].trim() : "?";
    if (tag === "rect") {
      const w = attrs.match(/width="(-?\d+\.?\d*)"/), h = attrs.match(/height="(-?\d+\.?\d*)"/);
      if (!w || !h) continue;
      const width = parseFloat(w[1]), height = parseFloat(h[1]);
      shapes.push({ kind: "rect", bbox: [tx, ty, tx + width, ty + height], poly: null, label });
    } else if (tag === "polygon") {
      const ptsM = attrs.match(/points="([^"]+)"/);
      if (!ptsM) continue;
      const poly = diamondPolygon(tx, ty, ptsM[1]);
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      shapes.push({ kind: "diamond", bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], poly, label });
    } else if (tag === "path") {
      const dM = attrs.match(/d="([^"]+)"/);
      if (!dM) continue;
      const nums = (dM[1].match(/-?\d+\.?\d*/g) || []).map(Number);
      if (!nums.length) continue;
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      shapes.push({ kind: "gate", bbox: [tx + Math.min(...xs), ty + Math.min(...ys), tx + Math.max(...xs), ty + Math.max(...ys)], poly: null, label });
    }
  }
  return shapes;
}

function collectTopLevelArrows(svg, groupSpans) {
  const arrows = [];
  const pathRe = /<path\b([^>]*)\/?>/g;
  let m;
  while ((m = pathRe.exec(svg))) {
    if (insideAnyGroup(m.index, groupSpans)) continue; // shape geometry, not a connector
    const attrs = m[1];
    const strokeM = attrs.match(/stroke="([^"]*)"/);
    if (!strokeM || strokeM[1] === "none") continue;
    const dM = attrs.match(/d="([^"]+)"/);
    if (!dM) continue;
    const pts = [...dM[1].matchAll(/([ML])(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((mm) => [parseFloat(mm[2]), parseFloat(mm[3])]);
    if (pts.length >= 2) arrows.push({ d: dM[1], pts });
  }
  const lineRe = /<line\b([^>]*)\/?>/g;
  while ((m = lineRe.exec(svg))) {
    if (insideAnyGroup(m.index, groupSpans)) continue;
    const attrs = m[1];
    const strokeM = attrs.match(/stroke="([^"]*)"/);
    if (!strokeM || strokeM[1] === "none") continue;
    const num = (name) => { const mm = attrs.match(new RegExp(`${name}="(-?\\d+\\.?\\d*)"`)); return mm ? parseFloat(mm[1]) : null; };
    const x1 = num("x1"), y1 = num("y1"), x2 = num("x2"), y2 = num("y2");
    if ([x1, y1, x2, y2].every((v) => v !== null)) arrows.push({ d: `<line ${attrs.slice(0, 40)}>`, pts: [[x1, y1], [x2, y2]] });
  }
  return arrows;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segHitsShape(p1, p2, shape) {
  const [bx0, by0, bx1, by1] = shape.bbox;
  const [x1, y1] = p1, [x2, y2] = p2;
  if (x1 === x2) {
    if (!(bx0 < x1 && x1 < bx1)) return false;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    if (hi <= by0 || lo >= by1) return false;
  } else if (y1 === y2) {
    if (!(by0 < y1 && y1 < by1)) return false;
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    if (hi <= bx0 || lo >= bx1) return false;
  }
  // axis-aligned fast-reject passed (or this is a diagonal segment, sampled directly below)
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = x1 + (x2 - x1) * t, sy = y1 + (y2 - y1) * t;
    const inBox = sx > bx0 && sx < bx1 && sy > by0 && sy < by1;
    if (!inBox) continue;
    if (!shape.poly) return true;
    if (pointInPolygon(sx, sy, shape.poly)) return true;
  }
  return false;
}
