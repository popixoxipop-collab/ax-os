#!/usr/bin/env python3
"""postbackprop-rules-guard.py — PreToolUse:Write/Edit hook.

postbackprop 프로젝트 파일 작성/수정 시 대회 규정 위반 패턴을 감지.

실격 조건:
  1. from_pretrained() — 사전학습 가중치 금지
  2. torch.optim.Adam/SGD 등 — 표준 옵티마이저 금지
  3. global backward (블록 외부에서 .backward()) — 전역 chain rule 금지

블록 내 local autograd는 허용 (detach() 경계 있을 때).
"""

import json, re, sys, os

try:
    payload = json.load(sys.stdin)
    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) if isinstance(payload.get("tool_input"), dict) else {}
except Exception:
    sys.exit(0)

if tool_name not in ("Write", "Edit"):
    sys.exit(0)

# postbackprop 프로젝트 파일만 감시
file_path = tool_input.get("file_path", "") or tool_input.get("path", "")
if "postbackprop" not in file_path:
    sys.exit(0)

# 검사할 내용
content = tool_input.get("content", "") or tool_input.get("new_string", "")
if not content:
    sys.exit(0)

# bypass
if os.environ.get("POSTBACKPROP_OK"):
    sys.exit(0)

# ── BLOCK 패턴 ──────────────────────────────────────────────────────────────
BLOCK_PATTERNS = [
    (r"from_pretrained\s*\(", "사전학습 가중치 금지 (Zero Pretrained Weights 조건)"),
    (r"torch\.optim\.(Adam|SGD|AdamW|RMSprop|Adagrad)\b",
     "표준 옵티마이저 금지 — 직접 구현 필수 (Zero Existing Optimizers 조건)"),
    (r"AutoModel|AutoModelForCausalLM|GPT2LMHeadModel|LlamaForCausalLM",
     "HuggingFace 사전학습 모델 클래스 금지"),
]

# ── WARN 패턴 ───────────────────────────────────────────────────────────────
WARN_PATTERNS = [
    (r"\.backward\(\)", "global backward() 감지 — detach() 블록 경계 확인 필요"),
    (r"jax\.grad|jax\.value_and_grad", "jax.grad 금지 (Zero Existing Optimizers 조건)"),
]

blocks = []
warns = []

for pattern, reason in BLOCK_PATTERNS:
    if re.search(pattern, content):
        blocks.append(reason)

for pattern, reason in WARN_PATTERNS:
    if re.search(pattern, content):
        warns.append(reason)

if blocks:
    print(json.dumps({
        "decision": "block",
        "reason": (
            "[postbackprop-rules-guard] 🚨 대회 실격 조건 감지:\n" +
            "\n".join(f"  - {b}" for b in blocks) +
            "\n규정: https://kaggle.com/competitions/the-post-backprop-challenge-zero-gradient-learning-for-efficiency/rules"
            "\nbypass: POSTBACKPROP_OK=1"
        ),
    }))
    sys.exit(0)

if warns:
    print(json.dumps({
        "decision": "warn",
        "reason": (
            "[postbackprop-rules-guard] ⚠️ 주의 필요:\n" +
            "\n".join(f"  - {w}" for w in warns) +
            "\ndetach() 블록 경계가 있으면 OK. 없으면 실격."
        ),
    }))

sys.exit(0)
