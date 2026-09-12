# PNL404 데스크

[pnl404.com](https://pnl404.com) 에서 세 모듈을 탭으로 전환한다.

| 탭 | 원본 |
|---|---|
| 스윙전광판 | `스윙전광판` 점수 스냅샷 |
| 피보나치 | `피봇스윙매매` `out/fib/fibdash_BTCUSDT.html` |
| SOP | `피봇스윙매매` `out/sop/sop_all.html` |

주문 실행 없음. 바이낸스 공개 데이터만 쓴다.

## 로컬에서 갱신 후 배포

```powershell
cd C:\Users\zxaswe\Desktop\피봇스윙매매
node src/refresh.ts

cd C:\Users\zxaswe\Desktop\pnl404-desk
node scripts/publish.mjs --deploy
```

`publish.mjs` 는 피보나치·SOP HTML 을 복사하고, 스윙전광판 백엔드 venv 가 있으면 전광판 `data.json` 을 다시 계산한다.

GitHub `main` 푸시도 Cloudflare Pages (`pnl404-desk`) 로 올라간다. 저장소 시크릿 `CLOUDFLARE_API_TOKEN` 이 필요하다.
