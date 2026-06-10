#!/usr/bin/env python3
"""resource-limit-guard.py — PreToolUse:Bash hook.

실험 스크립트 실행 전 로컬 리소스 한도 체크.
패턴: python/python3로 실행하는 exp_*.py, *train*.py, *grid_search*.py,
      *proxy*.py, *bench*.py 파일을 감지.

출력:
  - BLOCK (exit 2): 추정 GPU 피크 > 가용 메모리 70%
  - WARN  (exit 0): 추정 GPU 피크 > 가용 메모리 40%
  - OK    (exit 0): 문제 없음
"""

import json
import os
import re
import subprocess
import sys

# ── hook input ────────────────────────────────────────────────────────────────
try:
    payload = json.load(sys.stdin)
    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {})
    command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
except Exception:
    sys.exit(0)

if tool_name != "Bash":
    sys.exit(0)

# ── detect experiment script ──────────────────────────────────────────────────
EXP_PATTERN = re.compile(
    r"python3?\s+.*?(exp_\w+\.py|train\w*\.py|grid_search\w*\.py|"
    r"proxy_\w+\.py|bench\w+\.py|bll_nf4\.py)",
    re.IGNORECASE,
)
if not EXP_PATTERN.search(command):
    sys.exit(0)

# ── measure available memory ──────────────────────────────────────────────────
def get_available_gb() -> float:
    try:
        r = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3)
        page_size = 16384
        stats: dict[str, int] = {}
        for line in r.stdout.splitlines()[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                try:
                    stats[k.strip()] = int(v.strip().rstrip("."))
                except ValueError:
                    pass
        return (stats.get("Pages free", 0) + stats.get("Pages inactive", 0)) * page_size / 1e9
    except Exception:
        return 999.0  # unknown → don't block


# ── estimate experiment memory from filename / flags ─────────────────────────
def estimate_peak_gb(cmd: str) -> float:
    """Very rough heuristic: look for d= / n_layers= / BS= flags, else use script defaults."""
    d = n_layers = bs = sl = None

    for m in re.finditer(r"--?d(?:_model)?[= ](\d+)", cmd):
        d = int(m.group(1))
    for m in re.finditer(r"--?n_layers?[= ](\d+)", cmd):
        n_layers = int(m.group(1))
    for m in re.finditer(r"--?(?:batch_?size|bs|b)[= ](\d+)", cmd):
        bs = int(m.group(1))
    for m in re.finditer(r"--?(?:seq_?len|sl|s)[= ](\d+)", cmd):
        sl = int(m.group(1))

    # defaults by script
    if "grid_search" in cmd:
        d = d or 4096; n_layers = n_layers or 27; bs = bs or 32; sl = sl or 512
    elif "proxy" in cmd:
        d = d or 512;  n_layers = n_layers or 6;  bs = bs or 16; sl = sl or 128
    elif "bll_nf4" in cmd:
        d = d or 512;  n_layers = n_layers or 6;  bs = bs or 4;  sl = sl or 64
    else:
        d = d or 512;  n_layers = n_layers or 6;  bs = bs or 16; sl = sl or 256

    param_bytes = (d*d*4 + d*d*3 + d*d*2) * n_layers * 2   # FP16
    act_bytes   = bs * sl * d * n_layers * 2
    return (param_bytes + act_bytes) / 1e9


avail_gb  = get_available_gb()
peak_gb   = estimate_peak_gb(command)
ratio     = peak_gb / max(avail_gb, 1.0)

if ratio > 0.70:
    print(
        json.dumps({
            "decision": "block",
            "reason": (
                f"[resource-limit-guard] 추정 GPU 피크 {peak_gb:.2f} GB > "
                f"가용 메모리의 70% ({avail_gb * 0.70:.1f} GB). "
                f"가용: {avail_gb:.1f} GB. "
                "bypass: RESOURCE_OK=1 prefix로 실행하거나 --batch_size / --seq_len 줄이기."
            ),
        })
    )
    sys.exit(0)

if ratio > 0.40:
    print(
        json.dumps({
            "decision": "warn",
            "reason": (
                f"[resource-limit-guard] ⚠️  추정 GPU 피크 {peak_gb:.2f} GB "
                f"(가용 {avail_gb:.1f} GB 중 {ratio*100:.0f}%). "
                "계속 진행하나 메모리 부족 시 OOM 가능."
            ),
        })
    )
    sys.exit(0)

# OK — silent pass
sys.exit(0)
