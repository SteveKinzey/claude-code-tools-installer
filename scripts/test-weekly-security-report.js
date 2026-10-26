#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/weekly-dependency-security.yml'), 'utf8').replace(/\r\n/g, '\n');
const scanStep = workflow.split('      - name: Scan dependency vulnerabilities\n')[1]?.split('\n      - name:')[0];
assert.match(scanStep || '', /if: \$\{\{ always\(\) && !cancelled\(\) \}\}/, 'report capture must run even after complete validation fails');
const script = scanStep.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-weekly-audit-'));
try {
  fs.mkdirSync(path.join(temp, 'desktop'));
  // Override only npm within the actual workflow shell block; no registry calls.
  const stub = `npm() {
    if [[ "$*" == "audit --json" ]]; then
      printf '%s\\n' "$FIXTURE_JSON"
      return "$FIXTURE_JSON_STATUS"
    fi
    if [[ "$*" == "audit --audit-level=high" ]]; then
      echo threshold-invoked >> ../threshold.log
      return "$FIXTURE_THRESHOLD_STATUS"
    fi
    return 99
  }\n`;
  const valid = JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0 } } });
  for (const [name, json, jsonStatus, thresholdStatus, expected, thresholdCalled] of [
    ['clean', valid, 0, 0, 0, true],
    ['moderate remains non-blocking', valid, 1, 0, 0, true],
    ['high finding still blocks', valid, 1, 1, 1, true],
    ['registry error', JSON.stringify({ error: { code: 'E503' } }), 1, 0, 1, false],
    ['missing metadata', '{}', 0, 0, 1, false],
    ...[{}, 'invalid counters', null, [], { high: 0 }, { high: -1, critical: 0 },
      { high: 0.5, critical: 0 }, { high: 0, critical: '0' }].map((v) => [
      'malformed counters ' + JSON.stringify(v), JSON.stringify({ metadata: { vulnerabilities: v } }), 0, 0, 1, false,
    ]),
    ['invalid JSON', 'not json', 1, 0, 1, false],
    ['unexpected audit exit', valid, 2, 0, 2, false],
  ]) {
    fs.rmSync(path.join(temp, 'threshold.log'), { force: true });
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', stub + script], {
      cwd: path.join(temp, 'desktop'), encoding: 'utf8',
      env: { ...process.env, FIXTURE_JSON: json, FIXTURE_JSON_STATUS: String(jsonStatus), FIXTURE_THRESHOLD_STATUS: String(thresholdStatus) },
    });
    assert.equal(result.status, expected, `${name}: ${result.stderr}`);
    assert.equal(fs.readFileSync(path.join(temp, 'security-reports/npm-audit.json'), 'utf8').trim(), json, `${name}: report must survive failure`);
    assert.equal(fs.existsSync(path.join(temp, 'threshold.log')), thresholdCalled, name);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('15 weekly audit report fixtures passed: clean, moderate/high, malformed counters, registry/error exits and retained evidence.');
