#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');
const outputDirectory = path.join(root, 'docs', 'audits');
const requestedOutput = process.argv[2] ? path.resolve(process.argv[2]) : path.join(outputDirectory, 'deduplication-restoration-audit.json');
const temporaryA11yEvidence = path.join(outputDirectory, `.duplicate-skill-a11y-${process.pid}.json`);

function run(label, command, args, cwd = desktop, extraEnvironment = {}) {
  const startedAt = new Date().toISOString();
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnvironment },
    });
    return { label, command: [command, ...args].join(' '), startedAt, finishedAt: new Date().toISOString(), ok: true, output };
  } catch (error) {
    return {
      label,
      command: [command, ...args].join(' '),
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    };
  }
}

function redact(value) {
  return String(value || '')
    .replaceAll(root, '<repo>')
    .replace(/\/Users\/[^/\s]+/g, '<user-home>')
    .replace(/\/home\/[^/\s]+/g, '<user-home>')
    .replace(/\/var\/folders\/[^\s]+/g, '<temporary-fixture>')
    .replace(/([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Za-z0-9_]*)=\S+/g, '$1=<redacted>');
}

function parseA11yAudit(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) throw new Error('The duplicate-skill accessibility audit did not emit JSON evidence.');
  return JSON.parse(jsonLine);
}

async function main() {
  await fsp.rm(temporaryA11yEvidence, { force: true });
  const checks = [
    run('Static UI and IPC contract', 'npm', ['run', 'ui:check']),
    run('Duplicate preview renderer integration', 'npm', ['run', 'duplicate-skill-ui:check']),
    run('Deduplication and restoration safety fixture', 'npm', ['run', 'setup-manager:check']),
    run('Independent project portability fixture', 'npm', ['run', 'duplicate-skill:portability']),
    run('Duplicate preview accessibility and live-announcement audit', 'npm', ['run', 'duplicate-skill:a11y'], desktop, { CCTI_A11Y_REPORT_PATH: temporaryA11yEvidence }),
    run('Full desktop quality gate', 'npm', ['run', 'check']),
  ];
  const failedChecks = checks.filter((check) => !check.ok);
  let accessibility = null;
  const accessibilityCheck = checks.find((check) => check.label.includes('accessibility'));
  if (accessibilityCheck?.ok) {
    try {
      accessibility = JSON.parse(await fsp.readFile(temporaryA11yEvidence, 'utf8'));
    } catch {
      accessibility = parseA11yAudit(accessibilityCheck.output);
    }
  }

  const commit = run('Source commit', 'git', ['rev-parse', 'HEAD'], root);
  if (!commit.ok) throw new Error('Could not read the source commit.');
  const report = {
    schemaVersion: '1.0',
    reportType: 'ccti-deduplication-restoration-audit',
    generatedAt: new Date().toISOString(),
    source: {
      repository: 'SteveKinzey/claude-code-tools-installer',
      commit: commit.output.trim(),
      pathsReviewed: [
        'desktop/src/main.js',
        'desktop/src/preload.js',
        'desktop/src/renderer/app.js',
        'desktop/src/renderer/index.html',
        'scripts/test-setup-manager.js',
        'scripts/test-duplicate-skill-portability.js',
        'scripts/test-duplicate-skill-ui.js',
        'scripts/audit-duplicate-skill-accessibility.js',
      ],
    },
    scope: {
      deduplication: 'Direct Claude Code skill folders in the user skill root and one selected project skill root.',
      restoration: 'Only CCTI-owned timestamped backup folders whose original destination is empty.',
      privacy: 'Fixture-only evidence; real user paths, file contents, credentials, and environment values are excluded.',
    },
    assertions: {
      contentHashCollisionDetection: 'verified by the setup-manager fixture',
      exactBackupPreview: 'verified by the renderer fixture',
      corruptedBackupManifest: 'verified by changing a nested backup file after review; apply rejects the restore and leaves both backup and original destination unchanged',
      missingBackupFile: 'verified by removing SKILL.md after review; apply fails safely, preserves the remaining backup folder, and leaves the original destination unchanged',
      noOverwriteRestore: 'verified by an occupied original skill destination fixture',
      newestBackupSelection: 'verified when multiple timestamped backups target the same original destination',
      independentProjectPortability: 'verified with separately named fixture roots and differently named skills with identical complete content',
      ariaLiveInventory: 'verified in a rendered hidden Electron window',
      backupAndRestoreAnnouncements: 'verified as polite status announcements with preview-heading focus transfer',
    },
    accessibility,
    checks: checks.map((check) => ({
      label: check.label,
      command: check.command,
      startedAt: check.startedAt,
      finishedAt: check.finishedAt,
      ok: check.ok,
      exitCode: check.ok ? 0 : check.exitCode,
      log: redact(check.output),
    })),
    status: failedChecks.length ? 'failed' : 'passed',
  };

  await fsp.mkdir(path.dirname(requestedOutput), { recursive: true });
  await fsp.writeFile(requestedOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fsp.rm(temporaryA11yEvidence, { force: true });
  process.stdout.write(`${requestedOutput}\n`);
  if (failedChecks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
