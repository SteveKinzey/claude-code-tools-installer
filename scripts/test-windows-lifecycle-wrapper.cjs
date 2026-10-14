'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require(require.resolve('js-yaml', { paths: [path.join(__dirname, '../desktop')] }));

module.exports = function checkLifecycleWrapper(root) {
  if (process.platform !== 'win32') {
    console.log('SKIP actual PowerShell lifecycle wrapper simulation on non-Windows; required in native Windows CI.');
    return;
  }
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release-windows-unsigned.yml'), 'utf8'));
  const actual = workflow.jobs.unsigned.steps.find((step) => step.name === 'Test clean-runner NSIS install, main-window launch and uninstall').run;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-wrapper-'));
  try {
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.writeFileSync(path.join(directory, 'scripts/test-windows-nsis-lifecycle.ps1'), `param($Installer, $Version)
if ($env:CCTI_WRAPPER_FIXTURE -eq 'failure') { throw 'fixture lifecycle failure' }
Write-Output 'Successful inert lifecycle fixture; no native command was executed.'
`);
    const script = path.join(directory, 'simulate.ps1');
    fs.writeFileSync(script, `param([string]$Case)
$ErrorActionPreference = 'Stop'
$env:CCTI_WRAPPER_FIXTURE = $Case
function Get-ChildItem { param($Path, [switch]$File, $Filter); return [pscustomobject]@{FullName='inert-fixture.exe'} }
function Get-Content { param($Path, [switch]$Raw); return '{"version":"2026.10.1401"}' }
if ($Case -eq 'stale') { $global:LASTEXITCODE = 17 } else { Remove-Variable LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
$failed = $false
try {
${actual}
} catch { $failed = $true; $failure = $_.Exception.Message }
if ($Case -eq 'failure') {
  if (-not $failed -or $failure -notmatch 'fixture lifecycle failure') { throw 'Real helper failure was not propagated.' }
} else {
  if ($failed -or $global:LASTEXITCODE -ne 0) { throw "Successful wrapper falsely failed: $failure" }
}
Write-Output "PASS actual PowerShell lifecycle wrapper: $Case"
`);
    for (const test of ['unset', 'stale', 'failure']) {
      const result = cp.spawnSync('pwsh', ['-NoProfile', '-File', script, test], { cwd: directory, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, `${test}: ${result.error?.message || result.stderr || result.stdout}`);
      process.stdout.write(result.stdout);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
