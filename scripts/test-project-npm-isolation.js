#!/usr/bin/env node
// Proves project-scope setup runs npx inside the selected project (so skills land in
// <project>/.claude/skills) while npm itself ignores the project's own .npmrc and node_modules:
// every adapter npx call passes `--prefix <fresh, empty CCTI-owned folder>`.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(require('node:fs').realpathSync(os.tmpdir()), `ccti-npm-isolation-${process.pid}`);
const home = path.join(fixtureRoot, 'home');
const project = path.join(fixtureRoot, 'untrusted project');
const fakeBin = path.join(fixtureRoot, 'bin');
const npxLog = path.join(fixtureRoot, 'npx-calls.log');
const evilRegistry = 'http://127.0.0.1:9/';
// The adapters pin the third-party CLIs they run; read the reviewed versions from the macOS adapter
// (scripts/test-pinned-setup-code.js proves all three adapters carry identical pins).
const pinnedVersion = (name) => {
  const match = require('node:fs').readFileSync(path.join(root, 'setup-my-claude.sh'), 'utf8').match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (!match) throw new Error(`setup-my-claude.sh must pin ${name}`);
  return match[1];
};
const skillsCliVersion = pinnedVersion('CCTI_SKILLS_CLI_VERSION');
const claudeMemVersion = pinnedVersion('CCTI_CLAUDE_MEM_VERSION');

async function writeExecutable(name, source) {
  await fs.writeFile(path.join(fakeBin, name), source, { encoding: 'utf8', mode: 0o755 });
}

async function createFixtureCommands() {
  const versionCommand = "#!/usr/bin/env bash\nprintf 'fixture 1.0.0\\n'\n";
  await Promise.all(['node', 'npm', 'git'].map((name) => writeExecutable(name, versionCommand)));
  await writeExecutable('claude', "#!/usr/bin/env bash\nif [[ \"${1:-}\" == '--version' ]]; then printf 'claude fixture 1.0.0\\n'; exit 0; fi\nexit 0\n");
  // The fake npx records where it ran, its arguments, and what the --prefix folder held, then
  // simulates the skills CLI writing into the folder it runs in.
  await writeExecutable('npx', `#!/usr/bin/env bash
set -u
prefix=''
if [[ "\${1:-}" == '--prefix' ]]; then prefix="\${2:-}"; fi
contents=''
if [[ -n "$prefix" && -d "$prefix" ]]; then contents="$(ls -A "$prefix")"; fi
printf '%s\\t%s\\t%s\\t%s\\n' "$PWD" "$prefix" "[$contents]" "$*" >> "$CCTI_NPX_LOG"
if [[ " $* " == *' skills@'*' add '* ]]; then
  skill=''
  prev=''
  for arg in "$@"; do
    if [[ "$prev" == '--skill' ]]; then skill="$arg"; fi
    prev="$arg"
  done
  mkdir -p "$PWD/.claude/skills/$skill"
  printf '# %s\\n' "$skill" > "$PWD/.claude/skills/$skill/SKILL.md"
fi
exit 0
`);
}

function runAdapter(scriptName, args) {
  return spawnSync('bash', [path.join(root, scriptName), ...args], {
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      CCTI_NPX_LOG: npxLog,
    },
    encoding: 'utf8',
  });
}

async function readCalls() {
  return (await fs.readFile(npxLog, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [cwd, prefix, contents, args] = line.split('\t');
    return { cwd, prefix, contents, args };
  });
}

function assertIsolated(call, scriptName) {
  assert.equal(path.resolve(call.cwd), path.resolve(project), `${scriptName} must still run npx in the selected project folder`);
  assert.ok(call.prefix, `${scriptName} must pass --prefix so npm ignores the project's .npmrc`);
  assert.ok(path.resolve(call.prefix).startsWith(path.resolve(home, '.setup-my-claude') + path.sep), `${scriptName} must use a CCTI-owned prefix folder`);
  assert.equal(path.resolve(call.prefix).startsWith(path.resolve(project)), false, `${scriptName} must not use a prefix inside the project`);
  assert.equal(call.contents, '[]', `${scriptName} must use an empty prefix folder (no .npmrc or package.json)`);
}

async function testBashAdapter(scriptName) {
  await fs.writeFile(npxLog, '', 'utf8');
  await fs.rm(path.join(project, '.claude'), { recursive: true, force: true });
  const skill = runAdapter(scriptName, ['--item', 'planning-with-files', '--yes', '--no-launch', '--skill-scope', 'project']);
  assert.equal(skill.status, 0, `${scriptName} project skill install must succeed.\n${skill.stdout}\n${skill.stderr}`);
  const mem = runAdapter(scriptName, ['--item', 'claude-mem', '--yes', '--no-launch']);
  assert.equal(mem.status, 0, `${scriptName} claude-mem install must succeed.\n${mem.stdout}\n${mem.stderr}`);
  const calls = await readCalls();
  assert.equal(calls.length, 2, `${scriptName} must run exactly the two npx commands: ${JSON.stringify(calls)}`);
  const [skillCall, memCall] = calls;
  assertIsolated(skillCall, scriptName);
  assert.equal(skillCall.args, `--prefix ${skillCall.prefix} -y skills@${skillsCliVersion} add https://github.com/OthmanAdi/planning-with-files --skill planning-with-files --agent claude-code --yes`);
  assertIsolated(memCall, scriptName);
  assert.equal(memCall.args, `--prefix ${memCall.prefix} -y claude-mem@${claudeMemVersion} install`);
  assert.equal((await fs.readFile(path.join(project, '.claude', 'skills', 'planning-with-files', 'SKILL.md'), 'utf8')).trim(), '# planning-with-files', `${scriptName} must still place a project skill in <project>/.claude/skills`);
  for (const call of calls) {
    await assert.rejects(fs.access(call.prefix), `${scriptName} must remove its temporary prefix folder`);
  }
  const dryRun = runAdapter(scriptName, ['--item', 'planning-with-files', '--yes', '--no-launch', '--dry-run', '--skill-scope', 'project']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
}

// Real npm (no network): the project's .npmrc is honored by default, and ignored with --prefix.
function testRealNpmBehavior() {
  if (process.platform === 'win32') return 'skipped on Windows';
  // Use the empty fixture home and drop every registry override, so neither the developer's own
  // ~/.npmrc nor an inherited npm_config_registry (any casing) can decide the result.
  const npmEnv = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of Object.keys(npmEnv)) {
    if (key.toLowerCase() === 'npm_config_registry' || key.toLowerCase() === 'npm_config_userconfig') delete npmEnv[key];
  }
  const npm = (args) => spawnSync('npm', args, { cwd: project, encoding: 'utf8', env: npmEnv });
  const baseline = npm(['config', 'get', 'registry']);
  if (baseline.status !== 0) return 'skipped: npm unavailable';
  assert.equal(baseline.stdout.trim(), evilRegistry, 'fixture sanity: npm reads the project .npmrc when run in the project without --prefix');
  const emptyPrefix = path.join(fixtureRoot, 'empty-prefix');
  const isolated = npm(['config', 'get', 'registry', '--prefix', emptyPrefix]);
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.notEqual(isolated.stdout.trim(), evilRegistry, 'npm must ignore the project .npmrc when --prefix names an empty CCTI folder');
  return 'checked';
}

async function run() {
  try {
    await Promise.all([fs.mkdir(home, { recursive: true }), fs.mkdir(fakeBin, { recursive: true }), fs.mkdir(project, { recursive: true }), fs.mkdir(path.join(fixtureRoot, 'empty-prefix'), { recursive: true })]);
    await fs.writeFile(path.join(project, 'package.json'), '{"name":"untrusted"}\n', 'utf8');
    await fs.writeFile(path.join(project, '.npmrc'), `registry=${evilRegistry}\n`, 'utf8');
    await createFixtureCommands();
    // The bash adapters run on macOS and Linux; Windows bash path spellings differ.
    if (process.platform !== 'win32') {
      for (const scriptName of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) await testBashAdapter(scriptName);
    }

    const windowsSource = await fs.readFile(path.join(root, 'setup-my-claude.ps1'), 'utf8');
    assert.match(windowsSource, /Invoke-Logged npx \(@\("--prefix", \$prefixDir\) \+ \$Arguments\)/, 'The Windows adapter must pass --prefix <CCTI folder> to npx.');
    assert.match(windowsSource, /Invoke-NpxIsolated \$skillArguments/, 'The Windows adapter must install skills through the isolated npx helper.');
    assert.match(windowsSource, /Invoke-NpxIsolated @\("-y", "claude-mem@\$CCTI_CLAUDE_MEM_VERSION", "install"\)/, 'The Windows adapter must install Claude-Mem through the isolated npx helper.');
    assert.equal(/Invoke-Logged npx (?!\(@\("--prefix")/.test(windowsSource), false, 'The Windows adapter must not run npx without --prefix.');
    for (const scriptName of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
      const source = await fs.readFile(path.join(root, scriptName), 'utf8');
      assert.equal(/run_cmd npx /.test(source), false, `${scriptName} must not run npx without --prefix.`);
    }
    const realNpm = testRealNpmBehavior();
    console.log(`Project npm isolation passed: npx runs in the project with an empty CCTI --prefix, skills still land in the project, and the project .npmrc is ignored (real npm check: ${realNpm}).`);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
