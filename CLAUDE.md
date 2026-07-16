# Claude Code -- Global Development Rules
<!-- Last updated: 2026-04-06 -->

> 모든 프로젝트에 적용되는 범용 규칙. 프로젝트별 CLAUDE.md가 있으면 해당 규칙이 우선.

## 1. Plan-First Discipline

다음 중 하나에 해당하면 Plan Mode(`/plan`)에서 시작:
- 3개 이상 파일 변경
- 공개 API, DB 스키마, 보안 관련 경로 변경
- 접근 방식에 대한 확신이 부족한 경우
- 외부 시스템 연동(MCP, 외부 API) 변경이 포함된 경우

복잡한 작업은 하위 작업을 병렬로 위임하여 탐색과 구현을 분리.

## 2. Language

- 기본 응답 언어: 한국어
- 영어 전환 조건: 사용자가 영어로 작성하거나 명시적으로 요청한 경우
- 기술용어는 영어 그대로 사용 (예: "PDCA 파이프라인", "worktree 설정")

## 3. Git Discipline

- Commit 형식: Conventional Commits - `type(scope): description` (description은 영어)
  - Types: feat, fix, refactor, docs, test, chore, style, perf, ci
  - Scope: 모듈/영역 식별 (예: `feat(auth): add JWT refresh`)
- `main`/`master`에 force push 절대 금지
- `.env`, credentials, API keys, secrets 커밋 금지
- 커밋 전 사용 가능한 linter/test 실행
- 병렬 작업 시 worktree 사용. 메인 작업 디렉토리에서 branch 전환 금지
- PR 생성 시 변경 사항 요약과 테스트 계획 포함

## 4. Code Quality

- 모든 비동기 작업에 적절한 에러 처리 필수
- Production 코드에서 디버그용 로그 금지. 구조화된 로깅 사용
- 타입이 있는 언어에서 와일드카드 타입(`any`, `Object`, `interface{}`) 지양
- Import는 프로젝트 linter 설정을 따름. 없으면: 외부 → 내부 → 상대 → 타입 순
- 프로젝트가 지원하면 절대 경로 import 우선

## 5. Testing

- 기존 테스트가 깨지는 변경은 테스트도 함께 수정해야 커밋 가능
- 버그 수정 시 회귀 테스트 선행 작성 권장
- 테스트는 구현 세부사항이 아닌 행동(behavior)을 검증

## 6. Security

- 사용자 입력을 shell 명령으로 직접 실행 금지
- 시크릿은 환경변수로만 관리. 코드에 하드코딩 금지
- 서비스 경계(외부 입력)에서 모든 입력 검증
- 의존성 추가/업데이트 시 해당 생태계의 취약점 스캐너 실행 (`npm audit`, `pip audit`, `cargo audit`, `govulncheck` 등)

## 7. Task Delegation & Subagents

- 독립적인 하위 작업은 병렬 subagent로 위임 가능
- 순차적 의존성이 있는 작업은 순서대로 처리
- 사용자 확인이 필요한 결정은 위임하지 않고 직접 질문
- Subagent 위임 기준: 탐색/분석은 subagent, 의사결정/파일 수정은 메인에서
- Subagent에게 넘길 때: 목표 + 범위 + 출력 형식을 명시. 전체 컨텍스트 전달 금지
- 메인 컨텍스트 보호: subagent 결과는 요약만 수신

## 8. File Organization

- 기존 프로젝트 컨벤션을 최우선으로 따름
- 컨벤션이 없을 때: 파일명 kebab-case, 컴포넌트/클래스 PascalCase, 함수/변수 camelCase
- 컨벤션이 없을 때: 기능/도메인 기준 그룹핑을 우선 고려

## 9. Documentation

- 공개 함수/메서드에 간단한 docstring 또는 해당 언어의 문서화 주석 작성
- 프로젝트 구조 변경 시 README.md 동기화
- 사용자 대면 변경사항은 CHANGELOG에 반영

## 10. Self-Improvement

- 같은 종류의 실수가 2회 이상 발생하면 CLAUDE.md 규칙 추가를 제안
- 제안 형식: `[RULE SUGGESTION] 섹션명: 규칙 (1줄)` -- 사용자 승인 후 반영
- 기존 규칙과 중복/충돌 여부를 먼저 확인

## 11. Project Abbreviations

| 약어 | 풀네임 | 경로 |
|------|--------|------|
| **AGI** | Adaptive General Intelligence — 메타러닝 기반 지속적 학습 실험 프로젝트 | `~/Desktop/AGI/` |
| **F-CORE** | Fractal Cognitive Ontology & Routing Engine — 프랙탈 인지 온톨로지 기반 범용 추론 엔진 | `~/Desktop/F-CORE/` |
| **CGLM** | (구 프로젝트명) → **F-CORE**로 이름 변경 (2026-03-26) | — |
| **GLLM** | Graph-based Large Language Model | `~/Desktop/GLLM/` |
| **SOS** | (구 프로젝트명) → CGLM → **F-CORE**로 이름 변경 | — |

## 12. Session History

- 세션 히스토리를 `~/Desktop/HISTORY/` 디렉토리에 세션별 파일로 기록
- 파일명 규칙: `YYYY-MM-DD_프로젝트-주제.md` (예: `2026-03-04_gq-a1-grid-data-fix.md`)
- 같은 날 여러 세션이면 suffix 추가: `_v2`, `_v3` 등
- 형식: 사용자 입력(User Input N)과 Claude 출력(Claude Output N)을 분리하여 시간순 기록
- 기록 항목: 주요 결정, 실행한 명령, 수정한 파일, 백그라운드 작업 ID와 결과, 미완료 항목
- 새 세션 시작 시 `~/Desktop/HISTORY/` 내 최근 파일을 읽고 이전 컨텍스트 파악
- **이전 세션 요약·recap·메모리의 "완료/확인됨" 주장은 근거가 아니라 가설로 취급한다.** 그 위에 파괴적·비가역 작업(삭제, 덮어쓰기, revert, push)을 쌓기 전 실제 파일·git 이력으로 재검증할 것
  - 근거: 2026-07-08/07-10/07-16 arxiv에서 3회 연속 뒤집힘 — "삼중 태그"→실제 2자간, "오염 정리 완료"→전제 자체가 오류(삭제 2커밋 revert). 요약은 당시의 관찰이지 현재 사실이 아니며, 틀린 전제가 요약을 타고 세션 간 증폭된다
  - 같은 계열: subagent/fork의 "측정 중"·"완료" 자기보고도 그대로 믿지 말고 `ps aux`+원본 파일 직접 확인 (vdsp M16-C 세션서 3회 이상 재현)
- **compact 실행 전 반드시** 해당 세션 파일을 최신 상태로 업데이트 (컨텍스트 유실 방지)
- 세션 종료 시 또는 주요 마일스톤 완료 시에도 업데이트
- 백그라운드 작업(task_id)은 반드시 기록하여 세션 전환 시 추적 가능하게 유지

### 프로젝트별 히스토리·메모리 격리 (2026-06-13 — 전역 규칙으로 승격)

**알려진 repo에서 작업 중일 때는 반드시 repo-local 경로를 사용한다.**

| repo | 히스토리 | 메모리 |
|------|---------|--------|
| Finance | `/Volumes/D50/Finance/.claude/history/` | `/Volumes/D50/Finance/.claude/memory/` |
| AEQ | `/Volumes/D50/AEQ/.claude/history/` | `/Volumes/D50/AEQ/.claude/memory/` |
| BORN_LM | `/Volumes/D50/BORN_LM/.claude/history/` | `/Volumes/D50/BORN_LM/.claude/memory/` |
| Claim | `/Volumes/D50/Claim/.claude/history/` | `/Volumes/D50/Claim/.claude/memory/` |
| F-CORE | `/Volumes/D50/F-CORE/.claude/history/` | `/Volumes/D50/F-CORE/.claude/memory/` |
| GLLM | `/Volumes/D50/GLLM/.claude/history/` | `/Volumes/D50/GLLM/.claude/memory/` |
| ax-os | `~/ax-os-paper/.claude/history/` | `~/ax-os-paper/.claude/memory/` |

**전역 경로(`~/Desktop/HISTORY/`, `~/.claude/projects/-Users-xox/memory/`)는 repo와 무관한 cross-project 내용만.**

- hook `repo-isolation-guard.py`(PreToolUse Write/Edit)가 잘못된 위치 쓰기를 차단
- hook `repo-memory-inject.py`(UserPromptSubmit)이 세션 시작 시 `.claude/memory/MEMORY.md` 자동 주입
- bypass: `REPO_ISOLATION_OK=1`
- `.claude/memory/`는 git 커밋 권장 (이력 보존). `.claude/history/`는 `.gitignore`에 추가 권장

**구조:**
```
{repo}/
  .claude/
    memory/
      MEMORY.md       ← repo-specific 인덱스 (자동 주입됨)
      *.md            ← topic 메모리 파일
    history/
      YYYY-MM-DD_topic.md
```

**레거시 예외 (이전 규칙, 위 표로 대체됨):**
- AGI: `~/Desktop/AGI/history/` (기존 파일 유지, 신규는 위 표 따름)
- F-CORE: 위 표 따름

## 13. Office-Hours Fast-Track (2026-03-24)

`/office-hours`로 APPROVED 설계 문서(`~/.gstack/projects/{slug}/{user}-*-design-*.md`, Status: APPROVED)가 존재하면:

1. **`/pdca plan` 3-사이클 생략** — APPROVED 설계 문서가 plan + design을 대체
2. **Do → Check → Analysis → Report → Archive 직행**
3. 별도 plan.md / design.md 파일 생성 불필요 (생성하지 말 것)
4. `.bkit-memory.json` phase는 "do"로 직접 설정
5. Gap Analysis 기준: APPROVED 설계 문서의 FR/Success Criteria 사용

### 루틴 (APPROVED doc → Archive)

```
/office-hours → APPROVED doc 확인
  │
  ├─ [Do]     설계 문서의 FR 순서대로 구현
  ├─ [Check]  /pdca analyze — 설계 doc FR vs 구현 비교
  ├─ [Report] /pdca report
  └─ [Archive] /pdca archive
```

### 적용 조건
- 설계 문서 `Status: APPROVED` 확인 필수
- 프로젝트별 CLAUDE.md의 Plan 3-사이클 규칙보다 이 규칙이 우선 (사용자가 fast-track 명시 시)

## 12. Code Quality Rules (from awesome-claude-code-toolkit)

### Security
- 시크릿은 환경변수 또는 secrets manager로만. 절대 코드에 하드코딩 금지
- 모든 외부 입력은 서비스 경계에서 schema validation (Zod, Pydantic 등)으로 검증
- 파라미터화된 쿼리만 사용. SQL string interpolation 절대 금지
- HTTP 보안 헤더 필수: CSP, HSTS, X-Content-Type-Options, X-Frame-Options
- 의존성 취약점: critical CVE는 48시간, high CVE는 7일 내 업데이트

### Testing
- 커밋 전 관련 테스트 스위트 실행 필수. 실패하는 테스트로 push 금지
- 테스트는 구현이 아닌 행동(behavior) 검증. 리팩토링 시 테스트가 깨지면 안 됨
- 각 테스트는 하나의 명확한 assertion. "and"가 포함된 테스트명은 분리
- 외부 의존성(DB, HTTP, 파일시스템)만 mock. 테스트 대상 자체는 mock 금지
- flaky 테스트는 즉시 수정 또는 tracking issue와 함께 quarantine

### Performance
- 최적화 전에 반드시 프로파일링. 직관으로 최적화 금지
- N+1 쿼리 금지. eager loading, join, 또는 batch query 사용
- 리스트 엔드포인트에 pagination 필수 (cursor-based for large datasets)
- 성능 예산 설정: bundle size, API latency P99 알림 기준

### Git Workflow
- 기능 브랜치는 1-3일 내 merge. 오래된 브랜치는 rebase 또는 삭제
- PR은 400줄 diff 이하로 유지. 관련 없는 변경 사항 bundling 금지
- Squash merge for feature branches. Release branches는 merge commit

### Documentation
- 공개 API 함수에 파라미터, 반환 타입, 에러 조건, 예시 포함한 docstring
- CLAUDE.md는 프로젝트 컨텍스트, 컨벤션, 빌드 명령, 주요 결정사항 기록
- 아키텍처 결정은 ADR로 `docs/adr/`에 저장
- 코드 변경과 문서 업데이트는 같은 PR에 포함

## 13. Data-First Numerics (2026-04-06)

**모델·전략·파라미터의 수치는 반드시 데이터로 산출한다. 직관·경험칙·"합리적 추정"으로 숫자를 넣는 것을 금지한다.**

### 위반 패턴 (절대 하지 말 것)
- "약상승이니까 +0.3이 적당하겠지" → ❌
- "헤지 전략이니까 중립(0.0)으로" → ❌ (collar/protective_put은 실측 +0.90/+0.95)
- "보수적으로 0.8로 잡자" → ❌
- 주석에 "임의값", "추정", "경험칙" 포함 → ❌

### 수치 결정 프로세스 (필수)
1. **측정 먼저**: 가능한 한 긴 기간의 실제 데이터로 상관계수·분포·성과를 측정
2. **근거 명시**: 수치 옆 주석에 `# corr=+0.869, n=8350일, 1993~2026` 형태로 출처 기재
3. **재보정 조건 명시**: 언제 다시 측정해야 하는지 코드 또는 문서에 기재
4. **데이터 없으면 구현 보류**: 측정 불가능한 파라미터는 TODO로 남기고 임의값 투입 금지

### 적용 범위
- 모든 가중치, delta, 임계값, 하이퍼파라미터, 프로파일 수치
- ML 모델의 prior, 정규화 강도, 클리핑 범위
- 트레이딩 전략의 방향성 계수, 포지션 크기, 진입/청산 기준
- Born 간섭 위상 인코딩의 모든 수치 파라미터

### 사례 (2026-04-06 발견)
- Finance `_STRATEGY_DELTA`: collar=0.0(직관) → +0.90(SPY 8350일 상관 측정)
  protective_put=0.0 → +0.95, covered_call=+0.30 → +0.85
- **교훈**: "헤지=중립" 직관이 틀렸다. 기초자산 보유 전략은 방향성이 강하다.

## 14. Cell Status Tag (2026-04-17)

**노트북/스크립트 셀 단위 잠금 마커.** 작동 검증된 코드의 무단 수정을 방지한다.

### 태그 규약
- `#cell=True` — **작동 검증됨. 수정 금지** (사용자 명시 승인 시만 가능)
- `#cell=Test` — 테스트 중. 자유 수정 가능
- `#cell=False` — 비활성/미검증. 자유 수정 가능

### 위치
셀 첫 줄 주석 끝에 태그 부착:
```python
# ── 셀 1: vLLM 설치 ── #cell=True
# ── 셀 4.5: Bridge dequant ── #cell=Test
```

### 워크플로
1. 새 기능 추가 → `#cell=Test`로 시작
2. 배포 후 실행 성공 확인 → `#cell=True`로 승격
3. `#cell=True` 셀 수정 시도 → **hook이 차단하거나 경고**
4. 기존 `#cell=True` 셀은 pull/복사 시에도 원문 보존

### 적용 범위
- Kaggle 노트북 (.ipynb)
- RunPod 배포 스크립트 (.py)
- 실험 노트북 전반

### 사례 (2026-04-17 교훈)
- v16~v19 연속 4회 실패: agent가 `#cell=True`급 vLLM 설치 셀을 매번 재구성하며 깨뜨림
- v21에서 v5의 작동 셀을 보존하고 `#cell=Test` 셀만 교체하여 해결

## 15. Kaggle Push 규칙 (2026-04-17, 수정 2026-04-18)

**`kaggle kernels push` CLI 사용 금지.** 직접 REST API 호출만 허용.

### 근본 원인 (2026-04-18 SDK 소스 분석)

**Kaggle SDK `ApiSaveKernelRequest`에 `machine_shape` 필드가 아예 없다.**

`kagglesdk/kernels/types/kernels_api_service.py`의 모든 필드:
`id, slug, new_title, text, language, kernel_type, is_private, enable_gpu, enable_tpu, enable_internet, dataset_data_sources, competition_data_sources, kernel_data_sources, model_data_sources, category_ids, docker_image_pinning_type, session_timeout_seconds`
→ `machine_shape` **없음**

| 방법 | 결과 |
|------|------|
| CLI `kernels push` | `enable_gpu=True` boolean만 전송 → P100 |
| Python SDK `.kernels_push()` | `ApiSaveKernelRequest`에 필드 없음 → P100 |
| **REST API `machineShape` 직접 포함** | **대회 스폰서 GPU shape 이름과 일치하면 배정 성공** |
| REST API `machineShape` 미지정 또는 불일치 | P100 (기본값) |
| Kaggle Web UI GPU 드롭다운 | 정상 배정 |

참고: [kaggle-api#589](https://github.com/Kaggle/kaggle-api/issues/589) — T4×2 API 지원 요청, 수년째 미구현

### GPU 배정 방법

**일반 Kaggle GPU** (API push 가능):
| GPU | machineShape 값 | 비고 |
|-----|------|------|
| T4 단일 | `NvidiaTeslaT4` | 작동 확인 |
| T4×2 | **UI 수동 선택 필수** | API 미지원 |
| P100 | 미지정 시 기본값 | — |

**대회 스폰서 GPU** (REST API machineShape으로 지정 가능):
| GPU | machineShape 값 | 대회 | 비고 |
|-----|------|------|------|
| RTX Pro 6000 (48GB) | `NvidiaRtxPro6000` | Nemotron Reasoning Challenge | **2026-04-18 API push 작동 확인** |
| H100 (80GB) | `NvidiaH100` | AIMO 2025 | competitionDataSources에 대회 추가 필수 |

**핵심 규칙**: `machineShape` 값이 해당 대회에서 스폰서하는 GPU와 정확히 일치해야 배정됨.  
불일치 또는 미지정 시 P100 기본값으로 fallback.

### 올바른 REST API push 방법
```python
requests.post('https://www.kaggle.com/api/v1/kernels/push',
    auth=(username, key),
    json={
        'slug': 'username/kernel-slug',
        'enableGpu': True,
        'machineShape': 'NvidiaRtxPro6000',   # ★ 대회 스폰서 GPU shape 정확히 지정
        'competitionDataSources': ['nvidia-nemotron-model-reasoning-challenge'],
        'modelDataSources': ['metric/.../transformers/default/1'],
        ...
    })
```

### RTX Pro 6000 (94GB) — Nemotron Reasoning Challenge
- `machineShape: "NvidiaRtxPro6000"` REST API push로 배정 가능 (2026-04-18 확인)
- **실제 VRAM: 94GB** (문서에 48GB라고 나오지만 실제는 94GB — 2026-04-18 실측)
- 94GB로 Nemotron 30B **BF16 직접 로드 가능** (~60GB), bitsandbytes 불필요
- 인터넷 비활성화, `/kaggle/usr/lib/notebooks/ryanholbrook/nvidia_utility_script/` 경로

### Nemotron mamba_ssm 설치 방법 (2026-04-18 검증)
`ryanholbrook/nvidia-utility-script`를 kernelDataSources에 추가하면
cutlass + mamba_ssm이 pre-installed 상태로 제공됨.

**경로 주입 필수 (import mamba_ssm 전에 실행):**
```python
import site, glob, sys, os
UTILITY_BASES = [
    "/kaggle/usr/lib/notebooks/ryanholbrook/nvidia_utility_script",  # 언더스코어!
    "/kaggle/usr/lib/notebooks/ryanholbrook/nvidia-utility-script",
]
for base in UTILITY_BASES:
    if not os.path.isdir(base): continue
    for d in glob.glob(os.path.join(base, "**/python_packages"), recursive=True):
        site.addsitedir(d)
    if base not in sys.path:
        sys.path.insert(0, base)
import mamba_ssm  # 경로 주입 후 import
```
- 핵심: 경로가 **하이픈(-) 아닌 언더스코어(_)** (`nvidia_utility_script`)
- `site.addsitedir()` 실행 순서: import mamba_ssm **전**에 반드시 먼저

### ptxas-blackwell 실행 권한 픽스 (2026-04-18 v35에서 최종 해결)

Blackwell GPU(arch≥100)에서 triton 커널 컴파일 시 ptxas-blackwell 바이너리 실행 권한 없음.

**실제 경로** (환경마다 다를 수 있음 — glob 탐색 필수):
`/kaggle/usr/lib/notebooks/ryanholbrook/nvidia_utility_script/triton/backends/nvidia/bin/ptxas-blackwell`

**v31~v34 실패 원인들**:
- v31~v33: `TRITON_PTXAS_PATH` env var, `triton.knobs` 패치 — 모두 무효
- v34: subprocess 전역 패치는 맞는 방향이었으나 경로를 하드코딩(`/kaggle/usr/lib/nvidia-utility-script/...`) → 실제 경로와 불일치 → copy 자체가 안 됨

**v35 해결책 (검증됨)**:
```python
# 셀1: glob으로 경로 자동 탐색 후 /tmp 복사+chmod
_ptxas_candidates = (
    glob.glob('/kaggle/usr/lib/**/ptxas-blackwell', recursive=True) +
    glob.glob('/kaggle/lib/**/ptxas-blackwell', recursive=True)
)
_PTXAS_SRC = _ptxas_candidates[0] if _ptxas_candidates else None
if _PTXAS_SRC:
    shutil.copy2(_PTXAS_SRC, '/tmp/nvidia_bin/ptxas-blackwell')
    os.chmod('/tmp/nvidia_bin/ptxas-blackwell', 0o755)

# 셀2: subprocess 전역 패치 — 경로 포함 여부로 매칭 (exact match 금지)
def _fix_cmd(cmd):
    if isinstance(cmd, (list, tuple)) and cmd and 'ptxas-blackwell' in str(cmd[0]):
        cmd = list(cmd); cmd[0] = '/tmp/nvidia_bin/ptxas-blackwell'
    return cmd
subprocess.check_output = lambda cmd, *a, **kw: _orig_co(_fix_cmd(cmd), *a, **kw)
subprocess.run          = lambda cmd, *a, **kw: _orig_run(_fix_cmd(cmd), *a, **kw)
```

**교훈**: 경로 하드코딩 절대 금지. glob 탐색 + 패턴 매칭 사용.

### Hook 강제
- `kaggle-gpu-guard.py`가 CLI push 감지 시 **무조건 차단**
- 직접 API 호출에서 `machineShape` 누락 시에도 차단
- bypass: `KAGGLE_AGENT=1` prefix (agent 내부 전용)

## 16. Auto-Chain Rules (2026-05-08)

**`auto-router.py` (UserPromptSubmit) + `skill-chain-injector.py` (PostToolUse Skill) 연계 시스템.**

### AUTO-ROUTER 응답 규칙

`[AUTO-ROUTER]` 태그로 시작하는 `custom_prompt`가 주입되면:

| 신뢰도 | 동작 |
|--------|------|
| ≥ 90% | 사용자 확인 없이 즉시 해당 스킬 호출 |
| 80–89% | `"/skill 실행합니다"` 한 줄 알림 후 즉시 실행 |
| < 80% | 사용자에게 확인 후 실행 |

- 이미 명시적 `/skill` 명령이 있으면 auto-router 무시
- paper-orchestra-guard가 처리한 논문 패턴은 auto-router 스킵

### CHAIN 응답 규칙

`[CHAIN]` 태그가 PostToolUse 후 주입되면:

- `CLAUDE.md §16: 즉시 실행` 명시 → 사용자 확인 없이 체인 스킬 즉시 호출
- 명시 없음 → 사용자에게 체인 스킬 실행 여부 제안

### 체인 맵 (구현된 자동 연결)

| 완료 스킬 | → 다음 스킬 | 자동 여부 |
|-----------|------------|-----------|
| `paper-orchestra` | `graphify` | 자동 |
| `outline-agent` | `section-writing-agent` | 자동 |
| `section-writing-agent` | `content-refinement-agent` | 자동 |
| `bugfix` | `gstack-review` | 자동 |
| `hf-model-trainer` | `hf-evaluation` | 자동 |
| `gstack-review` | `gstack-ship` | 제안 |
| `deep-review` | `gstack-ship` | 제안 |
| `hf-evaluation` | `graphify` or `checkpoint` | 제안 |

## 17. Finance 계좌 조회 규칙 (2026-06-13)

**계좌 성과/잔고 조회는 반드시 Alpaca(US)+KIS(KR) 두 계좌를 함께 조회한다. 단일 계좌 조회 금지.**

- 통합 경로만 사용: `live/account_report.py` (로컬) 또는 `gh workflow run accounts_report.yml -R popixoxipop-collab/Finance` (Telegram 발송 포함)
- 단일 계좌 워크플로(`account_report.yml`/`kis_account_report.yml`)는 폐기됨 — 재생성 금지
- hook `account-pair-guard.py`(PreToolUse Bash|Write|Edit)가 단일 조회를 차단
- 트레이딩 봇 내부 동작(주문·리밸런싱)은 차단 대상 아님. bypass: `ACCOUNT_SINGLE_OK=1`
