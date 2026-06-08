#!/usr/bin/env python3
"""bianfu-spec-guard.py
AEQ LoRA 학습/어댑터 스펙을 bianfu EXACT recipe(LB 0.83) 정합으로 고정.

근본 원인 (2026-06-08 규명):
  bianfu(0.83) 어댑터 vs round_4 로컬학습 구조 비교 →
    bianfu : r=32, lora_alpha=32(scale=1.0), lm_head 학습 포함, dropout=0.0
    round_4: r=16, lora_alpha=8 (scale=0.5), lm_head 없음,     dropout=0.05
  lm_head 누락 + scale 절반 → 출력 로짓 튜닝 부재 + LoRA 기여 약화.

강제 규칙 (AEQ 학습 config / LoraConfig / adapter_config 작성·수정 시):
  R1. rank/r        = 32
  R2. scale=1.0  또는 lora_alpha=32  (= alpha/r = 1.0)
  R3. dropout       = 0.0
  R4. lm_head 포함  (keys 또는 target_modules)

bypass (의도적 ablation): AEQ_ABLATION=1 (Bash command prefix) 또는 본문에 포함.
"""
import json
import re
import sys


def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    ti = d.get("tool_input", {})
    cmd = str(ti.get("command", ""))
    fpath = str(ti.get("file_path", ""))
    body = str(ti.get("content", "")) + "\n" + str(ti.get("new_string", ""))

    combined = cmd + "\n" + fpath + "\n" + body

    # bypass
    if "AEQ_ABLATION=1" in combined:
        sys.exit(0)

    # AEQ 관련성 판정: 신호가 없으면 무관 → 통과
    if not re.search(
        r"AEQ|nemotron.*lora|lora.*nemotron|adaptive/round_|aeq-bf16-lora|convert_mlx_to_peft",
        combined, re.IGNORECASE,
    ):
        sys.exit(0)

    violations = []

    # ── 검사 A: 학습 config.yaml (lora_parameters 블록) ──
    if re.search(r"\.ya?ml$", fpath) and "lora_parameters" in body:
        v = []
        m = re.search(r"rank:\s*([0-9]+)", body)
        if m and m.group(1) != "32":
            v.append(f"rank={m.group(1)} (≠32)")
        m = re.search(r"scale:\s*([0-9.]+)", body)
        if m and abs(float(m.group(1)) - 1.0) > 1e-9:
            v.append(f"scale={m.group(1)} (≠1.0)")
        m = re.search(r"dropout:\s*([0-9.]+)", body)
        if m and float(m.group(1)) != 0.0:
            v.append(f"dropout={m.group(1)} (≠0.0)")
        if "lm_head" not in body:
            v.append("keys에 lm_head 없음")
        if v:
            violations.append("[config.yaml] " + "; ".join(v))

    # ── 검사 B: LoraConfig(...) (PEFT 학습 노트북) ──
    if "LoraConfig" in body:
        v = []
        m = re.search(r"\br\s*=\s*([0-9]+)", body)
        if m and m.group(1) != "32":
            v.append(f"r={m.group(1)} (≠32)")
        m = re.search(r"lora_alpha\s*=\s*([0-9]+)", body)
        if m and m.group(1) != "32":
            v.append(f"lora_alpha={m.group(1)} (≠32)")
        m = re.search(r"lora_dropout\s*=\s*([0-9.]+)", body)
        if m and float(m.group(1)) != 0.0:
            v.append(f"lora_dropout={m.group(1)} (≠0.0)")
        if "lm_head" not in body:
            v.append("target_modules에 lm_head 없음")
        if v:
            violations.append("[LoraConfig] " + "; ".join(v))

    # ── 검사 C: adapter_config.json (직접 작성) ──
    if re.search(r"adapter_config\.json", fpath):
        v = []
        m = re.search(r'"r"\s*:\s*([0-9]+)', body)
        if m and m.group(1) != "32":
            v.append(f"r={m.group(1)} (≠32)")
        m = re.search(r'"lora_alpha"\s*:\s*([0-9]+)', body)
        if m and m.group(1) != "32":
            v.append(f"lora_alpha={m.group(1)} (≠32)")
        if '"lm_head"' not in body:
            v.append("target_modules에 lm_head 없음")
        if v:
            violations.append("[adapter_config.json] " + "; ".join(v))

    if violations:
        msg = "[hook] BLOCKED: AEQ 어댑터 스펙이 bianfu(0.83) 정합 조건 위반.\n  " + \
              "\n  ".join(violations) + """

요구 스펙 (bianfu EXACT recipe 정합):
  R1. rank/r   = 32
  R2. scale=1.0  또는  lora_alpha=32   (alpha/r = 1.0)
  R3. dropout  = 0.0
  R4. lm_head  포함 (keys / target_modules)

근거: round_4(r16/scale0.5/lm_head없음/dropout0.05)는 bianfu 대비
  lm_head 출력튜닝 부재 + LoRA 기여 절반. 2026-06-08 어댑터 구조 비교에서 확인.

의도적 ablation이면: AEQ_ABLATION=1 prefix (Bash) 또는 본문에 포함."""
        print(msg, file=sys.stderr)
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
