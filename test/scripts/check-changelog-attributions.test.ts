import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findChangelogShapeViolations,
  findForbiddenChangelogThanks,
  isForbiddenChangelogThanksHandle,
  requiresExplicitHumanChangelogThanks,
} from "../../scripts/check-changelog-attributions.mjs";

const changelogScriptPath = path.join(process.cwd(), "scripts", "pr-lib", "changelog.sh");

function run(cwd: string, command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  }).trim();
}

function createRepoWithPrChangelogDiff(entry: string): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), "openclaw-changelog-credit-"));
  run(repo, "git", ["init", "-q", "--initial-branch=main"]);
  run(repo, "git", ["config", "user.email", "test@example.com"]);
  run(repo, "git", ["config", "user.name", "Test User"]);
  const baseChangelog = [
    "# Changelog",
    "",
    "Docs: https://docs.openclaw.ai",
    "",
    "## Unreleased",
    "",
    "### Fixes",
    "",
    "## 2026.5.28",
    "",
    "### Highlights",
    "",
    "- Existing highlight.",
    "",
    "### Changes",
    "",
    "- Existing change.",
    "",
    "### Fixes",
    "",
    "- Existing fix.",
    "",
  ].join("\n");
  writeFileSync(repo + "/CHANGELOG.md", baseChangelog, "utf8");
  run(repo, "git", ["add", "CHANGELOG.md"]);
  run(repo, "git", ["commit", "-qm", "seed"]);
  const baseSha = run(repo, "git", ["rev-parse", "HEAD"]);
  // validate_changelog_entry_for_pr reads origin/main...HEAD, so the test
  // fixture needs a real base ref plus a feature-branch changelog diff.
  run(repo, "git", ["update-ref", "refs/remotes/origin/main", baseSha]);
  run(repo, "git", ["checkout", "-qb", "feature"]);
  writeFileSync(
    repo + "/CHANGELOG.md",
    baseChangelog.replace("### Fixes\n\n## 2026.5.28", `### Fixes\n\n${entry}\n\n## 2026.5.28`),
    "utf8",
  );
  run(repo, "git", ["add", "CHANGELOG.md"]);
  run(repo, "git", ["commit", "-qm", "add changelog entry"]);
  return repo;
}

function validateChangelogEntry(repo: string, contrib: string): string {
  return run(
    repo,
    "bash",
    [
      "-c",
      'source "$OPENCLAW_PR_CHANGELOG_SH"; validate_changelog_entry_for_pr 123 "$OPENCLAW_TEST_CONTRIB"',
    ],
    {
      OPENCLAW_PR_CHANGELOG_SH: changelogScriptPath,
      OPENCLAW_TEST_CONTRIB: contrib,
    },
  );
}

describe("check-changelog-attributions", () => {
  it("flags forbidden bot, org, and maintainer thanks attributions", () => {
    const content = [
      "- Internal cleanup. Thanks @codex.",
      "- Org-owned fix. Thanks @openclaw.",
      "- Maintainer-owned fix. Thanks @steipete.",
      "- Mixed credit. Thanks @contributor and @OpenClaw.",
      "- Bot repair. Thanks @clawsweeper[bot].",
      "- Dependency bump. Thanks @dependabot[bot].",
      "- App repair. Thanks @app/clawsweeper.",
    ].join("\n");

    expect(findForbiddenChangelogThanks(content)).toEqual([
      { line: 1, handle: "codex", text: "- Internal cleanup. Thanks @codex." },
      { line: 2, handle: "openclaw", text: "- Org-owned fix. Thanks @openclaw." },
      { line: 3, handle: "steipete", text: "- Maintainer-owned fix. Thanks @steipete." },
      { line: 4, handle: "openclaw", text: "- Mixed credit. Thanks @contributor and @OpenClaw." },
      { line: 5, handle: "clawsweeper[bot]", text: "- Bot repair. Thanks @clawsweeper[bot]." },
      { line: 6, handle: "dependabot[bot]", text: "- Dependency bump. Thanks @dependabot[bot]." },
      { line: 7, handle: "app/clawsweeper", text: "- App repair. Thanks @app/clawsweeper." },
    ]);
  });

  it("allows external contributor thanks attributions", () => {
    expect(
      findForbiddenChangelogThanks(
        "- User-facing fix. Fixes #123. Thanks @external-contributor and @other-user.",
      ),
    ).toStrictEqual([]);
  });

  it("allows one stable-base version section without Unreleased", () => {
    const content = [
      "# Changelog",
      "",
      "Docs: https://docs.openclaw.ai",
      "",
      "## 2026.5.28",
      "",
      "### Highlights",
      "",
      "- Released highlight.",
      "",
      "### Changes",
      "",
      "- Released change.",
      "",
      "### Fixes",
      "",
      "- Released fix.",
    ].join("\n");

    expect(findChangelogShapeViolations(content)).toStrictEqual([]);
  });

  it("rejects Unreleased sections", () => {
    const content = [
      "# Changelog",
      "",
      "Docs: https://docs.openclaw.ai",
      "",
      "## Unreleased",
      "",
      "### Fixes",
      "",
      "- Pending fix.",
      "",
      "## 2026.5.28",
      "",
      "### Highlights",
      "",
      "- Released highlight.",
      "",
      "### Changes",
      "",
      "- Released change.",
      "",
      "### Fixes",
      "",
      "- Released fix.",
    ].join("\n");

    expect(findChangelogShapeViolations(content)).toStrictEqual([
      {
        line: 5,
        text: "## Unreleased",
        reason: "CHANGELOG.md must not contain ## Unreleased; release notes are regenerated from history.",
      },
    ]);
  });

  it("rejects cumulative and prerelease-specific changelog sections", () => {
    const content = [
      "# Changelog",
      "",
      "Docs: https://docs.openclaw.ai",
      "",
      "## 2026.5.28",
      "",
      "### Highlights",
      "",
      "- Released highlight.",
      "",
      "### Changes",
      "",
      "- Released change.",
      "",
      "### Fixes",
      "",
      "- Released fix.",
      "",
      "## 2026.5.28-beta.1",
      "",
      "## 2026.5.27",
    ].join("\n");

    expect(findChangelogShapeViolations(content)).toStrictEqual([
      {
        line: 19,
        text: "## 2026.5.28-beta.1",
        reason: "Prerelease changelog heading 2026.5.28-beta.1 must use the stable base version heading.",
      },
      {
        line: 21,
        text: "## 2026.5.27",
        reason: "CHANGELOG.md may contain at most one dated release section; found extra section 2026.5.27.",
      },
    ]);
  });

  it("requires the per-version changelog title, docs link, and release subsections", () => {
    const content = [
      "# Release Notes",
      "",
      "## 2026.5.28",
      "",
      "### Changes",
      "",
      "- Released change.",
      "",
      "### Fixes",
      "",
      "- Released fix.",
    ].join("\n");

    expect(findChangelogShapeViolations(content)).toStrictEqual([
      {
        line: 1,
        text: "# Release Notes",
        reason: "CHANGELOG.md must start with # Changelog.",
      },
      {
        line: 1,
        text: "",
        reason: "CHANGELOG.md must keep the docs link: Docs: https://docs.openclaw.ai.",
      },
      {
        line: 3,
        text: "## 2026.5.28",
        reason: "Current release section must contain ### Highlights.",
      },
    ]);
  });

  it("keeps the release changelog skill on the per-version output contract", () => {
    const changelogSkill = readFileSync(
      ".agents/skills/openclaw-changelog-update/SKILL.md",
      "utf8",
    );
    const releaseSkill = readFileSync(
      ".agents/skills/release-openclaw-maintainer/SKILL.md",
      "utf8",
    );

    expect(changelogSkill).toContain("Rewrite `CHANGELOG.md` as current release notes");
    expect(changelogSkill).toContain("preserve the top `# Changelog` title and docs link");
    expect(changelogSkill).toContain("remove older `## YYYY.M.D` sections");
    expect(changelogSkill).toContain("do not keep `## Unreleased`");
    expect(changelogSkill).toContain("### Highlights");
    expect(changelogSkill).toContain("### Changes");
    expect(changelogSkill).toContain("### Fixes");
    expect(changelogSkill).toContain("preserving issue/PR refs and human thanks");

    expect(releaseSkill).toContain(
      "`CHANGELOG.md` contains the current stable-base release section",
    );
    expect(releaseSkill).toContain(
      "`CHANGELOG.md` contains the current stable-base release section only.",
    );
    expect(releaseSkill).toContain("GitHub release and prerelease bodies must use the full matching");
    expect(releaseSkill).toContain("`CHANGELOG.md` version section");
  });

  it("checks every thanked handle on a changelog line", () => {
    expect(
      findForbiddenChangelogThanks("- Mixed credit (#123). Thanks @openclaw and @alice."),
    ).toEqual([
      {
        line: 1,
        handle: "openclaw",
        text: "- Mixed credit (#123). Thanks @openclaw and @alice.",
      },
    ]);
  });

  it("uses one attribution predicate for scanner and shell checks", () => {
    expect(isForbiddenChangelogThanksHandle("")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("null")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("app/any-bot")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("codex")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("openclaw")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("steipete")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("app/clawsweeper")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("clawsweeper")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("clawsweeper[bot]")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("openclaw-clawsweeper")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("openclaw-clawsweeper[bot]")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("dependabot[bot]")).toBe(true);
    expect(isForbiddenChangelogThanksHandle("dependabot[bot]", { strictBotHandle: true })).toBe(
      true,
    );
    expect(isForbiddenChangelogThanksHandle("alice")).toBe(false);
    expect(isForbiddenChangelogThanksHandle("human-clawsweeper-fan")).toBe(false);
    expect(
      isForbiddenChangelogThanksHandle("human-clawsweeper-fan", { strictBotHandle: true }),
    ).toBe(false);

    expect(requiresExplicitHumanChangelogThanks("clawsweeper")).toBe(true);
    expect(requiresExplicitHumanChangelogThanks("clawsweeper[bot]")).toBe(true);
    expect(requiresExplicitHumanChangelogThanks("dependabot[bot]")).toBe(true);
    expect(requiresExplicitHumanChangelogThanks("app/clawsweeper")).toBe(true);
    expect(requiresExplicitHumanChangelogThanks("human-clawsweeper-fan")).toBe(false);
    expect(requiresExplicitHumanChangelogThanks("steipete")).toBe(false);
    expect(requiresExplicitHumanChangelogThanks("")).toBe(false);
  });

  it("requires explicit human thanks for bot PR changelog entries", () => {
    const repo = createRepoWithPrChangelogDiff("- Bot repair (#123).");
    try {
      let output = "";
      try {
        validateChangelogEntry(repo, "dependabot[bot]");
      } catch (error) {
        output = String((error as { stdout?: unknown }).stdout ?? error);
      }
      expect(output).toContain("must include an explicit human Thanks @handle");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("accepts explicit human thanks for bot PR changelog entries", () => {
    const repo = createRepoWithPrChangelogDiff("- Bot repair (#123). Thanks @alice.");
    try {
      expect(validateChangelogEntry(repo, "dependabot[bot]")).toContain("explicit thanks");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps non-bot forbidden contributors on the no-thanks fallback", () => {
    const repo = createRepoWithPrChangelogDiff("- Maintainer repair (#123).");
    try {
      expect(validateChangelogEntry(repo, "steipete")).toContain("skipping thanks check");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("keeps PR changelog gates on the same attribution policy", () => {
    const commonLib = readFileSync("scripts/pr-lib/common.sh", "utf8");
    const changelogLib = readFileSync("scripts/pr-lib/changelog.sh", "utf8");
    const gates = readFileSync("scripts/pr-lib/gates.sh", "utf8");
    const mergeLib = readFileSync("scripts/pr-lib/merge.sh", "utf8");
    const prepareCore = readFileSync("scripts/pr-lib/prepare-core.sh", "utf8");

    expect(commonLib).toContain("pr_contributor_allows_human_trailers");
    expect(commonLib).toContain("resolve_contributor_coauthor_email");
    expect(changelogLib).toContain("changelog_attribution_script");
    expect(changelogLib).toContain("--is-forbidden-handle");
    expect(changelogLib).toContain("--requires-explicit-human-thanks");
    expect(changelogLib).toContain("changelog_thanks_required_for_contributor");
    expect(changelogLib).toContain("changelog_explicit_human_thanks_required_for_contributor");
    expect(changelogLib).toContain("Choose the credited original contributor");
    expect(gates).toContain("validate_changelog_attribution_policy");
    expect(prepareCore).toContain("resolve_contributor_coauthor_email");
    expect(mergeLib).toContain("pr_contributor_allows_human_trailers");
    expect(mergeLib).toContain("Skipping PR author co-author trailer check for bot/app author");
  });
});
