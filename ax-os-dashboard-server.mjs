/**
 * AX OS - Dashboard Server (Phase 11)
 * WebSocket event stream + static HTML dashboard.
 * Run: node ax-os-dashboard-server.mjs [port]
 *
 * Events broadcast to all connected clients in real-time.
 * Dashboard: http://localhost:PORT
 */

import { createServer }  from "node:http";
import { readFileSync }  from "node:fs";
import { WebSocketServer } from "ws";
import { DatabaseSync }  from "node:sqlite";

const PORT      = parseInt(process.argv[2] ?? "7474");
const MEMORY_DB = process.env.MEMORY_DB ?? "/tmp/ax-os-memory.db";
const VECTOR_DB = process.env.VECTOR_DB ?? "/tmp/ax-os-vectors.db";

// ─── In-process event bus ──────────────────────────────────────────────────
export const eventBus = {
  _clients: new Set(),
  subscribe(ws) { this._clients.add(ws); },
  unsubscribe(ws) { this._clients.delete(ws); },
  emit(type, data = {}) {
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    for (const ws of this._clients) {
      if (ws.readyState === 1 /* OPEN */) ws.send(msg);
    }
  },
};

// ─── DB readers ───────────────────────────────────────────────────────────
function readMemory() {
  try {
    const db = new DatabaseSync(MEMORY_DB);
    const nss = db.prepare(`SELECT DISTINCT namespace FROM ax_memory`).all().map(r=>r.namespace);
    const result = {};
    for (const ns of nss) {
      result[ns] = db.prepare(`SELECT key, value, created_at FROM ax_memory WHERE namespace=? ORDER BY created_at DESC LIMIT 20`).all(ns);
    }
    db.close();
    return result;
  } catch { return {}; }
}

function readVectorStats() {
  try {
    const db = new DatabaseSync(VECTOR_DB);
    const stats = db.prepare(`SELECT namespace, COUNT(*) AS n FROM ax_vectors GROUP BY namespace`).all();
    db.close();
    return stats;
  } catch { return []; }
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AX OS Dashboard</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0d1b2a; color:#e0e8f0; font-family:'Segoe UI',monospace; font-size:13px; }
  header { background:#1c3a5e; padding:12px 20px; display:flex; align-items:center; gap:12px; border-bottom:2px solid #00b4d8; }
  header h1 { font-size:18px; color:#00b4d8; letter-spacing:2px; }
  .status { font-size:11px; color:#8fa3b1; }
  .ws-dot { width:8px; height:8px; border-radius:50%; background:#2dc653; display:inline-block; }
  .ws-dot.off { background:#ff4444; }
  .grid { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:auto auto; gap:12px; padding:12px; height:calc(100vh - 50px); }
  .panel { background:#1c3a5e; border:1px solid #2a4a7a; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
  .panel-header { background:#0d2440; padding:8px 12px; font-size:11px; color:#00b4d8; font-weight:bold; letter-spacing:1px; text-transform:uppercase; }
  .panel-body { flex:1; overflow-y:auto; padding:8px; }
  .event-row { padding:4px 6px; border-bottom:1px solid #1a3050; font-size:11px; }
  .event-row:last-child { border:none; }
  .event-type { color:#00b4d8; font-weight:bold; }
  .event-ts { color:#4a6078; font-size:10px; }
  .stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; padding:6px; }
  .stat-card { background:#0d2440; border-radius:6px; padding:10px; text-align:center; }
  .stat-val { font-size:22px; font-weight:bold; color:#00b4d8; }
  .stat-label { font-size:10px; color:#8fa3b1; margin-top:2px; }
  .mem-row { display:flex; gap:6px; padding:3px 4px; border-bottom:1px solid #1a3050; font-size:10px; }
  .mem-key { color:#00b4d8; min-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mem-val { color:#8fa3b1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
  .bar-wrap { display:flex; align-items:center; gap:6px; padding:4px 8px; }
  .bar-label { width:100px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { flex:1; background:#0d2440; border-radius:3px; height:12px; overflow:hidden; }
  .bar-fill { height:100%; background:linear-gradient(90deg,#0077b6,#00b4d8); border-radius:3px; transition:width 0.5s; }
  .bar-score { width:45px; font-size:11px; color:#00b4d8; text-align:right; }
  ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:#0d1b2a; } ::-webkit-scrollbar-thumb { background:#2a4a7a; border-radius:2px; }
</style>
</head>
<body>
<header>
  <h1>AX OS v2</h1>
  <span class="status">Multi-Agent OS Dashboard</span>
  <span id="wsStatus"><span class="ws-dot off" id="wsDot"></span> <span id="wsLabel">connecting...</span></span>
</header>
<div class="grid">
  <!-- Live Events -->
  <div class="panel">
    <div class="panel-header">⚡ Live Events</div>
    <div class="panel-body" id="eventLog"></div>
  </div>
  <!-- Stats -->
  <div class="panel">
    <div class="panel-header">📊 System Stats</div>
    <div class="panel-body">
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-val" id="statEvents">0</div><div class="stat-label">Events</div></div>
        <div class="stat-card"><div class="stat-val" id="statMemKeys">0</div><div class="stat-label">Memory Keys</div></div>
        <div class="stat-card"><div class="stat-val" id="statVectors">0</div><div class="stat-label">Vectors</div></div>
        <div class="stat-card"><div class="stat-val" id="statUptime">0s</div><div class="stat-label">Uptime</div></div>
      </div>
      <div id="vectorBars" style="margin-top:8px;"></div>
    </div>
  </div>
  <!-- Memory -->
  <div class="panel">
    <div class="panel-header">🧠 SharedMemory</div>
    <div class="panel-body" id="memPanel"></div>
  </div>
  <!-- Routing Weights -->
  <div class="panel">
    <div class="panel-header">🎯 Routing Weights (Adaptive)</div>
    <div class="panel-body" id="routingPanel"></div>
  </div>
</div>
<script>
const ws = new WebSocket('ws://localhost:${PORT}');
const dot = document.getElementById('wsDot');
const lbl = document.getElementById('wsLabel');
const evLog = document.getElementById('eventLog');
let eventCount = 0;
const startTs = Date.now();

ws.onopen = () => { dot.className='ws-dot'; lbl.textContent='connected'; requestSnapshot(); };
ws.onclose = () => { dot.className='ws-dot off'; lbl.textContent='disconnected'; };

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'snapshot') { renderSnapshot(msg.data); return; }
  eventCount++;
  document.getElementById('statEvents').textContent = eventCount;
  const row = document.createElement('div');
  row.className = 'event-row';
  const t = new Date(msg.ts).toLocaleTimeString();
  row.innerHTML = \`<span class="event-ts">\${t}</span> <span class="event-type">\${msg.type}</span> \${JSON.stringify(msg.data).slice(0,80)}\`;
  evLog.prepend(row);
  if (evLog.children.length > 200) evLog.removeChild(evLog.lastChild);
  document.getElementById('statUptime').textContent = Math.round((Date.now()-startTs)/1000)+'s';
};

function requestSnapshot() { ws.send(JSON.stringify({ type: 'get_snapshot' })); }
setInterval(requestSnapshot, 5000);

function renderSnapshot({ memory, vectors, routing }) {
  // Memory panel
  const mp = document.getElementById('memPanel');
  mp.innerHTML = '';
  let totalKeys = 0;
  for (const [ns, entries] of Object.entries(memory || {})) {
    const header = document.createElement('div');
    header.style = 'color:#00b4d8;font-size:10px;padding:4px;background:#0d2440;margin-bottom:2px;';
    header.textContent = 'namespace: ' + ns;
    mp.appendChild(header);
    for (const e of (entries || []).slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'mem-row';
      const val = (typeof e.value === 'string') ? e.value.slice(0,60) : JSON.stringify(e.value).slice(0,60);
      row.innerHTML = \`<span class="mem-key">\${e.key}</span><span class="mem-val">\${val}</span>\`;
      mp.appendChild(row);
      totalKeys++;
    }
  }
  document.getElementById('statMemKeys').textContent = totalKeys;

  // Vector stats
  const vb = document.getElementById('vectorBars');
  vb.innerHTML = '';
  let totalVec = 0;
  for (const v of (vectors || [])) {
    totalVec += v.n;
    const div = document.createElement('div');
    div.className = 'bar-wrap';
    div.innerHTML = \`<div class="bar-label">\${v.namespace}</div><div class="bar-track"><div class="bar-fill" style="width:\${Math.min(100,v.n/2)}%"></div></div><div class="bar-score">\${v.n}</div>\`;
    vb.appendChild(div);
  }
  document.getElementById('statVectors').textContent = totalVec;

  // Routing weights
  const rp = document.getElementById('routingPanel');
  rp.innerHTML = '';
  for (const w of (routing || []).slice(0, 20)) {
    const score = (0.6*w.successRate + 0.4*w.qualityScore);
    const div = document.createElement('div');
    div.className = 'bar-wrap';
    div.innerHTML = \`<div class="bar-label" title="\${w.agentId}:\${w.taskType}">\${w.agentId.slice(0,10)}:\${w.taskType}</div><div class="bar-track"><div class="bar-fill" style="width:\${(score*100).toFixed(0)}%"></div></div><div class="bar-score">\${score.toFixed(2)}</div>\`;
    rp.appendChild(div);
  }
}
</script>
</body>
</html>`;

// ─── HTTP server ──────────────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DASHBOARD_HTML);
  } else if (req.url === "/api/snapshot") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ memory: readMemory(), vectors: readVectorStats(), routing: [] }));
  } else {
    res.writeHead(404); res.end("not found");
  }
});

// ─── WebSocket server ─────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  eventBus.subscribe(ws);
  // Send initial snapshot
  const snapshot = { memory: readMemory(), vectors: readVectorStats(), routing: [] };
  ws.send(JSON.stringify({ type: "snapshot", data: snapshot, ts: Date.now() }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "get_snapshot") {
        ws.send(JSON.stringify({ type: "snapshot", data: { memory: readMemory(), vectors: readVectorStats(), routing: [] }, ts: Date.now() }));
      }
    } catch {}
  });

  ws.on("close", () => eventBus.unsubscribe(ws));
});

// ─── Start ────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  AX OS Dashboard: http://localhost:${PORT}`);
  console.log(`  WebSocket:        ws://localhost:${PORT}`);
  console.log(`  Memory DB:        ${MEMORY_DB}`);
  console.log(`  Vector DB:        ${VECTOR_DB}\n`);
});

// Keep alive + periodic snapshot broadcast
setInterval(() => {
  eventBus.emit("heartbeat", { ts: Date.now(), clients: wss.clients.size });
  const snapshot = { memory: readMemory(), vectors: readVectorStats(), routing: [] };
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "snapshot", data: snapshot, ts: Date.now() }));
  }
}, 3000);
