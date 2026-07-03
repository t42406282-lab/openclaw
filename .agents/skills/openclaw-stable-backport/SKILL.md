---
name: openclaw-stable-backport
description: "Discover, assess, and prepare security and reliability backports for one OpenClaw stable release line. Use when preparing the next patch release from a stable/* branch, including direct commits and fixes without public PRs."
---

# OpenClaw Stable Backport

Prepare one stable patch release at a time. Commits are canonical; PRs, issues,
ClawSweeper reports, and advisories are supporting context only.

## Boundaries

- Require one explicit target `stable/*` branch. Run the skill separately for
  each of the two supported stable lines.
- Discover candidates before changing the target branch.
- Never push directly to a stable branch or merge automatically.
- Never backport features, broad refactors, speculative hardening, or changes
  that require new config, migrations, APIs, protocols, dependencies, runtime
  requirements, or operator action.
- Read `SECURITY.md` and use `$security-triage` for security candidates. For an
  unpublished advisory or fix not yet public on `main`, stop the public
  workflow and hand off to `$openclaw-ghsa-maintainer` or another explicitly
  approved private-fork process. Never push its diff or open a public PR before
  the security owner authorizes disclosure.
- Use `$openclaw-testing` for proof selection, `$autoreview` before handoff,
  and `$openclaw-pr-maintainer` for GitHub operations.

## Start

1. Run `git status -sb`. Do not overwrite unrelated work.
2. Fetch current refs and confirm the requested target exists remotely.
3. Identify the latest published tag reachable from the target branch and the
   mainline commit where this stable line began.
4. Confirm the target is an active supported line. If checked-in release
   metadata exists, treat it as authoritative; otherwise report the evidence
   used and require maintainer confirmation before mutation.

## Discover Candidates

Review the complete `main` commit history after the target branch diverged.
Do not limit discovery to PRs, conventional commit prefixes, changelog entries,
or GitHub labels.

Use both ancestry and patch-equivalence checks. Never continue with an empty
or guessed scan range:

```bash
if scan_start=$(git merge-base "origin/<stable-branch>" origin/main); then
  :
else
  echo "No merge base; resolve an explicit mainline scan start" >&2
  exit 1
fi
git log --reverse --stat "$scan_start..origin/main"
git cherry "origin/<stable-branch>" origin/main "$scan_start"
```

Some historical stable branches may have unrelated Git ancestry. In that case,
resolve `scan_start` from checked-in release metadata, the promotion/release
manifest, or a maintainer-provided mainline commit/tag. Record that source in
the release plan. If no auditable mainline start is available, stop rather than
guessing from dates, commit titles, or the current checkout.

Account for merges, squash commits, direct commits, reordered patches, and
stable-specific equivalents that `git cherry` may not recognize. Also inspect:

- direct security and maintainer commits;
- linked PRs or issues when they exist;
- ClawSweeper commit reports and findings when available;
- related follow-up commits required for the fix to be complete;
- current source, callers, siblings, tests, and dependency contracts.

Shortlist only material security or reliability fixes, such as crashes, hangs,
restart loops, data/session/message loss, auth/provider failures, serious
regressions in mature behavior, release/update/rollback failures, or bounded
resource-exhaustion fixes.

## Assess Each Candidate

For every plausible source commit, prove:

1. The faulty behavior exists on the target branch or shipped target tag.
2. For public fixes, the source commit is merged into `main` and is not already
   present or behaviorally equivalent on the target. Unpublished fixes remain
   in the approved private advisory workflow.
3. The change restores existing behavior rather than adding functionality.
4. The fix can be isolated with all required companion commits.
5. Stable-specific adaptation is narrow and preserves the same invariant.
6. Focused target-branch validation is possible.

Classify each candidate as:

- `backport`: applicable, material, isolated, and testable;
- `already-covered`: commit or equivalent behavior is present;
- `not-affected`: the target line does not contain the defect;
- `blocked`: useful fix, but adaptation or proof is unsafe or incomplete;
- `skip`: feature, low-impact change, refactor, or unsuitable stable change.

Do not infer that a clean cherry-pick is safe. Treat config/default, persisted
state, plugin/API boundary, protocol, dependency, packaging, installer, and
cross-repository changes as high risk requiring explicit maintainer judgment.

## Present the Release Plan

Before mutation, report:

| Source commit | Decision | Stable impact | Dependencies | Adaptation | Proof |
| ------------- | -------- | ------------- | ------------ | ---------- | ----- |

Include the target branch and tag, scan range, candidate ordering, excluded
high-risk changes, and unresolved gaps. Use PR links only when they exist;
always include the source commit identity internally.

Stop and obtain explicit maintainer approval for the proposed backport set.

## Prepare Approved Backports

1. Create a fresh branch/worktree from the current remote stable target.
2. Apply approved commits individually in dependency order, preserving source
   provenance. Never mix unrelated cleanup into conflict resolution.
3. After each application, inspect the complete diff against both the source
   commit and target branch. If adaptation becomes architectural, abort that
   candidate and report it as `blocked`.
4. Backport or add focused regression tests where practical.
5. Run the smallest target-branch proof that establishes the fixed behavior.
   Use Crabbox/Testbox for broad, release, package, cross-OS, or E2E proof.
6. Run `$autoreview` on the complete final branch until no accepted/actionable
   findings remain.
7. Use repository-native PR/release tooling. Never push the stable branch
   directly. For unpublished security work, do not push any public branch or
   PR; remain in the approved private advisory fork until disclosure is
   authorized. After disclosure, keep unnecessary private advisory details out
   of public branch names, commit messages, PR bodies, and comments.

## Handoff

Report:

- target stable branch and intended patch release;
- included source commits and optional PRs;
- skipped, blocked, and already-covered candidates;
- stable-specific adaptations;
- exact validation commands and run IDs;
- autoreview result;
- remaining security, release, or maintainer approvals;
- created PR URLs or the precise reason no PR was opened.
