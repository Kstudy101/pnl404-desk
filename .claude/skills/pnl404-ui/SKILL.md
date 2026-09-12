---
name: pnl404-ui
description: "PNL404 탭 셸과 전광판 화면의 HTML/CSS/JavaScript를 수정한다. 모바일 레이아웃, 탭·URL·뒤로가기, 정렬·필터·상세 화면 수정 및 후속 보완에 사용한다. 데이터 재계산·게시나 일반 차트 해설만 요청한 경우에는 적용하지 않는다."
---

# 화면 수정

1. [프로젝트 지도](../pnl404-orchestrator/references/project-map.md)에서 해당 화면의 원본과 소비 데이터를 확인한다. 별도 프레임워크·빌드가 필요하다고 가정하지 않는다.
2. 셸은 `public/index.html`, 전광판 UI는 `public/modules/board/index.html`을 수정한다. 피보나치 하단→상단 밴드 시각화는 같은 모듈 폴더의 `zone-visualization.mjs`와 `.css`에 있으며 publish가 연결 태그를 재적용한다. 그 외 fib/SOP 생성 내용 수정은 원본 생성기를 확인한다. 일회성 산출물 수정 요청은 그대로 수행하고 수명을 결과에 명시한다.
3. 탭 변경은 `data-tab`, TABS 키, iframe 경로, URL 쿼리, aria-selected, document.title과 popstate를 함께 확인한다.
4. 전광판 변경은 실제 JSON과 render/openDetail을 함께 읽는다. 점수·방향·잠정·결측 보정 표시를 임의로 해석하거나 데이터 값을 꾸미지 않는다. 사용자 요청이 없으면 표시 변경을 계산식 변경으로 확대하지 않는다.
5. `npm run check` 후 변경된 상호작용을 브라우저에서 검증한다. 모바일 레이아웃은 375px와 데스크톱에서 확인하고, 도구가 없으면 해당 항목을 미검증으로 남긴다.

결과는 변경 이유, 소유 파일, 실제 검사 결과, 생성 산출물 직접 수정 여부를 포함한다. 데이터 필드 변경이 필요하면 데이터 담당에게 생산자 수정과 함께 요청한다.
