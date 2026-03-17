export const ko: Record<string, string> = {
  // Toolbar
  'toolbar.history': '히스토리',
  'toolbar.log': '로그',
  'toolbar.stats': '통계',
  'toolbar.fetch': 'Fetch',
  'toolbar.pull': 'Pull',
  'toolbar.push': 'Push',
  'toolbar.refresh': '새로고침',
  'toolbar.fetchAll': 'Fetch All (원격 변경 사항 다운로드)',
  'toolbar.pullDesc': 'Pull (fetch + merge)',
  'toolbar.pushDesc': 'Push (로컬 commit 업로드)',
  'toolbar.refreshDesc': '새로고침 (Ctrl+R)',

  // Push modal
  'push.title': 'Push',
  'push.confirm': '{branch}을(를) 리모트에 push 하시겠습니까?',
  'push.forcePush': 'Force push (--force-with-lease)',
  'push.forceWarning': 'Force push는 원격 변경 사항을 덮어쓸 수 있습니다. 주의해서 사용하세요.',
  'push.cancel': '취소',
  'push.push': 'Push',
  'push.forcePushBtn': 'Force Push',

  // Sidebar sections
  'sidebar.local': '로컬',
  'sidebar.remotes': 'Remotes',
  'sidebar.tags': 'Tags',
  'sidebar.stashes': 'Stashes',
  'sidebar.worktrees': 'Worktrees',

  // Sidebar context menu
  'sidebar.checkout': 'Checkout',
  'sidebar.mergeInto': '현재 브랜치에 merge',
  'sidebar.rebaseOnto': '이 브랜치 위에 현재 브랜치를 rebase',
  'sidebar.rename': '이름 변경',
  'sidebar.delete': '삭제',
  'sidebar.fetchRemote': '{name} fetch',
  'sidebar.removeRemote': '{name} 제거',
  'sidebar.apply': '적용',
  'sidebar.pop': '팝 (적용 후 삭제)',
  'sidebar.drop': '삭제',
  'sidebar.deleteTag': '태그 삭제',
  'sidebar.pushTag': '리모트에 Push',
  'sidebar.pushAllTags': '모든 태그 Push',
  'sidebar.deleteRemoteTag': '리모트에서 삭제',

  // Create branch modal
  'createBranch.title': '브랜치 생성',
  'createBranch.desc': '새 브랜치 생성',
  'createBranch.createAt': '브랜치 생성 위치:',
  'createBranch.name': '브랜치 이름:',
  'createBranch.namePlaceholder': '브랜치 이름 입력',
  'createBranch.startPoint': '시작 지점 (선택 사항)',
  'createBranch.checkout': '생성 후 checkout',
  'createBranch.create': '생성',
  'createBranch.createAndCheckout': '생성 및 Checkout',

  // Rename branch modal
  'renameBranch.title': '브랜치 이름 변경',
  'renameBranch.newName': '"{name}"의 새 이름',
  'renameBranch.rename': '이름 변경',

  // Add remote modal
  'addRemote.title': '리모트 추가',
  'addRemote.name': '이름',
  'addRemote.url': 'URL',
  'addRemote.add': '추가',

  // Stash modal
  'stash.title': '변경 사항 Stash',
  'stash.message': '메시지 (선택 사항)',
  'stash.includeUntracked': '추적되지 않는 파일 포함',
  'stash.keepIndex': 'Staged 변경 사항 유지 (--keep-index)',
  'stash.stash': 'Stash',

  // Create tag modal
  'createTag.title': '태그 생성',
  'createTag.desc': 'Annotated 태그 생성',
  'createTag.createAt': '태그 생성 위치:',
  'createTag.name': '태그 이름:',
  'createTag.namePlaceholder': '태그 이름 입력',
  'createTag.message': '메시지:',
  'createTag.messagePlaceholder': '선택 사항',
  'createTag.target': '대상 (선택 사항, 기본값 HEAD)',
  'createTag.pushToRemotes': '모든 remote에 push',
  'createTag.create': '생성',
  'createTag.createAndPush': '생성 및 Push',

  // Graph
  'graph.loading': 'Commit 로딩 중',
  'graph.noCommits': 'Commit을 찾을 수 없습니다',
  'graph.noResults': '일치하는 commit이 없습니다',
  'graph.searchResults': '검색 결과 {count}개{plural}',
  'graph.description': '설명',
  'graph.author': '작성자',
  'graph.date': '날짜',
  'graph.sha': 'SHA',

  // Graph context menu
  'graph.checkoutHash': '{hash} checkout',
  'graph.createBranchHere': '여기에 브랜치 생성',
  'graph.cherryPick': 'Cherry-pick',
  'graph.revert': 'Revert',
  'graph.interactiveRebase': '여기서부터 Interactive Rebase',
  'graph.resetToHere': '현재 브랜치를 여기로 reset',
  'graph.compareWith': '{hash}와 비교',
  'graph.cancelCompare': '비교 취소',
  'graph.selectForCompare': '비교 대상 선택',
  'graph.comparingFrom': '{hash}에서 비교 중 — 다른 commit을 우클릭하세요',
  'graph.newTag': '새 태그 생성',
  'graph.mergeInto': "'{branch}'에 merge",
  'graph.rebaseTo': "'{branch}'을(를) 여기로 rebase",
  'graph.interactiveRebaseTo': "'{branch}'을(를) 여기로 Interactive Rebase",
  'graph.resetBranchToHere': "'{branch}'을(를) 여기로 reset",
  'graph.checkoutCommit': 'Commit Checkout',
  'graph.cherryPickCommit': 'Commit Cherry-pick',
  'graph.revertCommit': 'Commit Revert',
  'graph.savePatch': '패치로 저장',
  'graph.compareToLocal': '로컬 변경사항과 비교',
  'graph.copySHA': 'Commit SHA 복사',
  'graph.copyBranchName': '브랜치 이름 복사',
  'graph.copyTagName': '태그 이름 복사',
  'graph.deleteTag': '태그 삭제',
  'graph.rename': '이름 변경',
  'graph.deleteBranch': '삭제',

  // Reset modal
  'reset.title': '{hash}(으)로 Reset',
  'reset.confirm': '현재 브랜치를 {hash}(으)로 reset',
  'reset.soft': 'Soft',
  'reset.softDesc': '모든 변경 사항을 staged 상태로 유지',
  'reset.mixed': 'Mixed',
  'reset.mixedDesc': '변경 사항 유지하되 unstaged',
  'reset.hard': 'Hard',
  'reset.hardDesc': '모든 변경 사항 삭제',
  'reset.reset': 'Reset {mode}',

  // Interactive rebase
  'rebase.title': '{base} 위에 Interactive Rebase',
  'rebase.loading': 'Commit 로딩 중',
  'rebase.noCommits': 'Rebase할 commit이 없습니다',
  'rebase.instructions': '드래그하여 순서 변경. 클릭하여 액션 전환: pick \u2192 squash \u2192 fixup \u2192 reword \u2192 edit \u2192 drop.',
  'rebase.start': 'Rebase 시작',

  // Commit details
  'details.commit': 'Commit',
  'details.author': '작성자',
  'details.date': '날짜',
  'details.parents': '부모',
  'details.refs': '참조',
  'details.changes': '변경 사항',
  'details.browseFiles': '파일 탐색',
  'details.inline': '인라인',
  'details.sideBySide': '나란히 보기',
  'details.binaryFile': '바이너리 파일',
  'details.selectCommit': '커밋을 선택하여 상세 정보 보기',

  // Search bar
  'search.placeholder': 'Commit 검색 (메시지, 해시)',
  'search.search': '검색',
  'search.clear': '지우기',
  'search.filters': '필터',
  'search.authorFilter': '작성자 필터',

  // Activity log
  'activityLog.title': '활동 로그',
  'activityLog.auto': '자동',
  'activityLog.refresh': '새로고침',
  'activityLog.empty': '실행된 명령이 없습니다',

  // Stats
  'stats.contributors': '기여자 ({count})',
  'stats.commitsByDayHour': '요일 및 시간별 Commit ({count}개 총)',
  'stats.loading': '통계 로딩 중',

  // Checkout remote branch modal
  'checkoutRemote.title': '리모트 브랜치 Checkout',
  'checkoutRemote.desc': '"{remote}"을(를) 추적하는 로컬 브랜치를 생성하고 전환합니다.',
  'checkoutRemote.remote': '리모트',
  'checkoutRemote.localName': '로컬 브랜치',
  'checkoutRemote.checkout': 'Checkout',

  // Checkout commit modal
  'checkoutCommit.title': 'Commit Checkout',
  'checkoutCommit.desc': 'commit {hash}을(를) detached HEAD 상태로 checkout합니다. 어떤 브랜치에도 속하지 않게 됩니다.',

  // Fetch modal
  'fetch.desc': '리모트 저장소에서 최신 변경 사항을 가져옵니다.',
  'fetch.allRemotes': '모든 리모트',
  'fetch.prune': '삭제된 리모트 브랜치 정리 (--prune)',

  // Cherry-pick modal
  'cherryPick.noCommit': 'Commit 없이 변경 사항만 적용 (--no-commit)',

  // Revert modal
  'revert.noCommit': 'Commit 없이 변경 사항만 적용 (--no-commit)',

  // Rebase modal
  'rebase.autostash': 'Rebase 전 자동 stash (--autostash)',

  // Delete branch confirmation
  'deleteBranch.title': '브랜치 삭제',
  'deleteBranch.confirm': '브랜치 "{name}"을(를) 삭제하시겠습니까?',
  'deleteBranch.force': 'Merge되지 않은 브랜치도 강제 삭제 (-D)',

  // Delete tag confirmation
  'deleteTag.title': '태그 삭제',
  'deleteTag.confirm': '태그 "{name}"을(를) 삭제하시겠습니까?',

  // Delete remote tag confirmation
  'deleteRemoteTag.title': '리모트 태그 삭제',
  'deleteRemoteTag.confirm': '리모트에서 태그 "{name}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',

  // Stash drop confirmation
  'stashDrop.title': 'Stash 삭제',
  'stashDrop.confirm': 'Stash "{message}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',

  // Common
  'common.cancel': '취소',
  'common.close': '닫기',
  'common.dismiss': '닫기',

  // Repo selector
  'repo.switchRepo': '리포지토리 전환',
};
