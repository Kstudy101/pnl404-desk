---
name: pnl404-verify
description: "PNL404 변경 결과의 정적 자산·JSON·화면 연결과 하네스를 검증한다. 배포 전 점검, 파일 경로 오류, 상세 점수 오류, 하네스 감사와 수정 후 재검증에 사용한다. 실제 데이터 갱신이나 배포 자체는 publish 담당에게 연결한다."
---

# 연결 검증

요청과 완료 기준을 먼저 읽고 변경된 생산자·소비자를 함께 확인한다.

| 변경 | 함께 확인할 경계 |
|---|---|
| 탭·모듈 경로 | `public/index.html`의 TABS/data-tab ↔ 실제 모듈 파일 |
| 전광판 JSON | `scripts/snapshot-board.py`와 결과 JSON ↔ render/openDetail의 소비 필드 |
| 다중시장·모멘텀 | Python 수집/모멘텀 계산 → markets.json·history → Worker API → board-model/board 화면 |
| fib/SOP 게시 | 이웃 원본 ↔ 복사 대상 ↔ 셸 iframe 경로 |
| 배포 | wrangler assets 경로 ↔ public 파일 ↔ 배포 workflow |
| 하네스 | AGENTS/CLAUDE 진입 링크 ↔ 오케스트레이터 ↔ 역할·스킬 |

## 오프라인 검사

- `npm run check`: 하네스 메타데이터·링크, 정적 HTML의 로컬 자산 경로와 classic 인라인 JS 구문, JSON 소비 계약을 검사한다. 변경을 쓰지 않는다.
- `npm test`: 검사기를 수정했을 때 오류 검출 회귀 테스트를 실행한다.
- `npm run check:sources`: 실제 갱신 요청의 사전 점검에만 사용한다. 일반 UI 작업의 완료 조건으로 이웃 프로젝트 설치를 강제하지 않는다.
- Python을 수정했으면 import/실행 없이 `ast.parse`로 구문을 검사한다. 실제 재계산 검증은 외부 환경·실행 범위가 갖춰졌을 때만 한다.

## 화면 변경 시 브라우저 검사

로컬 HTTP로 public을 제공하고 셸 → 세 탭, `?tab=fib` 직접 진입, 새로고침, 뒤로/앞으로를 확인한다.
전광판은 정렬, 방향 필터, 빈 결과, 타일 상세 열기/닫기, details 누락 안내, JSON 로드 실패 표시 중 변경 영향을 받는 항목을 확인한다.
격리된 입력으로 `candle_closed=false`, `degraded=true` 표시가 사라지지 않는지 확인한다. 실제 data.json을 테스트용으로 바꾸지 않는다.
뷰포트·동작·화면 증거를 기록한다. 브라우저를 쓰지 않았으면 “정적 검사만 완료”라고 보고한다.

## 판정

명령 종료 성공, 최신 데이터 여부, 시각적 동작, 운영 반영은 각각 다른 증거를 요구한다.
선택적 details 누락이나 시간이 지난 스냅샷은 자체로 구조 오류가 아니다. 요청이 최신화일 때만 생성 시각을 완료 기준과 대조한다.
실패는 파일·위치·재현 단계와 함께 담당자에게 반환한다. 수정 후 해당 검사와 영향을 받는 경계만 재검증한다.
