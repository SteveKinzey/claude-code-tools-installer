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
const raceMarker = path.join(fixtureRoot, 'mcp-registered-during-add');

const requiredMcps = {
  repomix: {
    item: 'repomix',
    addCommand: 'mcp add repomix -- npx -y repomix --mcp',
  },
  playwright: {
    item: 'playwright-mcp',
    addCommand: 'mcp add playwright npx @playwright/mcp@latest',
  },
};

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
name="\${3:-}"
mode="\${CCTI_MCP_TEST_MODE:-existing}"
target="\${CCTI_MCP_TEST_TARGET:-}"
if [[ "\${1:-}" == '--version' ]]; then
  printf 'claude fixture 1.0.0\\n'
  exit 0
fi
if [[ "\${1:-}" == 'mcp' && "\${2:-}" == 'get' && "$name" == "$target" && "$target" != '' ]]; then
  if [[ "$mode" != 'existing' && ! -f "$CCTI_MCP_RACE_MARKER" ]]; then
    printf '%s is not configured yet\\n' "$target" >&2
    exit 1
  fi
  printf '%s: existing local configuration\\n' "$target"
  exit 0
fi
if [[ "\${1:-}" == 'mcp' && "\${2:-}" == 'add' && "$name" == "$target" && "$target" != '' ]]; then
  touch "$CCTI_MCP_RACE_MARKER"
  if [[ "$mode" == 'race' ]]; then
    printf 'MCP server %s already exists in local config\\n' "$target" >&2
    exit 1
  fi
  printf 'MCP server %s added\\n' "$target"
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

async function testBashAdapter(scriptName, name, mode = 'existing') {
  const definition = requiredMcps[name];
  await fs.writeFile(commandLog, '', 'utf8');
  await fs.rm(raceMarker, { force: true });
  const result = spawnSync('bash', [path.join(root, scriptName), '--item', definition.item, '--yes', '--no-launch'], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      CCTI_MCP_TEST_LOG: commandLog,
      CCTI_MCP_TEST_MODE: mode,
      CCTI_MCP_TEST_TARGET: name,
      CCTI_MCP_RACE_MARKER: raceMarker,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${scriptName} must treat an existing or concurrently-created ${name} MCP registration as a successful no-op.\n${result.stdout}\n${result.stderr}`);
  const expectedMessage = mode === 'race'
    ? /was already registered while CCTI was setting it up/
    : mode === 'missing'
      ? new RegExp(`MCP server added and verified: ${name}`)
      : new RegExp(`Existing MCP server detected: ${name}`);
  assert.match(result.stdout, expectedMessage, `${scriptName} must clearly report the resolved ${name} registration.`);

  const calls = (await fs.readFile(commandLog, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(count(calls, `mcp get ${name}`), mode === 'existing' ? 1 : 2, `${scriptName} must query ${name} before setup and after an add result.`);
  assert.equal(count(calls, definition.addCommand), mode === 'existing' ? 0 : 1, `${scriptName} must add ${name} only when the direct lookup reports it missing.`);
  assert.equal(calls.some((line) => line.startsWith('mcp list')), false, `${scriptName} must not health-check every MCP server to check ${name}.`);
}

async function run() {
  try {
    await Promise.all([fs.mkdir(home, { recursive: true }), fs.mkdir(fakeBin, { recursive: true })]);
    await createFixtureCommands();
    for (const scriptName of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
      for (const name of Object.keys(requiredMcps)) {
        await testBashAdapter(scriptName, name);
        await testBashAdapter(scriptName, name, 'missing');
        await testBashAdapter(scriptName, name, 'race');
      }
    }

    for (const scriptName of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
      const source = await fs.readFile(path.join(root, scriptName), 'utf8');
      assert.match(source, /claude mcp get "\$name" >\/dev\/null 2>&1/, `${scriptName} must use a direct MCP query.`);
      assert.match(source, /MCP server added and verified:/, `${scriptName} must verify a successful MCP add.`);
      assert.match(source, /was already registered while CCTI was setting it up/, `${scriptName} must reconcile a duplicate-name race.`);
    }

    const windowsSource = await fs.readFile(path.join(root, 'setup-my-claude.ps1'), 'utf8');
    assert.match(windowsSource, /& claude mcp get \$Name \*> \$null/, 'The Windows adapter must use a direct MCP query.');
    assert.match(windowsSource, /MCP server added and verified:/, 'The Windows adapter must verify a successful MCP add.');
    assert.match(windowsSource, /was already registered while CCTI was setting it up/, 'The Windows adapter must reconcile a duplicate-name race without overwriting the existing connection.');
    console.log('MCP registration idempotency passed: Repomix and Playwright are queried directly; existing servers are skipped, missing servers are verified after add, and duplicate-name races preserve user configuration.');
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
