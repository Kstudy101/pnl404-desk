# 프로젝트 지도

2026-09-12 저장소 소스로 확인한 기준이다. 변경 작업에서는 해당 파일을 다시 읽는다.
프레임워크 빌드 없이 HTML/CSS/JavaScript를 `public/`에서 제공한다. Python 금융 패키지가 시장 시세·일별 이력을 생성하고 `worker/index.mjs`의 읽기 전용 API가 이를 제공한다. 피보나치·SOP·기존 4H 점수는 별도 로컬 원본 생성물이다.

사용자가 확인한 raw data 원본은 서로 독립적인 아래 두 로컬 프로젝트다. `Desktop/PNL404`는 별도 프로젝트이며 두 원본을 포함하는 상위 폴더로 취급하지 않는다.

- `pivot`: `C:/Users/zxaswe/Desktop/피봇스윙매매`
- `board`: `C:/Users/zxaswe/Desktop/스윙전광판`

경로의 단일 설정은 저장소 루트의 [source-projects.json](../../../../source-projects.json)이다. Node 게시·사전 검사는 `scripts/source-paths.mjs`, Python 스냅샷은 같은 JSON을 읽는다. 절대 경로를 사용하며, 다른 환경에서 상대 경로로 설정한다면 저장소 루트를 기준으로 해석한다.

| 경계 | 원본 → 소비자 | 주의 |
|---|---|---|
| 탭 | `public/index.html`의 TABS → 모듈 HTML | `?tab=board/fib/sop`, 기본 board, history/popstate |
| 전광판 | `/api/markets`, `/api/search`, `/api/chart` → `public/modules/board/board.mjs`, `board-model.mjs`, `board.css`, `index.html` | 시장/지수 분류, 자동완성, localStorage 관심종목, 차트, 15분 갱신 확인 |
| 무료 시장 수집 | `scripts/market-python.mjs` → `scripts/market-refresh.py` → `markets.json`·`history/` | FinanceDataReader·yfinance 직접 사용, 암호화폐 CoinGecko. 가격 기준 날짜와 수집 시각 구분, 실패 시 이전값 보존 |
| 일봉 모멘텀 | `scripts/market-momentum.py` → `items[].momentum` → Worker·화면 | 7·14·21·28 완료 일봉 수익률, N+1 종가, 4개 7일 구간. 새 완료일마다 기간 이동, 재수신한 날짜는 교체 |
| 공개 시장 파일 | `public/modules/board/markets.json`·`history/` → Worker·화면 | Python 모드의 주 입력. 900초 경과 표시를 위해 생성 시각을 임의 갱신하지 않음 |
| 수동 보조 수집 | `scripts/market-refresh.mjs` → `worker/providers.mjs` | JavaScript NAVER/Yahoo/CoinGecko 어댑터. Python 예약 수집과 병행 실행하지 않음 |
| 예약 갱신 | `.github/workflows/refresh-markets.yml` → Python → 검사 → 준비된 파일 배포 | 15분 예약, 이전 검증된 산출물 캐시. main 반영·원격 실행 전까지 운영 갱신 완료로 보고하지 않음 |
| 기존 점수 | `public/modules/board/data.json`, `signal_config.json` → 전광판 상세 | 4H 점수·배점·잠정/보정·계산 시각은 기존 원본 의미 유지. 새 시세 갱신과 별도 |
| 피보나치 | `pivot`의 `out/fib/fibdash_BTCUSDT.html` → `public/modules/fib/index.html` | 원본 D·매트릭스 유지 + `scripts/enhance-fib.mjs`로 데스크 시각화 연결 |
| 미해소 레벨 (기존 SOP) | `pivot`의 `out/sop/sop_all.html` → `public/modules/sop/index.html` | `scripts/enhance-sop.mjs`로 표시 확장 재적용, 원본 D와 계산 의미 보존. 내부 주소 `sop` 유지 |
| 전광판 설정 | `board`의 `signal_config.json` → 공개 설정 JSON | publish가 통째로 복사 |
| 스냅샷 | `scripts/snapshot-board.py` → `board`의 `backend/app` → `data.json` | init_db와 recompute_board 실행: 단순 파일 검사가 아님 |
| 게시 | `scripts/publish.mjs` → 순차 복사 → 선택적 스냅샷 → 선택적 배포 | 중간 실패 시 앞선 파일은 이미 바뀔 수 있음 |
| 배포 | `wrangler.toml` + `.github/workflows/deploy.yml` | Worker 이름 `pnl404-desk`, assets `./public`, main 푸시도 배포 |

원본 경로를 현재 저장소의 부모 디렉토리로 추정하지 않는다. 원본 위치가 바뀌면 공통 설정을 수정하고 `npm run check:sources`로 확인한다. 경로 존재 확인은 Python 실행 환경의 정상 동작이나 데이터 최신성까지 보장하지 않는다.

피보나치 표시 확장은 `public/modules/fib/zone-visualization.mjs`와 `.css`에서 관리한다. 원본 매트릭스의 `D.distinct[].rows`에서 #1/#2/#7/#8 가격을 사용한다. #2→#7 상승폭의 분모는 #2 가격, 현재가 괴리율의 분모는 D.price다. 기본 하단·상단 밴드를 표시하며 확장층 상단 밴드를 새로 정의하지 않는다. publish의 enhancer가 표시 용어를 하단·상단 밴드로 치환하고 연결 태그를 재적용한다. raw 프로젝트와 가격·비율·계산식은 수정하지 않는다.

피보나치 전체 화면 구성은 같은 폴더의 `dashboard-view.mjs`와 `.css`가 담당한다. 기존 밴드 모듈 실행 후 원본 분포·근접 레벨·고유 기준·확장 매트릭스 DOM을 새 레이아웃으로 옮긴다. 히트 스트립은 기간 선택 버튼과 상세 패널로 확장한다. `enhance-fib.mjs`가 새 화면 연결도 재적용한다.

기존 점수 입력 계약은 `items[].symbol/display/score/direction/band`와 `generated_at`, 표시 설정의 bands/sort/filter/tile을 중심으로 확인한다. `details`가 없는 스냅샷은 화면이 안내 문구로 처리하므로 무조건 오류로 만들지 않는다. details가 있으면 components의 `points_long/points_short`는 숫자여야 한다. 실제 의미·배점은 원본 설정/계산 코드를 따른다.

새 시장 항목은 `id/market/symbol/name/groups/currency/price/change_pct/updated_at/source`를 사용하며 결측 가격은 null이다. Python 일봉의 `bar_date`는 거래일 날짜이고 자정 표식을 실제 체결 시각으로 표시하지 않는다. 주식 시가총액은 별도의 출처·시각이다. Python 모드의 Cloudflare Cron은 파일 경과 시간만 확인하며 Python을 실행하지 않는다. 수동 웹 모드 캐시는 24시간 보존과 15분 신선도를 구분하는 데이터센터별 캐시다. 무료 데이터 수집·종가 중심 요구는 [선택 기록](../../../../docs/market-data-options.md)을 따른다.

암호화폐 일봉 수집은 UTC 완료 경계별로 성공 이력을 재사용한다. 일반 예약은 최대20종목을16초 간격으로 보충하며 미완료분은 다음 회차로 이월한다. 429 응답은 즉시 중단하고 Retry-After 및 지수 대기 시간을 산출물에 기록한다. 가격·모멘텀 부분 성공은 종료 코드2이며 예약 workflow는 이를 명시적으로 허용한 뒤 `check:markets`와 테스트로 값·이력·계산 계약을 검사한다. 전체 실패는 게시하지 않는다.

`npm run publish`는 원본 HTML 두 개와 설정을 복사한다. Windows venv가 존재하면 전광판도 재계산한다. venv가 없으면 기존 data.json을 남기고 경고하며, 기존 JSON까지 없어도 경고 후 계속한다. 따라서 명령 종료 성공만으로 새 데이터가 모두 준비됐다고 판단하지 않는다.

`npm run deploy`는 위 갱신 후 `npx --yes wrangler deploy`까지 수행한다. 이미 준비된 public만 배포하라는 요청이라면 자동 갱신을 포함하는 명령을 그대로 선택하지 말고 검증 후 직접 Wrangler 배포 범위를 선택한다. 토큰은 기존 실행 환경·GitHub secret을 사용한다.

오프라인 검사와 배포는 다르다. 검사기는 공개 API·외부 Python·Wrangler를 실행하지 않는다. HTML 인라인 classic script는 구문만 검사하며 브라우저 렌더링·Worker 라우팅·데이터 최신성은 별도 증거가 필요하다.
