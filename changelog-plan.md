# Per-Version Changelog Plan

## Context

`CHANGELOG.md` is currently cumulative and is shipped in the root `openclaw`
npm package. The current file is `2,399,938` bytes on disk, about `2.3 MiB`
unpacked. A dry-run npm pack reports the current package at `14,562,001` bytes
compressed and `63,664,564` bytes unpacked, with `CHANGELOG.md` included as a
top-level tarball file.

The latest complete release section is much smaller. The current `## 2026.5.28`
section is about `6,370` bytes. Moving `CHANGELOG.md` to a per-version file
would preserve package-visible release notes while removing roughly `2.39 MB`
from unpacked installs and roughly `0.8 MB` from the compressed package today,
based on standalone gzip size for the current cumulative file.

The recent changelog generation flow is not a GitHub Action that asks an agent
to write release notes. The repo-owned prompt is the agent skill at
`.agents/skills/openclaw-changelog-update/SKILL.md`. The release maintainer
workflow tells the operator/agent to run `/changelog` from
`.agents/skills/release-openclaw-maintainer/SKILL.md`. GitHub Actions then read
the already-committed `CHANGELOG.md` from the release SHA and extract the target
version section.

## Current Surfaces

- Package inclusion: `package.json` includes `"CHANGELOG.md"` in the root
  package `files` list.
- Changelog authoring prompt: `.agents/skills/openclaw-changelog-update/SKILL.md`
  tells the agent to rewrite the target `CHANGELOG.md` version section from
  history.
- Release runbook: `.agents/skills/release-openclaw-maintainer/SKILL.md` tells
  maintainers to run `/changelog` on `main`, commit the rewrite, then create the
  release branch.
- GitHub release notes: `.github/workflows/openclaw-release-publish.yml` runs
  `git show "${TARGET_SHA}:CHANGELOG.md"` and extracts `## YYYY.M.D` through
  the next level-2 heading.
- Mac appcast notes: `scripts/changelog-to-html.sh` finds `CHANGELOG.md` and
  extracts one version section for Sparkle release notes.
- Attribution check: `scripts/check-changelog-attributions.mjs` scans
  `CHANGELOG.md` for forbidden or missing `Thanks @...` attribution.
- Changed-lane routing: `scripts/changed-lanes.mjs` treats `CHANGELOG.md` as a
  docs/changelog surface and runs the attribution check.

## Recommendation

Keep shipping `CHANGELOG.md`, but make it a small current-release file:

```md
# Changelog

Docs: https://docs.openclaw.ai

## YYYY.M.D

### Highlights

...

### Changes

...

### Fixes

...
```

The latest package still contains useful release notes, GitHub release creation
continues to use the same version-section extraction, and future tarballs do not
accumulate every historical release.

Older history remains available through Git tags, GitHub Releases, and the docs
site if we choose to publish an archive page later. The npm package should not
be the historical archive.

## Implementation Plan

1. Update the changelog authoring prompt.

   In `.agents/skills/openclaw-changelog-update/SKILL.md`, change the workflow
   from "rewrite the target version section" to "rewrite `CHANGELOG.md` as
   the target version section only." Make the output contract explicit:

   - preserve the top title and docs link
   - do not keep `## Unreleased`; release notes are regenerated from history
   - write one stable-base `## YYYY.M.D` section
   - remove older `## YYYY.M.D` sections from the file
   - keep beta releases under the stable base heading
   - preserve PR refs, issue refs, and human thanks in the target section

2. Update the release maintainer runbook.

   In `.agents/skills/release-openclaw-maintainer/SKILL.md`, replace cumulative
   wording with per-version wording. The important edits are:

   - say the changelog file is current release notes only
   - keep the rule that GitHub release bodies use the full matching version
     section
   - stop saying "full changelog" when the intended source is only the latest
     release section
   - keep beta guidance unchanged: beta tags use the stable base version
     heading

3. Trim the current `CHANGELOG.md`.

   Keep:

   - `# Changelog`
   - docs link
   - latest release section, currently `## 2026.5.28`

   Remove older release sections from the working copy. This is a one-time size
   reduction, not a generated artifact update.

4. Keep `package.json` inclusion unchanged.

   Do not remove `"CHANGELOG.md"` from `package.json` for the per-version
   approach. Removing it would be the separate "do not ship changelog" option.

5. Adjust user-facing "full changelog" links.

   `scripts/changelog-to-html.sh` currently emits "View full changelog" links
   to `main/CHANGELOG.md`. After this change, that link should become either:

   - "View release notes" pointing to `main/CHANGELOG.md`, or
   - "View release history" pointing to a GitHub Releases page or future docs
     archive.

   The first option is the smallest code change. The second option is clearer if
   we want a durable history destination.

6. Add a small automated guard.

   Add a script or extend an existing changelog check so normal checks fail if
   `CHANGELOG.md` contains too many dated release sections. A simple contract is
   enough:

   - reject `## Unreleased`
   - allow at most one `## YYYY.M.D` section
   - allow no beta-specific dated headings

   Wire the guard into `check:changelog-attributions` or a nearby changelog
   check so future agent rewrites cannot silently return to cumulative history.

7. Update tests that assert current extraction behavior.

   `test/scripts/package-acceptance-workflow.test.ts` asserts the release
   workflow extracts `CHANGELOG.md` from `TARGET_SHA` and supports the
   `Unreleased` prerelease fallback. Those assertions should continue to pass.
   Add or update tests for the new guard if one is introduced.

## Compatibility And Release Effects

- GitHub release creation should continue to work because
  `.github/workflows/openclaw-release-publish.yml` already extracts one target
  section.
- Beta release notes should continue to work because the workflow maps
  `vYYYY.M.D-beta.N` to `YYYY.M.D` before extracting notes.
- Mac appcast notes should continue to work because `scripts/changelog-to-html.sh`
  already extracts one version section.
- Attribution checks should continue to work on the reduced file.
- The package tarball keeps a changelog file, but it stops growing with every
  release.

## Risks

- Historical release notes disappear from `main/CHANGELOG.md`. This is intended
  for npm package size, but maintainers should know to use Git tags or GitHub
  Releases for older notes.
- Existing "full changelog" wording becomes inaccurate unless links/text are
  adjusted.
- If the prompt is changed without an automated guard, future agent-generated
  changelog rewrites may accidentally reintroduce old sections.
- Release-bound notes must be regenerated from git history instead of accumulating
  under `Unreleased`.

## Validation

For the actual implementation PR, run:

```sh
git diff --check
node scripts/run-vitest.mjs test/scripts/check-changelog-attributions.test.ts
node scripts/run-vitest.mjs test/scripts/package-acceptance-workflow.test.ts
npm pack --dry-run --json --ignore-scripts
```

After `npm pack --dry-run`, verify:

- `CHANGELOG.md` is still present in the file list.
- `CHANGELOG.md` size is close to the current release section size, not the old
  cumulative size.
- package `size` and `unpackedSize` decrease by approximately the expected
  amount.

If a new guard script is added, include its focused test and confirm it runs
through the changed-lane path that currently covers changelog attribution.

## Optional Follow-Ups

- Publish historical changelog pages under docs or GitHub Releases if users need
  an easier archive than tags.
- Add a release script helper that extracts the current version section into a
  temporary file and uses that same output for GitHub release notes, appcast
  notes, and package changelog verification.
- Consider removing `CHANGELOG.md` from the tarball later if even per-version
  notes are not useful to installed-package users.
