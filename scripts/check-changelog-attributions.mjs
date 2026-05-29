#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_CHANGELOG_THANKS_HANDLES = [
  "codex",
  "openclaw",
  "steipete",
  "clawsweeper",
  "openclaw-clawsweeper",
  "clawsweeper[bot]",
  "openclaw-clawsweeper[bot]",
];
export const FORBIDDEN_CHANGELOG_THANKS_HANDLE_PREFIXES = ["app/"];
export const FORBIDDEN_CHANGELOG_THANKS_HANDLE_SUFFIXES = ["[bot]"];
export const CHANGELOG_THANKS_REQUIRE_HUMAN_CREDIT_HANDLES = [
  "clawsweeper",
  "openclaw-clawsweeper",
  "clawsweeper[bot]",
  "openclaw-clawsweeper[bot]",
];
export const CHANGELOG_THANKS_REQUIRE_HUMAN_CREDIT_HANDLE_PREFIXES = ["app/"];
export const CHANGELOG_THANKS_REQUIRE_HUMAN_CREDIT_HANDLE_SUFFIXES = ["[bot]"];

const THANKS_PATTERN = /\bThanks\b/iu;
const THANKED_HANDLE_PATTERN = /@([-_/A-Za-z0-9]+(?:\[bot\])?)/giu;
const CHANGELOG_TITLE = "# Changelog";
const CHANGELOG_DOCS_LINK = "Docs: https://docs.openclaw.ai";
const UNRELEASED_HEADING_PATTERN = /^##\s+Unreleased(?:\s+.*)?$/u;
const STABLE_RELEASE_HEADING_PATTERN =
  /^##\s+([0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*)(?:\s+.*)?$/u;
const PRERELEASE_HEADING_PATTERN =
  /^##\s+([0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*-(?:alpha|beta)\.[1-9][0-9]*)(?:\s+.*)?$/u;

export function isForbiddenChangelogThanksHandle(handle, options = {}) {
  const { strictBotHandle = false } = options;
  const normalized = handle.toLowerCase();
  if (normalized === "" || normalized === "null") {
    // Empty/null input is not a GitHub handle, but the shell query path may pass it through.
    return true;
  }
  if (
    FORBIDDEN_CHANGELOG_THANKS_HANDLES.includes(normalized) ||
    FORBIDDEN_CHANGELOG_THANKS_HANDLE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    FORBIDDEN_CHANGELOG_THANKS_HANDLE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return true;
  }
  if (strictBotHandle) {
    // PR-author checks should not reject a real human whose login merely contains a bot keyword.
    return false;
  }
  return false;
}

export function requiresExplicitHumanChangelogThanks(handle) {
  const normalized = handle.toLowerCase();
  if (normalized === "" || normalized === "null") {
    return false;
  }
  return (
    CHANGELOG_THANKS_REQUIRE_HUMAN_CREDIT_HANDLES.includes(normalized) ||
    CHANGELOG_THANKS_REQUIRE_HUMAN_CREDIT_HANDLE_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    ) ||
    CHANGELOG_THANKS_REQUIRE_HUMAN_CREDIT_HANDLE_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix),
    )
  );
}

export function findForbiddenChangelogThanks(content) {
  return content
    .split(/\r?\n/u)
    .map((text, index) => {
      if (!THANKS_PATTERN.test(text)) {
        return null;
      }
      // A single changelog line may thank multiple handles; scan all of them.
      for (const match of text.matchAll(THANKED_HANDLE_PATTERN)) {
        if (isForbiddenChangelogThanksHandle(match[1])) {
          return { line: index + 1, handle: match[1].toLowerCase(), text };
        }
      }
      return null;
    })
    .filter(Boolean);
}

export function findChangelogShapeViolations(content) {
  const releaseHeadings = [];
  const unreleasedHeadings = [];
  const violations = [];
  const lines = content.split(/\r?\n/u).map((line, index) =>
    index === 0 ? line.replace(/^\uFEFF/u, "") : line,
  );
  const firstContentLineIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstContentLineIndex === -1 || lines[firstContentLineIndex] !== CHANGELOG_TITLE) {
    violations.push({
      line: firstContentLineIndex === -1 ? 1 : firstContentLineIndex + 1,
      text: lines[firstContentLineIndex] ?? "",
      reason: `CHANGELOG.md must start with ${CHANGELOG_TITLE}.`,
    });
  }

  const firstLevelTwoIndex = lines.findIndex((line) => line.startsWith("## "));
  const docsLinkIndex = lines.findIndex((line, index) => {
    return (
      line === CHANGELOG_DOCS_LINK &&
      (firstLevelTwoIndex === -1 || index < firstLevelTwoIndex)
    );
  });
  if (docsLinkIndex === -1) {
    violations.push({
      line: 1,
      text: "",
      reason: `CHANGELOG.md must keep the docs link: ${CHANGELOG_DOCS_LINK}.`,
    });
  }

  for (const [index, text] of lines.entries()) {
    const line = index + 1;
    if (UNRELEASED_HEADING_PATTERN.test(text)) {
      unreleasedHeadings.push({ line, text });
      continue;
    }

    const prereleaseMatch = PRERELEASE_HEADING_PATTERN.exec(text);
    if (prereleaseMatch) {
      violations.push({
        line,
        text,
        reason: `Prerelease changelog heading ${prereleaseMatch[1]} must use the stable base version heading.`,
      });
      continue;
    }

    const stableMatch = STABLE_RELEASE_HEADING_PATTERN.exec(text);
    if (stableMatch) {
      releaseHeadings.push({ line, version: stableMatch[1], text });
    }
  }

  for (const heading of unreleasedHeadings) {
    violations.push({
      line: heading.line,
      text: heading.text,
      reason: "CHANGELOG.md must not contain ## Unreleased; release notes are regenerated from history.",
    });
  }

  if (releaseHeadings.length === 0) {
    violations.push({
      line: 1,
      text: "",
      reason: "CHANGELOG.md must contain one stable-base ## YYYY.M.D release section.",
    });
  }
  for (const heading of releaseHeadings.slice(1)) {
    violations.push({
      line: heading.line,
      text: heading.text,
      reason: `CHANGELOG.md may contain at most one dated release section; found extra section ${heading.version}.`,
    });
  }

  const unreleasedLine = unreleasedHeadings[0]?.line;
  const releaseLine = releaseHeadings[0]?.line;
  if (releaseHeadings.length > 0) {
    const releaseStartIndex = releaseHeadings[0].line - 1;
    const releaseEndIndex =
      lines.findIndex((line, index) => index > releaseStartIndex && line.startsWith("## ")) ??
      -1;
    const releaseLines = lines.slice(
      releaseStartIndex + 1,
      releaseEndIndex === -1 ? lines.length : releaseEndIndex,
    );
    const subsectionOrder = releaseLines
      .map((line, index) => ({ line, sourceLine: releaseStartIndex + index + 2 }))
      .filter(({ line }) => line.startsWith("### "))
      .map(({ line, sourceLine }) => ({ name: line.replace(/^###\s+/u, ""), line: sourceLine }));
    const requiredSubsections = ["Highlights", "Changes", "Fixes"];
    let lastIndex = -1;
    for (const subsection of requiredSubsections) {
      const index = subsectionOrder.findIndex((entry) => entry.name === subsection);
      if (index === -1) {
        violations.push({
          line: releaseHeadings[0].line,
          text: releaseHeadings[0].text,
          reason: `Current release section must contain ### ${subsection}.`,
        });
        continue;
      }
      if (index < lastIndex) {
        violations.push({
          line: subsectionOrder[index].line,
          text: `### ${subsectionOrder[index].name}`,
          reason: "Current release subsections must be ordered Highlights, Changes, Fixes.",
        });
      }
      lastIndex = Math.max(lastIndex, index);
    }
  }

  return violations;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--is-forbidden-handle") {
    process.exitCode = isForbiddenChangelogThanksHandle(argv[1] ?? "", {
      strictBotHandle: true,
    })
      ? 0
      : 1;
    return;
  }

  if (argv[0] === "--requires-explicit-human-thanks") {
    process.exitCode = requiresExplicitHumanChangelogThanks(argv[1] ?? "") ? 0 : 1;
    return;
  }

  const changelogPath = argv[0] ?? "CHANGELOG.md";
  const absolutePath = path.resolve(process.cwd(), changelogPath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const thanksViolations = findForbiddenChangelogThanks(content);
  const shapeViolations = findChangelogShapeViolations(content);
  if (thanksViolations.length === 0 && shapeViolations.length === 0) {
    return;
  }

  const relativePath = path.relative(process.cwd(), absolutePath) || changelogPath;
  if (thanksViolations.length > 0) {
    console.error("Forbidden changelog thanks attribution:");
  }
  for (const violation of thanksViolations) {
    console.error(`- ${relativePath}:${violation.line} uses Thanks @${violation.handle}`);
  }
  if (thanksViolations.length > 0) {
    console.error(
      `Use a credited external GitHub username instead of ${FORBIDDEN_CHANGELOG_THANKS_HANDLES.map(
        (handle) => `@${handle}`,
      ).join(", ")}.`,
    );
  }

  if (shapeViolations.length > 0) {
    console.error("Invalid changelog shape:");
    for (const violation of shapeViolations) {
      console.error(`- ${relativePath}:${violation.line}: ${violation.reason}`);
    }
    console.error(
      "Keep CHANGELOG.md to one stable-base ## YYYY.M.D section.",
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
