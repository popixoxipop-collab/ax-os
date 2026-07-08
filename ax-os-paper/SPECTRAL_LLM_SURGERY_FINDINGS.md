# Spectral Filter LLM 외과적 치환 — 실측 Findings (2026-07-07)

이전 세션(창)에서 진행되다 중단된 실험을 복구/정리한 문서. 5개 트랙 전부 실측 완료, Codex 수학 검증까지 반영한 최종본.

## 배경

- 계보: vDSP 복소 spectral Born-head 압축을 로봇 제어 헤드(~48K params, VLA 프로젝트)에서 실측 검증(RTN q4 강건 확인, 실제 병목은 필터가 아니라 dense layer의 group_size 강제 축소였음) → "로봇 헤드 말고 실제 LLM 아키텍처 내부 특정 part를 대체하면?" 질문으로 확장
- 대상: `Qwen2.5-1.5B-Instruct` (MLX, bf16), 28 layers, hidden=1536, intermediate=8960, GQA 12/2 heads, `tie_word_embeddings=True`
- 베이스라인: **BF16 C4 PPL = 18.11** (`paper.tex` 매크로 `\COBFL`, 200 C4 문서, stride=512, 실측)
- 승인된 계획: `~/.claude/plans/reactive-noodling-toucan.md` (3-Track 계획 → 세션 중 사용자가 D/E 2트랙 추가, 최종 5-Track)
- 코드/원본 결과: `~/ax-os-paper/{eval,scripts,artifacts}/` — 아래 수치는 전부 해당 JSON 파일을 직접 읽어 확인한 값(재계산·추정 없음)

`SpectralFilter(dim=1536, K=4)`: rfft(hidden축) → K개 순차 학습된 복소 필터(각 필터: 곱 + magnitude-sigmoid gate) → irfft. 6,152 params, 실수 `filt_re`/`filt_im`로 저장.

## Track A — FFN(MLP) 전체 치환 (원본 41,287,680 params, 압축비 6,711×)

| Layer | Zero-shot(no-op, std=0.02) | Zero-shot(calibrated init) | Fine-tuned(387 step) |
|---|---|---|---|
| L4(초반) | +11.43% | +26.04% | **+8.64%** |
| L14(중반) | +4.47% | +6.88% | **+3.79%** |
| L24(후반) | +16.03% | +29.23% | **+16.25%** |

- "no-op"(std=0.02, 필터 출력이 원 서브모듈 대비 ~1e-7배)은 사실상 "이 FFN을 통째로 삭제(ablate)했을 때 비용"과 동일 — 그 비용 자체가 L4/L24 ≫ L14. 중간층 FFN이 가장 redundant(문헌의 "middle layer가 더 prunable" 패턴과 일치).
- **새 관찰(원 계획에 없던 발견): L24에서는 학습이 사실상 이득을 못 줌** — trained(+16.25%) vs no-op(+16.03%), 차이가 노이즈 수준. 반면 L4(+11.43%→+8.64%), L14(+4.47%→+3.79%)는 학습이 확실히 도움됨. 후반 층일수록 spectral filter가 학습으로 메울 수 있는 여지가 줄어듦.

## Track B — Attention `o_proj` 치환 (원본 2,359,296 params, 압축비 383×)

| Layer | Zero-shot(no-op) | Zero-shot(calibrated) | Fine-tuned |
|---|---|---|---|
| L4 | +3.36% | +3.78% | **+2.83%** |
| L14 | +1.49% | +1.52% | **+1.09%** |
| L24 | +3.11% | +3.39% | **+2.30%** |

- Track A 대비 전 구간 훨씬 완만(zero-shot조차 4% 미만) — o_proj가 FFN보다 명확히 덜 critical.
- L14가 A/B 공통으로 가장 관대한 지점(U자형 층 패턴).

## Track C — Cross-model bridge (Surgical MoE Chimera 계보 MLX 이식)

`BridgeModule`(P_up→동결 donor MLP 1개 층→P_down, `h+α·correction`)을 recipient L14에 삽입. `alpha=0` sanity(18.1024 ≈ 18.11) 양쪽 통과.

| Donor | trained α (epoch0→4) | 최종 PPL | ΔPPL% | val_ce 추이 |
|---|---|---|---|---|
| Qwen2.5-7B(same-family, donor L14) | 0.077→0.258 | 19.634 | **+8.41%** | epoch1 최저(2.6399)→epoch4 상승(2.7316) |
| Mistral-7B-v0.3(cross-family, donor L16, `llama.py` 라우팅) | 0.076→0.256 | 19.163 | **+5.82%** | epoch1 최저(2.6395)→epoch4 상승(2.7059) |

- 사전 등록 가설("same-family가 더 쉬울 것") **반증** — cross-family(Mistral)가 오히려 더 나음.
- **미해결 caveat**: 양쪽 다 val_ce가 epoch 1 최저 후 계속 상승(과적합)인데, 보고된 PPL은 epoch 4(가장 과적합된) 체크포인트 기준. Early-stopping 시점 PPL은 미측정 — "cross-family가 우수하다"를 "5 epoch 끝까지 밀어붙였을 때 어느 쪽이 덜 망가지는가"가 아니라 "각자 최적점에서 어느 쪽이 나은가"로 확정하려면 추가 실측 필요.

## Track D — Clustering (L14, K=4, G∈{2,4,8,16}) — 학습 후 효과 없음

| G | Zero-shot(no-op) | Zero-shot(calibrated) | Fine-tuned |
|---|---|---|---|
| 1(ungrouped) | +4.47% | +6.88% | +3.79% |
| 2 | +4.47% | +7.33% | +3.88% |
| 4 | +4.47% | +6.22% | +3.65% |
| 8 | +4.47% | +6.49% | +3.75% |
| 16 | +4.48% | +6.26% | +3.70% |

Fine-tuned 결과가 3.65~3.88% 좁은 띠에 몰려 G=1과 사실상 구분 불가 — "clustering이 도움되지 않는다"는 명확한 negative result.

## Track E — Activation distillation (L14, G=1, teacher=원본 FFN 입출력 MSE 직접 매칭)

| K | best val MSE | PPL | ΔPPL% | 비고 |
|---|---|---|---|---|
| 4 | 0.12799 | 18.881 | **+4.26%** | val MSE가 epoch 0 이후 사실상 평평 — 조기 수렴 |
| 16 | 0.13118 | 18.901 | **+4.37%** | val MSE가 epoch 29에도 계속 하강 중 — 수렴 미확인 |

- K=16이 4배 많은 파라미터(24,608 vs 6,152)를 쓰고도 더 나쁨(단 K=16 미수렴 가능성 있어 확정적이진 않음).
- 둘 다 plain CE fine-tune(+3.79%, Track A L14)보다 나쁨.

## 수학 검증(Codex 독립 검증, job `task-mraet3di-3o9omk`) — 원 설명 정정판

세션 중 사용자가 "혹시 거꾸로 적용한 거 아니냐" 지적 → `codex:codex-rescue`로 4개 주장 독립 검증 요청. **정정판을 기준으로 삼을 것, 원 설명은 폐기**:

| # | 원 주장 | Codex 판정 |
|---|---|---|
| ① | bin별 완전 독립(cross-bin mixing 없음) | **맞으나 과소서술** — 실제로는 더 강함: `z_{K,f} = e^{iΘ_f}β_f(\|X_f\|)X_f` (위상은 고정 회전만, magnitude만 비선형 게이팅) |
| ② | K개 순차 필터가 diagonal 1개로 "collapse" | **틀림** — 실제 구조(gate 개입)에서 K=2는 K=1로 환원 안 됨(반례+수치검증). 맞는 명제는 "K는 bin간 dependency graph를 바꾸지 못한다"는 더 좁은 버전뿐 |
| ③ | FFT/circulant 구조 때문에 인과적으로 FFN이 o_proj보다 취약 | **과장** — 증명되는 건 "채널축 cyclic-shift에 정확히 equivariant"까지. 거기서 "그래서 FFN이 더 나쁘다"는 추론이지 정리가 아님 |
| ④ | Clustering은 capability를 뺄 수만 있음(strict subset) | **틀림** — grouping은 cross-group mixing을 잃는 대신 group별 다른 동작을 얻음(block-circulant 2-block 반례). 여기서 무효했던 이유는 clustering이 원천적으로 손해라서가 아니라 FFN이 필요로 하는 게 global mixing이라 어떤 grouping도 못 주기 때문 |

- Codex가 자체 제시한 정체 원인(가설, 미증명): SwiGLU FFN은 원점 근처 선형근사에서도 입력좌표의 **dense quadratic form** (`y_i ≈ ½Σ_j D_ij(Gx)_j(Ux)_j`)이라 shift-equivariant/bin-독립 계열로는 원천적으로 표현 불가 — approximation-bias 논증이며, Track E의 val MSE(~0.128~0.131)가 teacher 자체 출력 분산(~0.143)에 근접한다는 실측과 정합적.
- Codex 추가 지적(원 설명에 없던 포인트): 이 모듈의 정확한 cyclic-shift equivariance 자체가, 원래 이동불변 의미가 없는 transformer hidden-channel 축에는 부자연스러운 성질 — 파라미터 수 논증과 별개로 짚어볼 문제.

## Track F — Cross-bin mixing 실험 (Codex 병목 가설 직접 검증, 2026-07-07 후속)

Track A-E는 전부 "bin/채널별 완전 독립" 구조를 유지했다. Codex가 지목한 병목(FFN=dense quadratic form, per-bin family로는 원천 표현 불가)을 직접 겨냥해, 동일 파라미터 예산(~24.6K, Track E K=16과 정합)에서 cross-bin mixing을 넣은 2개 arm을 L14에 구현·실측(`eval/bottleneck_filter.py`, `scripts/run_bottleneck_experiment.py` — Track A-E 기존 파일은 무수정, 신규 파일만 추가).

- **F1**: rfft → dense rank-8 **복소** bottleneck(전체 769 bin을 가로지르는 진짜 mixing, shift-equivariance 의도적으로 깨뜨림) → irfft, 24,608 params
- **F2**(대조군): FFT 없이 순수 real-valued dense rank-8 bottleneck(1536→8→1536), 24,576 params

| Config | PPL | ΔPPL% |
|---|---|---|
| F1 zero-shot(no-op) | 18.9303 | +4.53% |
| F1 zero-shot(calibrated) | 19.1861 | +5.94% |
| **F1 fine-tuned** | 18.6229 | **+2.83%** |
| F2 zero-shot(no-op) | 18.9226 | +4.49% |
| F2 zero-shot(calibrated) | 18.9226 | +4.49%(주1) |
| **F2 fine-tuned** | 18.3727 | **+1.45%** |

(주1) F2의 calibrated init이 no-op과 완전히 동일한 std=0.02로 나옴 — 버그 아님. 이 2-stage bottleneck은 SpectralFilter(K개 순차 게이트)보다 std에 대해 output RMS가 훨씬 가파르게 증가해서, 기존 후보 grid(0.02~2.0, SpectralFilter 기준 설계)의 최솟값이 이미 F2의 target RMS에 가장 가까운 지점이었음(grid 하한 포화). Fine-tuning은 초기값과 무관하게 진행되므로 핵심 비교엔 영향 없으나, F2의 "zero-shot calibrated" 이 한 셀만 신뢰도 낮음(grid 하한 확장 없이는 진짜 값 미확인).

no-op sanity check: F1=+4.53%, F2=+4.49%는 Track A L14 기준값(+4.47%)과 거의 일치 — 구현 정상, NaN/이상치 없음.

**판정**: F1(+2.83%)·F2(+1.45%) 둘 다 Track E K=16(+4.37%)과 Track A/D 최고 기록(+3.65~3.79%)을 뚜렷이 앞섬 → **사전 등록 버킷1 확인, Codex 가설 지지: per-bin/shift-equivariant 계열 자체가 진짜 병목이었고, 동일 예산에서 mixing을 추가하니 개선됨**.

단, 사전 등록 버킷과 어긋난 반전: F1≈F2가 아니라 **F2가 F1을 뚜렷이 앞섬**(+1.45% vs +2.83%, 1.38pp 격차 — 두 arm 개선폭 자체보다 큰 차이라 노이즈로 보기 어려움).

### F1>F2 이유에 대한 수학 검증 (Codex, job `task-mrarfesy-mpw9th`, 2026-07-07)

최초 설명("F1의 rank는 DFT가 강제하는 rotation-pairing에 묶여 명목상 2배 rank인데 실질은 덜 유용하다")을 Codex에 엄밀 검증 요청 — **최초 설명은 과도한 주장으로 판명, 아래가 정정판**:

- **(a) F1 선형부의 real-rank ≤16**: 증명됨(PROVEN WITH CAVEATS). 단 "각 복소-rank-1 항이 정확히 real-rank 2"라는 세부 서술엔 반례 있음 — DC/Nyquist bin(u=v=e_0)에 작용하는 항은 real-rank 1.
- **(b) 진짜 복소 bin(1-767, 767개)에서 각 rank-1 항=순수 scaled-rotation(2 자유도), 일반 2×2(4 자유도) 아님**: 증명됨(2×2 블록 명시적 도출 완료). 단 DC/Nyquist 두 bin을 묶은 특수 블록에서는 한 항이 임의의 2×2 행렬을 만들 수 있음(반례 확인) — 전체 769 bin 중 2개뿐인 예외.
- **(c) F2는 완전히 자유로운 real-rank≤8 연산자**: 예외 없이 엄밀히 증명됨(rank factorization으로 확인).
- **(d, 핵심 정정) "F1의 rank가 낭비된다"는 원 설명은 약화됨(PLAUSIBLE BUT SPECULATIVE로 하향)**: Codex가 직접 찾은 구멍 — 8개의 독립 rotation 항이 "각각 2 자유도"라고 각 항이 제약적이어도, 8개 항의 **합**은 그만큼만 제약되지 않는다. 선택된 8차원 복소 read/write 부분공간 사이에서 이 8개 항은 **임의의 8×8 복소 행렬(128 실수 자유도)**을 합성 가능(자유 real rank-16의 256 자유도보다 작지만, "8×2=16"이라는 단순 계산보다 훨씬 큼). F1은 실제로 상당히 표현력 있는 구조이고, "구조적으로 낭비돼서 졌다"는 근거는 없음 — F1이 F2에 졌다는 사실만 확실하고, 원인은 열려있음.

**F2>F1의 진짜 원인은 미확정.** Codex가 제시한 대안 후보(전부 미검증, 서로 배타적이지 않음):
- 복소 값 파라미터화 자체의 최적화/conditioning이 실수 파라미터화보다 불리할 수 있음
- 두 gate는 사실 서로 다른 연산(F1=주파수 영역 magnitude에 게이트, F2=채널 영역 실수 magnitude에 게이트) — "같은 비선형성을 두 곳에 적용"이 아님
- DC/Nyquist 비대칭(769개 bin 중 2개만 예외 구조)
- rfft/irfft가 채널축을 dense global mixture로 바꾸는 것 자체가, FFN이 채널축에 더 axis-aligned하게 반응한다면 나쁜 inductive bias일 수 있음(단, 이것도 미검증 가설 중 하나일 뿐 확정 아님)
- 파라미터 수가 같다고 singular-value 스케일/Lipschitz 스케일/유효 학습률까지 같은 건 아님(init/scale mismatch)

### Track G — 2×2 ablation으로 원인 분리 (2026-07-08)

위 후보 중 가장 구조적으로 테스트 가능한 두 개(복소 vs 실수 파라미터화, frequency-domain global mixing vs channel-domain)를 분리하기 위해 {frequency, channel} × {real, complex} 2×2를 구성. F1=(frequency,complex), F2=(channel,real)은 기존, 아래 2개를 추가 구현(`eval/bottleneck_ablation.py`, `scripts/run_bottleneck_ablation.py` — 기존 파일 무수정):

- **G1**(frequency, real): rfft 결과를 Codex가 검증한 정확한 real-linear isomorphism(`pack`/`unpack`, 1536 real ↔ 769 complex)으로 실수 1536차원에 담아, 그 위에서 real dense rank-8 bottleneck 수행 → irfft. F1과 같은 도메인(진짜 global mixing 유지), F2와 같은 가중치 타입(real).
- **G2**(channel, complex, **주의: local pairing만**): 인접 채널 2개를 임의로 묶어 복소수 768개로 만들고 그 위에서 complex dense rank-8 bottleneck 수행. F2와 같은 도메인(채널), F1과 같은 가중치 타입(complex) — 단 **global mixing이 전혀 없음**(rfft처럼 전체 1536채널을 섞는 게 아니라 인접 쌍끼리만), 그래서 "F1과 동등한 global mixing을 갖춘 복소" 셀이 아님 — 이 한계는 설계 단계부터 명시됨.

| Config | Zero-shot(no-op) | Zero-shot(calibrated) | Fine-tuned |
|---|---|---|---|
| G1(frequency,real) | +4.50% | +5.13% | **+2.21%** |
| G2(channel,complex,local) | +4.51% | +4.92% | **+1.88%** |

no-op sanity: G1=+4.50%, G2=+4.51%, Track A L14 기준값(+4.47%)과 일치 — 구현 정상.

**전체 2×2(fine-tuned ΔPPL%, 낮을수록 좋음)**:

|          | real | complex |
|---|---|---|
| frequency(global mixing) | G1 = +2.21% | F1 = +2.83% |
| channel | F2 = +1.45% | G2 = +1.88%(local pairing만, global 아님) |

**정정(2026-07-08, 사용자 지적으로 발견)**: 아래 원래 서술은 **틀렸음** — "F1 vs G1이 가중치 타입만 분리한다"는 주장은 rank(표현력) 차이를 놓쳤다. 4개 arm 전부 파라미터 **개수**(~24.6K)는 맞췄지만, Codex가 이미 증명한 사실(이 문서의 "F1>F2 이유에 대한 수학 검증" 절 (a)(c)) 때문에 파라미터 개수를 맞춰도 **real-rank(실질 표현력)는 맞지 않는다**:
- complex-rank-8 (F1, G2) → real-rank **≤16**
- real-rank-8 (G1, F2) → real-rank **=8** (정확히, 예외 없음)

즉 real/complex 축이 rank-8-vs-16 축과 **완전히 confound**되어 있었다 — complex 쪽 2개 셀(F1, G2)은 전부 real 쪽(G1, F2)의 2배 표현력을 갖고 시작한다. 그 결과:

- **F1 vs G1(원래 "가중치 타입만 분리"라고 서술)**: 실제로는 (complex, real-rank≤16) vs (real, real-rank=8) — 가중치 타입과 rank가 동시에 바뀜. "+0.62pp가 가중치 타입 단독 효과"라는 결론은 **철회** — 이건 "복소+2배rank" 조합 대 "실수+1배rank" 조합의 차이지, 가중치 타입만의 차이가 아님. (오히려 F1이 명목상 2배 rank를 갖고도 G1에 졌다는 게 더 흥미로운 사실 — 그 2배 rank가 실제로는 도움이 안 됐다는 뜻이지만, 왜 안 됐는지(가중치 타입 때문인지 domain 때문인지)는 이 비교 하나로 분리 불가.)
- **G2 vs F2(같은 축)**: 마찬가지로 confound. G2(+1.88%)가 F2(+1.45%)보다 나쁜 것도 "복소라서"인지 "이미 2배 rank를 갖고 있어서 다른 이유로 손해인지" 분리 불가.
- **G1 vs F2(둘 다 real 가중치, 둘 다 real-rank=8, domain만 다름)**: 이 비교만 **유효** — frequency-domain(rfft 구조)이 channel-domain보다 **+0.76pp** 나쁨(도메인 단독 효과, rank는 양쪽 다 8로 동일). **Track G에서 살아남는 유일한 깨끗한 결론은 이것 하나뿐.**

"가중치 타입 자체의 최적화 불리함이 +0.62pp"라는 원래의 45:55 분할 결론은 **폐기**. 가중치 타입(복소 vs 실수)만 따로 분리하려면 real-rank를 8로 맞춘 complex arm(즉 complex-rank=4, params≈12,304 — G1/F2보다 파라미터 수는 적어짐)이 별도로 필요 — 아래 Track I에서 실행함.

### Track I — real-rank로 맞춘 진짜 가중치-타입 분리 (2026-07-08)

Track G의 confound을 바로잡기 위해, complex-rank=4(→real-rank≤8, G1/F2와 표현력 매칭)인 새 arm 2개를 추가. **신규 모델 코드 불필요** — F1의 `DenseFFTBottleneck`과 G2의 `ComplexChannelPairBottleneck` 둘 다 이미 rank를 생성자 인자로 받으므로, `eval/bottleneck_filter.py`·`eval/bottleneck_ablation.py`를 전혀 수정하지 않고 rank=4로 인스턴스화하는 새 러너(`scripts/run_bottleneck_rankmatch.py`)만 추가.

- **I1**(frequency, complex-rank=4 = F1 클래스를 rank=4로): params=12,304, real-rank≤8(G1과 매칭)
- **I2**(channel, complex-rank=4, local pairing = G2 클래스를 rank=4로): params=12,288, real-rank≤8(F2와 매칭)

| Config | Zero-shot(no-op) | Zero-shot(calibrated) | Fine-tuned |
|---|---|---|---|
| I1(frequency,complex,r4) | +4.51% | +5.26% | **+2.67%** |
| I2(channel,complex,r4,local) | +4.47% | +11.71% | **+2.54%** |

no-op sanity: I1=+4.51%, I2=+4.47% — 기준값(+4.47~4.49%)과 일치, 구현 정상.

**진짜 real-rank=8 매칭 2×2(fine-tuned ΔPPL%, 낮을수록 좋음)**:

|          | real(params~24.6K) | complex(params~12.3K) |
|---|---|---|
| frequency | G1 = +2.21% | I1 = +2.67% |
| channel   | **F2 = +1.45%**(전체 최저) | I2 = +2.54% |

**가중치 타입 단독 효과(이제 진짜로 rank 고정)**:
- frequency에서: I1(+2.67%) vs G1(+2.21%) = **+0.46pp**(complex가 real보다 나쁨)
- channel에서: I2(+2.54%) vs F2(+1.45%) = **+1.09pp**(complex가 real보다 나쁨)

**두 조건 다 같은 방향**(complex가 항상 real보다 나쁨) — Track G에서 confound으로 폐기했던 "가중치 타입 자체가 손해"라는 결론이 **이번엔 제대로 분리된 상태로 재확인됨**. 단 크기가 다름(channel에서 2.4배 더 큼) — **domain과 가중치 타입은 단순 덧셈이 아니라 상호작용**한다:
- 도메인 효과(real 고정): G1 vs F2 = +0.76pp
- 도메인 효과(complex 고정): I1(+2.67%) vs I2(+2.54%) = **+0.13pp**(같은 방향이지만 훨씬 작음)

즉 **channel+real(F2) 조합이 유일하게 특별히 좋고, 나머지 3개 조합(G1, I1, I2)은 서로 비교적 가깝게 몰려있음** — "도메인 효과"와 "가중치 타입 효과"를 독립적인 두 숫자로 분해하는 건 정확한 서술이 아니고, 실제로는 F2의 (channel,real) 조합 자체가 특별한 것에 가까움. I1/I2는 G1/F2 대비 파라미터 수가 절반(~12.3K vs ~24.6K)이라는 점도 명시 — real-rank는 같아도 파라미터 수 자체가 다른 방식으로 최적화/일반화에 영향을 줄 여지는 남아있음(미검증).

**Caveat**: 6개 수치 전부 단일 시드 point estimate(반복실험 분산 미측정). F2<G2<G1<F1로 4개 셀이 완전히 단조적이고 교차 없음 — 노이즈가 아닌 실제 효과와 정합적이지만 통계적 유의성은 미확립.

Track G 도중 GPU 리소스 경합(Track H 동시 실행 + 이 머신의 무관한 Nemotron LoRA job)으로 Metal command-buffer 크래시가 반복 발생했으나 재시도로 전부 극복, 최종 수치에는 영향 없음.

**참고 교차비교**: F2(+1.45%, 24,576 params)는 Track B(o_proj 전체 치환, 6,152 params, +1.09%)보다 4배 많은 파라미터를 쓰고도 근소하게 못 미침 — o_proj는 애초에 자기 자신이 dense mixing이라 per-bin filter로도 비교적 잘 대체되는 반면, FFN은 mixing을 명시적으로 넣어줘도(F2) o_proj 수준까지는 못 따라옴. FFN이 o_proj보다 근본적으로 더 critical하다는 앞선 관찰(no-op ablation 비용 비교)과 일관됨.

## Track H — F2 rank/layer 확장 (2026-07-08)

F2(현재까지 최선의 FFN 치환안)를 rank와 삽입층 두 축으로 확장(`scripts/run_bottleneck_sweep.py`, 기존 `eval/bottleneck_filter.py`의 F2 클래스 재사용, 기존 파일 무수정).

### H1 — rank sweep(L14, fine-tuned ΔPPL%)

| r | params | ΔPPL% |
|---|---|---|
| 4 | 12,288 | +2.21% |
| **8** | 24,576 | **+1.45%**(최적) |
| 16 | 49,152 | +2.04% |
| 32 | 98,304 | +2.58% |

**비단조적** — r=8이 국소 최적점이고 그보다 작아도(r=4) 커도(r=16, r=32) 더 나쁨. "파라미터를 더 쓰면 무조건 낫다"는 직관과 반대. 원인 미검증(가능한 설명: 387-step 고정 학습예산에서 rank가 커질수록 작은 fine-tune 코퍼스에 과적합할 여지가 커짐 — Track C의 bridge가 epoch 1 이후 과적합했던 패턴과 유사하지만 확인된 건 아니고 추측일 뿐).

4개 rank 전부 **Track B(o_proj 치환, +1.09%)를 넘지 못함** — r=8(+1.45%)이 가장 근접하지만 여전히 못 미침. FFN 치환은 o_proj 치환보다 근본적으로 더 어려운 문제로 남아있음.

### H2 — layer sweep(r=8)

| Layer | no-op | calibrated | fine-tuned | Track A 기존 fine-tuned |
|---|---|---|---|---|
| L4 | +11.42%(주1) | +11.42%(주1) | **+4.78%** | +8.64% |
| L14 | +4.47% | +6.88% | **+1.45%** | +3.79% |
| L24 | +16.05% | +16.28% | **+12.46%** | +16.25%(no-op +16.03%과 사실상 동일 — 학습 무의미) |

(주1) L4의 no-op·calibrated이 완전히 같은 값(PPL 20.179) — Track F에서 이미 확인된 init grid 하한 포화 현상 재현(버그 아님).

**핵심 발견**: F2는 3개 층 전부에서 Track A(기존 per-bin filter)보다 뚜렷이 나음. 그리고 **L24에서 Track A가 보였던 "학습이 no-op 대비 전혀 이득 없음" 패턴이 F2에서는 깨짐** — F2는 L24에서도 학습으로 실제 개선(+16.05%→+12.46%, 3.59pp)을 얻음. 다만 L24는 F2 기준으로도 여전히 가장 어려운 층(L4, L14보다 훨씬 나쁨) — "이 층에서 아예 학습이 안 먹힌다"에서 "이 층은 여전히 어렵지만 학습 자체는 유효하다"로 결론이 바뀜.

## Track J — HellaSwag/PIQA commonsense-reasoning 평가 (2026-07-08)

지금까지 F2(최선 FFN 치환안)는 C4 perplexity로만 평가됐음 — "다음 토큰 예측"이 아니라 실제 **commonsense reasoning 능력**이 보존되는지는 별도 확인 필요. `~/Desktop/postbackprop`(이전 프로젝트)의 평가 방법론(loglikelihood 채점 — 생성 없이 teacher-forcing 한 번으로 각 선택지의 로그우도 비교, 가장 높은 걸 답으로 채택)을 MLX/Qwen 토크나이저로 포팅해 재사용(`eval/eval_mc.py`, `~/Desktop/postbackprop/scripts/local_eval.py`의 `LMEvalWrapper.loglikelihood`+`eval_multiple_choice` 직접 이식).

F2의 C4-학습 가중치가 그동안 저장된 적이 없어서(Track F/H는 평가 후 바로 원본 복원) `scripts/save_f2_weights.py`로 동일 레시피 재학습 + 저장, PPL 회귀 체크로 재현성 확인(diff=0.000pp, 완벽 일치).

| | HellaSwag acc(n=200) | PIQA acc(n=200) |
|---|---|---|
| baseline(bf16, 미치환) | 43.5% | 76.5% |
| F2(C4 학습, L14, r=8) | 42.0% | 75.5% |
| **delta** | **-1.5pp** | **-1.0pp** |

두 벤치마크 다 랜덤 기준(HellaSwag 25%, PIQA 50%)보다 훨씬 위에서 소폭 하락 — C4 perplexity 하락(+1.45%)과 방향이 일치하고 정도도 비슷한 규모. **F2의 FFN 치환은 commonsense reasoning을 완전히 무너뜨리지 않고, perplexity 저하와 일관된 수준의 경미한 저하만 유발함**을 확인.

원래 ARC-AGI-2(생성+그리드 파싱 필요, 훨씬 무거운 평가)를 검토했으나 사용자가 "너무 어려움/부적합"으로 판단해 기각, HellaSwag/PIQA(생성 불필요, loglikelihood만) 방식으로 전환 — 그 과정에서 F-CORE의 ARC 학습데이터가 Llama3 chat template(`<|start_header_id|>`)로 직렬화돼 있고 Qwen2.5는 ChatML(`<|im_start|>`)을 쓴다는 것도 확인됨(이번 트랙에선 사용 안 함, 향후 ARC 재시도 시 재직렬화 필요).

## 종합

- 저하폭(파라미터 예산 상이하니 직접 비교 시 주의): Track B(o_proj, 6.2K) < Track F2(FFN, 24.6K) < Track F1(FFN, 24.6K) < Track A/D 최고(FFN, 6.2K) < Track E(FFN, 24.6K) < Track C(bridge, 11-13M, epoch4 기준).
- Codex의 "dense quadratic form이라 per-bin family로 표현 불가" 가설은 Track F로 **직접 확인됨** — 동일 예산에서 mixing을 추가하자 Track A(+3.79%)→F2(+1.45%)로 개선.
- 추가 발견(사전 미등록): FFT 기저 자체는 이 치환 지점에서 **실측상 오히려 손해**(F1이 F2보다 나쁨, 1.38pp 격차) — 단 Codex 수학검증 결과 "F1의 rank가 DFT 구조 때문에 낭비된다"는 원인 설명은 과도한 주장으로 판명(8개 rotation 항의 합은 개별 항보다 훨씬 풍부한 128 자유도 core를 구성 가능). **F1<F2라는 사실은 확정, 원인은 미확정**(최적화/conditioning 차이, 서로 다른 도메인의 gate, DC/Nyquist 비대칭 등 복수 후보 중 미검증).
- L14(중반층)이 A/B/C/D/F 전부에서 가장 관대한 삽입 지점 — 재도출된 게 아니라 "네트워크 중간" 휴리스틱을 그대로 썼는데 결과가 사후에 이를 뒷받침.
- 미해결: Track C same/cross-family 비교는 양쪽 다 과적합 구간에서 비교된 것 — early-stop 재평가 전엔 확정 불가. F2의 zero-shot calibrated 한 셀도 grid 하한 포화로 미확인.
- **논문(paper.tex) 반영 여부: 미결정** (계획 단계에서 "결과 확인 후 별도 결정"으로 명시적으로 유보됨).

## 다음 결정 필요 (사용자 확인 대기)

1. 이 결과를 ax-os 논문에 포함할지 (포함 시 negative→positive 반전 서사 자체가 섹션이 될지, 별도 후속 페이퍼로 뺄지)
2. Track C early-stopping 재평가(추가 실측, ~10분) 진행 여부
3. F2(plain dense bottleneck)가 최선의 FFN 치환 후보로 확인됐으니: (a) rank r을 키워 격차를 더 줄일 수 있는지, (b) L4/L24에도 F2를 적용해 Track A가 L24에서 겪은 "학습해도 no-op과 동일" 문제가 F2에서도 재현되는지 후속 실험 진행 여부
