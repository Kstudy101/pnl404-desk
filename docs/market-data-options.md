# PNL404 무료 스윙 데이터 소스

확인일: 2026-09-12. 사용자의 최신 선택은 **실시간 시세보다 스윙 관점, 가능한 무료 구현**이다. 유료 서비스 가입은 진행하지 않는다.

## 채택 방향

조회 기간은 사용자 후속 요청에 따라 일봉 기반7·14·21·28일(기본7일)이다. 주식은 거래일, 암호화폐는 주말을 포함한 달력일로 누적 모멘텀과7일 구간별 변화를 계산한다. 데이터가 바뀌었는지1시간마다 확인하고 공급자의 가격 기준 시각과 수집 시각을 구분한다. 장마감 이후 가격이 그대로인 것은 정상이다. 실패 시 마지막 정상 응답을 보존한다.

| 무료 소스·라이브러리 | 확인한 역할 |
|---|---|
| [FinanceDataReader](https://github.com/FinanceData/FinanceDataReader) | KOSPI/KOSDAQ, NASDAQ/NYSE, TSE 종목 목록 및 일봉. 소스에서 NAVER 해외거래소 목록, 일본 `TOKYO` 코드, 한국 KRX 일별 캐시 경로를 확인했다. HEAD 조회: `addcbb7e887f0db6176a87d323de5de28357b5f4`. |
| [yfinance](https://github.com/ranaroussi/yfinance) | Yahoo 공개 데이터의 가격 이력·검색·다종목 조회 패턴. 개인·연구용 데이터 이용 안내가 있으며 공개 재배포 권한을 주는 라이브러리는 아니다. |
| [pykrx](https://github.com/sharebook-kr/pykrx) | 한국 종목·시가총액·지수 구성종목 조회 보완 후보. 문서와 원본 코드를 검토했으며 이 프로젝트에 패키지 설치나 실행 검증을 했다는 의미는 아니다. |
| [S&P500 구성종목 CSV](https://github.com/datasets/s-and-p-500-companies) | 실제 다운로드에서 중복 없는 503개 주식 코드 확인. Wikipedia 기반 공개 자료이며 공식 실시간 구성종목 피드는 아니다. 데이터 라이선스 PDDL. |
| [CoinGecko](https://docs.coingecko.com/reference/coins-markets) | 현재 시가총액 상위100, 가격·등락률·차트. 무료 호출 한도 안에서 공용 캐시 사용. |
| [CCXT](https://github.com/ccxt/ccxt) | 거래소별 OHLCV가 추가로 필요할 때 사용할 수 있는 오픈소스 후보. 전체 암호화폐 시총순위는 별도 공급자가 필요하므로 CoinGecko를 대체하지 않는다. |

사용자의 후속 요청에 따라 **FinanceDataReader·yfinance 패키지를 직접 사용하는 Python 수집기**를 채택했다. `.venv-market`의 FinanceDataReader 0.9.202, yfinance 1.7.0으로 주식989개와 CoinGecko 암호화폐100개를 실제 수집해 1,089/1,089 성공을 확인했다. 주식 일별 이력989개에 247,544개 관측값을 저장했다. 이 근거는 가격 수집 검증이며 별도 후속 모멘텀 계산·운영 자동 갱신까지 검증했다는 뜻은 아니다.

후속 모멘텀 검증(2026-09-12 15:58UTC):16초 간격의 한 차례 보충으로 누락96개를 모두 수집하여 암호화폐100개 이력을 확보했다. 이어서 가격1,089개를 다시 갱신했고, 이미 받은 암호화폐 일봉은 추가 호출0회로 재사용했다. 최종 이력은 총251,031관측,7·14·21일 모멘텀1,088개/28일1,087개가 가용하다. Figure Heloc은 날짜 공백, Circle USYC는28개 관측으로28일 수익률 계산에 필요한29개 종가가 부족하다. 원자료가 없는 날짜를 보간하지 않는다. 운영 예약 배포는 실행하지 않았다.

`scripts/market-refresh.py` → `public/modules/board/markets.json` 및 `history/` → Worker API → 전광판으로 연결한다. Python은 수집 환경에서 실행하며 브라우저에는 JSON을 제공한다. 기존 JavaScript 수집기는 명시적인 수동 보조 경로로 남긴다.

## 스킬 검색 결과

`npx skills find yfinance`, `npx skills find pykrx`, SkillsMP 검색과 GitHub 소스 읽기를 수행했다.

- [himself65/finance-skills — yfinance-data](https://github.com/himself65/finance-skills/tree/main/plugins/market-analysis/skills/yfinance-data): CLI 조회 약 3.1K 설치, 저장소 약 3.3K stars. SKILL.md까지 읽어 배치 수집·예외 처리·시간대 처리 내용을 확인했다. 설치하지 않고 구현 참고로 사용했다.
- 설치 명령: `npx skills add himself65/finance-skills --skill yfinance-data`.
- [HKUDS/Vibe-Trading — yfinance](https://github.com/HKUDS/Vibe-Trading/tree/main/agent/src/skills/yfinance): 직접 Yahoo 차트·검색 클라이언트와 공유 요청 제한 방식 참고. 전체 트레이딩 시스템을 이 저장소에 도입하지 않는다.
- 스킬은 개발 절차를 돕는 문서·도구이며, 데이터 공급 계정이나 API 권한을 대신하지 않는다.

## 유료 API 비교 참고

아래는 초기 비교 기록이며 현재 구현의 필수 요금이 아니다. 가격은 세금·거래소 추가 비용을 제외한 공식 페이지 표시 기준이다.

공개 전광판에는 데이터 조회 기능뿐 아니라 **외부 이용자에게 표시할 수 있는 계약**이 필요하다. 개발용 무료 접근과 운영용 표시 권한은 구분한다. 15분마다 수집하는 주기와 공급자가 제공하는 시세의 지연 시간도 별개다. 일별 종가(EOD) 상품은 15분마다 호출해도 장중 가격으로 바뀌지 않는다.

| 대상 | 추천 후보 | 적합성·비용 |
|---|---|---|
| 암호화폐 시총100 | [CoinGecko](https://www.coingecko.com/en/api/pricing) | 종목 ID, 시가총액 순위, 현재가, 거래량, 차트 API. Demo 무료 10,000회/월. Basic 월 $35 또는 연 결제 월 환산 $29, 100,000회/월. 유료 상업용 라이선스에도 출처 링크 표시 조건 적용. |
| 미국주식 공개 표시 | [Twelve Data Business](https://twelvedata.com/pricing-business) | Venture 월 $499부터, 외부 표시 용도와 미국 실시간 시세 지원. 크레딧·거래소 권한을 확인하여 계약. |
| 미국주식 개인 개발·차트 | [Massive](https://www.massive.com/stocks) | 무료는 EOD. 개인 Starter 월 $29에 15분 지연 시세. 공개 사이트용 Business는 별도 가격·권한이므로 개인 플랜 비용으로 운영 예산을 잡지 않는다. |
| 한국주식 공개 표시 | [코스콤 시세 API](https://koscom.gitbook.io/open-api/faq/market) | KOSPI·KOSDAQ 데이터와 외부 표시 용도를 명시해 견적 문의. [KRX 상품 설명](https://data.krx.co.kr/inc/datasale/Market%20Data%20Product%20Brochure.pdf)에 웹사이트·앱 대중 체결가 서비스 옵션이 있다. |
| 일본주식 공개 표시 | [JPX 15분 지연 시세 API](https://www.jpx.co.jp/english/markets/paid-info-equities/realtime/06.html) | 외부 배포 지원. 기본 월 80,000엔, API 정보료 0~350,000엔, 불특정 다수 배포 시 월 50,000~100,000엔 단말료. 실제 금액은 종목 수·취득 빈도에 따라 산정. 지수·통계는 포함하지 않음. |
| 국내·해외 주식 개인 검증 | [한국투자증권 Open API](https://apiportal.koreainvestment.com/apiservice-summary) | 계좌 기반 시세 API 후보. [정보 이용 조건](https://apiportal.koreainvestment.com/provider-doc1)은 거래고객 대상 서비스로 이용 범위를 제한하므로 공개 전광판의 기본 공급자로 채택하지 않는다. |

Twelve Data의 [거래소 목록](https://twelvedata.com/exchanges?level=pro)에서 한국 거래소는 EOD로 표시된다. 일본의 장중 제공 범위 역시 상품별 확인이 필요하다. [외부 이용 안내](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage)에 따르면 미국 외 지역의 상업용 가격 표시에는 추가 승인이 필요할 수 있다. 한 API로 세 나라 장중 시세가 모두 해결된다고 가정하지 않는다.

## 공개 배포와 요청량

개발·검증은 무료 공개 데이터 어댑터로 진행한다. 무료 라이브러리의 라이선스와 공급 데이터의 공개 표시 조건은 별개다. 공개 운영을 보장하는 상품을 별도로 선택해야 한다면 위 유료 비교를 참고할 수 있다.

CoinGecko 시총100 목록을 한 요청으로 1시간마다 수집하면 30일 기준 `1 × 24 × 30 = 720회`다. 현재 Python 모드의 7·14·21·28일 차트는 저장한 일별 이력을 사용한다. 암호화폐 일봉100개를 새 완료일마다 한 번씩 갱신하면 월 약3,000회가 더해져 기본 약3,720회이며, 초기 이력 확보·실패 재시도·구성종목 변경은 별도다. 시간별 통합 회차는 최대100개를16초 간격으로 수집하고 미완료분을 다음 회차로 이월한다. 계산 시각을 가격 기준 날짜와 구별한다.

[최신 무키 API 안내](https://docs.coingecko.com/docs/keyless-public-api)는 IP별 공유·가변 한도와 429 응답 시 backoff를 설명하며, 무키 경로를 예약 운영용으로 권장하지 않는다. 실제 첫 일봉 수집은2.2초 간격에서4종목 성공 후429가 발생했다. 이에 기본 간격을16초로 낮추고 Retry-After 및 지수 대기를 저장하도록 수정했다. [무료 Demo](https://www.coingecko.com/en/api/pricing)는 별도 키 기반 플랜이며 이번 작업에서 가입하거나 키를 생성하지 않았다. 무키 경로의 가용성과 정시 수집을 보장하지 않는다.

예약 실행은 [GitHub Actions schedule 안내](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)에 따라 지연될 수 있다. 이 저장소에서는 예약 정의와 빌드를 검증했으며 운영 배포·원격 실행은 별도다. 자동화 실행 환경의 무료 사용 한도는 데이터 API 사용량과 구별한다.

구현은 시세·검색·차트 데이터 계약을 분리하고 공급자를 교체할 수 있게 구성한다. 비밀 API 키가 필요한 공급자는 Worker의 secret에 보관하고 브라우저에 노출하지 않는다. 이 문서는 서비스 가입·결제·계약 체결을 실행한 기록이 아니다.

## UI/UX 후속 추천

- 장중·장마감·휴장 표시: 국가별 휴일 캘린더를 연결한 뒤 제공한다.
- 관심종목 그룹: 장기 관찰·단기 관찰 등 사용자 이름으로 구분한다.
- 두세 종목 비교: 통화가 다른 가격보다 같은 기준일의 등락률을 비교한다.
- 관심종목 내보내기·가져오기: 로그인 없이 기기 간 이전할 수 있게 한다.
- 가격·등락률 알림: 별도 알림 권한과 전달 수단을 정한 뒤 추가한다.

2026-09-13 갱신 주기 변경: 모든 모듈은 Windows의 매시간05분 통합 작업으로 수집·검사·게시한다. PC와 사용자 세션이 필요하며 GitHub 시장 전용 예약은 중복 게시를 피하기 위해 수동 실행만 남긴다. 위 이전 수집·배포 기록은 해당 시점의 결과다.
