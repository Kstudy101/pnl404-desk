import {SP500_MEMBERS,SP500_AS_OF} from './sp500.mjs';
// Membership reference: https://indexes.nikkei.co.jp/en/nkave/index/component
// Observed 2026-09-12; provider page update 2026-09-11. Membership is a dated
// catalogue, not a claim that index rebalances are tracked automatically.
export const CATALOGUE_DATE = '2026-09-12';
export const NIKKEI_CODES = `4151 4502 4503 4506 4507 4519 4523 4568 4578
285A 4062 6479 6501 6503 6504 6506 6526 6645 6701 6702 6723 6724 6752 6753 6758 6762 6770 6841 6857 6861 6902 6920 6954 6963 6971 6976 6981 7735 7751 7752 8035
543A 7201 7202 7203 7211 7261 7267 7269 7270 7272
4543 4902 6146 7731 7733 7741 9432 9433 9434 9984
5831 7186 8304 8306 8308 8309 8316 8331 8354 8411 8253 8591 8697 8601 8604 8630 8725 8750 8766 8795
1332 2002 2269 2282 2501 2502 2503 2801 2802 2871 2914
3086 3092 3099 3382 7453 7532 8233 8252 8267 9843 9983
2413 2432 3659 3697 4307 4324 4385 4661 4689 4704 4751 4755 6098 6178 6532 7974 9602 9735 9766
1605 3401 3402 3861 3405 3407 4004 4005 4021 4042 4043 4061 4063 4183 4188 4208 4452 4901 4911 6988
5019 5020 5101 5108 5201 5214 5233 5301 5332 5333 5401 5406 5411
3436 5706 5711 5713 5714 5801 5802 5803 2768 8001 8002 8015 8031 8053 8058
1721 1801 1802 1803 1808 1812 1925 1928 1963
5631 6103 6113 6273 6301 6302 6305 6326 6361 6367 6471 6472 6473 7004 7011 7013 7012
7832 7911 7912 7951 3289 8801 8802 8804 8830
9001 9005 9007 9008 9009 9020 9021 9022 9064 9147 9101 9104 9107 9201 9202 9501 9502 9503 9531 9532`.trim().split(/\s+/);

export const SP500_VERIFIED = new Set(SP500_MEMBERS.map(item=>item.symbol));
export const KOREAN_NAMES = {
  'AAPL':'애플', 'MSFT':'마이크로소프트', 'NVDA':'엔비디아', 'AMZN':'아마존',
  'GOOGL':'알파벳 A', 'GOOG':'알파벳 C', 'META':'메타', 'TSLA':'테슬라', 'AVGO':'브로드컴', 'MU':'마이크론',
  '7203.T':'도요타 자동차', '6758.T':'소니 그룹', '9984.T':'소프트뱅크 그룹', '9983.T':'패스트리테일링',
  '7974.T':'닌텐도', '8035.T':'도쿄일렉트론', '8306.T':'미쓰비시 UFJ', '6501.T':'히타치',
  '6861.T':'키엔스', '6098.T':'리크루트', '4063.T':'신에츠화학', '8316.T':'미쓰이스미토모',
  '9432.T':'NTT', '9433.T':'KDDI', '9434.T':'소프트뱅크', '6857.T':'어드밴테스트',
  '8058.T':'미쓰비시상사', '8001.T':'이토추', '8031.T':'미쓰이물산', '7011.T':'미쓰비시중공업',
  '7267.T':'혼다', '7269.T':'스즈키', '4502.T':'다케다제약', '4568.T':'다이이찌산쿄',
  '4519.T':'주가이제약', '8766.T':'도쿄해상', '8411.T':'미즈호금융', '7751.T':'캐논',
  '6981.T':'무라타제작소', '6902.T':'덴소', '6367.T':'다이킨', '7741.T':'호야', '6954.T':'화낙',
  '3382.T':'세븐앤아이', '4661.T':'오리엔탈랜드', '2914.T':'일본담배', '4901.T':'후지필름',
  '3659.T':'넥슨', '4755.T':'라쿠텐', '4385.T':'메르카리', '3350.T':'메타플래닛',
  '2702.T':'일본 맥도날드', '7564.T':'워크맨', '4478.T':'프리', '4477.T':'베이스', '9348.T':'아이스페이스',
};
export const CRYPTO_NAMES = {
  bitcoin:'비트코인', ethereum:'이더리움', tether:'테더', ripple:'리플', binancecoin:'비앤비', solana:'솔라나',
  'usd-coin':'유에스디 코인', dogecoin:'도지코인', cardano:'에이다', tron:'트론', 'staked-ether':'리도 스테이킹 이더',
  'wrapped-bitcoin':'랩트 비트코인', 'bitcoin-cash':'비트코인 캐시', chainlink:'체인링크', stellar:'스텔라루멘',
  litecoin:'라이트코인', sui:'수이', 'avalanche-2':'아발란체', 'the-open-network':'톤', 'shiba-inu':'시바이누',
  polkadot:'폴카닷', uniswap:'유니스왑', aave:'에이브', monero:'모네로', near:'니어프로토콜', 'hedera-hashgraph':'헤데라',
};

export const MARKETS = [
  {id:'us',label:'미국주식',currency:'USD',groups:[{id:'all',label:'전체'},{id:'sp500',label:'S&P 500'},{id:'nasdaq',label:'나스닥'},{id:'nyse',label:'뉴욕증권거래소'}],coverage:{type:'index_and_market_cap_selection',description:'S&P 500 구성 503개 주식 클래스 + 나스닥·NYSE 각 시총 상위 100 · S&P 목록은 공개 커뮤니티 자료',membership_as_of:SP500_AS_OF}},
  {id:'kr',label:'한국주식',currency:'KRW',groups:[{id:'all',label:'전체'},{id:'kospi',label:'코스피'},{id:'kosdaq',label:'코스닥'}],coverage:{type:'market_cap_selection',description:'코스피·코스닥 각 시총 상위 100종목'}},
  {id:'jp',label:'일본주식',currency:'JPY',groups:[{id:'all',label:'전체'},{id:'nikkei225',label:'닛케이 225'},{id:'prime',label:'프라임'},{id:'standard',label:'스탠더드'},{id:'growth',label:'그로스'}],coverage:{type:'dated_index_and_selection',description:'2026-09-11 닛케이225 구성종목 + 스탠더드·그로스 일부 종목',membership_as_of:CATALOGUE_DATE}},
  {id:'crypto',label:'암호화폐',currency:'USD',groups:[{id:'all',label:'전체'},{id:'top100',label:'시가총액 100'}],coverage:{type:'market_cap_top100',description:'CoinGecko 시가총액 순위 상위 100 · 스테이블·랩트 토큰 포함'}},
];

export function emptyItem(market, symbol, name = symbol, groups = []) {
  return {id:`${market}:${symbol}`,market,symbol,name,aliases:[],groups,currency:MARKETS.find(x=>x.id===market)?.currency || 'USD',price:null,change_pct:null,market_cap:null,updated_at:null,fetched_at:null,source:null,history:[]};
}
export const JAPAN_SEEDS = [
  ...NIKKEI_CODES.map(code => emptyItem('jp',`${code}.T`,KOREAN_NAMES[`${code}.T`] || code,['nikkei225','prime'])),
  ...[['3350','standard'],['2702','standard'],['7564','standard'],['4478','growth'],['4477','growth'],['9348','growth']].map(([code,group])=>emptyItem('jp',`${code}.T`,KOREAN_NAMES[`${code}.T`],[group])),
];
export const US_SEEDS = SP500_MEMBERS.map(item=>({...emptyItem('us',item.symbol,KOREAN_NAMES[item.symbol] || item.name,['sp500']),name_en:item.name}));
