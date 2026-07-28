// data-arch-* stamping + embedded-source contract (element-editor plan §3.1/§3.2).
//
// Two guarantees, one per test group:
//   1. stamping coverage — every emitted diagram element (node/edge/label/
//      lane/…) sits inside a <g data-arch-id data-arch-kind data-arch-part>
//      wrapper; nothing drawable is left unstamped except the background grid
//      and <defs>.
//   2. round-trip — a stamped element's data-arch-id resolves to an entry in
//      the #archify-source JSON embedded in the same file (derived ids
//      resolve by from/to/index), and that JSON deep-equals the input spec.
//
//   node --test test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-stamping-'));

const EXAMPLES = {
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
  architecture: 'web-app.architecture.json',
};

// mode -> [collection key, wrapper kind, id source] used by both tests.
// idField null means the derived `<prefix>:<from>-><to>:<index>` scheme.
const EDGE_COLLECTIONS = {
  workflow: ['edges', 'edge', 'e'],
  architecture: ['connections', 'connection', 'e'],
  dataflow: ['flows', 'flow', 'e'],
  lifecycle: ['transitions', 'transition', 'e'],
  sequence: ['messages', 'message', 'm'],
};

const NODE_COLLECTIONS = {
  workflow: ['nodes', 'node'],
  architecture: ['components', 'component'],
  dataflow: ['nodes', 'node'],
  lifecycle: ['states', 'state'],
  sequence: ['participants', 'participant'],
};

function renderExample(mode) {
  const out = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', EXAMPLES[mode]),
    out,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(out, 'utf8');
}

function svgOf(html) {
  const match = html.match(/<svg\b[\s\S]*?<\/svg>/);
  assert.ok(match, 'rendered html contains one svg block');
  return match[0];
}

const WRAPPER_OPEN_RE = /<g data-arch-id="([^"]*)" data-arch-kind="([^"]*)" data-arch-part="([^"]*)">/g;
// Wrappers never nest another <g>, so non-greedy block matching is exact.
const WRAPPER_BLOCK_RE = /<g data-arch-id="[^"]*" data-arch-kind="[^"]*" data-arch-part="[^"]*">[\s\S]*?<\/g>/g;

function wrappers(svg) {
  return [...svg.matchAll(WRAPPER_OPEN_RE)].map(([, id, kind, part]) => ({ id, kind, part }));
}

function loadSource(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[mode]), 'utf8'));
}

// ---------------------------------------------------------------------------
// 1. Stamping coverage: no drawable element escapes a data-arch wrapper.
for (const mode of Object.keys(EXAMPLES)) {
  test(`${mode}: every emitted diagram element carries data-arch-id/kind/part`, () => {
    const html = renderExample(mode);
    const svg = svgOf(html);

    // Every <g data-arch-id …> carries all three attributes in canon order.
    const idCount = (svg.match(/<g data-arch-id="/g) || []).length;
    const stamped = wrappers(svg);
    assert.equal(stamped.length, idCount, 'every data-arch wrapper has id+kind+part');
    assert.ok(stamped.length > 0, 'diagram emits stamped wrappers');
    for (const w of stamped) {
      assert.ok(w.id.length > 0 && w.kind.length > 0 && w.part.length > 0);
    }

    // Strip <defs> and all wrapper blocks; anything drawable left over is an
    // un-stamped element — only the background grid rect is allowed.
    const rest = svg
      .replace(/<defs>[\s\S]*?<\/defs>/, '')
      .replace(WRAPPER_BLOCK_RE, '');
    const leftovers = [...rest.matchAll(/<(rect|path|text|line|polygon|circle)\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => !tag.includes('fill="url(#grid)"'));
    assert.deepEqual(leftovers, [], `un-stamped drawable elements:\n${leftovers.join('\n')}`);

    // Count pins: every source node-like and edge-like entry produced its
    // wrapper (edge paths exactly one per source entry; labels one per
    // labelled entry, sharing the id under a different part).
    const source = loadSource(mode);
    const [nodeKey, nodeKind] = NODE_COLLECTIONS[mode];
    const nodeWrappers = stamped.filter((w) => w.kind === nodeKind);
    assert.equal(nodeWrappers.length, source[nodeKey].length, `${nodeKind} wrapper per source ${nodeKey} entry`);

    const [edgeKey, edgeKind] = EDGE_COLLECTIONS[mode];
    const edgeParts = stamped.filter((w) => w.kind === edgeKind);
    const pathParts = edgeParts.filter((w) => w.part === (mode === 'sequence' ? 'body' : 'path'));
    assert.equal(pathParts.length, (source[edgeKey] || []).length, `${edgeKind} wrapper per source ${edgeKey} entry`);

    assert.equal(stamped.filter((w) => w.kind === 'legend').length, 1, 'legend stamped');

    // HTML side: cards + meta title/subtitle are stamped too.
    const cardCount = (html.match(/<div class="card" data-arch-id="card:\d+" data-arch-kind="card" data-arch-part="body">/g) || []).length;
    assert.equal(cardCount, (source.cards || []).length, 'card wrapper per source card');
    assert.match(html, /<h1 data-arch-id="meta:title" data-arch-kind="meta-title" data-arch-part="body">/);
    assert.match(html, /<p class="subtitle" data-arch-id="meta:subtitle" data-arch-kind="meta-subtitle" data-arch-part="body">/);
  });
}

// ---------------------------------------------------------------------------
// 2. Round-trip: stamped id -> embedded #archify-source -> source entry.
for (const mode of Object.keys(EXAMPLES)) {
  test(`${mode}: data-arch ids round-trip to the embedded source JSON`, () => {
    const html = renderExample(mode);
    const svg = svgOf(html);

    const block = html.match(/<script type="application\/json" id="archify-source" data-archify-type="([^"]*)"[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(block, '#archify-source block present');
    assert.equal(block[1], mode, 'data-archify-type matches the diagram type');
    assert.ok(!block[2].includes('<'), 'payload contains no raw "<" (script cannot terminate early)');
    const source = JSON.parse(block[2]);
    assert.deepEqual(source, loadSource(mode), 'embedded source deep-equals the input spec');

    const stamped = wrappers(svg);

    // Source-id collections: every node-kind wrapper id resolves to an entry.
    const [nodeKey, nodeKind] = NODE_COLLECTIONS[mode];
    for (const w of stamped.filter((x) => x.kind === nodeKind)) {
      assert.ok(source[nodeKey].some((entry) => entry.id === w.id),
        `${nodeKind} id ${JSON.stringify(w.id)} resolves in source.${nodeKey}`);
    }

    // Derived-id collections: e:<from>-><to>:<i> / m:<from>-><to>:<i> must
    // point at source[<coll>][i] with matching from/to.
    const [edgeKey, edgeKind, prefix] = EDGE_COLLECTIONS[mode];
    const derived = stamped.filter((x) => x.kind === edgeKind);
    assert.ok(derived.length > 0, `${edgeKind} wrappers present`);
    for (const w of derived) {
      const m = w.id.match(new RegExp(`^${prefix}:(.+?)->(.+?):(\\d+)$`));
      assert.ok(m, `derived id ${JSON.stringify(w.id)} follows ${prefix}:<from>-><to>:<index>`);
      const entry = source[edgeKey][Number(m[3])];
      assert.ok(entry, `index ${m[3]} exists in source.${edgeKey}`);
      assert.equal(entry.from, m[1], `${w.id}: from matches`);
      assert.equal(entry.to, m[2], `${w.id}: to matches`);
    }

    // Indexed derived ids stay within their source arrays.
    const INDEXED = {
      seg: 'segments', act: 'activations', stage: 'stages', boundary: 'boundaries',
    };
    for (const w of stamped) {
      const m = w.id.match(/^(seg|act|stage|boundary):(\d+)$/);
      if (!m) continue;
      const list = source[INDEXED[m[1]]] || [];
      assert.ok(Number(m[2]) < list.length, `${w.id} indexes into source.${INDEXED[m[1]]}`);
    }
  });
}

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
