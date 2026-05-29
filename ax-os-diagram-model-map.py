"""AX OS v2 — Agent x Model Assignment (clean layout)"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle
import numpy as np

W, H = 24, 16
fig, ax = plt.subplots(figsize=(W, H))
BG = "#080F1A"
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)
ax.set_xlim(0, W)
ax.set_ylim(0, H)
ax.axis("off")

C = dict(
    plan="#0077B6", analyze="#2DC653", code="#F4A261",
    research="#028090", report="#7B2D8B", eval="#B5152B",
    embed="#E9C46A", algo="#1C3A5E", db="#0A2540",
    accent="#00B4D8", text="#FFFFFF", muted="#8FA3B1",
    a2a="#00B4D8", tool="#4A8FA3", mem="#2DC653",
    fb="#F4A261", eval_e="#FF5555", border="#2A4A7A",
    node_bg="#0D2440",
)

# ── Helpers ────────────────────────────────────────────────────────────────

def rect_band(y0, h, fill, label=""):
    p = FancyBboxPatch((0.5, y0), W-1, h,
                       boxstyle="round,pad=0.15",
                       facecolor=fill, edgecolor=C["border"],
                       linewidth=0.8, alpha=0.55, zorder=1)
    ax.add_patch(p)
    if label:
        ax.text(0.82, y0+h/2, label, va="center", ha="left",
                fontsize=6.5, color=C["muted"], alpha=0.7,
                rotation=90, fontfamily="monospace", zorder=2)

def agent(x, y, title, model, vram, roles, color, r=0.95):
    """Circle with 3 text lines inside, no hanging card."""
    for ri, ai in [(r*1.55, 0.06), (r*1.25, 0.11)]:
        ax.add_patch(Circle((x, y), ri, color=color, alpha=ai, zorder=2))
    ax.add_patch(Circle((x, y), r, color=color, alpha=0.91, zorder=3))
    ax.add_patch(Circle((x, y), r, fill=False, edgecolor="white",
                         linewidth=0.9, alpha=0.30, zorder=4))
    ax.text(x, y+0.35, title, ha="center", va="center",
            fontsize=10, fontweight="bold", color="white", zorder=5, fontfamily="monospace")
    ax.text(x, y+0.02, model, ha="center", va="center",
            fontsize=7.2, color=C["accent"], zorder=5, fontfamily="monospace")
    ax.text(x, y-0.28, vram, ha="center", va="center",
            fontsize=6.5, color="white", alpha=0.7, zorder=5,
            bbox=dict(boxstyle="round,pad=0.15", facecolor=color, alpha=0.5, edgecolor="none"))
    ax.text(x, y-0.60, roles, ha="center", va="center",
            fontsize=6.2, color="white", alpha=0.78, zorder=5)
    return x, y

def critic(x, y, name, r=0.50):
    ax.add_patch(Circle((x, y), r*1.3, color=C["eval"], alpha=0.08, zorder=2))
    ax.add_patch(Circle((x, y), r, color=C["eval"], alpha=0.88, zorder=3))
    ax.add_patch(Circle((x, y), r, fill=False, edgecolor="white",
                         linewidth=0.8, alpha=0.25, zorder=4))
    ax.text(x, y+0.14, name, ha="center", va="center",
            fontsize=7.2, fontweight="bold", color="white", zorder=5)
    ax.text(x, y-0.16, "mistral:latest", ha="center", va="center",
            fontsize=5.8, color=C["accent"], alpha=0.85, zorder=5, fontfamily="monospace")
    ax.text(x, y-0.35, "4.1 GB", ha="center", va="center",
            fontsize=5.6, color="white", alpha=0.6, zorder=5)

def box(x, y, w, h, title, model, detail, color):
    ax.add_patch(FancyBboxPatch((x-w/2, y-h/2), w, h,
                 boxstyle="round,pad=0.12",
                 facecolor=C["node_bg"], edgecolor=color,
                 linewidth=1.8, alpha=0.95, zorder=3))
    ax.text(x, y+h/2-0.24, title, ha="center", va="center",
            fontsize=8.5, fontweight="bold", color=color, zorder=5, fontfamily="monospace")
    bw = max(len(model)*0.072+0.2, 1.2)
    ax.add_patch(FancyBboxPatch((x-bw/2, y-0.06), bw, 0.30,
                 boxstyle="round,pad=0.05",
                 facecolor=color, alpha=0.72, edgecolor="none", zorder=5))
    ax.text(x, y+0.09, model, ha="center", va="center",
            fontsize=6.8, fontweight="bold", color="white", zorder=6, fontfamily="monospace")
    ax.text(x, y-h/2+0.24, detail, ha="center", va="center",
            fontsize=6.0, color=C["muted"], zorder=5)

def arr(x1, y1, x2, y2, color, lw=1.4, curve=0.0, label="", alpha=0.70, sh=0.95):
    dx, dy = x2-x1, y2-y1
    L = np.hypot(dx, dy)
    if L < 0.01: return
    ax.annotate("",
        xy=(x2-dx/L*sh, y2-dy/L*sh),
        xytext=(x1+dx/L*sh, y1+dy/L*sh),
        arrowprops=dict(arrowstyle="-|>", color=color, lw=lw,
                        connectionstyle=f"arc3,rad={curve}"),
        zorder=7, alpha=alpha)
    if label:
        mx, my = (x1+x2)/2 + (-dy/L)*0.32, (y1+y2)/2 + (dx/L)*0.32
        ax.text(mx, my, label, ha="center", va="center", fontsize=5.8,
                color=color, alpha=0.92, zorder=8,
                bbox=dict(boxstyle="round,pad=0.10", facecolor=BG, alpha=0.75, edgecolor="none"))

# ── Background bands ───────────────────────────────────────────────────────
rect_band(12.3, 3.1,  "#091828", "ORCHESTRATION")
rect_band( 8.7, 3.35, "#091E13", "SPECIALIST AGENTS")
rect_band( 5.8, 2.65, "#1A090C", "EVAL PANEL  Ph.9")
rect_band( 1.4, 4.1,  "#090F1C", "INFRASTRUCTURE")

# ── Title ──────────────────────────────────────────────────────────────────
ax.text(W/2, 15.65, "AX OS v2   Agent x Model Assignment",
        ha="center", fontsize=18, fontweight="bold",
        color=C["accent"], fontfamily="monospace", zorder=10)
ax.text(W/2, 15.22,
        "RTX 5070 Ti  15.9 GB VRAM   |   BRAIN Alpha Search Pipeline   |   Phase 1-12",
        ha="center", fontsize=9.5, color=C["muted"], zorder=10)

# ── PLANNER ────────────────────────────────────────────────────────────────
PX, PY = 7.8, 13.65
agent(PX, PY, "Planner", "qwen2.5:14b-instruct", "9.0 GB",
      "plan  |  delegate  |  orchestrate", C["plan"], r=1.05)

# ── HADES (domain specialist, top right) ───────────────────────────────────
HX, HY = 17.5, 13.55
ax.add_patch(FancyBboxPatch((14.8, 12.25), 5.4, 2.55,
             boxstyle="round,pad=0.12",
             facecolor=C["node_bg"], edgecolor="#7B68EE",
             linewidth=1.8, alpha=0.92, zorder=3))
ax.text(HX, 14.6,  "Hades (Domain Expert)", ha="center",
        fontsize=9, fontweight="bold", color="#9A8AFF", zorder=5, fontfamily="monospace")
ax.text(HX, 14.22, "hades-trunk-current:latest", ha="center",
        fontsize=7.8, color=C["accent"], zorder=5, fontfamily="monospace")
ax.add_patch(FancyBboxPatch((HX-0.7, 13.82), 1.4, 0.28,
             boxstyle="round,pad=0.05", facecolor="#7B68EE", alpha=0.72, edgecolor="none", zorder=5))
ax.text(HX, 13.96, "9.0 GB", ha="center", va="center",
        fontsize=7, fontweight="bold", color="white", zorder=6)
ax.text(HX, 13.52, "BRAIN-specific: alpha_gen  |  analyze", ha="center",
        fontsize=6.5, color=C["muted"], zorder=5)
ax.text(HX, 13.25, "AdaptiveRouter learns preference", ha="center",
        fontsize=6.0, color=C["muted"], alpha=0.75, zorder=5)

# ── SPECIALISTS ────────────────────────────────────────────────────────────
specs = [
    (2.5,  10.25, "Analyst",    "qwen2.5:14b-instruct",  "9.0 GB", "analyze  |  research",   C["analyze"]),
    (6.0,  10.25, "Coder",      "qwen2.5-coder:32b",     "19 GB*", "alpha_gen  |  code",      C["code"]),
    (9.7,  10.25, "Researcher", "gpt-oss:20b",           "13 GB",  "research  |  synthesis",  C["research"]),
    (13.4, 10.25, "Reporter",   "qwen2.5:14b-instruct",  "9.0 GB", "summarize  |  plan",      C["report"]),
]
for args in specs:
    agent(*args[:7], r=0.88)

# ── EVAL CRITICS ───────────────────────────────────────────────────────────
critics = [(2.8,7.0,"Correctness"), (5.8,7.0,"Feasibility"),
           (8.8,7.0,"Novelty"),     (11.8,7.0,"Statistical")]
for cx, cy, name in critics:
    critic(cx, cy, name)
ax.text(7.3, 5.95, "4 independent critics  |  parallel evaluation  |  majority vote >= 60% to APPROVE",
        ha="center", fontsize=7.2, color=C["eval"], alpha=0.85,
        fontfamily="monospace", zorder=7)

# ── INFRASTRUCTURE ─────────────────────────────────────────────────────────
infra = [
    (2.2,  3.3, 2.8, 1.55, "SharedMemory",   "SQLite (node:sqlite)",    "5 ns  |  13 keys  |  TTL", C["algo"]),
    (5.6,  3.3, 2.8, 1.55, "VectorMemory",   "all-minilm:latest",       "45 MB  |  384-dim  |  65 vecs", C["embed"]),
    (9.1,  3.3, 2.8, 1.55, "AdaptiveRouter", "EMA algorithm (code)",    "alpha=0.15  |  per(agent,task)", C["plan"]),
    (12.5, 3.3, 2.7, 1.55, "ToolRegistry",   "TypeScript (no model)",   "5 BRAIN tools + 3 builtins", C["algo"]),
    (15.9, 3.3, 2.7, 1.55, "BRAIN DB",       "SQLite + Python brain/",  "19,479 alphas  |  results.db", C["db"]),
    (19.3, 3.3, 2.7, 1.55, "ReAct Loop",     "[agent's model]",         "max 8 turns  |  tool-call parse", C["research"]),
]
for args in infra:
    box(*args)

# ── VRAM BUDGET BAR CHART (right panel) ────────────────────────────────────
vx, vy = 15.8, 11.4
ax.text(vx+2.0, vy+0.35, "VRAM Usage per Model  (15.9 GB limit)",
        ha="center", fontsize=8, fontweight="bold", color=C["muted"], zorder=10)

models_v = [
    ("qwen2.5-coder:32b",    19.0, C["code"],     "* needs Q4 AWQ"),
    ("gpt-oss:20b",          13.0, C["research"], ""),
    ("llama3.3:latest",      42.5, "#555",        "* too large, unused"),
    ("hades-trunk:9B",        9.0, "#7B68EE",     ""),
    ("qwen2.5:14b-instruct",  9.0, C["analyze"],  "x3 agents"),
    ("mistral:latest",         4.1, C["eval"],     "x4 critics"),
    ("llama3.2:latest",        2.0, "#999",        "fast/routing"),
    ("all-minilm:latest",      0.05,C["embed"],   "embed only"),
]
BAR_W = 3.8
LIMIT = 15.9

for i, (m, v, c, note) in enumerate(models_v):
    by = vy - 0.45*(i+1)
    frac = min(v / (LIMIT*1.05), 1.0)
    # track
    ax.add_patch(FancyBboxPatch((vx, by-0.13), BAR_W, 0.26,
                 boxstyle="square,pad=0", facecolor="#0D2440", alpha=0.6,
                 edgecolor="none", zorder=8))
    # fill
    over = v > LIMIT
    fc = "#FF6600" if over else c
    ax.add_patch(FancyBboxPatch((vx, by-0.13), max(frac*BAR_W, 0.06), 0.26,
                 boxstyle="square,pad=0", facecolor=fc, alpha=0.82,
                 edgecolor="none", zorder=9))
    ax.text(vx-0.1, by, m.replace(":latest",""), ha="right", va="center",
            fontsize=6.5, color=C["muted"], zorder=10, fontfamily="monospace")
    note_str = f"{v} GB  {note}"
    ax.text(vx+BAR_W+0.12, by, note_str, ha="left", va="center",
            fontsize=6.2, color="#FF9900" if over else C["muted"], zorder=10)

# Limit line
lx = vx + (LIMIT/(LIMIT*1.05)) * BAR_W
ax.plot([lx, lx], [vy-0.45*9+0.1, vy+0.05],
        color="#FF4444", lw=1.5, ls="--", alpha=0.85, zorder=10)
ax.text(lx+0.06, vy-0.45*4.5, "15.9 GB\nlimit", fontsize=6.2,
        color="#FF4444", va="center", zorder=10)

# ── EDGES ──────────────────────────────────────────────────────────────────
# Planner → Specialists
for sx, sy, *_ in specs:
    cv = -0.22 if sx < PX else 0.18
    arr(PX, PY, sx, sy, C["a2a"], lw=1.6, curve=cv, alpha=0.60)
# Planner → Hades
arr(PX, PY, HX-1.8, HY, C["a2a"], lw=1.3, curve=0.18, alpha=0.50)

ax.text(4.0, 11.5, "delegate_to_agent()  [Phase 5]",
        fontsize=7, color=C["a2a"], alpha=0.85, fontfamily="monospace", zorder=7)

# Reporter → Critics
for cx, cy, *_ in critics:
    arr(13.4, 9.37, cx, cy, C["eval_e"], lw=0.9, alpha=0.45, curve=0.12)

# Coder → VectorMemory (dedup)
arr(6.0, 9.37, 5.6, 4.08, C["mem"], lw=1.2, alpha=0.65,
    label="dedup [Ph.6]", curve=0.1)

# Analyst → SharedMemory
arr(2.5, 9.37, 2.2, 4.08, C["mem"], lw=1.1, alpha=0.55, curve=-0.05)

# Specialists → ToolRegistry
for sx, sy, *_ in specs:
    arr(sx, sy-0.88, 12.5, 4.08, C["tool"], lw=0.7, alpha=0.25, sh=0.5)

# ToolRegistry → BRAIN DB
arr(13.85, 3.3, 15.9, 3.3, C["tool"], lw=1.2, label="SQL", alpha=0.75, sh=0.3)

# AdaptiveRouter → Planner (feedback)
arr(9.1, 4.08, PX-0.6, PY-1.05, C["fb"], lw=1.6, alpha=0.65, curve=-0.28,
    label="routing weights [Ph.7]")

# ReAct wraps agents annotation
ax.annotate("", xy=(19.2, 9.5), xytext=(20.5, 4.1),
            arrowprops=dict(arrowstyle="-|>", color=C["research"], lw=1.0,
                            connectionstyle="arc3,rad=0.35"),
            zorder=6, alpha=0.40)
ax.text(21.2, 7.0, "wraps\neach\nagent", ha="center", fontsize=6.2,
        color=C["research"], alpha=0.75, zorder=7)

# ── LEGEND ─────────────────────────────────────────────────────────────────
lx, ly = 15.9, 7.95
ax.text(lx, ly, "EDGE TYPES", fontsize=7.5, fontweight="bold",
        color=C["muted"], zorder=10, fontfamily="monospace")
for i, (clr, lbl) in enumerate([
    (C["a2a"],    "A2A Delegation  (Phase 5)"),
    (C["tool"],   "Tool Call        (Phase 3)"),
    (C["mem"],    "Memory Access   (Phase 6)"),
    (C["fb"],     "Routing Feedback (Phase 7)"),
    (C["eval_e"], "Eval Request     (Phase 9)"),
]):
    ey = ly - 0.47*(i+1)
    ax.plot([lx, lx+0.42], [ey, ey], color=clr, lw=2.2, alpha=0.9, zorder=10)
    ax.annotate("", xy=(lx+0.42, ey), xytext=(lx+0.24, ey),
                arrowprops=dict(arrowstyle="-|>", color=clr, lw=1.6), zorder=10)
    ax.text(lx+0.56, ey, lbl, va="center", fontsize=6.5,
            color=C["muted"], zorder=10, fontfamily="monospace")

# ── MODEL SUMMARY TABLE ────────────────────────────────────────────────────
tx, ty = 15.9, 5.55
ax.text(tx, ty, "MODEL SUMMARY", fontsize=7.5, fontweight="bold",
        color=C["muted"], zorder=10, fontfamily="monospace")
rows = [
    ("all-minilm",          " 45MB", "embed",    "VectorMemory — 384d embeddings"),
    ("llama3.2:latest",     "  2GB", "fast",     "Routing hints, quick tasks"),
    ("mistral:latest",      "  4GB", "eval",     "4x parallel critics (Ph.9)"),
    ("qwen2.5:14b",         "  9GB", "analyze",  "Planner  Analyst  Reporter"),
    ("hades-trunk",         "  9GB", "domain",   "BRAIN expert — alpha_gen"),
    ("gpt-oss:20b",         " 13GB", "research", "Researcher  synthesis"),
    ("qwen2.5-coder:32b",   " 19GB", "code",     "Coder — needs Q4 AWQ (~10GB)"),
]
hdrs = [("Model", 2.1), ("VRAM", 0.65), ("Role", 0.85), ("Assigned To", 2.6)]
xo = tx
for h, w in hdrs:
    ax.text(xo, ty-0.35, h, fontsize=6.4, fontweight="bold",
            color=C["accent"], fontfamily="monospace", zorder=10)
    xo += w

for ri, (m, v, role, asgn) in enumerate(rows):
    ry = ty - 0.35 - 0.29*(ri+1)
    if ri % 2 == 0:
        ax.add_patch(FancyBboxPatch((tx-0.06, ry-0.12), 6.3, 0.25,
                     boxstyle="square,pad=0", facecolor="#0D2440", alpha=0.4,
                     edgecolor="none", zorder=9))
    xo = tx
    for val, (_, w) in zip([m, v, role, asgn], hdrs):
        clr = C["accent"] if val == m else (C["fb"] if "AWQ" in val else C["muted"])
        ax.text(xo, ry, val, fontsize=6.2, color=clr,
                fontfamily="monospace", zorder=10, va="center")
        xo += w

plt.tight_layout(pad=0.3)
out = "/tmp/ax_os_model_graph2.png"
plt.savefig(out, dpi=160, bbox_inches="tight", facecolor=BG)
print(f"saved: {out}")
