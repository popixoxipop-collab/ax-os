// archify serve — class (a) local render service (plan §6 S4, D8).
//
// A zero-dependency node:http server with two jobs:
//   1. statically serve editor/ (the element-editor shell + adapters), and
//   2. re-run the renderer pipeline over the SAME code path the `render` CLI
//      uses, so an archify-JSON diagram can be re-rendered server-side from the
//      browser (renderers are spawn-per-run Node scripts — plan G4 — so they
//      cannot run in-page; this endpoint is that local Node path).
//
// Every endpoint shells out to the exact renderer / check script the CLI runs
// (renderers/<type>/render-<type>.mjs and scripts/check-render-output.mjs); no
// renderer logic is forked or re-implemented here. Endpoints:
//   POST /render   {type, source} -> { html }              (stamped HTML, == CLI render)
//   POST /validate {type, source} -> { ok, errors }        (ajv + renderer layout validation, with fix suggestions)
//   POST /check    {html}         -> { ok, file, checks }  (== CLI check)
// CORS is opened for localhost so a statically-hosted editor on another local
// port can still reach a local serve.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const EDITOR_DIR = __dirname;

const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',  // D32: 자체호스팅 Pretendard Bold
  '.txt': 'text/plain; charset=utf-8',
};

function rendererPath(type) {
  return path.join(SKILL_ROOT, 'renderers', type, `render-${type}.mjs`);
}

// The renderer is a spawn-per-run script: an ajv or layout failure throws an
// uncaught Error, so its stderr is a V8 crash dump. Extract just the Error
// message (which for layout failures carries the validator's fix suggestions)
// and drop the "<file>:<line> / code / ^" preamble and the "    at ..." stack.
function cleanRendererError(stderr) {
  const text = String(stderr || '').replace(/\r/g, '');
  const marked = text.indexOf('\nError: ');
  let body;
  if (marked >= 0) body = text.slice(marked + 1);
  else if (text.startsWith('Error: ')) body = text;
  else body = text;
  body = body.replace(/^Error:\s*/, '');
  body = body.replace(/\n\s+at\s+[\s\S]*$/, ''); // strip V8 stack frames
  return body.trim();
}

// Run the real renderer over a JSON source by writing it to a temp file and
// spawning render-<type>.mjs exactly as the CLI does (loadDiagram reads the
// file, runs ajv via validateSchema, runs the renderer's own layout validator,
// then writeDiagram embeds the source). Returns { ok, html } or { ok:false, error }.
export function renderSource(type, source) {
  if (!TYPES.has(type)) {
    return { ok: false, error: `Unknown diagram type "${type}". Expected one of: ${[...TYPES].join(', ')}` };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-serve-'));
  const inPath = path.join(tmp, `${type}.json`);
  const outPath = path.join(tmp, `${type}.html`);
  try {
    fs.writeFileSync(inPath, JSON.stringify(source));
    const result = spawnSync(process.execPath, [rendererPath(type), inPath, outPath], { encoding: 'utf8' });
    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0) {
      const msg = cleanRendererError(result.stderr) || (result.stdout || '').trim() || 'render failed';
      return { ok: false, error: msg };
    }
    return { ok: true, html: fs.readFileSync(outPath, 'utf8') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ajv + renderer layout validation. Both surface through the renderer's stderr:
// schema failures as "<type> schema validation failed: ...", layout failures as
// "<type> layout validation failed:\n- ..." including the layout validator's
// fix suggestions (suggestLabelObstacleFix/suggestLabelPairFix). We preserve the
// full message and also split it into per-problem lines for the caller.
export function validateSource(type, source) {
  const rendered = renderSource(type, source);
  if (rendered.ok) return { ok: true, errors: [] };
  const message = rendered.error || 'validation failed';
  // Layout failures list problems as "\n- <problem>[\n<suggestion>]"; splitting
  // on "\n- " keeps each fix suggestion attached to its problem. Schema (ajv)
  // failures are newline-listed, so fall back to a line split there.
  let errors;
  if (message.includes('\n- ')) {
    const [head, ...problems] = message.split('\n- ');
    errors = [head.replace(/:\s*$/, ''), ...problems];
  } else {
    errors = message.split('\n').map((line) => line.trim()).filter(Boolean);
  }
  return { ok: false, errors, message };
}

// Run the real check script (scripts/check-render-output.mjs) on an HTML string
// by writing it to a temp file — identical code path to `archify check`.
export function checkHtml(html) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-check-'));
  const htmlPath = path.join(tmp, 'diagram.html');
  try {
    fs.writeFileSync(htmlPath, html);
    const result = spawnSync(process.execPath, [path.join(SKILL_ROOT, 'scripts/check-render-output.mjs'), htmlPath], { encoding: 'utf8' });
    if (result.error) return { ok: false, checks: [], error: result.error.message };
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch { /* fall through */ }
    if (!parsed) {
      return { ok: false, checks: [], error: (result.stderr || result.stdout || 'check failed').trim() };
    }
    // Drop the temp file path so the response never leaks a local absolute path.
    return { ok: parsed.ok, checks: parsed.checks };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  // Reflect a localhost origin (plan: "CORS: allow localhost"); for other/no
  // origins fall back to "*" — safe here because the service handles no cookies
  // or credentials and binds to loopback by default.
  const allow = isLocalOrigin(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function sendJson(res, status, obj, origin) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

function serveStatic(req, res, root, origin) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, corsHeaders(origin)); res.end('bad request'); return;
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const rel = urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, rel);
  // Path-traversal guard: resolved target must stay inside root.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403, corsHeaders(origin)); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(origin) });
      res.end('not found');
      return;
    }
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, ...corsHeaders(origin) });
    res.end(data);
  });
}

async function handle(req, res, root) {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === 'POST' && (route === '/render' || route === '/validate' || route === '/check')) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: `invalid JSON body: ${err.message}` }, origin);
      return;
    }
    try {
      if (route === '/render') {
        const out = renderSource(body.type, body.source);
        if (!out.ok) { sendJson(res, 400, { error: out.error }, origin); return; }
        sendJson(res, 200, { html: out.html }, origin);
        return;
      }
      if (route === '/validate') {
        const out = validateSource(body.type, body.source);
        sendJson(res, 200, out, origin);
        return;
      }
      // /check
      if (typeof body.html !== 'string') { sendJson(res, 400, { error: '/check requires { html: string }' }, origin); return; }
      sendJson(res, 200, checkHtml(body.html), origin);
      return;
    } catch (err) {
      sendJson(res, 500, { error: err.message }, origin);
      return;
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, root, origin);
    return;
  }

  sendJson(res, 405, { error: `method ${req.method} not allowed for ${route}` }, origin);
}

export function createServer({ dir = EDITOR_DIR } = {}) {
  const root = path.resolve(dir);
  return http.createServer((req, res) => {
    handle(req, res, root).catch((err) => {
      try { sendJson(res, 500, { error: err.message }, req.headers.origin); } catch { /* already sent */ }
    });
  });
}

export function startServer({ port = 4517, dir = EDITOR_DIR, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer({ dir });
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, host, port: address.port, url: `http://${host}:${address.port}` });
    });
  });
}
