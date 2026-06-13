# 2026-06-13 — Finance GitHub Actions 장애 전수 조사 + 긴급 수정

## User Input 1
Finance repo에 올라온 내용 확인해

## Claude Output 1
- repo: `/Volumes/D50/Finance` (`~/Finance` symlink 깨짐). 원격 231 커밋 behind.
- 핵심: `HANDOFF_EMERGENCY.md` (be60a54, 다른 세션 작성) — 3 장애 문서화
  (Phase 4 ALPACA_BASE_URL 빈 Secret / KIS token ConnectionError / Node.js 20 deprecation D-3)

## User Input 2
추가 장애도 조사해 github actions 의 오류 로그 등 직접 찾아서 ultrathink

## Claude Output 2 (전수 조사 — 1,825 run)
- **정정**: Phase 4는 4회가 아니라 **생성 이래 21/21 전부 실패** (2026-04-13~), 성공 0회
- **신규**: cron `'30 15 1-7 * 1'` OR-시맨틱 버그 → 매월 1~7일 매일 + 모든 월요일 (~11회/월) 발화
- **신규**: KIS 6/03 ConnectTimeout (문서의 6/11·6/12 RemoteDisconnected와 동일 endpoint 계열).
  `kis_trading_bot.py` requests 4곳 전부 timeout 없음
- **신규 장애 4**: GitHub runner 미배정 8건 (4/28, 5/05×5, 5/06×2) — annotation
  "The job was not acquired by Runner of type hosted" — 정확히 15분 후 취소. GitHub 인프라, 코드 조치 불가
- **신규 장애 5**: 5/15 Kalman KIS 행 1건 (completed_at null, 일회성)
- 과거 해결됨: 4/05 requirements 미발견, 4/06 numpy 미설치, 4/08 YAML 파싱 ×6
- **시스템 리스크**: 8개 워크플로 전부 timeout-minutes 없음 (기본 360분, private repo 과금)

## User Input 3
수정하세요 (+ 저장소 공간 확보 병행)

## Claude Output 3 (수정 적용 — 전부 push 완료)
| 커밋 | 내용 |
|---|---|
| `5a580cd` fix(live) | broker_alpaca `or` 폴백 + kis_trading_bot 세션 retry/timeout=30 (토큰 POST만 read오류·5xx 재시도, 주문 POST는 이중주문 방지로 비재시도) + HANDOFF 갱신 |
| `94d997b` fix(ci) | phase4 cron `'1-7 * *'` + First-Monday guard step, 8개 워크플로 timeout-minutes 15(실측 max 2분), FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 |
| `78f98b6` | 로컬 paper.tex/pdf + brain_signal.json 커밋, c35c273 포함 rebase push |

- GitHub Secret `ALPACA_BASE_URL` = `https://paper-api.alpaca.markets` 설정 (`gh secret set`)
- gemini adversarial review 반영 2건: 토큰 5xx 명시 재시도, 어댑터 Retry total=2로 중첩 축소
- **검증**: Phase 4 dry-run run 27446310925 **SUCCESS (사상 첫 성공)** — 계좌 $107,656.73 정상 조회
- workflow push에 `workflow` scope 필요 → 사용자 `gh auth refresh -s workflow` 브라우저 인증
- `brain/results.db`는 `/Volumes/D50/brain_runtime/` symlink (5/30 마이그레이션) → `git update-index --skip-worktree` 처리
- **디스크 풀 사건**: 루트 볼륨 100% (가용 129MB) → brew cleanup 2.7GB + APFS purgeable 회수로 112GB 확보.
  ~/.cache/huggingface 96GB (AX OS 논문용 모델)는 삭제 불필요해짐
- 백그라운드: run 27446681166 (phase4 signal 모드, 새 workflow 검증) — task bt1xj3lya

## User Input 4
리밸런싱 해

## Claude Output 4 (수동 리밸런싱 — 추가 버그 2건 발견·수정)
- 1차 run 27450898695: 7건 중 6건 OK, **TLT 전량매도 거부** (notional $29,580 > 실제 포지션 가치
  — 평가/체결 시점 가격 차로 345.1006주 요청 vs 345주 보유)
- **fix `1c4f7b9`**: 목표비중 0인 종목은 notional 매도 대신 `close_position()` (DELETE /v2/positions)
- 2차 run 27450992485: **장 마감 중이라 1차 주문이 미체결 큐 상태 → 포지션 불변 → 전 거래 중복 제출**
  (매수 ~$215k = 자산 2배 위험)
- **fix `462dbbc`**: `cancel_all_orders()` 신설(broker_alpaca) + rebalance() 시작 시 미체결 전량 취소
- 3차 run 27451049069 **최종 성공**: 미체결 12건 취소 → CLOSED TLT/SPY + BIL $53.8k/QQQ·IWM·GLD 각 $14.4k/SVOL $10.8k
  단일 세트 큐잉. 개장(금 09:30 ET) 시 체결 예정. 순자산 $107,626.88 (paper)
- 로컬 stale `phase4_rebalance_log.json` (4/13 dry-run 산출물) → `/tmp/phase4_rebalance_log.local.bak.json` 백업 후 원격본 수용

## 검증 완료
- run 27446681166 (signal 모드): success + **Node20 deprecation 경고 0건** — Node24/timeout 적용 확인

## User Input 5~7 (성과 조회 + 통합 규칙)
실거래 성과 조회 → KIS 계좌 조회 → 통합 조회 규칙 + hook 강제

## Claude Output 5~7
- **성과 (2026-06-13)**: Alpaca $107,627 (+7.63%, MDD -6.46%, Sharpe 1.20 — 단 B&H 성과, 전략은 오늘부터)
  / KIS 1억687만원 (≈+6.87%, 삼전 +39.98% 견인, 해외 거래 0) / MAP US +4.53%(6/10부터 NaN 깨짐)·KR +5.64%
- **통합 계좌 리포트 구축** (`b989c0d`): `live/account_report.py` (Alpaca+KIS+Telegram),
  `accounts_report.yml` (주중 20:15 UTC cron + dispatch). 단일 워크플로 2개 폐기.
  sys.path 버그 1회 수정 후 **검증 성공** (run 27451519580, telegram 발송 OK)
- **규칙 전역화**: Finance README §Account Reporting + ~/CLAUDE.md §17 + memory `finance-account-pair-rule`
- **hook `account-pair-guard.py`** (PreToolUse Bash|Write|Edit, settings.json 등록):
  단일 계좌 조회/폐기 워크플로/단일 워크플로 재생성 차단. 테스트 9/9 통과. bypass `ACCOUNT_SINGLE_OK=1`

## 미완료/추적
- 금요일 개장(13:30 UTC) 후 체결 확인 권장: SPY/TLT 청산 + 5종 매수 → 목표 비중 BIL 50/QQQ·IWM·GLD 13.3×3/SVOL 10
- 다음 자동 리밸런싱 = 2026-07-06(월) guard 통과 예정
- ~~MAP US paper NaN~~ → **수정 완료** (`384aa3e`): yfinance NaN 종가가 truthy 검사 통과 → 영구 오염.
  fetch_prices/update_value에 isfinite 가드 + 6/09 유효값(1,045,316)에서 실측 가격비로 state 재구성(1,055,986).
  검증: run 27451639755 → ₩1,055,881 (+5.59%) 유한값 복귀, origin `77af597` 확인
- KIS 초기자본 1억은 추정치

## User Input 8: PRISM bot·VRP 조사 진행

## Claude Output 8 — 미가동 원인 규명 + 수정 (`0e3f18c`, `cdc89b1`)
- **PRISM bot 2개월 0체결 = 3중 원인**:
  ① KIS는 거부도 HTTP 200 — 봇이 rt_cd 미검사로 "모의투자 장종료" 거부를 SUCCESS 로깅(침묵 실패)
  ② cron이 마감 15분 전(06:15/19:45 UTC)인데 GitHub 스케줄 지연 실측 47~151분(중앙값 99, n=15) → 상시 마감 후 도착
  ③ 구 NASDAQ cron `* * 2-6`은 월요일 미국장 누락
  → 수정: rt_cd=="0" 필수+JSON가드, cron 03:30/17:00 UTC로 지연 보정. **오늘 cron부터 실주문 검증됨**
- **VRP 미가동**: 6/08 Signal YES($5,047 VXX숏)였으나 runner에서 yfinance VXX 1회 실패가 `except:pass`로
  침묵 → 진입 스킵. 수정: 3회 재시도 + data.alpaca.markets 호가 fallback (gemini 리뷰 4건 반영:
  JSON 파싱 가드, paper-api 아닌 data API 직접 호출, np 중복, step 이름)
- **계좌 공유 충돌 발견·해결**: VRP SPY B&H 80% vs Phase 4 100% 배분이 동일 Alpaca 계좌에서 상호 청산
  구조 → 사용자 결정: **VRP SPY B&H 비활성화, VXX 신호만 운용** (`_do_spy_rebalance` short-circuit)
- 4/12 "4거래 PnL 0"은 동일가 같은날 재실행 아티팩트, VIX=45 row는 합성 테스트 잔재로 판정

## User Input 9~10: 워크플로 전체 분석 + 예상 장애 지점 → 수정 승인(ㅇㅇ)

## Claude Output 9~10 — 전수 분석 + P1 일괄 수정 (`ad3944a`)
- **실측**: scalp cron 지연 +3~147분(중앙값 67, n=40), trading_bot 중앙값 99분. push 패턴 `|| true` 11곳
- **P1 발견·수정 (gemini NO BLOCKING ISSUES)**:
  ① 빈 문자열 시크릿 지뢰 13곳 일괄 `or` 패치 (options_hedge×3, scalp, broker_bridge, api, broker_kis×2, kis_trading_bot×5)
  ② scalp 마감청산 cron 20:00→17:28 UTC (도착 13:31~15:55 ET 보장) + `_market_open()` 가드 4곳
    (exit_all/check_and_exit: 장외 bracket취소+큐잉=무방비 오버나이트 차단 / run_enter/run_gap_enter: 스테일 진입 차단)
  ③ `git push || true` → rebase 재시도 11곳 (kalman, kalman_kis, map×9)
  ④ broker_kis._get_token 3회 재시도 (KIS OAuth 단절 6월 3회 실측, 빈 토큰 연쇄 401 방지)
- **P2 미수정(기록)**: yfinance 단일시도 30곳+ 공용 유틸화, Phase4 cron-skip 월 누락 보강가드,
  map 큐적체(cancel-in-progress false), gap_enter 타이밍은 GitHub cron 인프라 한계로 보정 불가
- 검증: map fast run 27452461575 디스패치 (push 재시도 경로 확인)

## 추적
- 오늘 03:30 UTC cron(KOSPI)·17:00 UTC cron(NASDAQ)에서 rt_cd 수정 후 첫 실주문 결과 확인
- 개장(22:30 KST) 후 Phase 4 리밸런싱 체결 확인 + scalp 새 청산 시각(17:28 cron) 동작 확인
- 6/15(월) Phase 4 guard 스킵 확인, 7월 VRP run에서 가격 fallback 동작 확인
- hook은 다음 세션부터 로드됨 (settings.json 등록 완료)
