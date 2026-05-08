---
name: rebase-ui-fork
description: Use when the upstream acp-ui repo has new changes to pull into the fork, or when the user wants to update the ACP UI submodule to the latest upstream
---

# Rebase UI Fork

Rebase the `mturley/acp-ui` fork onto the latest upstream `formulahendry/acp-ui`, resolve conflicts, and update the submodule reference in `acp-web-relay`.

## Prerequisites

- Working directory: `acp-web-relay` project root
- Submodule at `ui/acp-ui/` must be initialized (`git submodule update --init`)
- Remotes `origin` (fork) and `upstream` (formulahendry/acp-ui) must exist in the submodule

## Workflow

### Phase 1: Preparation

1. `cd ui/acp-ui`
2. Check for uncommitted changes — commit or stash them before proceeding
3. Fetch upstream: `git fetch upstream`
4. Show what's new: `git log --oneline HEAD..upstream/main` — share this with the user
5. If no new commits, stop here

### Phase 2: Rebase

1. `git rebase upstream/main`
2. If conflicts occur:
   - Read `FORK_CHANGES.md` to understand which files have fork-specific changes
   - For each conflict, determine whether to keep the fork's version, take upstream's version, or merge both
   - Fork changes are documented per-file in `FORK_CHANGES.md` — use this to make informed decisions
   - After resolving each file: `git add <file>`
   - Continue: `git rebase --continue`
   - Repeat until rebase is complete
3. If rebase becomes too complex, ask the user before `git rebase --abort`

### Phase 3: Audit for Fork Intent

After rebasing, verify the fork's modifications still hold. Read `FORK_CHANGES.md` for the full list of intentional changes, then check each category:

1. **Telemetry removal:** Grep for telemetry imports and calls that upstream may have added in new code:
   - `grep -r "applicationinsights\|initTelemetry\|trackEvent\|trackError\|trackPageView\|trackMetric" --include="*.ts" --include="*.vue" src/`
   - Any hits outside `src/lib/telemetry.ts` (the no-op stub file) indicate new telemetry calls that need to be removed
   - Check `package.json` for re-added `@microsoft/applicationinsights-web` dependency
2. **Other fork changes:** Review the categories in `FORK_CHANGES.md` and verify upstream hasn't introduced code that conflicts with the fork's intent (e.g. new sidebar behavior that bypasses `sidebarHidden`, new permission dialog logic that doesn't account for external resolution)

If any fixes are needed, commit them as new commits on top of the rebase.

### Phase 4: Build Verification

1. Run `npm install` in `ui/acp-ui/` (upstream may have changed dependencies)
2. Run `npm run build` in `ui/acp-ui/` to verify the fork builds cleanly
3. If build fails, fix issues and commit the fixes

### Phase 5: Update FORK_CHANGES.md

If the rebase required conflict resolution or if upstream changes affected fork-modified files:
- Update `FORK_CHANGES.md` to reflect any changes to how fork modifications interact with the new upstream code
- Note if any fork changes were absorbed upstream (and can be removed from the fork)

### Phase 6: Push Fork and Update Submodule

1. Ask the user before force-pushing the fork: `git push origin main --force-with-lease` (in `ui/acp-ui/`)
2. `cd ../..` (back to acp-web-relay root)
3. Verify the submodule ref changed: `git diff -- ui/acp-ui`
4. Ask the user before committing the submodule update in the parent repo
5. Push the parent repo: `git push origin main` (in `acp-web-relay` root)

## Conflict Resolution

Read `FORK_CHANGES.md` in the submodule root. It lists every modified file, what the fork changed, conflict likelihood, and the resolution strategy for each file. Use it as your guide when resolving rebase conflicts.
