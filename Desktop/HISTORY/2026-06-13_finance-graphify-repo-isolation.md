# 2026-06-13 — Finance Graphify 업데이트 + Repo Isolation 시스템 구축

## 컨텍스트
Finance 긴급 수리 세션(별도 히스토리: `2026-06-13_finance-actions-emergency-fix.md`) 이후 연속 세션.

---

## User Input 1
Finance repo도 graphify로 망 구성 했던가?

## Claude Output 1
- `graphify-out/` 존재, 6738 nodes/13369 edges 확인
- 마지막 graphify 업데이트(`167c5ed`)가 오늘 세션 중간에 찍혔고 이후 3커밋 미반영
- `.graphifyignore` 보강 후 재빌드: 438→163 파일, 6738→4304 nodes, 13369→5616 edges
- 커밋: `2bc64e6 chore(graphify): expand ignore patterns and rebuild graph`
- 추가 패턴: CSV/parquet/lock, phase3~13 백테스트 스크립트, result JSON 블롭

---

## User Input 2
이 추론망 기반 다음 진행 방향 추천

## Claude Output 2
Finance graphify 그래프 쿼리 결과 커뮤니티 분리 패턴 진단:
- community 45 (account_report, 3노드) — live/ 인프라와 단절
- community 974 (phase4_rebalance) — broker_alpaca/kis와 에지 없음
- community 20 (vrp_executor) — `yf_close()` 대신 자체 구현
- community 0 (prism_finance) — live/ 실행 계층과 단절

**우선순위**: ①yfinance 공용화(30+곳) ②prism_finance→live/ 신호 배선 ③MAP KISBroker 이중 경로 정리 ④account_report 격리 해소

---

## User Input 3
각 repo별로 메모리와 history를 분리 관리하도록 해야할 거 같은데 규칙을 정해서 hook에 달아두고 강제해야할듯

## Claude Output 3 — Repo Isolation 시스템 구축

### 구조 설계
```
{repo}/.claude/
    memory/MEMORY.md     ← repo-specific 메모리 인덱스 (hook이 자동 주입)
    memory/*.md          ← topic 메모리 파일
    history/             ← session 히스토리 (gitignored)
```

### 구현 완료
| 파일 | 내용 |
|---|---|
| `~/.claude/hooks/scripts/repo-isolation-guard.py` | PreToolUse Write/Edit — 잘못된 위치 차단 |
| `~/.claude/hooks/scripts/repo-memory-inject.py` | UserPromptSubmit — 로컬 MEMORY.md 자동 주입 |
| `~/.claude/settings.json` | 두 훅 등록 |
| `~/CLAUDE.md` | §12 repo isolation 규칙 전역화 |

### 테스트 결과 (4/4 통과)
- Finance + global HISTORY/ → BLOCK ✅
- Finance + finance-specific memory → BLOCK ✅
- Finance + 비-repo 메모리 → ALLOW ✅
- 홈 CWD + global HISTORY/ → ALLOW ✅

### 초기화된 repo (5개)
Finance, AEQ, BORN_LM, Claim, F-CORE
각각 `.claude/memory/MEMORY.md` + `.claude/history/` + `.gitignore` 추가

### Finance 파일럿 마이그레이션
- `finance_account_pair_rule.md` 전역→로컬 이전
- `feedback_phase3_oos_split.md` 전역→로컬 이전
- 전역 MEMORY.md Finance 섹션 → 포인터로 교체
- 커밋: `239ba10 chore(memory): init repo-local .claude/ memory structure`

### 커밋 (홈 repo)
- `cc14f06 chore(infra): add repo-isolation hooks + update CLAUDE.md §12`

---

## 완료 항목
- [x] Finance graphify 재빌드 (4304n/5616e)
- [x] repo-isolation-guard.py 훅 구현 + 테스트
- [x] repo-memory-inject.py 훅 구현
- [x] CLAUDE.md §12 전역 규칙화
- [x] 5개 repo .claude/ 디렉토리 초기화
- [x] Finance 메모리 파일럿 마이그레이션

## 미완료/추적
- AEQ/BORN_LM/Claim/F-CORE 메모리 상세 마이그레이션 → 해당 세션에서 진행
- Finance graphify P2 항목: yfinance 공용화, KISBroker 이중 경로 통합
