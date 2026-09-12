---
name: pnl404-publish
description: "PNL404 원본 HTML·설정 수집, 전광판 data.json 갱신, publish 오류와 Cloudflare 게시·배포 작업을 처리한다. 스냅샷 업데이트·갱신 재실행에도 사용한다. 화면 스타일 수정이나 로컬 파일 검사만 요청한 경우에는 실행하지 않는다."
---

# 데이터 갱신과 게시

## 준비

[프로젝트 지도](../pnl404-orchestrator/references/project-map.md)와 `source-projects.json`, `scripts/publish.mjs`, `scripts/snapshot-board.py`를 읽는다. 요청이 원본 갱신·산출물 수집·이미 준비된 파일 배포 중 무엇인지 판별한다. 원본은 바탕화면의 독립 프로젝트 두 개이며 `Desktop/PNL404` 아래에서 찾지 않는다.

갱신 전 `npm run check:sources`를 실행해 실제 계산된 입력 경로를 확인한다. 누락 시 존재하지 않는 원본을 생성하거나 오래된 산출물을 최신으로 표시하지 않는다. 필수 위치를 알리고 진행 가능한 검사·준비를 계속한다.

다중시장 시세·일봉·모멘텀은 이 저장소의 `scripts/market-refresh.py`와 `requirements-market.txt`를 확인하고 `npm run refresh:markets`로 생성한다. Python 패키지 수집과 정적 JSON 게시를 구분한다. 기존 4H 암호화폐 점수의 별도 재계산만 설정된 `board` 프로젝트의 `init_db()`와 `recompute_board()` 경로를 사용한다. 검증만 필요할 때 재계산하지 않는다. 원본 경로 변경은 공통 설정에서 처리하고 사용자 지정 위치를 따른다.

## 실행

- 전체 로컬 수집 요청: 사전 확인 후 `npm run publish`. 세 복사는 순차적이며 부분 실패할 수 있으므로 실행 전후 diff와 생성 시각을 대조한다.
- 일부 모듈만 요청: 해당 원본·대상만 처리한다. 전체 publish로 다른 모듈까지 갱신하지 않는다.
- 새 전광판이 필요하지만 venv 없음: 기존 data.json 보존은 최신화 성공이 아니다. 필요한 환경과 미완료를 보고한다.
- 갱신 후 배포 요청: `npm run publish` → `npm run check` → 기존 권한으로 Wrangler 배포를 수행한다. 검사 전에 배포가 이어지는 `npm run deploy`는 검증 단계를 대신하지 않는다.
- 이미 준비된 public만 배포 요청: `npm run check` 후 `npx --yes wrangler deploy`. 배포 대상은 wrangler 설정과 사용자 요청을 대조한다. 셸에서 실행 파일을 찾지 못하면 실제 설치 경로를 확인하고, Windows `.cmd` 실행 방식은 현재 환경에 맞춘다.

## 확인

종료 코드와 로그뿐 아니라 변경한 JSON의 generated_at, 재사용 여부, HTML 복사 결과를 검사한다. 배포했으면 도구가 반환한 실제 URL에서 셸·대상 모듈·JSON 응답을 확인한다. 토큰 값은 출력하지 않는다.

일시적 실패는 현재 상태를 읽은 뒤 1회 재시도한다. 필수 산출물 오류가 남으면 배포하지 않는다. 결과에 갱신 성공·기존 데이터 재사용·미완료·운영 반영 여부를 명확히 구분한다.
