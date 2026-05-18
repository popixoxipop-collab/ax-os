# P110 Causality Threshold -- V_trans Correlation Decay

## 2026-03-29

### User Input 1
F-CORE P110 Causality Threshold 구현. V_trans 궤적의 상관 함수 C(t) 감쇠율 M 측정, 인과율 게이트.

### Claude Output 1

#### 구현
- `/Users/xox/Desktop/F-CORE/planets/core/typed_ir/causality_threshold.py` 작성
- 기존 코드 재사용: P48 TransitionNWKernel, P54 rich_vtrans, P34 pipeline, P37 gravity

#### 핵심 발견: M이 작을수록 코히어런트 (P109 가설 부분 반증)
- 정상 궤적(인접 CID): M=0.036 -- V_trans 방향 일관, 느린 감쇠
- 환각 궤적(랜덤 점프): M=0.137 -- V_trans 방향 급변, 빠른 감쇠
- 물리적 해석: 코히어런트한 추론 = 벡터장 상관 장기 유지 = 낮은 M

#### 실험 결과

| Experiment | Metric | Value | Verdict |
|---|---|---|---|
| A: COPA Causality | AUC, acc | 0.51, 0.53 | 구분 실패 (p=0.51) |
| B: Hallucination | F1 | 0.92 (optimal 0.94) | 강력 분리 (p=3e-35) |
| C: WikiSection | F1 | 0.66 (p=7.6e-8) | 유의미하지만 미약 |

- M_threshold=0.06: 정상 95.5% PASS, 환각 87.7% BLOCK
- COPA에서 M이 작동하지 않는 이유: 정답/오답 모두 합리적 문장 쌍이므로 코히어런스 유사

#### 출력 파일
- Script: `planets/core/typed_ir/causality_threshold.py`
- Report: `logs/p110_causality_result.json`
- Plot: `logs/p110_causality.png`
- Discovery: `docs/Discovery.md` (P110 항목 추가)
