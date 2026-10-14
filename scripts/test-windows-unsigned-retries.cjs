'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require(require.resolve('js-yaml', { paths: [path.join(__dirname, '../desktop')] }));

module.exports = function testRetries(root) {
  if (process.platform !== 'win32') {
    console.log('SKIP actual PowerShell draft-upload simulation on non-Windows; required in native Windows CI.');
    return;
  }
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release-windows-unsigned.yml'), 'utf8'));
  const actual = workflow.jobs.stage.steps.find((step) => step.name === 'Upload only to an unpublished draft release').run;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-upload-retry-'));
  try {
    fs.mkdirSync(path.join(directory, 'staged-inputs'));
    fs.writeFileSync(path.join(directory, 'staged-inputs/fixture.exe'), 'inert bytes, not executed');
    const mock = `param([string]$Case)
$ErrorActionPreference = 'Stop'
$env:TAG = 'v2026.10.14.00'
$env:GITHUB_REPOSITORY = 'fixture/repository'
$env:GITHUB_SHA = '0000000000000000000000000000000000000000'
$script:uploads = 0
$script:deletes = 0
function Start-Sleep { param($Seconds) }
function gh {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'release' -and $args[1] -eq 'view') {
    if ($args -contains 'databaseId') { if ($Case -eq 'invalid-release-id') { return 'not-numeric' }; return '123' }
    if ($Case -eq 'public') { return 'false' }; return 'true'
  }
  if ($args[0] -eq 'api' -and $args -contains '--paginate') {
    $id = if ($Case -eq 'invalid-asset-id') { 'not-numeric' } else { '456' }
    return ('{"id":"' + $id + '","name":"fixture.exe"}')
  }
  if ($args[0] -eq 'api' -and $args -contains 'DELETE') {
    if ($args[-1] -ne 'repos/fixture/repository/releases/assets/456') { throw 'Wrong numeric asset deleted' }
    $script:deletes++; return
  }
  if ($args[0] -eq 'release' -and $args[1] -eq 'upload') {
    $script:uploads++
    if ($Case -eq 'exhaustion' -or $script:uploads -eq 1) { $global:LASTEXITCODE = 1 }
    return
  }
  throw ('Unexpected mocked gh call: ' + ($args -join ' '))
}
$failed = $false
try {
${actual}
} catch { $failed = $true; $failure = $_.Exception.Message }
if ($Case -eq 'retry') {
  if ($failed -or $script:uploads -ne 2 -or $script:deletes -ne 2) { throw "Retry fixture failed: $failure" }
} elseif ($Case -eq 'exhaustion') {
  if (-not $failed -or $script:uploads -ne 4 -or $script:deletes -ne 4) { throw 'Bounded exhaustion fixture failed' }
} else {
  if (-not $failed -or $script:uploads -ne 0 -or $script:deletes -ne 0) { throw 'Fail-closed refusal fixture failed' }
}
Write-Output "PASS actual PowerShell upload block: $Case"
`;
    const script = path.join(directory, 'simulate.ps1');
    fs.writeFileSync(script, mock);
    for (const test of ['retry', 'exhaustion', 'public', 'invalid-release-id', 'invalid-asset-id']) {
      const result = cp.spawnSync('pwsh', ['-NoProfile', '-File', script, test], { cwd: directory, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, `${test}: ${result.error?.message || result.stderr || result.stdout}`);
      process.stdout.write(result.stdout);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
