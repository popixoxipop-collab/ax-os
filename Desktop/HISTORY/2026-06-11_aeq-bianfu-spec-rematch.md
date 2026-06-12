# AEQ Adapter PCA + Local Eval 세션 (2026-06-11)

## 주요 작업
- 경쟁자 어댑터(bianfu/huikang/kienngx_mlx) PCA 분석에 포함
- 수술적 병합 어댑터 생성 (huikang gate_proj+x_proj+experts + base)
- 전체 어댑터 로컬 eval 파이프라인 구축

## PCA 분석 핵심 결과

### 어댑터 키 포맷 발견
- kienngx MLX: `backbone.layers.X.mixer.Y.lora_a` (전치됨: lora_a shape=(in,rank))
- kienngx PEFT: `base_model.model.model.layers.X.mixer.Y.lora_A.weight` (shape=(rank,in))
- huikang_v26 PEFT: 동일하나 gate_proj/x_proj/experts 타겟팅 (in_proj 없음)

### PC 공간 구조 (15-어댑터, 원점=0.84 base)
```
어댑터           LB    PC1     PC4     PC6    특성
kienngx         0.83  -18.5   +7.7    +10.3  PC1 지배 (neg-delta 방향)
huikang_v26     0.83   -4.9  +40.7    -0.8   PC4 지배 (gate_proj 방향)
kienngx_mlx     0.83   -5.5  +24.8   -46.5   PC6 지배 (MLX 버전)
aeq_hybrid      0.82  -80.5   -17.2  +263.6  PC3 폭발 → 0.82 하락
base(0.84)      0.84    0.0    0.0     0.0   원점
```

### 핵심 발견
1. PC1 방향(62% 분산) = kienngx 방향 = 이미 탐색 완료. 0.84가 최적점.
2. huikang의 진짜 기여 = 363M 파라미터 NEW 서브공간
   - experts 353.7M + gate_proj 5M + x_proj 5M
   - base(888M) 공간 밖의 완전히 새로운 방향
   - PCA로 표현 불가 → 실험만이 답
3. aeq_hybrid PC3 폭발 = kienngx+huikang 강제 융합으로 PC3=263 → 0.82 하락

### 수술적 병합 전략
- `W_surg = W_base + β × delta_huikang_only`
- huikang only 230 keys: gate_proj(46) + x_proj(46) + experts(138)
- 충돌 없음: base는 이 키들 수정 안 함

## 생성된 어댑터 목록 (/tmp/aeq_eval_adapters/)

### 기준 앵커 (알려진 LB)
- `kienngx_083/`: LB=0.83 (kienngx MLX)
- `aeq_hybrid/`: LB=0.82
- `base_neg084/`: LB=0.84 (우리 base = α=0.10)
- `neg_a010/`: LB=0.84 (α=0.10, base와 동일)
- `neg_a020/`: LB=0.73 (α=0.20)

### neg-delta α 시리즈 (예측 지점)
- `neg_a005/`: α=0.05 (LB 미확인)
- `neg_a008/`: α=0.08 (LB=0.84 확인됨)
- `neg_a009/`: α=0.09 (예측 지점)
- `neg_a011/`: α=0.11 (예측 지점)
- `neg_a012/`: α=0.12 (예측 지점)
- `neg_a015/`: α=0.15 (예측 지점)

### surgical β 시리즈 (NEW - huikang experts 추가)
- `surg_b010/` ~ `surg_b150/`: β=0.1 ~ 1.5
- 각각 = base_neg084 + β×huikang(gate_proj+x_proj+experts)

### 복합 시리즈
- `neg008_surg_b050/`: neg_α=0.08 + surg_β=0.50
- `neg008_surg_b100/`: neg_α=0.08 + surg_β=1.00
- `peft_r5_3500/`: round5 LB 미확인

## 기술 이슈 해결

### PEFT→MLX 변환 전치 버그 (2026-06-11)
- PEFT: lora_A shape=(rank,in), lora_B shape=(out,rank)
- MLX: lora_a shape=(in,rank), lora_b shape=(rank,out)
- peft2mlx.py에 `.t().contiguous()` 추가
- 3D 텐서(experts)는 전치 생략

### D50 디스크 공간 관리
- eval 어댑터: /tmp/aeq_eval_adapters/ (Mac 내장, fp16, ~2-2.5GB/개)
- 제출용 어댑터: D50에 fp32 유지

## 로컬 Eval 파이프라인

### 스크립트
- `gen_pred_adapters.py`: 예측 지점 어댑터 생성
- `peft2mlx.py`: PEFT → MLX 변환
- `batch_local_eval.py`: 어댑터 로테이팅 eval + 정리표

### 설정
- eval 데이터: data/held6.jsonl (48) + data/solvable_eval.jsonl (30) = 78문제
- hybrid solver 모드: EQ+solver실패만 모델 호출 → 시간 단축
- 결과: /tmp/aeq_eval_results.json

## 현재 진행 중 (2026-06-11)
- 백그라운드 Task byofjgth0: 앵커 5개 eval (kienngx_083/base_neg084/aeq_hybrid/neg_a010/neg_a020)
- 완료 후 전체 21개 eval 순차 실행 예정

## 추가 수정 사항 (2026-06-11 오후)

### fast_eval v1 실패 원인 발견 (2026-06-11)
**증상**: 21개 모든 어댑터 동일 acc=0.646 (EQ=0.00, 완전히 base 모델 결과)  
**원인**: `fast_eval.py`에서 base 모델(LoRA 레이어 없음)에 `strict=False`로 lora_a/lora_b 키 로드
  → strict=False는 미존재 키를 무시 → 21개 모두 base 모델로 평가됨  
**진단법**: 모든 어댑터의 acc가 동일 + EQ=0.00(model call이 없거나 base model)

### fast_eval2.py — LoRA 정상화 수정
**핵심 변경**:
1. `load_model_with_lora(ref_sft)`: `linear_to_lora_layers` 호출로 LoRA 레이어 초기화
2. `collect_lora_key_shapes`: LoRA 키만 수집 (stale zeroing용)
3. `swap_weights`: stale 키만 zeroing → 새 어댑터 로드
4. `log()`: flush=True 강제 (파이프 SIGPIPE 방지)

**기술 참고사항**:
- tree_flatten 경로는 dot-separated string (`.split('.')[-1]`)
- model.load_weights(list_of_tuples)로 특정 키만 0 초기화 가능
- 첫 inference 시 MLX 그래프 컴파일 30-60s 추가

### 3D 텐서 전치 수정 (사용자 지적)
- peft2mlx.py 및 gen_pred_adapters.py: 3D experts는 `permute(0,2,1).contiguous()`
  (이전: 3D 전치 생략 오류)

### 타이밍 재추정 (proper LoRA 적용 시)
- 이전 broken 추정: 241s/adapter (base model, 빠른 종료)
- 실제: ~13분/adapter (CoT reasoning 1500 tokens × 12 calls)
- 20개 eval: ~4시간 (단 hybrid solver 커버분 제외)
- 해결방안: 핵심 5-6개만 eval 후 제출 결정

### 현재 상태 (2026-06-11 15:xx)
- fast_eval2.py sanity check 실행 중 (kienngx_083 + base_neg084, ~5분 경과)
- PID 12427, /tmp/fe2_sanity.log 모니터링 중
- 완료 후 두 어댑터가 다른 acc를 보이면 LoRA 스왑 정상 확인

## Sanity Check 결과 (2026-06-11 19:47~20:05)

### fast_eval2 sanity: kienngx_083 vs base_neg084

| 어댑터 | LB | local_acc | EQ | NUM | CIPH | BIT | GRAV | UNIT | 시간 |
|--------|----|-----------|----|-----|------|-----|------|------|------|
| kienngx_083 | 0.83 | 0.646 | 0/8 | 8/8 | 4/8 | 4/8 | 7/8 | 8/8 | 687s |
| base_neg084 | 0.84 | 0.646 | 0/8 | 8/8 | 4/8 | 4/8 | 7/8 | 8/8 | 515s |

**[경고] local_acc 분산=0** — 두 어댑터 완전히 동일!

### 근본 원인 분석: PEFT vs MLX 어댑터 포맷 불일치

Nemotron-30b 아키텍처:
- SSM 레이어: `in_proj/out_proj` (standard nn.Linear → `linear_to_lora_layers` wrap)
- MoE 레이어 (23개): 
  - `shared_experts.down_proj/up_proj` (shared path → wrap)
  - `switch_mlp.fc1/fc2` (MLX 배치형 expert gate → wrap, 3D tensor)
  - `experts.N.down_proj/up_proj` (128 per-expert, PEFT 개별 형식 → NOT wrapped)

| 어댑터 | 키 수 | 포맷 | 모델 적용 | 비고 |
|--------|-------|------|-----------|------|
| kienngx_083 | 326 | MLX native | 326/326 ✅ | switch_mlp.fc1/fc2 포함 |
| base_neg084 | 12010 | PEFT (per-expert) | 234/326 ⚠️ | switch_mlp 92개 zeroed |
| surg_b010 | 12240 | PEFT + 230 extra | 234/326 ⚠️ | surg extra keys 모두 무시 |

결론: 로컬 eval에서 base_neg084 = surg_b* = kienngx의 234/326 부분 적용

### 해결책: MLX 전용 neg-delta 어댑터 생성

`gen_mlx_neg_adapters.py` 작성 + 실행:
- kienngx_083 326 MLX keys × (1+α) → 각 alpha별 어댑터
- neg_a000 ~ neg_a030 (12개), /tmp/aeq_eval_adapters_mlx/에 저장
- 원리: warmstart LoRA=0이므로 neg_a_lora = (1+α) × kienngx_lora

현재 실행 중: `fast_eval2.py --mlx --only neg_a000,neg_a010,neg_a020,neg_a012,neg_a015`
- PID 19012, /tmp/fe2_mlx_key.log, VERBOSE_EQ=True (EQ 0/8 원인 진단)
- 예상 완료: ~55-60분

## 오늘(06-11) Kaggle Dlearn 실험 결과 (자동 제출 5건)

**auto_submit_orthogonal.py** KST 09:03 자동 실행 → 5건 제출 성공

| 어댑터 | 설명 | LB | ref |
|--------|------|----|-----|
| learn_p3 | bianfu + 3×Dlearn | **0.36** | 53551286 |
| learn_m3 | bianfu - 3×Dlearn | 0.27 | 53551566 |
| learn_m6 | bianfu - 6×Dlearn | 0.00 | 53551927 |
| combo_p3 | neg0.84 + 3×Dlearn | 0.28 | 53552306 |
| combo_m3 | neg0.84 - 3×Dlearn | 0.18 | 53552634 |

**[결론] Dlearn 방향 = 완전 실패**
- Dlearn 단독으로도 최대 0.36 (기준선 0.83/0.84 대비 크게 열등)
- neg0.84에 Dlearn 더하면 0.84→0.28 붕괴 (직교가 아니라 방해 방향)
- 이 방향은 완전히 포기

## 06-10 neg-delta 확인 (피크 탐색)

| 어댑터 | LB | ref |
|--------|-----|-----|
| neg-delta α=0.08 | **0.84** | 53518563 |
| neg-delta α=0.12 | **0.84** | 53518657 |

→ 0.84 plateau는 α ∈ [0.08, 0.12] (flat, 동일 문제 세트 정답)

## 진단 eval 실행 중 (2026-06-11 20:07~, PID 20294)

**명령**: `fast_eval2.py --mlx --only neg_a000,neg_a010,neg_a020 --save /tmp/fe2_mlx_diag.json`
**MAXTOK_BY_CAT = {"EQ": 4000}, VERBOSE_EQ=True**

### VERBOSE_EQ 중간 결과 (neg_a000 처리 중):

| EQ gold | pred | 원인 |
|---------|------|------|
| '24' | '' | 4000 토큰에서도 reasoning 중 — cut |
| '-35' | '' | 4000 토큰에서도 reasoning 중 — cut |
| '\\<?/' | '' | 모델 `\boxed</[)]` 출력 (extract_ans 파싱 실패) |

**[확정] EQ 로컬 eval 근본적으로 신뢰 불가**:
1. 수치 EQ: 4000 토큰도 부족 (모델이 수십 개 operation 시도)
2. 심볼릭 EQ: `\boxed{...}` 대신 `\boxed[...]` 형식 출력 → regex miss
3. Kaggle은 더 많은 토큰 허용하거나 다른 문제 세트

## 내일(06-12) 제출 계획

### 생성된 PEFT 어댑터 (Kaggle-ready)
- `surg_peft_b{005,010,020,030,050}/` (5GB 각) — base_neg084 + β×huikang_experts
- `neg_peft_a{013,015,016,017}/` (3.55GB 각) — (1+α)×kienngx

### cron 06-12 09:03 예약 (auto_submit_surgical.py)
```
surg_peft_b010: surgical β=0.10: base0.84 + 0.10×huikang_experts
surg_peft_b020: surgical β=0.20: base0.84 + 0.20×huikang_experts
surg_peft_b030: surgical β=0.30: base0.84 + 0.30×huikang_experts
neg_peft_a013:  neg-delta α=0.13: 1.13×kienngx
neg_peft_a015:  neg-delta α=0.15: 1.15×kienngx
```

### 전략 근거
- neg-delta α plateau 확인: 0.84=[0.08,0.12], 탐색 미완료: 0.13~0.17
- surg_peft: huikang의 expert-only delta 추가 (PEFT 포맷 Kaggle 제출 첫 시도)
  - base_neg084 (12010 keys) + huikang_only (230 keys) = 12240 keys
  - huikang_only = gate_proj(46) + x_proj(46) + experts(138), lm_head 제외

## 진단 eval 최종 결과 (20:51 완료, PID 20294 종료)

| 어댑터 | acc | model_calls | 시간 |
|--------|-----|-------------|------|
| neg_a000 (kienngx×1.00, LB=0.83) | 0.646 | 12/48 | 1342s |
| neg_a010 (kienngx×1.10, LB=0.84) | 0.646 | 12/48 | 1406s |

**[확정] 로컬 eval로 α 값 간 순위 결정 불가 — 모든 α에서 동일 acc=0.646**

neg_a020(LB=0.73) eval은 불필요 → 킬. Kaggle 제출이 유일한 평가 수단.

## 세션 최종 요약 (2026-06-11 20:51)

### 오늘 성과
1. fast_eval2.py sanity: 분산=0 → PEFT vs MLX 포맷 불일치 확인
2. gen_mlx_neg_adapters.py 작성 + 실행 (12개 α, MLX 326-key 포맷)
3. VERBOSE_EQ 진단: EQ=0 원인 = 4000 토큰에서도 reasoning 컷
4. Dlearn 5건 LB 결과: 모두 실패 (max 0.36, 조합은 0.28)
5. neg-delta plateau 확인: α=0.08/0.12도 0.84 (α=0.12 신규 확인)
6. surg_gate 어댑터 생성: base_neg084 + β×huikang(gate+x_proj) × 3
7. neg_peft 어댑터 생성: neg_a013/015 (Kaggle-ready PEFT)
8. cron 06-12 09:03 설정: auto_submit_surgical.py

### 내일(06-12) 자동 제출 (cron 09:03)
| 어댑터 | 설명 | 예상 |
|--------|------|------|
| surg_gate_b010 | base0.84 + 0.10×gate+x_proj | 0.84? |
| surg_gate_b020 | base0.84 + 0.20×gate+x_proj | ? |
| surg_gate_b030 | base0.84 + 0.30×gate+x_proj | ? |
| neg_peft_a013  | 1.13×kienngx | 0.84 또는 하락 |
| neg_peft_a015  | 1.15×kienngx | 0.84 또는 0.73 |

## 미완료 항목
- [x] 로컬 eval 완료 → 확정: α 간 구분 불가 (모두 0.646)
- [ ] 06-12 cron 결과 확인 → surg_gate/neg_peft LB 비교표
- [ ] 0.85+ 돌파 후보 결정 (surg 결과 기반)

---

# 06-12 세션 (컨텍스트 재개 후)

## 핵심 발견: 제출 형식 오류 수정

### 제출 형식 = submission.zip (adapter), NOT submission.csv (predictions)
- 공식 데모 `ryanholbrook/nvidia-nemotron-submission-demo` 확인
- 데모 셀 3: `subprocess.run("zip submission.zip adapter_config.json adapter_model*.safetensors")`
- 대회 평가: 서버측 vLLM이 우리 adapter 로드 후 추론 → 점수 계산
- 이전 노트북(inference+CSV 저장)은 잘못된 방식

### 올바른 커널 플로우
1. /kaggle/input/adapter_084_neg/ 에서 파일 복사
2. /kaggle/working/에 adapter_config.json + adapter_model.safetensors 저장
3. `zip submission.zip adapter_config.json adapter_model*.safetensors`
4. GPU 불필요 — CPU 커널로 충분

## MLX→PEFT 변환 확립 (세션 전반부)

### 변환 규칙 (확정)
- Standard 2D: transpose 필요 (lora_a [in,r] → lora_A.weight [r,in])
- MoE batched 3D (switch_mlp.fc1/fc2): 전치 없음, 슬라이싱만 ([128,r,in] → per-expert [r,in])
- lm_head: `base_model.model.lm_head.lora_A/B.weight`
- 키 수: 326 MLX → 12010 PEFT

### 생성/업로드 완료
- `/tmp/neg_peft_a013/`: scale=1.13, 12010 keys, fp32 ✅
- `/tmp/neg_peft_a015/`: scale=1.15, 12010 keys, fp32 ✅
- `adapter-084-neg` dataset v3 (최신=neg_peft_a015): 3.35GB ✅

## 커널 push 수정 이력

| 버전 | 방법 | 결과 | 원인 |
|------|------|------|------|
| v1~v3 | REST API, code 필드 | ERROR: empty notebook | 'code'는 잘못된 필드 |
| v4 | REST API, code 필드 없음 | 실행됐으나 빈 notebook | 기존 notebook 없음 |
| v5 | REST API, `text` 필드 | RUNNING (inference) | 올바른 필드, 그러나 format 틀림 |
| v6 | REST API, `text` 필드, packaging notebook | 실행 중 | ✅ 올바른 접근 |

**핵심 수정**: `'code'` → `'text'` 필드명

## 생성된 파일

### 대회 컨텍스트 파일 (~/Desktop/AEQ/competition/)
- `COMPETITION_OVERVIEW.md`: 대회 개요 (평가 파라미터, 제출 형식, 상금)
- `COMPETITION_RULES.md`: 규정 주요 항목 (rank ≤ 32, 기반 모델, 라이선스)
- `SUBMISSION_GUIDE.md`: 제출 가이드 + 올바른 notebook 코드 예시
- `submission_demo.ipynb`: 공식 데모 로컬 사본

### Hooks
- `nemotron-competition-guard.py` (PreToolUse Bash|Write|Edit): rank>32, 잘못된 base model 차단
- `nemotron-submission-guide.py` (UserPromptSubmit): AEQ 관련 프롬프트 시 submission guide 자동 주입

## 현재 상태 (06-12)
- v6 커널: CANCEL_ACKNOWLEDGED (v5 취소 중) → v6 대기/실행 예정
- adapter-084-neg v3 (neg_peft_a015) 업로드 완료
- cron 09:03 surg_peft/neg_peft 제출 결과 미확인

## 미완료
- [ ] v6 커널 완료 후 submission.zip 제출 → LB 확인
- [ ] cron 09:03 결과 확인
- [ ] surg_peft_b010/020/030 neg_peft_a013/015 LB 비교표

---

# 06-12 야간 ~ 06-13 새벽 세션 (batched format 근본 해결)

## cron 09:03 제출 결과 (5건) — 모두 ERROR

| 어댑터 | ref | 결과 | 원인 |
|--------|-----|------|------|
| surg_peft_b010 | 53612526 | ERROR | 어댑터 포맷 불일치 |
| surg_peft_b020 | 53612615 | ERROR | 어댑터 포맷 불일치 |
| surg_peft_b030 | 53612688 | ERROR | 어댑터 포맷 불일치 |
| neg_peft_a013  | — | 0.83 | 정상 (per-expert 2D, kienngx 구조) |
| neg_peft_a015  | — | 0.82 | 정상 (per-expert 2D, kienngx 구조) |

## surg_gate ERROR 근본 원인 분석

### 1차 시도 — adapter_config.json target_modules 누락
- surg_gate safetensors: gate_proj/x_proj 있음
- adapter_config.json target_modules: gate_proj/x_proj 없음
- vLLM: 예상 외 키 → REJECT
- 수정: target_modules에 gate_proj, x_proj 추가 → 여전히 ERROR

### 2차 시도 — 포맷 충돌
- per-expert 2D 포맷 (experts.0.down_proj, ...) + gate_proj/x_proj 혼용
- vLLM Nemotron LoRA: 지원 안 함
- 사용자: "근본 해결해 per-expert 다차원 포멧으로 맞추던가 해서"

## 근본 해결: convert_to_batched.py 작성

### 핵심 발견: huikang 10 keys per MoE layer
```
batched 구조 (418 keys = huikang 완전 일치):
  - experts.w1.lora_A/B  (up_proj 배치형)
  - experts.w2.lora_A/B  (down_proj 배치형)
  - experts.w3.lora_A/B  (placeholder empty [0] tensors)
  - shared_experts.down_proj.lora_A/B  (shared path)
  - shared_experts.up_proj.lora_A/B   (shared path)
```

### 변환 수식 (per-expert 2D → batched 3D)
```
w1 (up_proj):
  lora_A: mean([N, r, 2688]) → [1, r, 2688]
  lora_B: stack([N, 1856, r]) → [N, 1856, r]

w2 (down_proj):
  lora_A: stack([N, r, 1856]) → [N, r, 1856]
  lora_B: mean([N, 2688, r]) → [1, 2688, r]

w3: empty [0] tensor (placeholder), 그대로 복사
```

### 버그 수정 이력
1. v1 (326 keys): `"experts." not in k` 필터가 shared_experts도 제외 → 92 keys 누락
2. v2 (280 keys): w3 empty tensors 미추가 → 46 keys 누락
3. v3 (418 keys FINAL): `not re.search(r"\.mixer\.experts\.\d+\.", k)` + w3 복사 + shared_experts 유지

### 최종 배치된 어댑터
| 이름 | beta | 크기 | keys | 상태 |
|------|------|------|------|------|
| batched_b010 | 0.10 | 1544MB | 418 | SUBMITTED (53615340) PENDING |
| batched_b020 | 0.20 | 1544MB | 418 | READY |
| batched_b030 | 0.30 | 1544MB | 418 | READY |

## 현재 상태 (06-13 05:53)
- batched_b010 v3 (53615340) PENDING — vLLM 418-key 구조 일치 여부 검증 중
- batched_b020/030 생성 완료, b010 결과 보고 제출 예정
- lm_head 경로: ours=`base_model.model.lm_head`, huikang=`base_model.model.model.lm_head` (2 keys diff, base_neg084와 동일 경로 → 문제 없을 것)
