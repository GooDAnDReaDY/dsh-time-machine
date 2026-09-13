# Plan: Rich Rollback, Staging Safety, Visual Diff & Pre-Tool Checkpoints (#36, #35)

## Status
- Branch: feat/rich-rollback-safety
- Issues: #36 (feat), #35 (bug)
- State: In-Progress

## Tasks
1. [ ] Core engine enhancements in lib/snapshot.js
   - [ ] Fix issue #35: options object in cleanupOrphanedIndices
   - [ ] Add staging safety guard (capture stagedTreeHash)
   - [ ] Add selective file rollback (rollbackFile)
   - [ ] Add diff file parsing (diffFiles / diff structured summary)
2. [ ] Host wiring and tools in lib/index.js
   - [ ] Pre-tool automatic checkpoints (command, bash, patch)
   - [ ] Register time_machine_file_rollback tool
   - [ ] Add /dsh-time-machine/rollback-file endpoint with CSRF protection
3. [ ] Client UI improvements in lib/client.js
   - [ ] Remove hardcoded ru locale dictionary from bundle (en + zh only)
   - [ ] Add new localization keys (en + zh)
   - [ ] File-by-file explorer and "Restore File" action in Diff Modal
4. [ ] Automated Tests
   - [ ] Add unit tests for all new functions
   - [ ] Verify test suite passes 100%
5. [ ] Russian localization dispatch
   - [ ] Create issue in goodandready/dsh-russian-lang with new string keys
6. [ ] Documentation update
   - [ ] Update docs/design/DESIGN.md
   - [ ] Update README.md, README.zh.md, README.ru.md
   - [ ] Bump version to 0.1.15 in package.json
7. [ ] MiniPC test server verification
   - [ ] Build .tgz, install on MiniPC 192.168.1.123
   - [ ] Verify clean boot, UI, logs, cleanup
8. [ ] Merge PR, Release and Production Deploy
   - [ ] PR in Gitea, squash-merge
   - [ ] Tag v0.1.15, GitHub Release, npm publish
   - [ ] Deploy to MiniAI 192.168.1.111 web profile
   - [ ] Close issues #35 and #36
