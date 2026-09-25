# Git Graph+

[![VS Code Marketplace](https://img.shields.io/badge/Install-VS%20Code%20Marketplace-007ACC?logo=visual-studio-code&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=the0807.git-graph-plus)
[![Open VSX](https://img.shields.io/badge/Install-Open%20VSX-a60ee5?logo=eclipse-ide&logoColor=white)](https://open-vsx.org/extension/the0807/git-graph-plus)

[![CI](https://github.com/the0807/git-graph-plus/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/the0807/git-graph-plus/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/the0807/git-graph-plus/branch/main/graph/badge.svg)](https://codecov.io/gh/the0807/git-graph-plus)

[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

[English](README.md)

VS Code를 위한 모던 Git GUI. 커밋 히스토리를 시각화하고, 브랜치를 관리하고, 고급 Git 작업까지 에디터를 벗어나지 않고 수행할 수 있습니다.

> 스테이징, 커밋, 인라인 블레임은 VS Code 내장 소스 제어를 사용합니다. Git Graph+는 그 외 모든 것에 집중합니다.

![Git Graph+](resources/main.png)

---

## 주요 특징

- **인터랙티브 커밋 그래프** - 색상 구분 브랜치 레일과 머지 라인으로 히스토리를 한눈에
- **완전한 Git 워크플로우** - 브랜치, merge, rebase, cherry-pick, reset, stash, worktree, 태그, 리모트 작업
- **드래그 Rebase & Merge** - 한 브랜치를 다른 브랜치 위로 드래그하여 rebase 또는 merge - 명령어 없이
- **Interactive Rebase** - 드래그로 커밋 순서 변경, 커밋별 액션 제어 (pick, squash, fixup, drop 등)
- **Fixup & Squash 워크플로우** - 그래프에서 `fixup!`/`squash!` 커밋을 생성하고, interactive rebase의 autosquash 토글로 대상에 접어 넣기
- **충돌 예측 & 해결** - merge/rebase 실행 전에 충돌 파일을 미리 확인하고, VS Code 3-way 병합 편집기로 해결
- **내장 Diff 뷰어** - Shiki 기반 구문 강조, 이미지 diff (나란히 보기, 스와이프, 오니언 스킨)
- **마크다운 커밋 메시지** - 커밋 설명을 상세 패널에서 서식 있는 마크다운으로 렌더링, 마크다운/일반 텍스트 토글 제공
- **고급 Git 도구** - Git Flow, Bisect, LFS 파일 잠금, 서브모듈, 통계, dangling 커밋 복구가 포함된 Reflog

---

## 기능

### 커밋 그래프 & 히스토리

| 기능              | 설명                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **그래프 시각화** | 색상 구분 브랜치 레일과 머지 라인이 포함된 인터랙티브 커밋 그래프                         |
| **커밋 정렬**     | Fork와 같은 위상순 정렬로 명확한 브랜치 히스토리 표시                                     |
| **세 가지 뷰**    | **그래프**로 시각적 히스토리, **Reflog**로 git 참조 로그 탐색, **통계**로 분석            |
| **커밋 상세**     | 커밋 클릭으로 메타데이터, 변경 파일, 전체 diff를 크기 조절 가능한 하단 패널에서 확인      |
| **마크다운 메시지** | 마크다운이 포함된 커밋 메시지를 상세 패널에서 서식 렌더링, 마크다운/일반 텍스트 토글 제공 |
| **커밋 링크**     | 커밋 메시지의 이슈·PR·머지 리퀘스트 참조를 클릭 가능한 링크로 변환 - `origin`에서 GitHub/GitLab 자동 감지 및 사용자 정의 정규식 규칙 지원 |
| **커밋 비교**     | 기준 커밋 선택 후 다른 커밋 클릭으로 비교 - 여러 커밋을 선택해 합쳐진 변경 패널 토글, 또는 커밋과 작업 트리 비교 |
| **검색**          | 메시지, 작성자, 날짜 범위, 해시, 변경된 파일로 커밋 검색 - 결과 하이라이트 및 키보드 탐색 |
| **HEAD로 이동**   | 검색창 옆 버튼으로 현재 HEAD 커밋으로 스크롤 (화면 밖일 때 강조), 검색에서도 `HEAD` 키워드 매칭 |
| **키보드 탐색**   | 방향키로 그래프 선택 이동, Ctrl/Cmd로 첫 부모 또는 최신 자식으로 점프하며 돌아올 경로 기억 |
| **브랜치 필터**   | 선택한 브랜치에서 도달 가능한 커밋만 표시하도록 커밋 그래프 필터링                        |
| **미커밋 변경사항** | 미커밋 변경사항을 가상 노드로 표시합니다. 클릭 시 VS Code SCM 뷰를 열어 스테이징 및 커밋이 가능합니다. |
| **Push 상태**     | 로컬 전용 커밋은 파란 점 (push 안 됨), 리모트 전용 커밋은 회색 점 (리모트가 앞서감)       |
| **아바타**        | 작성자명 옆에 Gravatar 아바타 표시                                                        |
| **테마**          | 라이트, 다크, 고대비 VS Code 테마 완벽 지원                                               |

### 브랜치 & 태그 관리

<p>
  <img src="resources/interactively_rebase.png" width="49%" />
  <img src="resources/reset.png" width="49%" />
</p>

| 기능                     | 설명                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| **브랜치 작업**          | 브랜치 생성, 이름 변경, 삭제, checkout                                                  |
| **브랜치 툴바**          | Fork 스타일 split 버튼: 현재 브랜치를 기준으로 브랜치(또는 worktree) 생성, **Lean Sync** (현재 브랜치를 default 브랜치 위로 rebase), **Lean Finish** (default 브랜치에 merge), 중첩 Git Flow 메뉴 |
| **Amend**                | 그래프에서 클릭 한 번으로 마지막 커밋을 즉시 수정(amend)                                |
| **Merge**                | Default, `--no-ff`, `--ff-only`, squash merge 전략                                      |
| **Rebase**               | 일반 rebase 및 드래그로 순서 변경 가능한 interactive rebase UI                          |
| **Interactive Rebase**   | 액션 드롭다운 (pick, reword, edit, squash, fixup, drop), drop 경고, `fixup!`/`squash!` 커밋을 대상에 접어 넣는 autosquash 토글이 포함된 키보드 조작형 시각적 UI - 브랜치 또는 여러 커밋 선택에서 시작. 선택적 classic 모드는 통합 터미널에서 `git rebase -i` 실행 (`gitGraphPlus.interactiveRebase.mode`) |
| **드래그 Rebase/Merge**  | 그래프에서 한 브랜치를 다른 브랜치 위로 드래그하여 대상 위로 rebase하거나 대상에 merge  |
| **Squash Commits**       | 그래프에서 연속된 여러 커밋을 선택해 하나로 합치기                                      |
| **Fixup / Squash 커밋**  | 스테이징된 변경을 컨텍스트 메뉴에서 임의 커밋의 `fixup!` 또는 `squash!` 커밋으로 생성, autosquash 준비 |
| **Cherry-pick & Revert** | 특정 커밋 적용 또는 되돌리기 (한 개 또는 여러 개 동시 선택), `--no-commit` 옵션 포함     |
| **Reset**                | soft, mixed, hard 모드로 임의의 커밋으로 reset                                          |
| **태그**                 | 경량 또는 주석 태그 생성; 태그 상세 보기, 리모트에 push, 로컬/리모트 삭제               |
| **Upstream 추적**        | upstream 설정 기반 로컬/리모트 브랜치 자동 매칭                                         |

### 리모트 작업

| 기능                    | 설명                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| **Fetch / Pull / Push** | 리모트 선택 다이얼로그 및 진행 상태 알림 - 리모트가 하나뿐이면 fetch는 다이얼로그 생략 |
| **리모트 관리**         | 리모트 추가 및 제거                                                      |
| **강제 Push**           | `--force-with-lease` (안전) 또는 `--force` (강제) 모드, 시각적 경고 표시 |
| **자동 Fetch**          | 설정 가능한 주기적 fetch 간격 (1–60분)                                   |
| **리모트 Checkout**     | 로컬 트래킹 브랜치 생성 다이얼로그와 함께 리모트 브랜치 checkout         |
| **Pull 제안**           | 리모트보다 뒤처진 브랜치 checkout 시 자동 pull 제안                      |

### 충돌 해결

<p>
  <img src="resources/conflict_detect.png" width="49%" />
  <img src="resources/conflict.png" width="49%" />
</p>

| 기능                 | 설명                                                  |
| -------------------- | ----------------------------------------------------- |
| **충돌 예측**        | Merge, rebase 모달에서 hover 시 충돌 예상 파일을 작업 실행 전에 미리 표시 |
| **자동 감지**        | Merge, rebase, cherry-pick, revert 시 충돌 자동 감지  |
| **충돌 배너**        | 파일별 상태 표시와 함께 충돌 파일 목록 표시           |
| **에디터 연동**      | 충돌 파일 클릭으로 VS Code 3-way 병합 편집기에서 열기 |
| **해결 & 스테이징**  | 파일별 "해결 완료 표시" 및 자동 스테이징              |
| **Continue / Abort** | 원클릭으로 작업 계속 또는 중단                        |

### Diff 뷰어

![Diff Viewer](resources/diff.png)

| 기능                | 설명                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| **파일 트리**       | 상태 배지가 있는 계층적 파일 브라우저 (Added, Modified, Deleted, Renamed, Copied) |
| **구문 강조**       | Shiki 기반 - 에디터 수준의 정확한 구문 색상                                       |
| **이미지 Diff**     | 이미지 변경사항에 대한 나란히 보기 및 스와이프 비교                               |
| **Patch 내보내기**  | 임의의 커밋을 `.patch` 파일로 저장                                                |
| **에디터에서 열기** | diff 뷰어에서 파일 우클릭으로 파일 열기 또는 VS Code에서 변경사항 보기            |
| **파일 경로 액션**  | 파일 우클릭으로 OS 파일 탐색기에서 보기, 절대 경로 복사, 또는 저장소 기준 상대 경로 복사 |
| **변경 되돌리기**   | 커밋의 파일 전체, 단일 hunk, 또는 거터에서 선택한 줄을 작업 트리에 되돌리고, 선택한 줄을 복사 - diff에서 바로 |

### Stash & Worktree

| 기능                | 설명                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| **Stash**           | 저장, 적용, pop, 삭제, 이름 변경 - untracked 파일 및 keep-index 옵션 포함 |
| **그래프 내 Stash** | 커밋 그래프에 stash 항목이 배지로 표시되며 전용 컨텍스트 메뉴 제공        |
| **Worktree**        | 목록, 추가, 제거, 정리, 커밋 그래프 컨텍스트 메뉴에서 바로 생성, 새 창에서 열기 및 파일 탐색기에서 표시, 연결된 브랜치 정리 |

### 고급 도구

<p>
  <img src="resources/bisect.png" width="49%" />
  <img src="resources/gitflow.png" width="49%" />
</p>

![Reflog](resources/reflog.png)

| 기능           | 설명                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Git Flow**   | Feature, release, hotfix 브랜치 초기화 및 관리                                                                                          |
| **Git Bisect** | 시각적 bisect UI - 시작, good/bad 표시, reset                                                                                           |
| **Git LFS**    | LFS 추적 파일 목록 확인 및 파일 잠금 관리                                                                                               |
| **서브모듈**   | 상태 확인, 업데이트, 서브모듈 리포지토리로 그래프 전환                                                                                  |
| **통계**       | 작성자별 커밋 통계 (Gravatar 포함), 활동 히트맵                                                                                         |
| **Reflog**     | 시맨틱 컬러가 적용된 상세 액션(amend, squash 등)과 검색/액션 필터를 갖춘 git 참조 로그 탐색 — 과거 상태 복구 및 Dangling 커밋 감지 지원 |

### 멀티 리포지토리 & 서브모듈

- 워크스페이스 내 서브모듈 자동 탐색
- 툴바 드롭다운으로 리포지토리 전환

### 액티비티 바 사이드바

- **Branches**, **Remotes**, **Tags**, **Stashes**, **Worktrees** 트리 뷰
- 클릭으로 빠른 액션 메뉴, 우클릭으로 전체 컨텍스트 메뉴
- 브랜치 정렬: `main`/`master` 우선, 이후 알파벳순

### 다국어 지원

- 영어 (기본), 한국어, 중국어 간체
- `gitGraphPlus.locale` 설정으로 변경 가능
- Git 용어 (commit, merge, rebase, push, pull, fetch 등)는 번역하지 않음

---

## 시작하기

1. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=the0807.git-graph-plus)에서 설치
2. Git 리포지토리가 포함된 폴더 열기
3. Git Graph+ 열기:
   - **명령 팔레트** - `Git Graph+: Open`
   - **액티비티 바** - Git Graph+ 아이콘 클릭
   - **SCM 제목 표시줄**, **상태 표시줄** 또는 **에디터 제목 표시줄** - git-merge 아이콘 클릭

> [!Tip]
> 더 나은 사용 경험을 위해 아래 VS Code 설정을 활성화하는 것을 권장합니다.
> - `git.autofetch: true` - 모든 리모트에서 주기적으로 fetch하여 그래프를 최신 상태로 유지
> - `git.fetchPrune: true` - Fetch 시 삭제된 리모트 브랜치를 정리하여 그래프를 깔끔하게 유지

---

## 설정

| 설정                                   | 기본값        | 설명                                                  |
| -------------------------------------- | ------------- | ----------------------------------------------------- |
| `gitGraphPlus.autoRefresh`             | `true`        | 리포지토리 변경 감지 시 자동 새로고침                 |
| `gitGraphPlus.timeout`                 | `60`          | Git 명령 중단 전 최대 대기 시간 (초)                  |
| `gitGraphPlus.initialCommitCount`      | `200`         | 첫 렌더링/새로고침 시 로드할 커밋 수 (큰 리포지토리는 낮추면 빨라짐) |
| `gitGraphPlus.loadMoreCommitCount`     | `50`          | **Load more commits** 클릭당 추가로 가져올 커밋 수    |
| `gitGraphPlus.defaultCommitTab`        | `details`     | 커밋 클릭 시 기본으로 열 탭 (`details`, `changes`)    |
| `gitGraphPlus.locale`                  | `auto`        | UI 언어 (`auto`, `en`, `ko`, `zh-cn`)                 |
| `gitGraphPlus.graphSortOrder`          | `topological` | 커밋 정렬 순서 (`topological`, `date`, `author-date`) |
| `gitGraphPlus.interactiveRebase.mode`  | `ui`          | Interactive rebase 모드 (`ui` 시각적 편집기, `classic` 터미널에서 `git rebase -i`) |
| `gitGraphPlus.showSignatureStatus`     | `true`        | 그래프에 GPG/SSH 서명 상태 표시                       |
| `gitGraphPlus.commitMessageLinks`      | `[]`          | 커밋 메시지 텍스트를 클릭 가능한 링크로 만드는 사용자 정의 `{ pattern, url }` 정규식 규칙 |
| `gitGraphPlus.autoDetectRepoLinks`     | `true`        | `origin` 리모트 기반으로 `#123` 이슈(github.com/gitlab.com)와 `!123` GitLab MR 자동 링크 |
| `gitGraphPlus.branchBadgeBarThickness` | `thin`        | 브랜치 배지 색상 바 두께 (`thin`, `medium`, `thick`)  |
| `gitGraphPlus.branchColors`            | `[]`          | 이름 패턴별 고정 브랜치 색 (정규식 → hex)             |
| `gitGraphPlus.graphColors`             | 12색          | 그래프 레일에 자동 할당되는 색 팔레트 (hex 문자열)    |

### 작업 기본값

각 작업 대화상자의 기본 옵션을 `gitGraphPlus.defaults.*` 로 미리 설정할 수 있습니다 (VS Code 설정에서 변경):

| 작업            | 옵션 (`gitGraphPlus.defaults.` 하위)                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| Push            | `push.force`, `push.setUpstream`, `push.allTags`                                             |
| Pull            | `pull.rebase`, `pull.stash`                                                                  |
| Fetch           | `fetch.allRemotes`                                                                           |
| Merge           | `merge.mode`, `merge.pushAfter`, `merge.deleteSource`                                        |
| Rebase          | `rebase.autostash`, `rebase.pushAfter`                                                       |
| Amend           | `amend.keepMessage`, `amend.resetDate`, `amend.resetAuthor`, `amend.only`, `amend.pushAfter` |
| Checkout        | `checkout.dirty`, `checkoutRemote.dirty`                                                     |
| Create Branch   | `createBranch.checkout`, `createBranch.publish`                                              |
| Create Tag      | `createTag.push`                                                                             |
| Cherry-pick     | `cherryPick.noCommit`, `cherryPick.pushAfter`                                                |
| Revert          | `revert.noCommit`, `revert.pushAfter`                                                        |
| Reset           | `reset.mode`                                                                                 |
| Stash           | `stashSave.includeUntracked`, `stashSave.keepIndex`                                          |
| Delete Branch   | `deleteBranch.force`, `deleteBranch.deleteRemote`                                            |
| Delete Tag      | `deleteTag.deleteRemote`                                                                     |
| Remove Worktree | `removeWorktree.deleteBranch`                                                                |

---

## 요구 사항

- VS Code 1.85.0 이상
- Git이 설치되어 있고 PATH에서 사용 가능 (또는 `git.path` 설정으로 지정)

## 크레딧

- [Git Graph](https://github.com/mhutchie/vscode-git-graph), [Fork](https://git-fork.com/), [SourceGit](https://github.com/sourcegit-scm/sourcegit)의 UI/UX에서 아이디어를 얻었습니다
- 이 프로젝트는 [Git Graph](https://github.com/mhutchie/vscode-git-graph)의 코드를 사용하지 않으며, 모든 코드는 처음부터 새로 작성되었습니다
- 확장 아이콘: [VS Code Codicons](https://github.com/microsoft/vscode-codicons), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 라이선스

## 변경 이력

[CHANGELOG.md](CHANGELOG.md)에서 릴리스 히스토리를 확인할 수 있습니다.

## 라이선스

[Apache-2.0](LICENSE)
