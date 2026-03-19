# Git Graph+

[![Install from VS Code Marketplace](https://img.shields.io/badge/Install-VS%20Code%20Marketplace-blue.svg)](https://marketplace.visualstudio.com/items?itemName=the0807.git-graph-plus)

[English](README.md)

VS Code를 위한 모던 Git GUI. 커밋 히스토리를 시각화하고, 브랜치를 관리하고, 고급 Git 작업까지 에디터를 벗어나지 않고 수행할 수 있습니다.

> 스테이징과 커밋은 VS Code 내장 소스 제어를 사용합니다. Git Graph+는 그 외 모든 것에 집중합니다.

![Git Graph+ 데모](resources/git-graph-plus.gif)

## 기능

### 커밋 그래프
- 브랜치/머지 시각화 및 색상 구분이 적용된 인터랙티브 커밋 그래프
- Fork와 같은 위상순 커밋 정렬 (topo-order)
- 커밋을 클릭하여 상세 정보, 변경된 파일, diff 확인
- 우클릭 컨텍스트 메뉴: checkout, cherry-pick, revert, reset, merge, rebase 등
- 두 커밋 비교: 기준 커밋 선택 후 다른 커밋 클릭으로 diff 확인
- 커밋과 로컬 작업 변경사항 비교
- 메시지, 작성자, 날짜 범위, 해시로 검색
- 작성자명 옆에 Gravatar 아바타 표시
- 크기 조절 가능한 하단 패널 (Escape로 닫기)
- 로컬 전용 커밋 표시 (파란 점 — push 안 됨)
- 리모트 전용 커밋 표시 (회색 점 — 리모트가 앞서감)

### 브랜치 & 태그 관리
- 브랜치 생성, 이름 변경, 삭제, checkout
- Merge (default, no-ff, ff-only, squash) 및 rebase (interactive 포함)
- Cherry-pick 및 revert
- 경량 태그 및 주석 태그 생성
- 리모트 태그 push, 삭제, 관리 (리모트에서도 삭제 옵션)
- upstream 추적 기반 로컬/리모트 브랜치 매칭

### 리모트 작업
- 확인 모달이 있는 fetch, pull, push (리모트 선택 가능)
- 리모트 추가 및 제거
- `--force-with-lease` 안전 장치를 사용한 강제 push (경고 표시)
- 자동 fetch 간격 설정 가능
- 리모트 브랜치 checkout 시 로컬 트래킹 브랜치 생성 다이얼로그
- 뒤처진 브랜치 checkout 시 pull 제안

### 충돌 해결
- Merge, rebase, cherry-pick, revert 시 자동 충돌 감지
- 충돌 배너에 파일 목록 및 상태 표시
- 충돌 파일 클릭으로 VS Code 에디터에서 열기 (3-way 병합 편집기 지원)
- Continue 및 Abort 버튼 (해결된 파일 자동 스테이징)

### Stash & Worktree
- Stash 저장, 적용, pop, 삭제
- 커밋 그래프에 stash 배지 및 전용 컨텍스트 메뉴
- Worktree 관리 (목록, 추가, 제거, 정리)

### 고급 기능
- Git Flow 지원 (feature, release, hotfix)
- Git Bisect (start, good, bad, reset)
- Git LFS 파일 목록 및 잠금 관리
- 서브모듈 상태 확인, 업데이트, 그래프 전환
- 리포지토리 통계 (작성자별 Gravatar 커밋 통계, 활동 히트맵)
- 사용자 액션 필터링이 적용된 활동 로그

### 멀티 리포지토리 & 서브모듈
- 워크스페이스 내 서브모듈 자동 탐색
- 툴바 드롭다운으로 리포지토리 전환

### 액티비티 바 사이드바
- 트리 뷰: Branches, Remotes, Tags, Stashes, Worktrees
- 클릭으로 액션 메뉴, 우클릭으로 컨텍스트 메뉴
- 브랜치 정렬: main/master 우선, 이후 알파벳순

### 다국어 지원
- 영어 (기본) 및 한국어
- `gitGraphPlus.locale` 설정으로 변경 가능
- Git 용어 (commit, merge, rebase, push, pull, fetch 등)는 번역하지 않음

## 시작하기

1. VS Code Marketplace에서 확장을 설치합니다
2. Git 리포지토리가 포함된 폴더를 엽니다
3. Git Graph+를 엽니다:
   - **명령 팔레트**: `Git Graph+: Open`
   - **액티비티 바**: Git Graph+ 아이콘 클릭
   - **SCM 제목 표시줄** 또는 **상태 표시줄**: git-merge 아이콘 클릭

## 설정

| 설정                              | 기본값  | 설명                                  |
| --------------------------------- | ------- | ------------------------------------- |
| `gitGraphPlus.maxCommits`         | `1000`  | 처음에 불러올 최대 커밋 수            |
| `gitGraphPlus.defaultView`        | `graph` | 기본 뷰 (`graph` 또는 `log`)          |
| `gitGraphPlus.graphRowHeight`     | `28`    | 커밋 그래프 행 높이 (px)              |
| `gitGraphPlus.autoRefresh`        | `true`  | 리포지토리 변경 감지 시 자동 새로고침 |
| `gitGraphPlus.showRemoteBranches` | `true`  | 사이드바에 리모트 브랜치 표시         |
| `gitGraphPlus.confirmForcePush`   | `true`  | 강제 push 전 확인 대화상자 표시       |
| `gitGraphPlus.autoFetch`          | `true`  | 리모트에서 주기적으로 자동 fetch      |
| `gitGraphPlus.autoFetchInterval`  | `10`    | 자동 fetch 간격 (분, 1–60)            |
| `gitGraphPlus.locale`             | `auto`  | UI 언어 (`auto`, `en`, `ko`)          |

## 요구 사항

- VS Code 1.85.0 이상
- Git이 설치되어 있고 PATH에서 사용 가능

## 크레딧

- [Git Graph](https://github.com/mhutchie/vscode-git-graph), [Fork](https://git-fork.com/), [SourceGit](https://github.com/sourcegit-scm/sourcegit)의 UI/UX에서 아이디어를 얻었습니다
- 이 프로젝트는 [Git Graph](https://github.com/mhutchie/vscode-git-graph)의 코드를 사용하지 않으며, 모든 코드는 처음부터 새로 작성되었습니다
- 확장 아이콘: [VS Code Codicons](https://github.com/microsoft/vscode-codicons), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 라이선스

## 라이선스

[Apache-2.0](LICENSE)
