# 명도 대비 오탐 실험 하네스

자동 웹 접근성 검사에서 명도 대비(WCAG 1.4.3 / KWCAG 5.4.1) 판정이 렌더링 조건과
반복 측정에 따라 어떻게 달라지는지 측정하는 연구용 하네스입니다.

논문 *"웹 접근성 자동 검사의 명도 대비 오탐은 렌더링 조건이 아니라 측정 비결정성에서
온다"* 의 실험을 재현합니다.

## 무엇을 측정하나

애니메이션 감속(`prefers-reduced-motion`)과 웹폰트 정책(차단/허용)을 2×2로 조합한
네 조건에서, 같은 페이지를 조건당 여러 번 검사합니다.

| 조건 | reducedMotion | 웹폰트 |
|---|---|---|
| `base` | off | 차단 |
| `rm` | on | 차단 |
| `font` | off | 허용 |
| `rm+font` | on | 허용 |

뷰포트(1280×800), 로케일(ko-KR), image/media 차단은 전 조건에 고정하고 axe-core의
`color-contrast` 규칙만 실행해 조건 외 변인을 통제합니다.

핵심 측정값은 **요소별 발생률**입니다 — 같은 조건에서 k회 검사했을 때 그 요소가 몇 번
보고되었는지. 0 < 발생률 < 1인 요소를 **비결정 위반**이라 부르며, 이것이 이 연구의
주된 관심사입니다.

## 설치

이 디렉터리는 상위 모노레포와 독립된 패키지입니다. 여기서 직접 설치하세요.

```bash
cd research/contrast-flakiness
npm install
npx playwright install chromium
```

Node 22.19 이상이 필요합니다.

## 사용

### 1. 대상 목록 준비

줄당 URL 하나, `#`로 시작하는 줄은 주석입니다.

```
# candidates.txt
https://example.com/
https://example.org/main
```

### 2. 스크리닝 — 표본 선별

로드 시점의 실행 중 애니메이션과 오파시티 전환 요소를 세고, 1.5초 후 다시 재어
"로드 시에만 도는" 페이드인과 상시 애니메이션을 구분합니다.

```bash
node contrast-falsepos.mjs --screen --candidates=candidates.txt
# → exp-out/screening-report.md
```

둘 중 하나라도 관측되면 본 실험 후보입니다.

### 3. 본 실험

```bash
node contrast-falsepos.mjs --candidates=candidates.txt --runs=5
# → exp-out/results.json, exp-out/labeling-report.md
```

`--runs`는 조건당 반복 횟수입니다. 비결정성을 측정하는 것이 목적이므로 **5회 이상**을
권합니다. `--sites=N`으로 앞의 N곳만 쓸 수 있습니다.

### 4. 분석

```bash
node analyze.mjs                    # → exp-out/analysis-summary.md
node analyze.mjs --in=other.json
```

조건별 위반 수, 대조군 대비 증감, 측정 안정성, 그리고 라벨링이 필요한 케이스를
양방향(제어 조건에서 사라진 요소 / 새로 생긴 요소)으로 정리합니다.

### 5. 라벨링

조건 간 차이를 보인 요소가 실제로 위반인지는 **안정 상태**에서 다시 재야 알 수 있습니다.
안정 상태는 애니메이션이 끝나고(감속 미적용) 실제 웹폰트가 적용된 상태로 정의하며,
`document.fonts.ready`와 실행 중 애니메이션 소멸을 기다린 뒤 측정합니다.

```bash
node label-assist.mjs --in=exp-out/results.json   # 1회 측정 기반 제안
node verify-labels.mjs --host=example.com --runs=5  # 사이트별 5회 반복 검증
node verify-summary.mjs                             # 전 사이트 집계
```

`label-assist.mjs`는 제안일 뿐입니다. **안정 상태 측정 자체가 비결정적일 수 있으므로**
`verify-labels.mjs`로 반복 검증하세요. 반복 측정에서 발생률이 0도 1도 아닌 요소는
안정 상태에서조차 라벨을 확정할 수 없으며, 이 하네스는 그것을 **경계**로 분류합니다.

### 6. 익명화 (선택)

산출물에는 사이트별 위반 수가 실명과 함께 들어 있습니다. 공개 데이터셋으로 낼 때
익명 ID로 치환할 수 있습니다.

```bash
node anonymize.mjs --in=exp-out --out=exp-out-anon --mapping=mapping.json --shots
```

공개 전에는 반드시 검사하세요. 호스트명 치환만으로는 부족합니다 — 선택자에 남은 URL
경로나 HTML 스니펫의 한국어 UI 문구로도 사이트가 특정됩니다.

```bash
node check-anonymity.mjs --dir=dataset --mapping=mapping.json
```

매핑은 호스트명 정렬 기준이라 결정적입니다 — 같은 데이터를 다시 익명화해도 같은 ID가
나옵니다. **매핑표는 공개 저장소에 커밋하지 마세요.**

## 알아 둘 한계

**image/media를 차단하고 측정합니다.** 프로덕션 스캐너와 조건을 맞추기 위함이지만,
배경 이미지 위의 텍스트는 axe가 배경색을 확정하지 못해 판정에서 빠질 수 있습니다.
`label-assist.mjs`는 이런 경우를 "판정 보류"로 분류합니다.

**2-패스 안정성 필터를 적용하지 않습니다.** 이 하네스는 필터 없는 1차 패스만 측정합니다.
필터가 적용된 프로덕션 동작과는 다르며, 필터의 효과를 측정하려면 별도 조건이 필요합니다.

**첫 화면만 봅니다.** 로그인 이후 화면이나 하위 페이지는 대상이 아닙니다.

## 산출물

| 파일 | 내용 |
|---|---|
| `screening-report.md` | 표본 선별 근거 (애니메이션·오파시티 측정) |
| `results.json` | 사이트 × 조건 × 요소별 발생률 원자료 |
| `analysis-summary.md` | 조건별 집계 표 (논문 표 1~2) |
| `labeling-report.md` | 조건 간 diff 케이스 체크리스트 |
| `labeling-assist.md` / `.json` | 안정 상태 1회 측정 기반 라벨 제안 |
| `label-verify-<host>.json` | 사이트별 반복 검증 결과 |
| `label-verify-summary.md` | 전 사이트 라벨 확정 집계 (논문 표 3) |

## 공개 데이터셋 (`dataset/`)

논문 실험의 측정 결과입니다. 사이트는 익명 ID(`site-A`, `site-B`, …)로, 요소는
`el-N`으로 치환했습니다.

```bash
node analyze.mjs --in=dataset/results-combined.json
node verify-summary.mjs   # dataset/의 label-verify-*.json 집계
```

**측정값만 담았습니다.** CSS 선택자·HTML 스니펫·URL 경로는 검색하면 원 사이트를
특정할 수 있어 제거했습니다. 요소 식별자(`el-N`)는 안정적이라 같은 요소가 여러 조건에
등장하는지는 비교할 수 있지만, 그 요소가 원 사이트의 어느 부분인지는 알 수 없습니다.
스크린샷도 화면 자체가 식별 정보라 제외했습니다.

조건별 위반 수, 발생률, 대비값, 라벨 판정은 모두 그대로이므로 논문의 표 1~3은 전부
재현됩니다. 실명 매핑표는 연구자가 비공개로 보관합니다.

## 라이선스

Apache-2.0. 상위 저장소의 검사 엔진(`packages/core`)과 같은 라이선스입니다.
