#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(os.tmpdir(), `ccti-mcp-idempotency-${process.pid}`);
const home = path.join(fixtureRoot, 'home');
const fakeBin = path.join(fixtureRoot, 'bin');
const commandLog = path.join(fixtureRoot, 'claude-commands.log');

async function writeExecutable(name, source) {
  const file = path.join(fakeBin, name);
  await fs.writeFile(file, source, { encoding: 'utf8', mode: 0o755 });
  return file;
}

async function createFixtureCommands() {
  const versionCommand = `#!/usr/bin/env bash
printf 'fixture 1.0.0\\n'
`;
  await Promise.all(['node', 'npm', 'npx', 'git', 'bun', 'repomix'].map((name) => writeExecutable(name, versionCommand)));
  await writeExecutable('claude', `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$CCTI_MCP_TEST_LOG"
if [[ "\${1:-}" == '--version' ]]; then
  printf 'claude fixture 1.0.0\\n'
  exit 0
fi
if [[ "\${1:-}" == 'mcp' && "\${2:-}" == 'get' && "\${3:-}" == 'repomix' ]]; then
  printf 'repomix: existing local configuration\\n'
  exit 0
fi
if [[ "\${1:-}" == 'mcp' && "\${2:-}" == 'get' && "\${3:-}" == 'playwright' ]]; then
  printf 'playwright is not configured\\n' >&2
  exit 1
fi
if [[ "\${1:-}" == 'mcp' && "\${2:-}" == 'add' && "\${3:-}" == 'playwright' && "\${4:-}" == 'npx' && "\${5:-}" == '@playwright/mcp@latest' ]]; then
  printf 'playwright added\\n'
  exit 0
fi
if [[ "\${1:-}" == 'mcp' && "\${2:-}" == 'list' ]]; then
  printf 'mcp list must not be used to check one registration\\n' >&2
  exit 90
fi
printf 'Unexpected Claude fixture command: %s\\n' "$*" >&2
exit 91
`);
}

function count(lines, expected) {
  return lines.filter((line) => line === expected).length;
}

async function testBashAdapter(scriptName) {
  await fs.writeFile(commandLog, '', 'utf8');
  const result = spawnSync('bash', [path.join(root, scriptName), '--item', 'repomix', '--yes', '--no-launch'], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      CCTI_MCP_TEST_LOG: commandLog,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${scriptName} must treat an existing Repomix MCP registration as a successful no-op.\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Existing MCP server detected: repomix/, `${scriptName} must report the existing registration clearly.`);
  const calls = (await fs.readFile(commandLog, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(count(calls, 'mcp get repomix'), 1, `${scriptName} must query the exact MCP registration once.`);
  assert.equal(count(calls, 'mcp add repomix -- npx -y repomix --mcp'), 0, `${scriptName} must not re-add Repomix when it is already configured.`);
  assert.equal(calls.some((line) => line.startsWith('mcp list')), false, `${scriptName} must not health-check every MCP server to check one registration.`);
}

async function testMissingPlaywrightInstall(scriptName) {
  await fs.writeFile(commandLog, '', 'utf8');
  const result = spawnSync('bash', [path.join(root, scriptName), '--item', 'playwright-mcp', '--yes', '--no-launch'], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      CCTI_MCP_TEST_LOG: commandLog,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${scriptName} must install a missing Playwright MCP connection.\n${result.stdout}\n${result.stderr}`);
  const calls = (await fs.readFile(commandLog, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(count(calls, 'mcp get playwright'), 1, `${scriptName} must query the named Playwright MCP registration once.`);
  assert.equal(count(calls, 'mcp add playwright npx @playwright/mcp@latest'), 1, `${scriptName} must add a missing Playwright MCP through the reviewed npx command.`);
  assert.equal(calls.some((line) => line.startsWith('mcp list')), false, `${scriptName} must not health-check every MCP server before installing Playwright.`);
}

async function run() {
  try {
    await Promise.all([fs.mkdir(home, { recursive: true }), fs.mkdir(fakeBin, { recursive: true })]);
    await createFixtureCommands();
    for (const scriptName of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
      await testBashAdapter(scriptName);
      await testMissingPlaywrightInstall(scriptName);
    }
    for (const scriptName of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
      const source = await fs.readFile(path.join(root, scriptName), 'utf8');
      assert.match(source, /claude mcp get "\$name" >\/dev\/null 2>&1/, `${scriptName} must use a direct MCP query.`);
      assert.equal(source.includes('claude mcp list'), false, `${scriptName} must not use broad MCP health checks for duplicate detection.`);
    }
    const windowsSource = await fs.readFile(path.join(root, 'setup-my-claude.ps1'), 'utf8');
    assert.match(windowsSource, /& claude mcp get \$Name \*> \$null/, 'The Windows adapter must use a direct MCP query.');
    assert.equal(windowsSource.includes('claude mcp list'), false, 'The Windows adapter must not use broad MCP health checks for duplicate detection.');
    assert.match(windowsSource, /Install-Mcp "playwright" \$Id @\("npx", "@playwright\/mcp@latest"\)/, 'The Windows adapter must add a missing Playwright MCP through the reviewed npx command.');
    console.log('MCP registration idempotency passed: existing Repomix is reused and missing Playwright is installed through named checks.');
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
