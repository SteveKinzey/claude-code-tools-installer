#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  comparePackageVersions,
  parseReleaseIdentity,
  validateReleaseIdentity,
} = require('./release-identity');

assert.deepEqual(parseReleaseIdentity('v2026.09.22'), {
  tag: 'v2026.09.22',
  packageVersion: '2026.9.22',
  dailyRevision: null,
  isLegacy: true,
});
assert.deepEqual(parseReleaseIdentity('v2026.09.22.01'), {
  tag: 'v2026.09.22.01',
  packageVersion: '2026.9.2201',
  dailyRevision: 1,
  isLegacy: false,
});
assert.deepEqual(parseReleaseIdentity('v2028.02.29.99'), {
  tag: 'v2028.02.29.99',
  packageVersion: '2028.2.2999',
  dailyRevision: 99,
  isLegacy: false,
});
assert.equal(parseReleaseIdentity('v2026.02.29.01'), null);
assert.equal(parseReleaseIdentity('v2026.09.22.1'), null);
assert.equal(parseReleaseIdentity('v2026.09.22.100'), null);
assert.equal(comparePackageVersions('2026.9.2201', '2026.9.22'), 1);
assert.equal(comparePackageVersions('2026.9.22', '2026.9.2201'), -1);
assert.equal(comparePackageVersions('2026.9.2201', '2026.9.2201'), 0);
assert.deepEqual(validateReleaseIdentity({
  tag: 'v2026.09.22.01',
  packageVersion: '2026.9.2201',
  requireDailyRevision: true,
}), parseReleaseIdentity('v2026.09.22.01'));
assert.throws(() => validateReleaseIdentity({
  tag: 'v2026.09.22',
  packageVersion: '2026.9.22',
  requireDailyRevision: true,
}), /daily revision/);
assert.throws(() => validateReleaseIdentity({
  tag: 'v2026.09.22.01',
  packageVersion: '2026.9.22',
  requireDailyRevision: true,
}), /Release identity mismatch/);

console.log('Release identity tests passed.');
