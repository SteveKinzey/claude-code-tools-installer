#!/usr/bin/env node
/**
 * Fails only when a release-shaped CCTI tag/release remains without a
 * SHA-256-backed executable artifact after its short release-pipeline grace.
 * Kept dependency-free so it can run locally and in GitHub Actions.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { parseReleaseIdentity } = require("../desktop/src/release-identity");

const DEFAULT_GRACE_HOURS = 24;
const RELEASE_TAG = /^v?\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d{2})?$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isReleaseTag(tag) {
  return typeof tag === "string" && RELEASE_TAG.test(tag) && Boolean(parseReleaseIdentity(tag));
}

function classifyArtifact(name) {
  const file = String(name || "").toLowerCase();
  if (/\.(?:sha256|sha512|sig|asc|yml|yaml|json)$/i.test(file)) return null;
  if (/claude[._-]?code[._-]?tools[._-]?installer/.test(file)
    && /(?:macos|darwin|mac)(?:[-_.]|$)/.test(file)
    && /\.(?:dmg|zip)$/.test(file)) return "macos";
  if (/claude[._-]?code[._-]?tools[._-]?installer/.test(file)
    && /(?:windows|win)(?:[-_.]|$)/.test(file)
    && /\.(?:exe|msi|zip)$/.test(file)) return "windows";
  if (/claude[._-]?code[._-]?tools[._-]?installer/.test(file)
    && /linux(?:[-_.]|$)/.test(file)
    && /\.(?:appimage|deb|rpm|tar\.gz)$/.test(file)) return "linux";
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

// This is a protected, reviewed record of abandoned staging candidates, not a
// wildcard exclusion list. Every use rechecks immutable source and live assets.
function validateDispositions(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.candidates)) {
    throw new Error("Invalid release disposition schema.");
  }
  const seen = new Set();
  for (const item of document.candidates) {
    if (!item || item.status !== "superseded-staging"
      || !isReleaseTag(item.tag) || !isReleaseTag(item.supersededBy)
      || item.tag === item.supersededBy || seen.has(item.tag)
      || ![item.tagObject, item.commit, item.supersedingCommit].every((sha) => /^[a-f0-9]{40}$/.test(sha || ""))
      || typeof item.reason !== "string" || !item.reason.trim()
      || !Array.isArray(item.evidence) || item.evidence.length === 0
      || !item.evidence.every((url) => typeof url === "string" && url.startsWith("https://github.com/SteveKinzey/claude-code-tools-installer/"))) {
      throw new Error("Invalid or duplicate superseded staging disposition.");
    }
    seen.add(item.tag);
  }
  return document.candidates;
}

function resolveTag(tag) {
  const resolve = (suffix) => execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `refs/tags/${tag}${suffix}`], { cwd: root, encoding: "utf8" }).trim();
  return { object: resolve(""), commit: resolve("^{commit}") };
}

function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root });
  if (result.error || ![0, 1].includes(result.status)) throw result.error || new Error("Cannot verify release ancestry.");
  return result.status === 0;
}

function evaluateSupersededStaging({ tag, release, releases, dispositions, git }) {
  const item = dispositions.find((candidate) => candidate.tag === tag);
  if (!item) return null;
  const fail = (reason) => ({ state: "drift", coverage: {}, message: `${tag} staging disposition refused: ${reason}.` });
  // A subsequently published record must satisfy the ordinary artifact gate.
  if (release && (release.tag_name !== tag || !release.draft)) return fail("the candidate is no longer an unpublished draft");
  const source = git.resolveTag(tag);
  const successor = git.resolveTag(item.supersededBy);
  if (source.object !== item.tagObject || source.commit !== item.commit
    || successor.commit !== item.supersedingCommit) return fail("immutable tag/source binding changed");
  if (source.commit === successor.commit || !git.isAncestor(source.commit, successor.commit)) return fail("replacement does not contain the staged source");
  const replacement = releases.find((candidate) => candidate.tag_name === item.supersededBy);
  if (!replacement || replacement.draft || replacement.prerelease
    || !Object.values(getCoverage(replacement)).some((files) => files.length > 0)) {
    return fail("the pinned replacement lacks published SHA-256-backed executable assets");
  }
  return {
    state: "superseded",
    coverage: {},
    message: `${tag} is retained as unpublished staging, superseded by verified public ${item.supersededBy}. ${item.reason}`,
  };
}

function evaluateReleaseArtifactState({ tag, release, createdAt, now = new Date().toISOString(), graceHours = DEFAULT_GRACE_HOURS, releases = [], dispositions = [], git = { resolveTag, isAncestor } }) {
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

  const superseded = evaluateSupersededStaging({ tag, release, releases, dispositions, git });
  if (superseded) return superseded;

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
    message: `${tag} ${reason} after the ${graceHours}-hour grace period. Complete authorized platform trust and artifact publication, or propose a documented superseded-staging disposition through a protected PR; preserve tag history.`,
    coverage,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    if (["all", "list-audit-tags"].includes(key)) values[key] = true;
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
  const dispositions = validateDispositions(readJson(path.join(root, "docs", "release-staging-dispositions.json")));
  if (options["list-audit-tags"]) {
    const existing = execFileSync("git", ["tag", "--list", "v*"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(isReleaseTag);
    // Retain registered originals even if their refs disappear, so evaluation
    // reaches the pinned-ref check instead of silently omitting the candidate.
    console.log([...new Set([...existing, ...dispositions.map((item) => item.tag)])].sort().reverse().join("\n"));
    return;
  }
  const now = options.now || new Date().toISOString();
  const graceHours = Number(options["grace-hours"] || DEFAULT_GRACE_HOURS);
  const releases = options["releases-file"] ? readJson(options["releases-file"]) : [];
  const release = options["release-file"] ? readJson(options["release-file"]) : null;
  if (!Array.isArray(releases)) throw new Error("Release inventory must be an array.");

  const evaluations = options.all
    ? (Array.isArray(releases) ? releases : []).filter((candidate) => isReleaseTag(candidate.tag_name)).map((candidate) => evaluateReleaseArtifactState({
      tag: candidate.tag_name,
      release: candidate,
      createdAt: candidate.published_at || candidate.created_at,
      now,
      graceHours,
      releases,
      dispositions,
    }))
    : [evaluateReleaseArtifactState({
      tag: options.tag,
      release,
      createdAt: options["tag-created-at"],
      now,
      graceHours,
      releases,
      dispositions,
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
  validateDispositions,
};
