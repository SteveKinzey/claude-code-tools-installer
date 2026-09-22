'use strict';

const LEGACY_TAG = /^v?(\d{4})\.(\d{1,2})\.(\d{1,2})$/;
const DAILY_TAG = /^v?(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function isCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseReleaseIdentity(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const match = DAILY_TAG.exec(raw) || LEGACY_TAG.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isCalendarDate(year, month, day)) return null;

  const revisionText = match[4];
  const tagBase = `v${String(year).padStart(4, '0')}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  if (revisionText === undefined) {
    return {
      tag: tagBase,
      packageVersion: `${year}.${month}.${day}`,
      dailyRevision: null,
      isLegacy: true,
    };
  }

  const dailyRevision = Number(revisionText);
  if (!Number.isInteger(dailyRevision) || dailyRevision < 0 || dailyRevision > 99) return null;
  return {
    tag: `${tagBase}.${revisionText}`,
    packageVersion: `${year}.${month}.${Number(`${String(day).padStart(2, '0')}${revisionText}`)}`,
    dailyRevision,
    isLegacy: false,
  };
}

function parsePackageVersion(value) {
  const match = SEMVER.exec(String(value || '').trim());
  if (!match) return null;
  return match.slice(1).map(Number);
}

function comparePackageVersions(left, right) {
  const leftParts = parsePackageVersion(left);
  const rightParts = parsePackageVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

module.exports = {
  comparePackageVersions,
  isCalendarDate,
  parsePackageVersion,
  parseReleaseIdentity,
};
