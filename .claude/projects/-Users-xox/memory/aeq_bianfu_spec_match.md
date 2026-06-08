---
name: aeq_bianfu_spec_match
description: AEQ 로컬 LoRA 학습은 bianfu(0.83) 어댑터 정합 스펙 필수 — r=32/scale=1.0/lm_head포함/dropout=0.0
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a39c8734-923a-4e2a-b735-bcb0c79abaf7
---

**AEQ 로컬 학습 어댑터는 bianfu EXACT recipe(LB 0.83)와 구조 정합해야 한다.**

2026-06-08 bianfu(0.83) 어댑터 vs round_4 로컬학습 어댑터 바이너리 비교에서 4개 차이 발견:

| 항목 | bianfu (0.83) | round_4 (로컬) | 정합 스펙 |
|------|:-:|:-:|:-:|
| rank | **32** | 16 | **32** |
| lora_alpha | 32 | 8 | **32** |
| scale (=alpha/r) | **1.0** | 0.5 | **1.0** |
| lm_head 학습 | **포함**(norm 11.3, 최대값) | **없음** | **포함** |
| lora_dropout | 0.0 | 0.05 | **0.0** |

**핵심 진단**:
- **lm_head 누락이 가장 치명적**. MLX round_4 학습이 lm_head를 LoRA 대상에서 빠뜨림(324키 전부 backbone). 출력 로짓 레이어 튜닝 부재 → 추론 형식/종료토큰 패턴이 bianfu와 다름.
- scale 0.5 → vLLM이 LoRA 기여를 절반 강도로 적용(alpha/r 곱).
- bianfu norm 이중분포(p10=0.61 / p75=3.44)는 kienngx scaffold + huikang replace 융합 흔적. 로컬은 균일.

**How to apply**:
- MLX 학습 config.yaml `lora_parameters`: `rank:32, scale:1.0, dropout:0.0` + `keys`에 lm_head 명시.
  - **lm_head는 keys 명시 필수**: mlx_lm 자동탐색(`get_keys_for_lora`)은 `model.layers`만 순회 → lm_head(model 레벨 QuantizedLinear) 누락. keys 명시 시 `linear_to_lora_layers` 둘째 패스(`model.named_modules()`)가 lm_head 포착.
  - nemotron 4bit MLX 자동탐색 키 10개(2026-06-08 실측): mixer.{in_proj,out_proj,q_proj,k_proj,v_proj,o_proj}, mixer.switch_mlp.{fc1,fc2}, mixer.shared_experts.{up_proj,down_proj}. + lm_head = 11개.
- PEFT(Kaggle) LoraConfig: `r=32, lora_alpha=32, lora_dropout=0.0, target_modules=[...,"lm_head"]`.
- **Hook 강제**: `~/.claude/hooks/scripts/bianfu-spec-guard.py` (PreToolUse Bash|Write|Edit) — AEQ 관련 config.yaml/LoraConfig/adapter_config.json에서 4규칙 위반 시 exit 2 차단. bypass: `AEQ_ABLATION=1`.

**Why**: round_4 iter4000/5000 제출(ref 53465952/53465977)이 bianfu 0.83 대비 미달 예상 → 스펙 정합 round_5 재학습으로 격리 비교. 데이터는 round_4와 동일(스펙 효과만 분리).

관련: [[aeq_submission_landscape]] [[aeq_competition_state]] [[feedback_local_test_before_deploy]]
