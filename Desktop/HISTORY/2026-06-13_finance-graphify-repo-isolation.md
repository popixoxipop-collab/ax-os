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

---

## 세션 2 — Finance P2 항목 순차 구현 (컨텍스트 이월 후 계속)

### 완료 항목 (커밋)

| Task | 커밋 | 내용 |
|------|------|------|
| A. yfinance 공용화 | `607de0a` | utils.yf_close(3-retry+Alpaca fallback), yf_series(). vrp_executor/paper_trader 교체 |
| B. KISBroker 이중 경로 통합 | `9a9b436` | map_execution.KISBroker → live.broker_kis 위임 (토큰/헤더 중복 제거) |
| C. phase4 yf_series | `2e6d454` | phase4_rebalance.py도 yf_series()로 전환 |
| D. Phase4 OOS 대시보드 | `d8c9ec2` | live/phase4_monitor.py 신규. +31.40% vs SPY +25.04%, Sharpe 1.16, MDD -6.78% |
| E. MAP 큐 적체 해소 | `db2af5f` | map_monitor+scalp_daily cancel-in-progress=true |
| F. First-Monday guard 보강 | `bb5cf58` | live/first_monday_guard.py + Alpaca /v2/calendar 공휴일 대응 |

- push: `239ba10..bb5cf58 → origin/main`

## 미완료/추적 (세션 2 기준)
- AEQ/BORN_LM/Claim/F-CORE 메모리 상세 마이그레이션 → 해당 세션에서 진행

---

## 세션 3 — VRP 검증 + ETF 지식 시스템 + SpaceX→반도체→KRW 추론망

### VRP 분리 검증 (CLAUDE.md §13 Data-First)

- **SVOL 수익 드라이버**: term structure contango (VIX3M-VIX, corr **+0.36**) ≠ VRP (VIX-RV30, corr -0.33)
- 파라미터 재보정 (OOS 2015-2026, n=2858일):
  - `VRP_MU` = 0.052392 (was 0.071577)
  - `VRP_SIG` = 0.043620 (was 0.032055)
  - `MUL_MIN` = 0.24 → p5 데이터 기반 (was 0.50 직관)
  - `MUL_MAX` = 1.85 → p95 데이터 기반 (was 1.50 직관)
- SVOL 성과: 누적 +47.4%, Sharpe 0.22, 백워데이션 guard 핵심 (-3.98% vs contango +0.79%)
- 커밋: `1269024`

### ETF 지식 시스템 구축

- `live/etf_research.py`: Gemini SDK (google_search grounding) 검색 루프 → `live/data/etf_knowledge/{TICKER}.md`
- `.github/workflows/etf_research.yml`: 매주 일요일 01:00 UTC cron (GH Actions, GEMINI_API_KEY secret 필요)
- DEFAULT_TICKERS: SVOL/BIL/QQQ/IWM/GLD/TLT/SPY/SPCX/SVIX/ZIVB/KMLM/BTAL/PFIX + NVDA/TSM/SOXL/SOXX
- 커밋: `2009129`

### SPCX 정체 발견

- SPCX = **SpaceX 주식** (IPO 2026-06-12). 구 SPAC ETF SPCX는 2026-04-07 SPCK로 리네임
- Gemini CLI 웹 검색으로 확인 (SDK는 NOT_FOUND 오류 → CLI fallback)
- `live/data/etf_knowledge/SPCX.md` 생성 (커밋 `f65a35b`)

### SpaceX → 한국 반도체 → KRW 추론망

**기존 상태**: KOSPI Born 신호(community 316, 고립), macro_born_encoder(CPI/10Y/DXY/OAS), supply_chain, ais_tracker(상하이), geopolitical 존재. 반도체/FX/SpaceX 노드 없음.

**신규 생성**:
- `live/krw_fx_signal.py`: USD/KRW + Samsung/SK Hynix 모멘텀 + SpaceX 5d 수익률 → 종합 신호 (-1~+1)
- `live/data/etf_knowledge/SPACEX_SEMICONDUCTOR_LINKS.md`: SpaceX→Starlink→LPDDR5→Samsung/SK Hynix→KRW 공급망 지식
- graphify update: 4325→4345 nodes / 5627→5659 edges
- 커밋: `d10cd72` + `5fb6d67`

### 추론 체인 (공급망)
SpaceX Starlink → Samsung/SK Hynix LPDDR5 수요  
NVIDIA H100/H200 → SK Hynix HBM3e 독점공급  
삼성전자/SK하이닉스 수출 달러화 → KRW 강세  
USD/KRW ↓ (원화강세) → KOSPI tailwind  
`krw_fx_signal.signal` → PRISM bot 포지션 보정 예정

### 미완료 (세션 3 기준)
- [x] ~~Finance repo GEMINI_API_KEY GH Secret 추가~~ → 기존 GOOGLE_API_KEY 매핑으로 해결 (2026-06-15)
- [x] ~~etf_research.py NVDA/TSM/SOXL 지식 파일 생성~~ → 수동 실행 + GH Actions 17/17 ✅ (2026-06-15)
- [x] ~~krw_fx_signal.py 파라미터 실증 측정~~ → 완료 (2026-06-16, §13)
- [x] ~~Samsung/SK Hynix KRX 모멘텀 상관 실측~~ → 완료 (2026-06-16)
- [x] ~~PRISM bot에 KRW regime 신호 배선~~ → 완료 (2026-06-16, commit 240c39d)

---

## 세션 4 — Finance 동작 확인 + ETF Research 버그 수정 (2026-06-15)

### 발견 및 수정
- ETF Research GH Actions(06-14) 전부 ❌: 구 SDK(`google-generativeai`)만 설치 → grounding 불가
- 수정: `etf_research.yml`에 `google-genai`(신 SDK) 추가 → 재실행 17/17 ✅ (커밋 `d39af49`)
- MAP Monitor 정상 (04:24 UTC), KIS Monitor 정상 (02:43 UTC)
- README 현재 상태 섹션 추가 (커밋 `7aca3cd`)
- graphify: 4347 nodes / 5659 edges

### 최종 커밋 목록 (2026-06-15)
| 커밋 | 내용 |
|------|------|
| `d39af49` | fix(etf): install google-genai SDK for GH Actions |
| `86a7db3` | chore(graphify): sync |
| `7aca3cd` | docs(readme): current status section |
| `a10c06a` | graphify update 4347n/5659e |

### Finance 상태 — 완전 정상 운영 중
- 모든 GH Actions 워크플로 ✅
- ETF 지식 루프 17/17 자동화 완성
- 다음 자동 리밸런싱: 2026-07-07(월) First-Monday guard

---

## 세션 5 — 추론망 개선 A+B 구현 + Graphify 갱신 (2026-06-16)

### 컨텍스트 이월 후 재개 (이전 세션 summary로 복원)

### 개선 A — Korea Macro Composite 브릿지 (완료)
**파일**: `live/korea_macro_composite.py` (신규)
- MacroBornEncoder(com=19, 글로벌 CPI/10Y/DXY/OAS) ↔ krw_fx_signal(com=10, 한국 KRW+반도체)
- 가중치: W_GLOBAL=0.40 / W_KRW=0.40 / W_SEMICON=0.20
- 출력: composite -1~+1, regime RISK_ON/NEUTRAL/RISK_OFF
- 의의: 분리된 두 macro 커뮤니티를 추론망에서 연결

### 개선 B — news_nlp_signal 연결 (완료)
**파일**: `live/krw_fx_signal.py` (수정)
- 선택적 news sentiment 블록 추가 (`from news_nlp_signal import build_news_signals`)
- SAMSUNG/SKHYNIX/NVIDIA/SPACEX 뉴스 감성 → signal 기여 ±0.2
- `try/except` 완전 방어 — transformers 미설치 시 0.0 폴백

**파일**: `news_nlp_signal.py` (수정)
- MARKET_TICKERS += 005930.KS/000660.KS/NVDA/SPCX
- 단절된 com=29,62,63(news_nlp) → com=10(krw_fx) 교차 엣지 형성

### Graphify --update 결과
- 변경: 167 code + 42 doc/image = 209 파일
- 3-agent 병렬 semantic 추출 (chunk 01: 162n, 02: 117n, 03: 15n)
- 그래프: 4350n/5660e → **4659n/5975e** (+309n/+315e)
- 새 커뮤니티: BRAIN alpha archive, Korea P_macro chart, docs/EVOLUTION_AUDIT_LOG

### 커밋
| 커밋 | 내용 |
|------|------|
| `0e07e78` | feat(graphify): update graph 4659n/5975e + add KRW/SpaceX signal modules |
| (rebase) `4b7f379` | push to origin/main (remote에 선행 커밋 있어 rebase 후 push) |

### 완료 항목
- [x] live/korea_macro_composite.py — com=19↔com=10 브릿지 (개선 A)
- [x] news_nlp_signal.py MARKET_TICKERS 확장 (개선 B)
- [x] krw_fx_signal.py news_sentiment optional 블록 (개선 B)
- [x] graphify --update 4659n/5975e
- [x] Finance MEMORY.md 갱신
- [x] 세션 히스토리 갱신

---

## 세션 6 — Telegram 리포트 기간 표시 + 월별 달력 + KIS 시드 데이터 (2026-06-17)

### 기능 1: % 수익률에 기간 추가
- `ALPACA_START = date(2026, 4, 6)` / `KIS_START = date(2026, 4, 6)` 상수 추가
- 출력: `순자산 $107,627 (+7.63%, 2026-04-06~, 72d)` 형식
- 커밋: `0833994`

### 기능 2: 월별 수익률 달력 (ASCII code block)
- Alpaca: `/v2/account/portfolio/history?period=6M&timeframe=1D` API 직접 호출
- KIS: `kis_daily.json` 일별 적립 후 월별 집계 (`_monthly_returns_kis()`)
- `_calendar_block()`: Telegram Markdown ``` 블록, ┌─┐│─┤└ 박스
- 커밋: `cd0ec37`

### 기능 3: GH Actions → kis_daily.json 영구 저장
- `accounts_report.yml`에 git commit+push step 추가 (`[skip ci]`)
- `token: ${{ secrets.GITHUB_TOKEN }}` for push 권한
- 커밋: `768e339`

### KIS 히스토리 조사
- GH Actions 전체 실행: 모두 2026-06-12 이후. 이전 누적 데이터 없음
- Unified Accounts Report 로그 3건 파싱:
  - 6/13 (run 27451519580): 106,869,800원
  - 6/15 (run 27580665163): KIS API 타임아웃 (no data)
  - 6/16 (run 27652072831): 109,955,400원

### KIS 시드 데이터 생성
- `live/data/kis_daily.json` 신규 생성 (6/13, 6/16 두 포인트)
- 6월 KIS 달력 표시: +2.89% (6/13→6/16 기준, 부분 기간)
- 커밋: `488387a` → push origin/main

### 달력 최종 형태
```
      월별 수익률
┌─────┬──────────┬──────────┐
│ Mon │  Alpaca  │   KIS    │
├─────┼──────────┼──────────┤
│ Apr │  +X.XX%  │     -    │
│ May │  +X.XX%  │     -    │
│ Jun*│  +X.XX%  │  +2.89%  │
└─────┴──────────┴──────────┘
 * 진행중  KIS: 일별 수집 중
```
(KIS Apr/May: 데이터 없음, Jun: 6/13 시작점 기준)

### 완료 항목
- [x] Telegram 기간 표시 (`+7.63%, 2026-04-06~, 72d`)
- [x] 월별 달력 (`_calendar_block()`)
- [x] GH Actions KIS 일별 캐시 영구화
- [x] KIS 시드 데이터 2 포인트 (6/13, 6/16)
