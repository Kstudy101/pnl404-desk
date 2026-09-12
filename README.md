# PNL404 데스크

[pnl404.com](https://pnl404.com) 에서 세 모듈을 탭으로 전환한다.

| 탭 | 원본 |
|---|---|
| 전광판 | 무료 공개 시장 데이터 + `스윙전광판`의 기존 암호화폐 점수 스냅샷 |
| 피보나치 | `피봇스윙매매` `out/fib/fibdash_BTCUSDT.html` |
| 미해소 레벨 | `피봇스윙매매` `out/sop/sop_all.html` |

주문 실행 없음. 전광판은 미국·한국·일본 주식과 암호화폐를 조회하며, 피보나치·미해소 레벨은 기존 바이낸스 데이터를 사용한다.

미해소 레벨은 기존 SOP의 새 화면 이름이다. BTC·ETH·SOL·XRP의 1시간봉 미해소 지지·저항과 해소시간 분포를 조회한다. 원본 계산값과 생성 시각을 유지하며, 기존 `?tab=sop` 주소도 그대로 연결된다. 화면 확장은 `scripts/enhance-sop.mjs`를 통해 원본 게시 때마다 다시 적용된다.

## 무료 스윙 전광판

유료 API 구독 없이 공개 데이터를 조회한다. 시장별 분류, 종목명·티커 자동완성, 브라우저에 저장하는 관심종목, 카드/목록 전환, 상세 차트를 제공한다. 모멘텀 조회 기간은 **7·14·21·28일**, 기본7일이다. 주식은 거래일, 암호화폐는 주말을 포함한 달력일을 사용한다. 선택 기간 누적 등락률과 상승·하락·중립 방향, 7일 구간별 변화를 확인한다. 필요한 종가가 부족한 기간은 계산 불가로 표시한다.

`scripts/market-refresh.py`가 **FinanceDataReader와 yfinance를 직접 사용**해 시세와 일별 이력을 JSON으로 저장한다. 미국·일본 주식은 yfinance, 한국 주식은 FinanceDataReader, 암호화폐 시총100은 CoinGecko를 사용한다. `worker/index.mjs`의 `/api/markets`, `/api/search`, `/api/chart`가 같은 산출물을 화면에 전달한다. 주식 가격은 정규장 마감 후 확인한 일봉 종가다.

전광판·피보나치·미해소 레벨은 **1시간마다** 수집·계산·게시를 시도하고 화면에서도 1시간마다 새 산출물을 확인한다. 통합 실행은 `npm run refresh:all -- --deploy`이며, Windows 작업 스케줄러가 현재 체크아웃에서 매시간 05분에 실행한다. **PC가 켜져 있고 해당 사용자 세션 및 네트워크가 사용 가능해야 한다.** Python 모드의 Cloudflare Cron은 매시간 파일 경과 시간만 확인한다. GitHub의 시장 전용 갱신 workflow는 수동 보조 경로로 두어 통합 게시와 중복 실행하지 않는다. **수집 주기와 시세 기준 시각은 별개**이며, 휴장 중에는 가격이 그대로일 수 있다. 실패한 종목은 마지막 값과 원래 시각을 유지하고 지연·결측을 표시한다.

새 모멘텀은 완료된 일별 종가로 계산한다. N일 수익률에는 N+1개 종가가 필요하며, 7일 구간은 같은 하루의 변화를 중복 계산하지 않는다. 기존 `data.json`의 4H 암호화폐 점수는 상세의 과거 스냅샷으로 보존하고 새 모멘텀으로 재표기하지 않는다. 새 시세가 과거 점수의 계산 시각을 바꾸지 않는다. 피보나치·SOP 생성물과 과거 점수 재계산은 아래 원본 갱신 절차를 따른다.

새 완료 일봉을 받으면 날짜별 이력에 추가하고 최신 종가를 끝점으로 모든 기간을 다시 계산한다. 같은 날짜의 정정값을 재수신하면 해당 날짜 값을 교체한다. 주식은 새 거래일마다 구간이 이동하며, 암호화폐는 주말에도 이동한다. 주식의 28거래일은 달력상 한 달보다 길 수 있다. 암호화폐 일봉은 새 UTC 완료 경계마다 수집하고, 공용 API 제한을 고려해 시간별 통합 회차에 최대100종목을16초 간격으로 갱신한다. 나머지는 다음 회차로 이어가며, 실제 기준 날짜와 이력 부족·지연 상태를 표시한다.

무료 라이브러리·GitHub 소스 및 API 비교는 [시장 데이터 선택 기록](docs/market-data-options.md)에 있다. `requirements-market.txt`는 실제 수집에 사용한 버전을 고정한다. 패키지의 코드 라이선스와 공급 데이터의 공개 표시 조건은 별개다.

```powershell
python -m venv .venv-market
.venv-market/Scripts/python.exe -m pip install -r requirements-market.txt
npm run refresh:markets   # Python 패키지로 시세·이력 갱신
npm run dev              # 로컬 API와 화면 (기본 8787)
```

다른 Python 환경을 사용하려면 `PNL404_PYTHON`에 실행 파일 경로를 지정한다. Linux에서는 `.venv-market/bin/python`을 사용한다. `refresh:markets:web`는 이전 JavaScript 공급자 어댑터의 수동 보조 명령이며 Python 수집과 동시에 예약하지 않는다. 시가총액은 주식 일봉 종가와 별도 출처·시각의 관측값이다.

원본(raw data)은 바탕화면의 독립 프로젝트 `C:/Users/zxaswe/Desktop/피봇스윙매매`, `C:/Users/zxaswe/Desktop/스윙전광판`이다. `Desktop/PNL404`는 별도 프로젝트다. [source-projects.json](source-projects.json)에 원본 경로를 명시하며, 게시 스크립트·Python 스냅샷·사전 검사가 이 설정을 함께 읽는다.

피보나치 탭의 **하단 밴드 → 상단 밴드**에서 기준 기간별 #2→#7 상승폭, 현재가 위치, 네 경계 가격과 현재가 대비 괴리율을 확인할 수 있다. “전체 기준 비교”는 같은 가격 축으로 고유 기준들을 나란히 보여준다. 기존 확장 3층 매트릭스는 유지되며, 표시 확장은 게시할 때마다 자동으로 연결된다.

피보나치 화면은 밴드 비교, 구간 분포·기간 선택, 근접 레벨, 고유 기준과 매트릭스 순서로 탐색한다. 기간별 히트 스트립은 터치·키보드로 상세를 확인할 수 있다. `dashboard-view.mjs`와 `.css`는 원본 표시 요소를 재구성하며, 기존 밴드 계산과 원본 데이터는 유지한다.

계산 기준은 화면에 표시하지 않고 [계산 기준 데이터](data/fib-calculation-rules.json)에 기록한다. 이 파일은 계산식 설명을 보관하는 메타데이터이며 실행 설정은 아니다.

## 작업 하네스

화면·데이터/게시·검증 담당을 요청에 맞게 연결한다. [작업 절차](.claude/skills/pnl404-orchestrator/SKILL.md)에 역할, 파일 소유 범위, 재실행 규칙이 있다. Codex는 [AGENTS.md](AGENTS.md), Claude는 [CLAUDE.md](CLAUDE.md)에서 같은 정의를 읽는다. Codex의 연결 방식은 [공식 AGENTS.md 안내](https://learn.chatgpt.com/docs/agent-configuration/agents-md)를 따른다.

예: “모바일 탭 간격 수정해줘”, “전광판 JSON과 화면 연결 검사해줘”, “이전 갱신 실패 지점부터 다시 확인해줘”.

Node.js 22 이상에서 의존성 설치 없이 검사할 수 있다.

```powershell
npm run check          # 하네스 링크·정적 자산·JSON·인라인 JS 구문
npm run check:markets  # 가격·일봉·7/14/21/28일 계산 산출물 대조
npm test               # 검사기의 오류 감지 테스트
npm run check:sources  # 갱신 원본 존재 확인 (데이터 재계산 없음)
```

`check:harness`, `check:assets`로 범위를 좁힐 수 있다. 검사는 브라우저 렌더링이나 데이터 최신성을 보장하지 않는다. GitHub의 별도 Check workflow도 오프라인 검사를 실행하며, 기존 Deploy workflow와는 독립적이다. 팀 작업의 중간 기록은 Git에서 제외된 `_workspace/harness/`에 보존한다.

## 로컬에서 갱신 후 배포

```powershell
cd C:\Users\zxaswe\Desktop\피봇스윙매매
node src/refresh.ts

cd C:\Users\zxaswe\Desktop\PNL404\pnl404-desk
npm run check:sources
npm run publish
npm run check
npx --yes wrangler deploy
```

`publish.mjs` 는 설정된 원본에서 피보나치·SOP HTML과 전광판 설정을 복사하고, 스윙전광판 백엔드 venv 가 있으면 전광판 `data.json` 을 다시 계산한다. 원본 폴더가 이동하면 `source-projects.json`을 수정한다. venv가 없으면 기존 JSON이 유지될 수 있다. `check:sources`는 파일 존재만 확인하며 Python 실행 가능 여부는 실제 갱신 단계에서 확인해야 한다.

GitHub `main` 푸시는 오프라인 검사만 실행한다. 자동 운영 게시 주체는 매시간 통합 작업 하나로 유지하여 오래된 커밋 데이터가 최신 시세를 덮어쓰지 않게 한다. GitHub의 수동 배포를 쓸 때는 준비된 산출물과 `CLOUDFLARE_API_TOKEN` 시크릿이 필요하다.


시간별 Windows 작업 등록은 `scripts/install-hourly-task.ps1`을 사용한다. 기존 예약 설정을 백업하고 현재 사용자로 매시간 05분에 `scripts/refresh-all-hidden.vbs`를 실행한다. 숨김 실행도 실제 성공·실패 코드를 전달한다. 최근 결과는 `_workspace/hourly-refresh/latest.json`, 회차별 상세는 `_workspace/hourly-refresh/runs/<runId>/run.log`에서 확인한다.
임시 산출물과 복구용 사본은 최근 완료 3회분을 보존한다. 이전 회차의 로그와 상태 기록은 남기며, 진행 중인 회차는 정리하지 않는다.
