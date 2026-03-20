export const ko: Record<string, string> = {
  // Toolbar
  'toolbar.history': '히스토리',
  'toolbar.log': '로그',
  'toolbar.stats': '통계',
  'toolbar.fetch': 'Fetch',
  'toolbar.pull': 'Pull',
  'toolbar.push': 'Push',
  'toolbar.refresh': '새로고침',
  'toolbar.stashDesc': 'Stash (커밋되지 않은 변경 사항 저장)',
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
  'renameBranch.desc': '브랜치 {name} 이름 변경',
  'renameBranch.newName': '새 이름',
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
  'graph.comparingFrom': '비교할 commit을 클릭하세요',
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
  'graph.rename': '브랜치 이름 변경',
  'graph.deleteBranch': '브랜치 삭제',
  'graph.deleteRemoteBranch': '리모트 브랜치 삭제',
  'graph.removeWorktree': 'Worktree 삭제',

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
  'rebase.title': 'Interactive Rebase',
  'rebase.loading': 'Commit 로딩 중',
  'rebase.noCommits': 'Rebase할 commit이 없습니다',
  'rebase.instructions': '드래그 또는 화살표로 순서 변경. 액션을 클릭하여 변경.',
  'rebase.start': 'Rebase 시작',
  'rebase.dropWarning': '{count}개 commit이 삭제됩니다.',
  'rebase.action.pick': '그대로 적용',
  'rebase.action.reword': '메시지만 변경',
  'rebase.action.edit': '멈추고 수정',
  'rebase.action.squash': '이전 커밋에 합침',
  'rebase.action.fixup': '합치고 메시지 제거',
  'rebase.action.drop': '커밋 제거',

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
  'activityLog.showAll': '전체',
  'activityLog.refresh': '새로고침',
  'activityLog.empty': '실행된 명령이 없습니다',

  // Stats
  'stats.contributors': '기여자 ({count})',
  'stats.commitsByDayHour': '요일 및 시간별 Commit ({count}개 총)',
  'stats.loading': '통계 로딩 중',
  'stats.less': '적음',
  'stats.more': '많음',

  // Checkout remote branch modal
  'checkoutRemote.title': '리모트 브랜치 Checkout',
  'checkoutRemote.desc': '"{remote}"을(를) 추적하는 로컬 브랜치를 생성하고 전환합니다.',
  'checkoutRemote.remote': '리모트',
  'checkoutRemote.localName': '로컬 브랜치',
  'checkoutRemote.checkout': 'Checkout',

  // Checkout commit modal
  'checkoutCommit.title': 'Checkout',
  'checkoutCommit.desc': 'Commit checkout',
  'checkoutCommit.branchDesc': '이 브랜치로 전환합니다.',
  'checkoutCommit.checkout': 'Checkout',
  'checkoutCommit.checkoutBranch': '{name} Checkout',
  'checkoutCommit.checkoutRemote': '{name} Checkout',
  'checkoutCommit.detachedWarning': '이 커밋에 브랜치가 없습니다. Detached HEAD 상태가 됩니다.',

  // Checkout and Fast-Forward modal
  'fastForward.title': 'Checkout and Fast-Forward',
  'fastForward.desc': '로컬 브랜치로 전환하고 리모트 브랜치로 fast-forward 합니다.',
  'fastForward.switchTo': 'Switch to:',
  'fastForward.fastForwardTo': 'Fast-Forward to:',

  // Checkout branch modal (pull after checkout)
  'checkoutBranch.title': '브랜치 Checkout',
  'checkoutBranch.desc': '이 브랜치는 리모트보다 {count}개의 commit이 뒤처져 있습니다. Checkout 후 pull 하시겠습니까?',
  'checkoutBranch.behind': '{count} 뒤처짐',
  'checkoutBranch.checkoutOnly': 'Checkout만',
  'checkoutBranch.checkoutAndPull': 'Checkout & Pull',

  // Fetch modal
  'fetch.title': 'Fetch',
  'fetch.desc': '리모트 저장소에서 최신 변경 사항을 가져옵니다.',
  'fetch.remote': '리모트',
  'fetch.allRemotes': '모든 리모트',
  'fetch.prune': '삭제된 리모트 브랜치 정리 (--prune)',
  'fetch.fetch': 'Fetch',

  // Push modal (inline)
  'push.desc': '로컬 commit을 리모트 저장소에 push합니다.',
  'push.forcePushOption': 'Force push (--force-with-lease)',

  // Pull modal
  'pull.title': 'Pull',
  'pull.desc': '리모트 저장소에서 변경 사항을 pull합니다.',
  'pull.rebase': 'Merge 대신 rebase',
  'pull.stash': '로컬 변경 사항을 stash 후 재적용',
  'pull.pull': 'Pull',

  // Cherry-pick modal
  'cherryPick.title': 'Commit Cherry-pick',
  'cherryPick.desc': '선택한 commit을 현재 브랜치에 적용합니다.',
  'cherryPick.noCommit': 'Commit 없이 변경 사항만 적용 (--no-commit)',
  'cherryPick.cherryPick': 'Cherry-pick',

  // Revert modal
  'revert.title': 'Commit Revert',
  'revert.desc': '선택한 commit의 변경 사항을 되돌리는 새 commit을 생성합니다.',
  'revert.noCommit': 'Commit 없이 변경 사항만 적용 (--no-commit)',
  'revert.revert': 'Revert',

  // Merge modal
  'merge.title': 'Merge Branch',
  'merge.desc': '선택한 브랜치를 현재 브랜치에 merge합니다.',
  'merge.mergeType': 'Merge 유형:',
  'merge.default': '기본 — 가능하면 fast-forward',
  'merge.noFf': 'No Fast-forward — 항상 merge commit 생성',
  'merge.ffOnly': 'Fast-forward Only — 불가능하면 실패',
  'merge.squash': 'Squash — 모든 commit을 하나로 합침',
  'merge.squashWarning': '원본 commit이 히스토리에 보존되지 않습니다.',
  'merge.merge': 'Merge',

  // Rebase modal
  'rebaseBranch.title': 'Rebase Branch',
  'rebaseBranch.desc': '현재 브랜치를 선택한 브랜치 위에 rebase합니다. Commit 히스토리가 재작성됩니다.',
  'rebaseBranch.rebase': 'Rebase',
  'rebase.autostash': 'Rebase 전 자동 stash (--autostash)',

  // Reset modal
  'reset.modalTitle': '브랜치를 리비전으로 Reset',
  'reset.desc': '브랜치 헤드를 선택한 리비전으로 이동합니다.',
  'reset.branch': '브랜치:',
  'reset.moveTo': '이동 대상:',
  'reset.resetType': 'Reset 유형:',
  'reset.softOption': 'Soft — 모든 변경 사항을 staged 상태로 유지',
  'reset.mixedOption': 'Mixed — 모든 변경 사항을 unstaged 상태로 유지',
  'reset.hardOption': 'Hard — 모든 변경 사항 삭제',
  'reset.hardWarning': '커밋되지 않은 모든 변경 사항이 영구적으로 손실됩니다.',
  'reset.resetBtn': 'Reset',

  // Common labels
  'common.commit': '커밋:',
  'common.onto': '대상:',
  'common.branch': '브랜치:',
  'common.options': '옵션:',

  // Delete branch confirmation
  'deleteBranch.title': '브랜치 삭제',
  'deleteBranch.confirm': '브랜치 "{name}"을(를) 삭제하시겠습니까?',
  'deleteBranch.force': 'Merge되지 않은 브랜치도 강제 삭제 (-D)',
  'deleteBranch.deleteRemote': '리모트 브랜치도 함께 삭제',
  'deleteBranch.worktreeWarning': '연결된 worktree "{name}"도 함께 삭제됩니다.',

  // Delete tag confirmation
  'deleteTag.title': '태그 삭제',
  'deleteTag.confirm': '태그 "{name}"을(를) 삭제하시겠습니까?',
  'deleteTag.deleteRemote': '리모트에서도 삭제',

  // Delete remote tag confirmation
  'deleteRemoteTag.title': '리모트 태그 삭제',
  'deleteRemoteTag.confirm': '리모트에서 태그 "{name}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',

  // Delete remote branch
  'deleteRemoteBranch.title': '리모트 브랜치 삭제',
  'deleteRemoteBranch.confirm': '리모트에서 브랜치 {name}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',

  // Stash drop confirmation
  'stashDrop.title': 'Stash 삭제',
  'stashDrop.confirm': 'Stash "{message}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',

  // Stash pop confirmation
  'stashPop.title': 'Stash Pop',
  'stashPop.confirm': 'Stash "{message}"을(를) 적용하고 삭제하시겠습니까? 적용 후 stash 항목이 삭제됩니다.',
  'stashPop.pop': 'Pop',

  // Stash save modal
  'stashSave.title': '변경사항 Stash',
  'stashSave.message': '메시지 (선택)',
  'stashSave.placeholder': 'Stash 메시지',
  'stashSave.save': 'Stash',

  // Worktree modals
  'worktree.addTitle': 'Worktree 추가',
  'worktree.startAt': '시작점:',
  'worktree.branchName': '브랜치 이름:',
  'worktree.branchPlaceholder': '브랜치 이름 입력',
  'worktree.location': '위치:',
  'worktree.add': 'Worktree 추가',
  'worktree.removeTitle': 'Worktree 삭제',
  'worktree.removeConfirm': '"{path}"의 worktree를 삭제하시겠습니까?',
  'worktree.deleteBranch': '연결된 브랜치 "{name}"도 함께 삭제',

  // Conflict resolution
  'conflict.abortTitle': '작업 중단',
  'conflict.abortConfirm': '현재 {operation} 작업을 중단하시겠습니까? 작업이 중단되고 변경사항이 되돌려집니다.',
  'conflict.abort': '중단',
  'conflict.resolveSuccess': '{operation} 작업이 완료되었습니다.',

  // Common
  'common.cancel': '취소',
  'common.close': '닫기',
  'common.dismiss': '닫기',

  // Repo selector
  'repo.switchRepo': '리포지토리 전환',
};
