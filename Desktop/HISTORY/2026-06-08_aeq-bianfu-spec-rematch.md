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

---

## 세션 후반: 채점 결과 + 어댑터 산술 실험 (2026-06-08 오후)

### 채점 결과 (from-scratch 막힘 확정)
| 어댑터 | 데이터/스펙 | 점수 |
|---|---|---|
| bianfu (융합) | — | 0.83 |
| warmstart 3000 (bianfu+improved 3000iter LR1e-5) | continue | **0.66** |
| base-only (어댑터0) | — | 0.54 |
| round_5 from-scratch 3500 (improved, r32+lm_head 정합) | from-scratch | **0.52** |
| round_4 4000/5000 (improved, r16) | from-scratch | 0.52/0.53 |

**핵심 결론**: 스펙 정합(r32+lm_head)도 from-scratch 점수 못 올림(round_5=0.52=round_4). base(0.54)보다 낮음. from-scratch SFT 막힘 확정. warmstart(0.66)>from-scratch(0.52): 0.83 출발 이점 실재하나 continue도 0.83→0.66 하락.

### Kaggle warm-start 디스크풀 crash + 회수 교훈
- v3(ITERS5000 save500) iter3500에서 No space left crash. step별 어댑터(4.26GB) 누적이 원인.
- **`kaggle kernels output`(API)은 crash run의 working을 안 줌(로그 `[]`만). 웹 output storage엔 step3000 온전 잔존.** signed URL로 회수 성공.
- 교훈: crash kernel = API output 비어도 웹 스토리지 working 확인 필수. (메모리 기록 가치)

### 어댑터 산술 실험 (task arithmetic / negation)
- bianfu(model.model.layers) vs warmstart(model.backbone.layers) 키 체계 다름. **backbone→model 치환으로 12010키 정렬**(완전 매칭). warmstart 추가키=lm_head.base_layer(제외).
- **Δ=warmstart−bianfu 상대크기 153%** (lora_A 156%, lora_B 103%). continue가 어댑터 대폭 재구성.
- negative delta: W=(1+α)bianfu−α·warmstart. α=1.0(2bianfu−warm) 제출=53479312 PENDING. NaN/inf 없음, max_abs 0.16.
- **발산 측정**: α=1.0에서 거의 모든 모듈(6003/6005) ΔW>3x. 전역적(국소 아님). 단 절대값 작음(max_abs 0.16). >10x는 α1.0서 8개뿐.

### Ricci flow surgery 외삽 (사용자 아이디어)
- 발산 모듈 절제(bianfu 복원)+안정 모듈 외삽. 국소 특이점 아니라 "상위 발산 절제"로 재해석.
- 생성: surg_a1.5_t10(절제1973/외삽4032), surg_a2.0_t10(절제3045/외삽2960, max_abs0.145=발산억제), surg_a2.0_t5(절제6003=거의bianfu).

### 준비된 어댑터 11개 (D50 /Volumes/D50/AEQ/)
- 순수외삽: neg_delta_a1.0(제출)/a1p1~a1p5, 보간: interp_am0p25/0p5/0p75, surgery: surg_a1p5_t10/a2p0_t10/a2p0_t5
- bianfu소스 /tmp/bianfu_adp (submission/fusion_086_recipe/submission.zip), step3000 /Volumes/D50/AEQ/ws_step3000_adapter

### 내일 할 일
1. **53479312(neg α=1.0) 점수 확인 = 외삽 방향 분기점** (>0.83이면 외삽 유효)
2. 한도 5건 제출: neg α1.5 vs surg_a1.5_t10(surgery효과 직접비교) + surg_a2.0_t10 + neg α1.2 + interp am0.5
3. 결과로 negative delta + Ricci surgery 유효성 판정

### 백그라운드 작업 (전부 완료/정리됨)
- 로컬 round_5 from-scratch: 5000 완주 (val best iter2000=0.315, 4500=0.335). 어댑터 adaptive/round_5/adapter/
- Kaggle warm-start: v3 crash→step3000 회수→0.66. step3000 continue +5000 노트북은 미실행(dataset ws-step3000 업로드 후 중단)
