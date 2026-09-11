#!/usr/bin/env node
/**
 * Fails only when a release-shaped CCTI tag/release remains without a
 * SHA-256-backed executable artifact after its short release-pipeline grace.
 * Kept dependency-free so it can run locally and in GitHub Actions.
 */
const fs = require("node:fs");

const DEFAULT_GRACE_HOURS = 24;
const RELEASE_TAG = /^v?\d{4}\.\d{1,2}\.\d{1,2}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isReleaseTag(tag) {
  return typeof tag === "string" && RELEASE_TAG.test(tag);
}

function classifyArtifact(name) {
  const file = String(name || "").toLowerCase();
  if (/\.dmg$/.test(file) || /(?:macos|darwin|mac)(?:[-_.]|$)/.test(file)) return "macos";
  if (/\.(?:exe|msi|msix|msixbundle)$/.test(file) || /(?:windows|win)(?:[-_.]|$)/.test(file)) return "windows";
  if (/\.(?:appimage|deb|rpm|tar\.gz)$/.test(file) || /linux(?:[-_.]|$)/.test(file)) return "linux";
  return null;
}

function isVerifiedExecutableAsset(asset) {
  return Boolean(
    classifyArtifact(asset?.name)
    && asset?.state === "uploaded"
    && Number.isFinite(asset?.size)
    && asset.size > 0
    && SHA256_DIGEST.test(String(asset?.digest || "")),
  );
}

function getCoverage(release) {
  const coverage = { macos: [], windows: [], linux: [] };
  for (const asset of Array.isArray(release?.assets) ? release.assets : []) {
    if (!isVerifiedExecutableAsset(asset)) continue;
    const platform = classifyArtifact(asset.name);
    if (platform) coverage[platform].push(asset.name);
  }
  return coverage;
}

function getCoverageSummary(coverage) {
  return Object.entries(coverage)
    .filter(([, files]) => files.length > 0)
    .map(([platform]) => platform)
    .join(", ") || "none";
}

function ageHours(createdAt, now) {
  const created = Date.parse(createdAt || "");
  const current = Date.parse(now || "");
  if (!Number.isFinite(created) || !Number.isFinite(current)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (current - created) / (60 * 60 * 1000));
}

function evaluateReleaseArtifactState({ tag, release, createdAt, now = new Date().toISOString(), graceHours = DEFAULT_GRACE_HOURS }) {
  if (!isReleaseTag(tag)) {
    return { state: "ignored", message: `Ignored non-release tag ${String(tag || "(missing)")}.`, coverage: {} };
  }

  const normalizedRelease = release && !release.draft && !release.prerelease && release.tag_name === tag ? release : null;
  const coverage = getCoverage(normalizedRelease);
  if (Object.values(coverage).some((files) => files.length > 0)) {
    return {
      state: "verified",
      message: `${tag} has verified executable coverage for ${getCoverageSummary(coverage)}.`,
      coverage,
    };
  }

  const age = ageHours(createdAt || normalizedRelease?.published_at || normalizedRelease?.created_at, now);
  const reason = normalizedRelease
    ? "has no uploaded SHA-256-backed executable asset"
    : "has no published GitHub Release with an executable asset";
  if (age < graceHours) {
    return {
      state: "grace",
      message: `${tag} ${reason}; waiting ${Math.ceil(graceHours - age)} more hour(s) for the release pipeline.`,
      coverage,
    };
  }

  return {
    state: "drift",
    message: `${tag} ${reason} after the ${graceHours}-hour grace period. Publish a signed platform artifact and its SHA-256 digest, or remove/rename the tag if it is not a desktop release.`,
    coverage,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    if (key === "all") values.all = true;
    else values[key] = argv[index + 1];
  }
  return values;
}

function writeSummary(lines) {
  const outputPath = process.env.GITHUB_STEP_SUMMARY;
  if (outputPath) fs.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const now = options.now || new Date().toISOString();
  const graceHours = Number(options["grace-hours"] || DEFAULT_GRACE_HOURS);
  const releases = options["releases-file"] ? readJson(options["releases-file"]) : [];
  const release = options["release-file"] ? readJson(options["release-file"]) : null;

  const evaluations = options.all
    ? (Array.isArray(releases) ? releases : []).filter((candidate) => isReleaseTag(candidate.tag_name)).map((candidate) => evaluateReleaseArtifactState({
      tag: candidate.tag_name,
      release: candidate,
      createdAt: candidate.published_at || candidate.created_at,
      now,
      graceHours,
    }))
    : [evaluateReleaseArtifactState({
      tag: options.tag,
      release,
      createdAt: options["tag-created-at"],
      now,
      graceHours,
    })];

  const lines = evaluations.map((result) => `- **${result.state.toUpperCase()}** — ${result.message}`);
  console.log(lines.join("\n"));
  writeSummary(["## CCTI release artifact drift check", "", ...lines]);

  if (evaluations.some((result) => result.state === "drift")) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_GRACE_HOURS,
  RELEASE_TAG,
  SHA256_DIGEST,
  classifyArtifact,
  evaluateReleaseArtifactState,
  getCoverage,
  isReleaseTag,
  isVerifiedExecutableAsset,
};
