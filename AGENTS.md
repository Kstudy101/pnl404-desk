# PNL404 데스크 작업 지침

이 저장소의 화면·데이터 갱신·배포 작업과 그 후속 수정에는 [pnl404-orchestrator](.claude/skills/pnl404-orchestrator/SKILL.md)를 먼저 읽고 해당 역할의 스킬만 적용한다. 단순 설명·일반 시장 질문은 직접 답한다.

하네스 정의의 원본은 `.claude/`에 있다. Codex에서는 이 파일의 링크로 읽는다. `.claude/agents/`를 Codex의 자동 등록 에이전트라고 가정하지 않는다. 위임 시 정의 파일을 읽고 현재 제공되는 도구와 모델을 사용한다.

에이전트에게 새 작업을 배정하기 전에는 skills.sh와 SkillsMP에서 관련 스킬을 검색·검토하고 배정한다. 검색 근거와 선정 스킬은 오케스트레이터의 배정 전 스킬 탐색 절차에 따라 기록·전달한다.

`npm run check`는 네트워크·데이터 재계산·배포 없이 하네스 연결과 정적 자산을 검사한다. `npm test`는 검사기의 오류 감지를 검증한다. 갱신 작업 전에는 `npm run check:sources`로 원본 프로젝트 입력을 확인한다.

사용자가 확인한 raw data 원본은 바탕화면의 `피봇스윙매매`와 `스윙전광판`이다. `Desktop/PNL404`는 별도 프로젝트이며 원본 폴더의 부모가 아니다. 실제 경로는 [source-projects.json](source-projects.json)을 따른다.

이 프로젝트는 공개 시장 데이터 표시용 정적 사이트다. 데이터 생성 원본과 배포 산출물의 구분은 [프로젝트 지도](.claude/skills/pnl404-orchestrator/references/project-map.md)를 따른다. 사용자 변경을 보존하고, 요청된 작업의 권한을 이어서 사용한다. `main` 푸시는 검사만 실행한다. 운영 자동 배포는 매시간 통합 갱신 작업이 담당하고, 수동 배포는 검증된 산출물에 한정한다.
