#!/usr/bin/env node
const assert = require("node:assert/strict");
const path = require("node:path");
const { evaluateReleaseArtifactState, getCoverage, isReleaseTag } = require("./check-release-artifact-drift");

const fixture = (name) => require(path.join(__dirname, "fixtures", "release-artifact-drift", name));
const NOW = "2026-09-20T12:00:00Z";

function stateFor(release, overrides = {}) {
  return evaluateReleaseArtifactState({
    tag: release?.tag_name || "v2026.09.15",
    release,
    createdAt: release?.published_at || "2026-09-15T12:00:00Z",
    now: NOW,
    graceHours: 24,
    ...overrides,
  });
}

const verified = fixture("verified-release.json");
const sourceOnly = fixture("source-only-release.json");
const invalidDigest = fixture("invalid-digest-release.json");

assert.equal(isReleaseTag("v2026.09.12"), true);
assert.equal(isReleaseTag("2026.9.12"), true);
assert.equal(isReleaseTag("release-candidate"), false);

assert.equal(stateFor(verified).state, "verified");
assert.deepEqual(Object.keys(getCoverage(verified)).sort(), ["linux", "macos", "windows"]);
assert.equal(stateFor(sourceOnly).state, "drift");
assert.equal(stateFor(invalidDigest).state, "drift");
assert.equal(stateFor(null, { tag: "v2026.09.15", createdAt: "2026-09-15T12:00:00Z" }).state, "drift");
assert.equal(stateFor(sourceOnly, { now: "2026-09-13T18:00:00Z" }).state, "grace");
assert.equal(stateFor(null, { tag: "docs-only", createdAt: NOW }).state, "ignored");

console.log("Release artifact drift tests passed.");
