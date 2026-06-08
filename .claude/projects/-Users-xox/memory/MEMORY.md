# Global Workflow Memory

## Setup
- Global CLAUDE.md: ~/CLAUDE.md
- Shell functions: cc, ccp, ccr, cwt, cwt-ls, cwt-rm, cwt-clean, cc-status, cc-sync, cc-parallel, cc-do, cc-plan
- Terminal: Warp
- **Bash 항상 승인**: settings.json bypassPermissions
- [use_llvm_lstm_location.md](use_llvm_lstm_location.md) — **활성 프로젝트 13개 /Volumes/D50/ 이전(~/Desktop symlink)**. iCloud quota초과로 git/symlink 깨짐(2026-05-30~31) → D50 이동 + iCloud Desktop 동기화 OFF. 깨지면 `bash /Volumes/D50/_desktop_symlinks_restore.sh`.
- [feedback_no_icloud_drive.md](feedback_no_icloud_drive.md) — **★ iCloud Drive 사용 금지(전역)**. 프로젝트는 로컬/D50만. hook `icloud-drive-guard.py`가 iCloud 컨테이너 쓰기 차단(bypass: `ICLOUD_OK=1`). 2026-05-31 quota사고 교훈.

## Born Interference LM (Post-Backprop Kaggle, zero-gradient) (2026-06-04) ★★★★★
- [born_lm_ceiling_study.md](born_lm_ceiling_study.md) — **천장=용량(서사전복), 궤적옵티마이저 무효, capacity scaling이 유일 레버**. 챔피언 d512L6 ppl24.99/acc17.24%. `/Volumes/D50/BORN_LM/RESEARCH_REPORT.md`. CPU가 MPS보다 4.6×빠름.

## 논문 작성 규칙 (2026-04-21) ★★★★★
- [feedback_paper_orchestra_mandatory.md](feedback_paper_orchestra_mandatory.md) — **논문 작성 시 반드시 paper-orchestra 스킬 사용** (fullstack-engineer 등 다른 에이전트 금지). Hook 자동 강제.
- [feedback_explog_velocity_dependence.md](feedback_explog_velocity_dependence.md) — **experimental_log.md 최상단에 Velocity Dependence Declaration 선행 필수** (P37/P38 수치 오류 교훈). Hook 경고 추가됨.

## Graphify 지식그래프 (2026-04-20) ★★★★★
- [graphify_benchmark.md](graphify_benchmark.md) — **F-CORE 코드 탐색 시 `/graphify query` 우선 (11.5× 토큰 절감)**. MEMORY 검색은 `cd memory && graphify query "<주제>"`. Grep은 미매칭 시만 fallback.
- [feedback_graphify_dedup_guard.md](feedback_graphify_dedup_guard.md) — **graphify 추출 중복 금지**: 동일 콘텐츠 파일 재추출 차단. hook `graphify-dedup-guard.py`(PreToolUse:Agent)가 세션 내 콘텐츠 SHA1 대조로 BLOCK. 준비된 `.graphify_chunk_input_NN.txt` 그대로 쓸 것.

## Knowledge Vault (Karpathy LLM-wiki) (2026-05-18) ★★★★★
- [knowledge_vault_setup.md](knowledge_vault_setup.md) — `~/knowledge-vault/` Karpathy LLM-wiki 패턴 + 수학적 schema. `/vault-ingest /vault-query /vault-lint` + `/graphify wiki/`. 구독 없이 운영.

## Finance Phase 3 OOS 규칙
- [feedback_phase3_oos_split.md](feedback_phase3_oos_split.md) — **paper trading 제안 금지, OOS = 2025-01-01~현재**

## 모델 호환성 사전 확인 (2026-04-21) ★★★★★
- [feedback_model_compat_check.md](feedback_model_compat_check.md) — **모델별 양자화/VRAM/패키지 호환 사전 확인 필수** (Nemotron MoE $5.86 낭비 교훈, hook 자동 차단)

## Adversarial Review 필수 (2026-04-27) ★★★★★
- [feedback_adversarial_review_before_push.md](feedback_adversarial_review_before_push.md) — **push 전 gemini-cli 리뷰 필수** (30회 실패 교훈). hook: adversarial-review-guard.py

## 배포 전 검증
- [feedback_peft_load_adapter_version.md](feedback_peft_load_adapter_version.md) — **멀티-어댑터 eval은 PeftModel.from_pretrained per-adapter 사용** (transformers base.load_adapter()는 peft≥0.18.2 요구, 미검증 환경에 투입 금지). + apply_chat_template return_dict 버그/빈 AttributeError 교훈.
- [feedback_local_test_before_deploy.md](feedback_local_test_before_deploy.md) — **Colab/RunPod 배포 전 로컬 syntax+import 검증 필수**
- [feedback_reactive_debugging.md](feedback_reactive_debugging.md) — **대형 실험 사전 점검 우선, 크래시 후 수정 반복 금지**
- [feedback_runpod_local_preflight.md](feedback_runpod_local_preflight.md) — **RunPod 시행착오 절대 금지: triton/kernels/transformers 소스 로컬 확인 후 배포**
- [feedback_runpod_build_cpu_tier.md](feedback_runpod_build_cpu_tier.md) — **빌드는 4 vCPU, 실행은 32 vCPU 분리** (ET 빌드 $6.40 낭비 교훈, 2026-05-15). Hook 자동 경고.

## 실험 해석 규칙 (2026-04-19 교훈) ★★★★★
- [feedback_avoid_overinterpretation.md](feedback_avoid_overinterpretation.md) — **4-Tier 분류 필수** (T0 운영/T1 논문/T2 가설/T3 비유). 가설은 허용, 가설을 발견처럼 서술만 금지.

## BnB 4-bit 대형 모델 로딩 (2026-04-11 교훈) ★★★★★
- [feedback_bnb_4bit_device_map.md](feedback_bnb_4bit_device_map.md) — **`max_memory`에 "cpu" 넣지 말 것, 수동 device_map 필수** (accelerate BF16 오산 + BnB 0.49.2 meta tensor 버그)
- [feedback_expandable_segments_mandatory.md](feedback_expandable_segments_mandatory.md) — 대형 모델 BnB 로딩 시 `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` 필수
- [feedback_no_spot_for_long_jobs.md](feedback_no_spot_for_long_jobs.md) — 1시간+ 작업은 on-demand만, spot 금지

## Kaggle 노트북 규칙
- [feedback_kaggle_private.md](feedback_kaggle_private.md) — Secrets 사용 노트북은 항상 Private
- [kaggle-agent.md](kaggle-agent.md) — Kaggle 배포 전용 agent (CLI push 금지, 직접 API+machineShape 필수)
- [feedback_kaggle_minimal_mod.md](feedback_kaggle_minimal_mod.md) — **작동 버전 base 최소 수정 원칙** (v16~v19 4연속 실패 교훈)

## Surgical MoE Chimera (2026-04-07) ★★★★★
- [surgical_moe_chimera.md](surgical_moe_chimera.md) — E2B+31B Bridge, L24 tower, Theseus 1/9 MLP, ARC-C +16pp
- [feedback_born_prism_mandatory.md](feedback_born_prism_mandatory.md) — **Bridge 추출점+주입점 모두 Born+PRISM 데이터 기반 필수, 하드코딩 금지**

## Human Monitor 핵심 발견 (2026-04-12) ★★★★★
- [human_monitor_key_findings.md](human_monitor_key_findings.md) — BPF-First ICA (HR 분리 필수), CUSUM 31분 리드타임 vs 임계값 28초, LMS 구급차 진동 보상

## WorldQuant BRAIN IQC
- [reference_brain_operators.md](reference_brain_operators.md) — **BRAIN 알파 작성 전 반드시 참조**
- [feedback_brain_confirmed_only.md](feedback_brain_confirmed_only.md) — **CONFIRMED 연산자만 사용, UNVERIFIED 금지**
- 레퍼런스: `docs/brain_operators.md` (실전 검증), `docs/worldquant_brain_operators_reference.md` (전체 1181줄)
- F21 블렌드 ACTIVE (Sharpe 1.97 IS, 4.04 TEST)
- G4v3 위기 오버레이 제출 대기 (Sharpe 1.90, Fitness 1.02)
- **2026-05-10 VALUE_MOMENTUM 패턴 확인**: `rank(-ts_rank(bookvalue_ps,250)) + rank(1-abs(ts_corr(returns,ts_delay(returns,1),250)))` → SR=1.54 FIT=1.15 SUBMITTABLE ✅ (alpha_id: leQwWoL2)
- [brain_3pipeline_handoff.md](brain_3pipeline_handoff.md) — **3-pipeline A(d1/TOP500) / B(d0/TOP500) / C(d1/TOP3000) + GVM 15필드, nohup 필수, d0Score=0 비어있음 가설.** 2026-05-28 첫 launch SIGHUP 크래시 → `Finance/brain/HANDOFF.md` 재가동 절차.

## AEQ 대회 현재 상태 (2026-06-02) ★★★★★ — 세션 재개 시 먼저 읽기
- [aeq_competition_state.md](aeq_competition_state.md) — **내일(06-03) 제출 큐(attn_with/attn_without A/B, s015), 채점대기(s025 53290936/s030 53290976), scale ablation ledger(base0.54 / 0.25→0.61 / 0.50→0.53), 경쟁자 0.86 융합 분석, converter attention 복구 완료.** 디렉토리 /Volumes/D50/AEQ.
- [aeq_eval_temp_greedy.md](aeq_eval_temp_greedy.md) — **★ AEQ 추론 temp=0 greedy 고정**. LB vs 로컬 갭은 temp 아니라 4-bit MoE 양자화. hook temp-guard.py 보호.
- [aeq_submission_landscape.md](aeq_submission_landscape.md) — **★ 제출 LB: 0.82-0.83=kienngx+huikang 융합, 우리포맷 continue-train은 0.86→0.52 붕괴**. 융합=최고레버, 로컬4-bit는 LB비교불가.
- [aeq_synthetic_sft_degrades.md](aeq_synthetic_sft_degrades.md) — **★ 합성 CoT SFT는 clean·well-posed여도 base EQ 추론 32%→12% 열화**(2026-06-05 solvable n=25 측정). 모델 자연추론>합성절차. SFT 레버 막힘 → solver+fusion 확정. 측정도구 `data/solvable_eval.jsonl`+`build_solvable_eval.py`. 자산: `improved_eq_gen.py`/`improved_cipher_gen.py`/`eval_format.py`+hook.
- [aeq_quant_correction_findings.md](aeq_quant_correction_findings.md) — **★ 양자화는 정확도 병목 아님**(2D보정 91%회수=정확도0). 활성-인지 저랭크보정 브릿지 실증(LQER/ASER). 갭은 어댑터.
- [aeq_bianfu_spec_match.md](aeq_bianfu_spec_match.md) — **★ 로컬 LoRA는 bianfu(0.83) 정합 필수: r=32/scale=1.0/lm_head포함/dropout=0.0** (2026-06-08 어댑터 바이너리 비교). round_4(r16/scale0.5/lm_head없음)는 미달. lm_head는 MLX keys 명시 필수(자동탐색 누락). hook `bianfu-spec-guard.py` 강제(bypass AEQ_ABLATION=1). round_5 재학습 `/Volumes/D50/AEQ/adaptive/round_5/`.

## AEQ GPU 환경 (2026-05-24 업데이트) ★★★★★
- [aeq_gpu_environment.md](aeq_gpu_environment.md) — **로컬 GPU: RTX 5070 Ti (SM12.0, 15.9GB)** — RTX 3060에서 업그레이드됨. SM12.0 패치 필수. 벤치 기준: Multi-Batch 422.8 tok/s.

## AEQ Research (2026-04-17, 업데이트 2026-05-07) ★★★★★
- [aeq_research_direction.md](aeq_research_direction.md) — **Private** Adaptive Expert Quantization, cross-layer expert similarity 가설, 공개 금지
- [nemotron_cache_bridge_discovery.md](nemotron_cache_bridge_discovery.md) — Nemotron cache bridge (past_key_values↔cache_params), 4096 CoT, router hook 성공
- [aeq_fcore_tier_classification.md](aeq_fcore_tier_classification.md) — **Tier 1**(SVD/Phase/반박) vs **Tier 2**(Born/Yang-Mills 가설) vs **Tier 3**(비유). 확증 편향 방지.
- [aeq_q4_scales_with_size.md](aeq_q4_scales_with_size.md) — **측정: uniform q4 품질 손실은 dense 모델 클수록 감소** (Qwen-1.5B +25% vs Mistral-7B +1.6% ppl, 둘 다 ~3.5×). 7B+ dense는 q4 기본값. MoE는 미검증.
- **CoT DB 현황 (2026-05-07 S11): 9386/9386 (100.00%) ✅**. algo_cot.jsonl 8316 + results/ 1070. "Examining" 141→115 (1.22%). S11: partial-strip fallback (_find_oracle_numeric_op) +26 케이스. 남은 115=(A)23+(Y)37+(Z)55. **다음=SFT 훈련 Kaggle RTX Pro 6000**. History: `HISTORY/2026-05-07_aeq-algo-solver.md`

## AEQ-Kernel-MLX GRPO 훈련 (2026-05-28) ★★★★★
- [feedback_grpo_min_g4.md](feedback_grpo_min_g4.md) — **GRPO G≥4 필수 + acc=0%는 흡수 상태(absorbing)** (G=4도 floor 없으면 붕괴; positive-sample 강제주입+early-stop 필수, 2026-05-30 v6 8h 낭비 확정)
- [feedback_mlx_concurrent_training.md](feedback_mlx_concurrent_training.md) — **MLX 14B+ 훈련 중 다른 mlx_lm 작업 동시 실행 금지** (Metal Interactivity 크래시, 3회 관측)
- [feedback_pythonunbuffered_for_long_jobs.md](feedback_pythonunbuffered_for_long_jobs.md) — **장시간 Python job은 PYTHONUNBUFFERED=1 필수** (stdout 버퍼링으로 stall/progress 구별 불가)
- 체크포인트: `~/Desktop/AEQ/lora_grpo_v5_step75_G2.npz` (최신). 재시도 명령: `HISTORY/2026-05-28_aeq-grpo-g2-vs-g4.md`

## 실험 전 원본 보존 (2026-04-25) ★★★★★
- [feedback_preserve_originals.md](feedback_preserve_originals.md) — **수정 실험 전 원본 백업 필수** (git checkout으로 uncommitted 개발본 유실 교훈)

## Claim 시리즈 추론망 (2026-06-04) ★★★★★
- [claim_reasoning_network.md](claim_reasoning_network.md) — **P1-P52 추론망 전체 구조**: SUMMARY가 허브(betweenness 0.055), 수정체인 35개, Wall#5 유일 철거→Wall#3 강화, 취약고리=SUMMARY→P41 도약. graphify 통합그래프 2190노드/3064엣지. `graphify-out/graph_unified.html`. **+공격면(2026-06-04): B1~B4 reconciled, A1 braneworld 계산완료(BBN 범주오류), P53 exhaustion 초안(gap L1), B5 pending.**

## Claim 워프드라이브 검증 (2026-05-30) ★★★★★
- [claim_warp_drive_bottlenecks.md](claim_warp_drive_bottlenecks.md) — **38편 음에너지/워프 시리즈: PASS1/ISSUES18/CRITICAL19. claim 막는 13병목(4-tier), 진짜 벽=①양자부등식+⑤고정점부재.** `~/Desktop/Claim/verification/` errata 4종+SUMMARY+RESEARCH.

## User Preferences
- Language: Korean default, English tech terms

## F-CORE HPC-Transformer 구현 (2026-03-31) ★★★★★
- [hpc_transformer_completed.md](hpc_transformer_completed.md) — 계층적 베이지안 라우팅 트랜스포머 완전 구현
- 파일 4개: 정식화(600L) + 구현(730L) + 테스트(530L) + 데모(170L)
- 28/28 테스트 PASS, 학습 검증 14.9% 손실 감소
- 설계: 8개 클래스(Config, LayerPosterior, BeliefUpdate, Memory, LowRank, Block, LM, loss), 5-component loss
- 주요 결정: prior 분리, soft mixture, belief GRU, memory landmarks, lowrank correction

## iOS 개발 시행착오 (전역 적용) ★★★
- [feedback_ios_websocket_ats.md](feedback_ios_websocket_ats.md) — ATS/SSL/키패드/Metal 등 8가지 함정과 해결법
- 핵심: NWConnection 쓰지 말 것(URLSessionWebSocketTask), ws://+ATS 예외, plist 변경 시 앱 삭제 필수

## F-CORE 5W1H NER + PRISM (2026-03-30) ★★★★★
- [fcore_5w1h_ner_adapter.md](fcore_5w1h_ner_adapter.md) — 전체 아키텍처
- 핸드오프: `docs/2026-03-30_session-handoff.md`
- uniform F1=0.7157(1.5MB), micro WHEN=0.87(5.6K★), KOSPI Sharpe=11.76
- 768D 직교 분해 + 고정점 LaBSE{46,59,85,86} (backbone별, 보편 아님)
- 주파수 분해: 저주파=보존, 중주파=수술, 고주파=무시
- 실수=분류, 복소=추론(Born). PRISM+Surgery+Finance 독립 프로젝트 완성
- 특허 10 Claim, 4단계 상업화 준비
- **Pod 2 과금 중**: k1uogpr57b1i0g → C2+Scaling → 회수+삭제 필요
- 다음: Scaling C* → 고정점 보호 구현 → PRISM Layer 2 통합
- uniform adapter F1=0.7157(1.5MB), micro WHEN F1=0.87(22KB)
- Oracle-Complex 통합 모듈 완성 (Born 간섭, 12.7K params)
- FiveW1HPipeline 리팩토링 완료 (번역 제거, adapter NER 직접)
- E2E ko/en/ja 5W1H 추출 검증 완료
- **RunPod 진행 중** (agent로 회수):
  - Pod1 (g83v3j8c2bafm7): Bayesian/Jacobian 72K
  - Pod2 (k1uogpr57b1i0g): 스케일업 200K/400K
- 다음: RunPod 결과 회수 → 비교표 → Complex-Oracle 학습 → iPhone 배포

## F-CORE Phase B VLA Pipeline (2026-03-30) ★★★★★
- [fcore_phase_b_vla.md](fcore_phase_b_vla.md) — On-device VLA: SpatialCID 1.07ms, DAgger 65%, Pick&Place 100%, ARKit bridge, Swift앱, 웹데모
- 파이프라인: 자연어→LaBSE→CID매칭→SpatialCID→ActionHead→Franka Pick&Place (4/4 명령 100%)
- iPhone 27Hz 추정, Core ML ANE 0.054ms, 웹데모 http://localhost:8000

## F-CORE Millennium Adoption (2026-03-30) ★★★★
- [fcore_millennium_adoption.md](fcore_millennium_adoption.md) — 6개 난제에서 F-CORE에 4건 기술 이전
- Poly KDE+KDTree (Hodge p104): 8.7x speedup, sklearn 제거
- Geodesic boundary (Hodge p107): 66 CID pair 경계 precompute, 오분류 진단
- Density confidence (NS p150): top1-top2 gap → 오분류 100% 탐지
- Tropical fallback (Hodge p102): 0.005ms nearest-centroid 안전망
- 11 smoke tests PASSED. 9건 기각 (도메인 불일치, 인프라 부재 등)

## NS Millennium α₀ Discovery (2026-03-30) ★★★★★
- [ns_millennium_alpha0.md](ns_millennium_alpha0.md) — **N=64 Re=1k~10k: β_global≈0.04, α₀_max~log(Re), α₀→negative late**
- **새 경로**: α₀ ≤ C·log(Ω) → d/dtΩ ≤ C·log(Ω)·Ω → double-exp → BKM → 정칙성
- p142-p146 완료. α₀_max ≈ -0.363+0.533·log₁₀(Re) (대수 성장, Re 10배마다 +0.53)
- Next: α₀ ≤ C·log(Ω) 이론 증명 시도 + True DNS 검증 (N=128, Re=3000)

## NS Millennium Assault (2026-03-28~29) ★★★★★
- **45실험 18Codex 6변환 8경로 → 벽: α<1 (수치 0.77, 해석 열림)**
- 최종 히스토리: `history/2026-03-29_ns-millennium-complete.md`
- 핵심: (ω̂·S·ω̂)/|ω|<1 모든 곳, Log Lyapunov 100%, 투영 gain 0.965, Gevrey=Maclaurin
- 벽: 6변환(Log,Taylor,Laplace,Euler,Z,Gevrey) 모두 α<1로 수렴

## F-CORE Causality Threshold + 4D 질량 탄생 (2026-03-29) ★★★★★
- [fcore_causality_threshold.md](fcore_causality_threshold.md) — V_trans C(t) 감쇠율 M으로 환각 차단, 4D 위상학, 중력 아날로그
- 핵심: M>M_th→행동 승인, M<M_th→BLOCK. 4D=2-form 교차 최소 차원. Codex: Bakry-Émery dead end

## F-CORE Yang-Mills × density_gap (2026-03-28) ★★★★★
- [fcore_yang_mills_density_gap.md](fcore_yang_mills_density_gap.md) — P96~P108 완결, SU(2) 상전이 탐지, α=α_C+α_F-β
- 핵심: density_gap = order parameter gap (≠ mass gap), 범용 상전이 탐지기

## F-CORE 세션 12 (2026-03-28~29) ★★★★
- [fcore_session12_onion_to_topology.md](fcore_session12_onion_to_topology.md) — P90-C~P98-B, 스케일링법칙, 오일러위상
- P96-C: 2000문장 ep10 recall 1.0, P95: oracle-guided 0.856
- AD-10: Map B 오일러 χ 감시 + AnchorStore HITL 편입
- **미해결: CID Steering (decoder blend gate → direct pathway 수렴)**

## F-CORE BSD 여정 (2026-03-28~29) ★★★★
- [fcore_bsd_journey.md](fcore_bsd_journey.md) — P96 시리즈 전체: AD-8 ADC 정리 증명, ap_entropy↔Sha ρ=0.27, Cremona 64K 검증
- 핵심: F-CORE 내부 정리 ✅, BSD 증명 ✗ (범함수적 등식은 귀납으로 연역 불가)
- 데이터: `data/cremona/allbsd.00000-09999` (64,687곡선)
- 문서: AD-7~AD-11 (5개, ~3,400줄), 실험 14개

## F-CORE 세션 11 (2026-03-28) ★★★
- [fcore_session11_p85_p90.md](fcore_session11_p85_p90.md) — P86-Av2 PSNR22, P87 3D돌파, P89 LLM상전이, 양파껍질 생성모델
- 핵심: DPT fusion=64D, GPT-2 L1↔LaBSE +0.87, Layer 8 상전이, Transformer=one-way

## F-CORE 세션 10 (2026-03-27)
- [fcore_session10_discoveries.md](fcore_session10_discoveries.md) — Path Signature, MOPT, 물리추론, ThoughtEvaluator, 논문확장
- Commit style: Conventional Commits
- bkit plugin: v1.5.5 active (don't duplicate its features)

## RunPod 유휴 감지 시스템 (2026-04-06)
- [runpod_idle_monitor.md](runpod_idle_monitor.md) — Gemini CLI 기반 자동 모니터링 + Claude 세션 보고

## RunPod 대형 모델 최적화
- [feedback_runpod_large_model_download.md](feedback_runpod_large_model_download.md) — CPU pod 다운로드 → Network Volume → GPU pod 추론만. 70B+ 모델 ~$6/실험 절감

## RunPod 배포 → 전용 agent 위임
- **RunPod 관련 모든 것(규칙, 교훈, 장애 대응)은 전용 agent가 관리**
- [runpod-agent.md](runpod-agent.md) — 호출 규칙 + Hook bypass 규칙
- Pod 배포/모니터링/장애 대응 시 반드시 전용 agent 호출. 메인에서 직접 처리 금지.
- **★ Hook bypass**: 전용 agent 내부에서 `RUNPOD_AGENT=1` prefix 필수 (없으면 hook이 block)
- **RunPod MCP 서버 설치됨 (2026-03-21)**: `~/.claude.json` mcpServers.runpod
  - `mcp__runpod__list-pods`, `stop-pod`, `delete-pod`, `create-pod` 등 26개 도구 사용 가능
  - 메인 Claude에서 직접 pod 상태 조회/긴급 terminate에 사용 가능 (hook 우회)
  - 단, 배포/모니터링 전체 흐름은 여전히 Agent에 위임
- [feedback_runpod_resource_calc.md](feedback_runpod_resource_calc.md) — 배포 전 VRAM/GPU util 계산 필수
- [feedback_runpod_agent_always.md](feedback_runpod_agent_always.md) — agent 위임 규칙

## F-CORE P-시리즈 참조
- [cglm_p_series_reference.md](cglm_p_series_reference.md) — P4~P44 번호별 파일명·내용·결과 완전판 (2026-03-26 기준)
- [cglm_phase_architecture.md](cglm_phase_architecture.md) — Phase 1~7 역할·구현·결과 전체 아키텍처 (2026-03-27 기준)
- [fcore_tabr.md](fcore_tabr.md) — **TABR 기본 라우팅 전략** (αmax=0.5, steep=3, 3-스케일 ALL PASS)
- [fcore_auto_genesis_policy.md](fcore_auto_genesis_policy.md) — **Auto-Genesis 반복 확장 정책** (점진 데이터→자율 CID 확장, 3-스케일 기본)

## CGLM 완료된 피처 (Completed Features)

### arc-lexicon-augment-p27 (Lexicon 보강) — 2026-03-26 ✅ PASS (P-시리즈 최고)
- **DR=0.9931** (143/144), P26 대비 **+0.0834 (+9.17%)**, 잔존실패 13개→1개
- **방법**: p27_failure_analysis.py로 원인 분류 → p14_lexicon.json 21개 단어 추가/이동
- **핵심 수정**: CID_APPLE에서 `april`, `껍질` 제거 → 각각 CID_TIME, CID_TREE로 이동
- **추가**: CID_TIME: `april/month/spring`, CID_WATER: `우물/brook/선원/stream/well/source`, CID_FIRE: `재/타다/ray/ember/燃烧`, CID_SKY: `云`, CID_WIND: `불다/세차다`, CID_TREE: `껍질/carpentry`
- **핵심 교훈**: 오분류 단어 1개(april→CID_APPLE)가 spring 관련 케이스 전체 실패 유발. Lexicon 품질 > w_a 튜닝
- **잔존 1개**: `배+껍질` → CID_APPLE (예측: CID_TREE) — 껍질 이동 1-1 트레이드오프로 해결 불가
- **파일**: `p14_lexicon.json` (수정), `p16_train_emb.npy` (9809,64), `p27_failure_analysis.py` (신규)
- **P-시리즈**: 0.708→0.736→0.771→0.819→0.896→0.9097→**0.9931**

### arc-kde-gravity-p26 (동적 w_a + 정밀 탐색) — 2026-03-26 ✅ PASS
- **DR=0.9097** (131/144), P25(0.8958) 대비 **+0.0139 (+1.55%)**
- **최적 w_a=0.35** (P25=0.30), [0.34,0.36] 고원 확인 (0.0001 해상도에서 무차별)
- **공식**: `q = 0.35 × L2(emb_anchor) + 0.65 × emb_context`, 이후 L2 정규화
- **핵심 발견**: 초정밀 탐색으로 w_a 방향 한계 도달 → 다음 축(렉시콘)에서 탐색 필요
- **파일**: `planets/core/typed_ir/p26_dynamic_weight.py` (신규, 537L)
- **Archive**: `docs/archive/2026-03/arc-kde-gravity-p26/`

### arc-kde-gravity-p25 (반중력 쿼리 합성) — 2026-03-26 ✅ PASS (P-시리즈 역대 최고)
- **DR=0.8958** (129/144), P24 대비 **+7.64%**, FR 6/6, NFR 3/3, Match Rate 100%
- **공식**: `q = 0.3 × emb_anchor + 0.7 × emb_context`, 이후 L2 정규화
- **그리드 탐색**: W_GRID = [-1.0…+1.0] × {raw, L2-norm} = 22회, 최적 w_a*=0.3 L2-norm
- **실패 개선**: 26개 → 15개 개선(star+actor/singer/movie, 건물+학교 관련 등) / 11개 잔존 / 4개 신규
- **핵심 발견**: 최적이 음수(반중력)가 아닌 양수 소범위(0.3). L2-norm이 raw보다 항상 우세
- **파일**: `planets/core/typed_ir/p25_query_weight.py` (신규, 307L), runtime=11.0s
- **다음**: P26 — CID별 최적 w_a 탐색, 잔존 11개 패턴 분석, w_a ∈ [0.2, 0.4] 정밀 탐색

### arc-kde-gravity-p22 (Abramson γ-Scaled KDE) — 2026-03-26 ✅ PASS (P17 동률 달성)
- **DR=0.771** (P17=0.771 동률, 6회 시도 끝 최초), density_gap=4.77 (P17=5.31보다 예리), runtime=10.6s (P17 74% 단축)
- **공식**: `σ_i = σ_pilot × (d_k / g_mean_dk)^γ`, σ_pilot=0.10, γ={0.3,0.5,0.7}
- **P21 σ 폭주 해결**: [0.44, 0.93] → [0.079~0.134] (P17 σ=0.10 ±34% 이내)
- **γ 결과**: P22-A(0.3)=DR 0.771, P22-B(0.5)=DR 0.771/density_gap=4.77, P22-C(0.7)=DR 0.736
- **교훈**: Geometric mean normalization으로 σ_pilot 스케일 보존하면서 상대적 밀도 정보 유지
- **파일**: `planets/core/typed_ir/p22_gamma_kde.py`, `test_p22_smoke.py` (14/14 PASS)
- **Match Rate**: 99% (FR 8/8, NFR 5/5 PASS)
- **다음**: P23 — γ 자동 최적화 (CID별 적응형 γ) or 앙상블 접근

### arc-kde-gravity-p21 (k-NN Adaptive KDE) — 2026-03-26 ❌ FAIL (σ 스케일 불일치)
- **DR=0.653** (P17=0.771 대비 -0.118), SA_kde=0.376 (급락), density_gap=0.09 (소멸), runtime=14.4s
- **근본 원인**: k-NN σ_i = 0.44~0.93 (P17 최적 σ=0.10의 5~9배) → bandwidth 과대 → CID 경계 소멸
- **교훈**: k-NN dist 그대로 σ로 쓰면 안 됨. P22에서 rescaling 필수: σ_i = α×d_k(xi), α = σ_P17/mean(d_k)
- **파일**: `planets/core/typed_ir/p21_knn_kde.py` (신규 1개)
- **P-시리즈 연속 실패**: P18=0.715, P19=0.771(동일), P20=0.722, P21=0.653 (5회 연속 P17 초과 실패)
- **다음**: P22 — k-NN σ_i rescaling (pilot bandwidth × relative k-NN distance ratio)

### arc-kde-gravity-p18 (Lexicon Cleansing) — 2026-03-25 ⚠️ PARTIAL (역설적 결과)
- **DR**: 0.715 (P17=0.771 대비 -0.056 **악화**), SA_kde=1.000, density_gap=7.32
- **핵심 발견 (역설)**: ROGUE 단어 제거 → DR 오히려 악화. centroid L2 거리 ≠ KDE 밀도 기여도
- **메커니즘**: ROGUE 단어들이 KDE 밀도를 넓은 공간으로 확장 → 경계 쿼리 커버리지 향상 기여. 제거 후 CID 밀도 수축 → 경계 쿼리 오분류 증가
- **Fast Path**: prepare_p18_data.py — 0.0s (Wikipedia API 재호출 없음)
- **Design Match**: 95% (FR 3/3, NFR 2/4), 파일 3개 신규
- **P-시리즈**: P14=0.708 → P16=0.736 → P17=0.771 → **P18=0.715** (2번째 회귀)
- **다음**: P19 — Adaptive sigma. density_gap=7.32 >> 5.0으로 필요성 확정

### arc-kde-gravity-p17 (KDE 중력장 분류기) — 2026-03-25 ⚡ FAIL(SA)/P-시리즈 최고(dr)
- **P17-A KDE-64D**: dr=0.771 ★ (P-시리즈 역대 최고), sa=0.376 (측정 불일치), verdict=FAIL
- **P17-B KDE-2D**: dr=0.340 — 차원 저주 수치 확인
- **핵심**: 파라미터 0개 KDE가 6,900 파라미터 FC(P16=0.736)를 dr에서 +0.035 초과
- **σ_opt=0.10** (AMISE 이론 ≈0.880 vs 실제 0.10 — LaBSE 임베딩이 이미 강한 클러스터링)
- **SA FAIL 원인**: FC h2(contrastive 최적화) vs PCA-64D(순수 LaBSE) 측정 공간 불일치 (버그 아님)
- **Design Match**: 97% (FR 9/9, NFR 4/4), runtime=40.9s
- **파일**: `planets/core/typed_ir/p17_kde_gravity.py` (신규 1개)
- **다음**: P18 — KDE용 SA metric 재정의 (CID 내 vs CID 간 cosine), 동적 CID 확장 실험

### arc-angle-tok-v2-p16 (데이터 스케일링) — 2026-03-25 ✅ PASS
- **P16**: dr=0.736, sa=1.000, PASS. Wikipedia API(4,794) + Tatoeba(891) → 6,109 samples (P14 ×2.6)
- **핵심**: 에폭 조정 필수 (300→1500). epoch=1000~1500 최적, epoch=2000+ 과적합(dr=0.694)
- **데이터 스케일링 가설 ✅**: 더 많은 데이터 + 적절 에폭 → dr 0.708 → 0.736
- **파일**: `prepare_p16_data.py`, `p16_fc_scale.py`, `p16_train_emb.npy` (6109,64)

### arc-angle-tok-v2-p15 (768D LDA) — 2026-03-25 (실험)
- **P15**: dr=0.674 — PCA 무죄 확인. LDA on 64D = LDA on 768D (수학적 동치)
- **선형 방법 절대 상한 = 0.674**: 어떤 선형 투영으로도 0.674 초과 불가

### arc-angle-tok-v2-p14 + A→C→B 로드맵 — 2026-03-25 ✅ COMPLETE
- **P14 (A)**: PASS — dr=0.708, sa=1.000, 133 회귀 PASS. 해양 어휘 4개 제거 + Frozen P12 PCA로 P13 회귀(0.660) 완전 복구
- **C (FAISS baseline)**: dr=0.646 — B 진입 조건(>0.660) 미충족
- **B (Complex Plane POC)**: min-sum-dist=0.646 (FAISS 수학적 동치), majority=0.292 (참패)
- **핵심 인사이트**: min-sum-dist across 63 planes ≈ weighted L2 in 64D → FAISS와 동일. FC layer의 학습 우위(+0.062)는 파라미터 없는 기하학으로 재현 불가.
- **IC**: Majority Vote는 단일 2D plane이 너무 약해 63-앙상블이 랜덤 투표로 전락
- **Files**: `p14_lexicon.json`, `prepare_p14_data.py`, `p7_projection.py(+main_p14)`, `test_p14_smoke.py`, `faiss_baseline.py`, `complex_plane_poc.py`
- **Design Doc**: `~/.gstack/projects/cglm/xox-unknown-design-20260325-204717.md`
- **Archive**: `docs/archive/2026-03/arc-angle-tok-v2-p14/` (예정)

### arc-angle-tok-v2-p13 — 2026-03-25 ⚠️ (PARTIAL, dr 회귀)
- **Status**: Complete (96% Design Match, **PARTIAL verdict** — dr 회귀)
- **P13 실험 결과**: PARTIAL — dr=0.660 (P12 0.708 대비 **-0.048 회귀**), sa=1.000 ✅, runtime=61.1s (1.1s 초과)
- **핵심 발견**: 28개 어휘 추가로 lexicon-only PCA 재피팅 → 임베딩 공간 전체 이동 → P12 통과 테스트 신규 실패. "데이터 수정 = 성능 향상" 가설 반증.
- **IC**: PCA refit 취약성 — 어휘 추가 시 기존 테스트 불안정화 위험. P14+는 Frozen PCA 또는 ablation 기반 검증 필수.
- **껍질 cross-anchor**: Premise 7 현실화. 껍질 CID_APPLE 제거 후 P14에서 재검토.
- **테스트**: 52/52 PASS (3 P13 + 49 레거시)
- **dr 추이**: P9=0.465 → P10=0.562 → P11=0.653 → P12=0.708 → **P13=0.660 (첫 회귀)**
- **Archive**: `docs/archive/2026-03/arc-angle-tok-v2-p13/`

### arc-angle-tok-v2-p12 — 2026-03-25 ✅
- **Status**: Complete (100% Design Match, **PASS verdict** — P-시리즈 최초)
- **P12 실험 결과**: PASS — dr=0.708 (≥0.70 ✅, P11 0.653→+0.055), sa=1.000 ✅, runtime=53.4s ✅
- **핵심 발견**: "movie" 이중 레이블 (CID_BOOK+CID_PERSON) → 훈련 신호 상쇄 → star+movie=CID_SKY (오분류). 수정: CID_BOOK에서 제거 → CID_PERSON 전용 → PASS
- **IC**: 이중 레이블 금지 규칙 — 어휘 추가 전 전체 12 CID 중복 검사 필수
- **테스트**: 49/49 PASS (3 P12 + 46 P11 이전)
- **dr 성장**: P9=0.465 → P10=0.562 → P11=0.653 → P12=0.708 ✅
- **Archive**: `docs/archive/2026-03/arc-angle-tok-v2-p12/`

### arc-angle-tok-v2-p11 — 2026-03-24 ✅
- **Status**: Complete (91.3% Design Match, PARTIAL verdict)
- **P11 실험 결과**: PARTIAL — dr=0.653 (≥0.70 미달, P10 0.562→+0.091), sa=0.997 ✅, runtime=37s ✅
- **핵심 발견1**: SCL(SupCon) loss가 N≥1440 full-batch에서 CE gradient를 압도 → beta=0.0 필수
- **핵심 발견2**: OPUS+lexicon 혼합 PCA → lexicon-only PCA 필수 (단어 분리도 저하)
- **어휘 갭**: CID_PERSON "actor"/"singer" 미등록 → 0/6 오류 (P12 개선 대상)
- **IC 5건**: alpha/beta/epochs 변경, lexicon-only PCA, dropout=0, n_train 추가, dead import
- **테스트**: 46/46 PASS (기존 43 + P11 smoke 3)
- **dr 성장 추이**: P9=0.465 → P10=0.562 → P11=0.653 (+0.091)
- **다음 단계**: P12 — CID_PERSON 어휘 보강 + OPUS per-sample PCA 재활용 → dr ≥ 0.70
- **Archive**: `docs/archive/2026-03/arc-angle-tok-v2-p11/`

### arc-angle-tok-v2-p6 — 2026-03-24 ✅
- **Status**: Complete (95% Design Match, PARTIAL verdict)
- **P6 실험 결과**: PARTIAL — DR=0.613 (≥0.60), beta_pval=0.034, synonym_alignment=FAIL
- **핵심 발견**: 바이트 공간 ≠ 의미 공간 정량 확인 → P7 Neural Projection Layer 설계 명분 확보
- **이례적 신호**: P6-B ncr_ratio=1.5750 (FAIL 예측이었으나 barely PASS) — 원인 분석 권장
- **버그 2건 수정**: verdict_p6 차원 불일치 + OR 조건 누락 → FAIL 오판 → PARTIAL 복원
- **코드**: p6_word_attractor.py (806L, FR-B1~B12), test_p6_smoke.py (431L, 38 PASS)
- **다음 단계**: P7 Neural Projection Layer (Supervised Contrastive Loss + Lexicon DB Hard Anchoring)
- **Output**: `docs/04-report/features/arc-angle-tok-v2-p6.report.md`

### arc-angle-tok-v2-p5 — 2026-03-24 ✅
- **Status**: Complete (100% Design Match, PASS verdict)
- **P5 실험 결과**: PASS — CCR=2.529 ≥ 2.0 ✅
- **핵심 발견**: noun centroid가 within-noun 분산의 2.5배로 분리 → Word Attractor 중심점 증명
- **4지표 측정**: NCR=1.667 (baseline), RCR=0.113 (baseline), CCR=2.529 ✅, JCR=0.431 (3.9×)
- **코드**: p5_noun_attractor.py (512줄, 10 FR), test_p5_smoke.py (352줄, 29 PASS)
- **다음 단계**: P6 Word Attractor 통합 (파티클 필터 의미 수렴, P6-A/B/C)
- **Output**: `docs/04-report/features/arc-angle-tok-v2-p5.report.md`
- **Memory**: [arc-angle-tok-v2-p5-completion.md](arc-angle-tok-v2-p5-completion.md)

### arc-angle-tok-v2-p4 — 2026-03-24 ✅
- **Status**: Complete (96% Design Match)
- **P4 실험 결과**: PARTIAL — cosine_suffix sil=0.507 ✅, stem_match=31% ❌
- **핵심 발견**: suffix mean angle 클러스터 존재하나 josa 그룹화 불충분
- **결론**: Word Attractor = noun-anchor 재설계 필요 (P5로 수행)
- **Output**: `docs/04-report/features/arc-angle-tok-v2-p4.report.md`
- **파일**: p4_dtw_pilot.py (366줄), test_p4_dtw_smoke.py (11 PASS), p4_ko_nouns_1000.txt (787개)

### copa-typed-ir-v02 — 2026-03-22 ✅
- **Status**: Complete (90% Design Match)
- **Memory File**: [copa-typed-ir-v02-completion.md](copa-typed-ir-v02-completion.md)
- **Key Metrics**: overall=0.640 (+0.050 vs v01), cause=0.635 (+0.116 key breakthrough), effect=0.646
- **Design Match**: 90% (FR-01 partial due to untrained F_op, IC-1 bidirectional LM scoring boost)
- **Files Changed**: typed_ir_adapter.py (backward_nlp_rules), copa_experiment.py (v02 refactor)
- **Documentation**: plan.md (208L), design.md (130L), analysis.md (117L), report.md
- **Output**: `/Users/xox/Desktop/CGLM/docs/04-report/features/copa-typed-ir-v02.report.md`
- **Next**: v03 (F_op training + backward rules activation, adaptive alpha)

### typed-ir-algebra-v01 — 2026-03-22 ✅
- **Status**: Complete (97% Design Match)
- **Memory File**: [typed-ir-algebra-v01-completion.md](typed-ir-algebra-v01-completion.md)
- **Key Metrics**: 10 FR (100%), 4 NFR (100%), 0 missing, 4 IC (all beneficial), 6 extras (all beneficial)
- **Smoke Tests**: 7/7 PASS (T1~T7)
- **Documentation**: plan.md, design.md, analysis.md, report.md (~3,260 lines total)
- **Output**: `/Users/xox/Desktop/CGLM/docs/04-report/features/typed-ir-algebra-v01.report.md`
- **Next**: v0.2 (Math/Code E_d adapters, adaptive thresholds)

### text-rule-trieddb (F13a) — 2026-03-21 ✅
- **Status**: Complete (98% Design Match)
- **Memory File**: [text-rule-trieddb-completion.md](text-rule-trieddb-completion.md)
- **Key Metrics**: 6 FR (100%), 3 NFR (100%), 5 Gate (100%), 0 missing, 2 IC
- **Documentation**: plan.md, design.md, analysis.md, report.md (1,428 lines total)
- **Output**: `/Users/xox/Desktop/CGLM/docs/04-report/features/text-rule-trieddb.report.md`
- **Next**: F13b (Thompson sampling)

---

## CGLM 학습 데이터 (★ 핵심 — 잘못 인식 3회 재발 금지)
- [project_cglm_multi_domain_datasets.md](project_cglm_multi_domain_datasets.md)
- **현재 학습 데이터**: Crownelius/Opus-4.6-Reasoning-3300x (추론/수학, thinking 포함)
- **평가 후보**: ginigen-ai/smol-worldcup (다국어 벤치마크, JSON 출력)
- ★ "tinystories", "영어 서사 단일 도메인" 표현 절대 금지

## CGLM 아키텍처 핵심 의도
- [project_cglm_architecture_intent.md](project_cglm_architecture_intent.md) — 동적 로딩, anchoring 조절, 환경 구성 순서, planet=도메인

## command.md 기록 규칙 (피드백)
- [feedback_command_md.md](feedback_command_md.md) — 매 사용자 입력 즉시 기록, 3회 누락으로 지적받음

## Plan 3-사이클 강제 규칙 (피드백)
- [feedback_plan_3cycle.md](feedback_plan_3cycle.md) — plan 문서 생성 시 개념→코드베이스→수학 3-사이클 강제 (각 WebSearch 포함, 생략 불가)

## 로컬 실행 시간 한도 (강제 규칙)
- [feedback_local_runtime_limit.md](feedback_local_runtime_limit.md) — **로컬 1시간 초과 시 RunPod 전환**
- 예상 30분 이상 → RunPod 사용 여부 먼저 판단. 실행 중 30분 초과 → 즉시 kill → RunPod

## RunPod Spot 배포 강제 규칙 ($0.22/hr)
- [feedback_runpod_cost_limit.md](feedback_runpod_cost_limit.md) — **Spot(bidPerGpu=0.22) 필수. On-Demand($0.46/hr) 금지**
- RTX 3090 Spot=$0.22/hr, On-Demand=$0.46/hr. bidPerGpu 없이 배포 = 규칙 위반
- infra.py: `SPOT_BID=0.22`, create_pod()에 `bidPerGpu: {SPOT_BID}` 포함 확인

## 시행착오 교훈 (코드/실험 패턴)

> Pod/RunPod 관련 교훈(로그 확보, idle 방치, 과부하 등)은 전용 agent에 이관됨 → `scripts/runpod_agent_prompt.md`

### 1. config 전달 누락 — 가장 빈번한 치명 버그
- **문제**: 새 파라미터를 argparse에 추가하고 awake_cfg/sleep_cfg dict에 안 넣음 (BUG-7 mi_lambda, sv6-BUG-1 slam-step-update)
- **원칙**: 새 CLI arg 추가 시 반드시 `grep -n "awake_cfg\|sleep_cfg\|recalib_cfg"` 해서 전달 경로 전수 확인
- **체크**: smoke test에서 새 arg가 실제로 코드 내부에 도달하는지 로그로 확인

### 2. detached tensor → gradient dead
- **문제**: `torch.tensor(list)` 또는 `torch.stack([...]).detach()` 로 leaf tensor 생성 → loss에 gradient 없음 (sv6-BUG-2 TD-smooth)
- **원칙**: loss에 기여할 tensor는 반드시 `requires_grad=True`인 연산 그래프 내에서 생성. 새 loss term 추가 시 `loss.backward()` 후 관련 param의 `.grad`가 None이 아닌지 확인
- **체크**: smoke test에서 `assert param.grad is not None` 또는 debug dict에 grad norm 출력

### 3. debug 집계에서 첫 step 키만 사용
- **문제**: `_debug_accum[0].keys()`를 key template으로 쓰면 later step에서만 나타나는 키(film_gamma_norm 등)가 누락 (sv6-BUG-4)
- **원칙**: debug dict 집계는 반드시 **union of all keys** 패턴. `set().update()` 사용
- **체크**: 조건부 debug 키(FiLM, HyperNet 등)가 최종 로그에 나타나는지 확인

### 4. 설계 의도 검증 — "이게 내 의도에 부합하니?"
- **문제**: TD-smooth를 "신호 안정화"가 아닌 "ctrl 반응 억제"로 잘못 구현 (sv6 TD-smooth 첫 설계)
- **원칙**: 새 메커니즘 구현 전에 한 문장으로 의도 요약하고, 구현 후 그 문장과 코드가 일치하는지 self-check. 의심되면 사용자에게 확인
- **체크**: "이 코드가 X를 하는가?" 질문에 대한 답이 코드에서 직접 추적 가능해야 함

### 5. 백그라운드 agent 독자 Pod 생성 금지 — 2회 재발 (CRITICAL)
- **문제1**: S68 모니터 agent가 기존 3 Pod terminate(로그 미회수) + 전체 재배포 → 로그 유실 + GPU 경합
- **문제2**: subagent가 사용자 승인 없이 `s68f-p1/p2` Pod를 독자 생성 → 사용자가 타인 침입으로 오인 + 불필요 과금
- **절대 금지**: subagent가 RunPod Pod를 직접 생성(create)하는 것. Pod 생성은 반드시 사용자가 launcher 실행을 확인한 후에만.
- **원칙**: (1) Pod 생성/terminate는 사용자에게 먼저 보고 후 승인받아 실행 (2) agent가 자체 판단으로 Pod 재시도/재배포 절대 금지
- **체크**: (1) 기존 Pod terminate 전 로그 회수 확인 (2) 재배포 전 로컬 logs/ 완료 여부 확인 (3) 전체 재배포 금지, 누락분만

### 6. 실험 arm 공통 기반 누락
- **문제**: 실험 arm 중 control(기준)에 필수 플래그 빠뜨림 → 모든 비교군이 사실상 같은 조건 (sv6-BUG-1 COMBO에 --slam-step-update 누락)
- **원칙**: 실험 launcher 작성 시 COMBO(공통 기반) 문자열을 먼저 정의하고, `grep`으로 필수 플래그 전부 포함 확인
- **체크**: launcher 완성 후 각 arm의 최종 명령줄을 출력해서 사람이 읽을 수 있게 리뷰

## 자율 수행 규칙 (2026-03-11 사용자 허가)

### 자율 수행 범위
- **로드맵(plan/roadmap-v2.md) 순서대로** 구현·실험·분석 진행
- RunPod 실험 포함 — 배포는 전용 agent에 위임
- 궁금한 점은 WebSearch로 논문/참조 확인 후 진행
- 사용자에게 질문은 **방향 전환이 필요할 때만**

### 배포 전 필수 체크리스트 (자율 수행 시)
0. **Spot 배포 확인: bidPerGpu=0.22 포함됐는가** (강제, On-Demand 배포 위반)
1. smoke test `--sequence parity:2` 통과 (✓ committed 2회, ERROR/Traceback 없음)
2. 새 파라미터 → config dict 전달 경로 전수 확인 (교훈 #1)
3. 새 loss term → gradient flow 확인 (교훈 #2)
4. debug dict → union key 패턴 확인 (교훈 #3)
5. 설계 의도 1문장 요약 → 코드 대조 (교훈 #4)
6. launcher COMBO → 필수 플래그 전수 확인 (교훈 #6)
7. RunPod 재배포 시 로컬 logs/ 완료 여부 확인 → 누락분만 배포 (교훈 #5)

### 자기 교정 프로토콜
- 같은 종류의 실수 2회 발생 → 즉시 MEMORY.md 교훈 추가 + CLAUDE.md 규칙 제안
- 실험 실패 시 → 원인 분석 → 교훈 해당 여부 체크 → 해당되면 교훈 강화
- 매 실험 완료 시 → history 파일 업데이트 + 교훈 위반 여부 self-audit

## AGI 이론적 프레임워크 (2026-03-12 정립)
- [agi-theoretical-framework.md](agi-theoretical-framework.md) — MAML/Data++/CEC 대응 관계

## 최근 세션 요약 (2026-03-14)

### AGI: S87 배포 완료 (실행 중)

**실험 스택 (최신)**:
- S68 ADOPT: gate06 (τ=0.6) composite=0.6183 (CEC baseline)
- **S82 lp1 BEST**: composite=0.6337, arith_adapt=0.6727, par_ret=0.5233, loops=1.89
- S86 REJECT (S1 rate=0%, dim mismatch bug)
- **S87 배포 중**: token_emb_mean fix, 3 arms × 3 seeds = 9 jobs, 3 Pods (RTX 3090)
  - Pod 1: 2qzfexndz1np81 (213.192.2.106:40006) — ctrl s42/43/44
  - Pod 2: n1jfq8euvpkdo7 (213.192.2.123:40189) — s87_par4 s42/43/44
  - Pod 3: o22ypxcoe7s3nl (213.192.2.117:40172) — s87_drift5 s42/43/44
  - 모니터: /tmp/s87_monitor.py (PID 53752)
  - H1: ctrl composite ≥ 0.6237, H2: parity S1_rate ≥ 0.50, H3: best arm > ctrl+0.01

**S87 배포 중 발견된 launcher 버그 (Incidents #19, #20)**:
- Incident #19: rsync silent fail → `install_rsync_remote()` retry+verify 패턴으로 수정
- Incident #20: nohup SSH timeout → 중복 프로세스 → `start_runner.py` (start_new_session=True) + retry 중복 방지
- launcher template 수정 완료 (`scripts/runpod_s87.py`)

**교훈 누적 (Incidents #18~20)**:
- #18: chunk centroid/query 반드시 동일 표현 (dim mismatch → sim 무효)
- #19: ssh_cmd는 returncode 미확인 → 설치 검증 단계 필수
- #20: nohup background: start_new_session=True만 확실히 SSH 즉시 반환

**현재 파일**:
- `scripts/runpod_s87.py`: S87 launcher (fix 완료)
- `analysis/s87_verdict.py`: S87 verdict 스크립트
- `history/2026-03-14_s85-deployment.md`: S85~S87 상세 히스토리

### ★ 폐기 확정된 방향 (다시 시도 금지)
- W masking (S71), γ trajectory replay (S69, S72), obs_boost (S72), GRU with detach (S72)
- Prototype/MoE for gamma_task (S73), Born rule interference (S73)
- λ_Δ 계열 (S75~S77): W-compile과 근본적 trade-off
- EWC bank (S81): single-domain importance 측정 근본 한계
- **h_ctx 192-dim chunk centroid (S85)**: W-dependent → stale after sleep

## CGLM 자율 실험 모니터 에이전트 (2026-03-15 추가)

### 활성화 방법
```python
Agent(
    subagent_type="general-purpose",
    prompt=open("/Users/xox/Desktop/CGLM/scripts/cglm_monitor_agent.md").read(),
    description="CGLM 24h 실험 모니터"
)
```
또는 로컬 모니터: `python /Users/xox/Desktop/CGLM/scripts/cglm_monitor.py`

### 핵심 규칙
- 로그 회수 전 terminate 금지 (R3)
- deploy_round2.py --logs 로 30분마다 상태 확인
- **자율 수행 모드 ON (2026-03-15)**: Round 2+ 배포 포함 모든 단계 사용자 승인 없이 진행

### Round 1 결과 (2026-03-15 완료 ★)
| Variant | val_bpb |
|---------|---------|
| v0 Baseline | 1.3260 |
| v1 RoPE | 1.1846 |
| v2 SwiGLU | 1.2481 |
| v3 RoPE+SwiGLU | 1.1115 |
| **v4 ALL (BEST)** | **1.0265** |
- 목표 1.5 → **5/5 모두 달성** (best: v4=1.0265)

### Round 2 결과 (2026-03-15 완료 ★)
| Variant | val_bpb | Steps | 비고 |
|---------|---------|-------|------|
| v5 Scale192 | **0.8968** | 10K | d_model=192, n_layers=6 → BEST |
| v6 FullRun | 0.9166 | 50K | v4 flags, full training |
- **v5 Scale192가 최고**: 모델 크기 확장이 steps 증가보다 효과적
- 체크포인트: `checkpoints/v5_lm.pt` (11MB), `checkpoints/v6_lm.pt` (3.5MB)
- 이미지 교훈: `runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2204` (9.6GB) → SSH 포함, pulling 빠름
- data_prep nohup SSH timeout(15s)은 정상 (백그라운드 실행됨, 에러 무시)

### CGLM 다음 세션 교훈 (#7)
- **community cloud 이미지**: `runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2204` (9.6GB) 사용 권장 (구 22GB devel 이미지 금지)
- **DATA_PREP_SCRIPT 인자 오류**: `--dataset/--out-dir` → `--data-dir` (argparse 변경사항 반드시 확인)
- **data_prep nohup SSH timeout**: 15초 timeout은 정상 — nohup으로 백그라운드 실행됨 (에러 무시하고 진행)

### Stage 2 학습 (완료 ★, 2026-03-15)
- **best h_MSE = 0.02670** @ step 26000/30000 (목표 <0.05 ✓, 목표 대비 47% 초과 달성)
- 체크포인트: `checkpoints/encoder_v5_stage2.pt` (11MB)
- config: d_model=192, n_layers=6, n_heads=6, d_ff=768, d_sent=256, RoPE+SwiGLU
- 31분 (RTX 3090 j542cjvpek5xw7, terminated)

### Stage 3 A* Decoder (smoke test 완료 ★, 2026-03-15)
- **path_coherence**: A*=0.6045 vs Greedy=0.0000 — A* 완승
- `scripts/run_inference.py` 3개 버그 수정:
  1. load_encoder: use_rope/use_swiglu/max_seq_len 미전달 → state_dict mismatch
  2. greedy_generate: lm.generate() 1D return인데 `[0, n:]` 2D 인덱싱 → IndexError
  3. path_coherence: `astar_story`가 list인데 `.replace()` 호출 → AttributeError
- 결과: `docs/experiments/stage3_smoke_test.json`

### CGLM 1차 PDCA 사이클 완전 종료 (2026-03-15)

| Feature | Match Rate | 아카이브 위치 |
|---------|:----------:|--------------|
| cglm-model | 85% | docs/archive/2026-03/cglm-model/ |
| cglm-data-pipeline | 92% | docs/archive/2026-03/cglm-data-pipeline/ |

**데이터 현황**: train.bin (Opus-Reasoning 2,160개 기반), val.bin, test.bin, pairs_*.arrow, landmarks.json(100개)
**체크포인트**: v5_lm.pt(0.8968 bpb), encoder_v5_stage2.pt(h_MSE=0.0267), slam_v5_landmarks/

### Active Projects
- **AGI**: ~/Desktop/AGI/ — S87 배포 중, 완료 후 verdict 실행
- **CGLM**: ~/Desktop/CGLM/ — 1차 PDCA 완료. 다음: SLAM landmarks mining + 2차 학습(50K steps) 또는 신규 feature
- **fashion-crawler**: ~/Desktop/fashion-crawler/ — P1 complete, P0 (zigzag) pending
- **GLLM**: ~/Desktop/GLLM/ — router_stability, osc_coupling, training_launcher
- **Self-Evolving**: ~/Desktop/Self-Evolving/ — 12 agents, PDCA pipeline

## Kaggle 리소스 카탈로그 (2026-05-20) ★★★★★
- [kaggle_catalog_reference.md](kaggle_catalog_reference.md) — datasets 5개, notebooks 40+개 전체 목록. Hook 자동 주입. 갱신: 'kaggle catalog update'

## AEQ Nemotron 대회 0점 디버깅 (2026-06-01) ★★★★★
- [feedback_mlx_peft_scale_match.md](feedback_mlx_peft_scale_match.md) — **MLX→PEFT 변환 시 lora_alpha=scale*rank 정합 필수** (convert --config). hook: submission-scale-guard.sh
- [feedback_think_format_match.md](feedback_think_format_match.md) — **Nemotron 학습 데이터를 추론 chat template(<think>) 형식과 일치** (text 필드 직접구성). round_2~3 0점 숨은원인

## AEQ 0점 돌파 0.61 (2026-06-01) ★★★★★🎉
- [aeq_0point_breakthrough.md](aeq_0point_breakthrough.md) — **0점→0.61 돌파 (역대최고, 이전 v4 0.48)**. 원인 3종(think형식+scale+fresh) 규명. iter500(0.06epoch)에서 달성. 동적생성 전환 예정
- [aeq_metric_official_format.md](aeq_metric_official_format.md) — **공식 metric/verify 코드 확보 + 형식 100% 정합**(2026-06-02). extract \text 안벗김→CIPH plain필수, verify 1%tol, 빈system+boxed지시. GRAV가중평균/UNIT OLS(정확일치+23%p)
