# 2026-06-08 AEQ — bianfu 정합 스펙 재학습 (round_5)

## 개요
round_4 로컬 MLX LoRA 어댑터(iter4000/5000)를 Kaggle 제출 후, bianfu EXACT
recipe(LB 0.83) 어댑터와 바이너리 구조를 비교 → 4개 스펙 불일치 발견 →
정합 스펙으로 round_5 재학습 + hook 고정 + 문서화.

## User Input 1
"bianfu EXACT recipe 내부 어댑터 상태와 53465977 53465952 내부 상태 각각 비교"

### Claude Output 1 — 어댑터 구조 비교
제출 결과: iter4000 ref=53465952, iter5000 ref=53465977 (둘 다 PENDING).

| 항목 | bianfu(0.83) | r4i4000 | r4i5000 |
|------|:-:|:-:|:-:|
| rank | 32 | 16 | 16 |
| lora_alpha | 32 | 8 | 8 |
| scale(alpha/r) | 1.0 | 0.5 | 0.5 |
| lm_head | 있음(norm11.3) | 없음 | 없음 |
| dropout | 0.0 | 0.05 | 0.05 |
| 총 키 | 12010 | 12008 | 12008 |

- 키 차이 정확히 2개 = lm_head.lora_A/B (bianfu에만).
- norm 분포: bianfu 이중분포(p10=0.61/p75=3.44, 융합 흔적), 로컬 균일(p50≈3.1).
- MLX 원본(0004000/0005000_adapters.safetensors) 324키 전부 backbone, lm_head 없음.

## User Input 2
"수정본으로 둘 다 다시 진행 / lora_alpha, scale, lm_head, dropout 맞춰서 /
hook 고정 / 메모리 readme 히스토리 graphify 정리 / 커밋 푸쉬 / 로컬+kaggle 노트북 수정 재시도"

### Claude Output 2 — 전체 정합 작업

**결정·검증한 사항**:
1. MLX lm_head LoRA 지원 확인 (실측):
   - nemotron 4bit MLX 자동탐색 키 10개: mixer.{in_proj,out_proj,q_proj,k_proj,
     v_proj,o_proj}, mixer.switch_mlp.{fc1,fc2}, mixer.shared_experts.{up_proj,down_proj}
   - lm_head = model 레벨 QuantizedLinear, 자동탐색(model.layers 순회)이 누락.
   - config `keys`에 lm_head 명시 → `linear_to_lora_layers` 둘째 패스가 포착.
     실측: lm_head → LoRALinear 변환, lora_a/lora_b 생성 확인.
   - tie_word_embeddings=False (lm_head 독립 가중치), vocab=131072.

**수정/생성 파일**:
- `/Volumes/D50/AEQ/adaptive/round_5/config.yaml` (신규)
  - rank:32, scale:1.0, dropout:0.0, save_every:500, keys 11개(lm_head 포함)
  - data는 round_4 심볼릭 링크(동일 데이터, 스펙 효과 격리)
- `/Volumes/D50/AEQ/kaggle_eval/notebook_push/aeq-bf16-lora-train.ipynb` Cell 3
  - r=16→32, lora_alpha=8→32, lora_dropout=0.05→0.0,
    target_modules에 "lm_head" 추가, SAVE_EVERY 1000→500
- `~/.claude/hooks/scripts/bianfu-spec-guard.py` (신규, Python — bash awk multi-line 버그로 재작성)
  - PreToolUse [Bash|Write|Edit] 등록 (settings.json)
  - AEQ 관련 config.yaml/LoraConfig/adapter_config.json 4규칙 위반 시 exit 2
  - bypass: AEQ_ABLATION=1
  - 테스트 7케이스 통과 (위반→2, 정합→0, 비-AEQ→0, bypass→0)
- 메모리: `aeq_bianfu_spec_match.md` + MEMORY.md 인덱스
- graphify: AEQ 그래프 갱신

## 백그라운드 작업
- (완료) bdzat9p2g: iter4000/5000 제출 → ref 53465952/53465977 (PENDING)
- (예정) round_5 MLX 재학습

## 미완료
- round_5 학습 시작 + 모니터링
- 학습 후 convert_mlx_to_peft_v2.py 변환 (lm_head transpose 검증)
- bianfu와 shape 정합 확인 후 제출
- iter4000/5000 채점 결과 확인 (bianfu 0.83 대비)
