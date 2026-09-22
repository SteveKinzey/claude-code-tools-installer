#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  comparePackageVersions,
  isCalendarDate,
  parsePackageVersion,
  parseReleaseIdentity,
} = require('../desktop/src/release-identity');

function validateReleaseIdentity({ tag, packageVersion, requireDailyRevision = false }) {
  const identity = parseReleaseIdentity(tag);
  if (!identity) {
    throw new Error(`Invalid CCTI release tag: ${tag || '(missing)'}. Use vYYYY.MM.DD.RR with a real calendar date and RR from 00 through 99.`);
  }
  if (requireDailyRevision && identity.isLegacy) {
    throw new Error(`New CCTI releases require a daily revision: ${identity.tag} must use vYYYY.MM.DD.RR.`);
  }
  if (requireDailyRevision && !String(tag || '').startsWith('v')) {
    throw new Error(`New CCTI releases require a canonical v-prefixed tag: received ${tag}.`);
  }
  if (!parsePackageVersion(packageVersion)) {
    throw new Error(`desktop/package.json version must be unpadded three-component SemVer; received ${packageVersion || '(missing)'}.`);
  }
  if (packageVersion !== identity.packageVersion) {
    throw new Error(`Release identity mismatch: ${identity.tag} requires package version ${identity.packageVersion}, received ${packageVersion}.`);
  }
  return identity;
}

function parseArguments(args) {
  const options = { requireDailyRevision: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--require-daily-revision') options.requireDailyRevision = true;
    else if (argument === '--tag' || argument === '--package-json') options[argument.slice(2)] = args[++index];
  }
  return options;
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.tag || !options['package-json']) {
    throw new Error('Usage: release-identity.js --tag vYYYY.MM.DD.RR --package-json /path/to/desktop/package.json [--require-daily-revision]');
  }
  const packageJson = JSON.parse(fs.readFileSync(options['package-json'], 'utf8'));
  const identity = validateReleaseIdentity({
    tag: options.tag,
    packageVersion: String(packageJson?.version || ''),
    requireDailyRevision: options.requireDailyRevision,
  });
  process.stdout.write(`${JSON.stringify(identity)}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  comparePackageVersions,
  isCalendarDate,
  parsePackageVersion,
  parseReleaseIdentity,
  validateReleaseIdentity,
};
