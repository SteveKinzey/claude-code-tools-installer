#!/usr/bin/env node
// Proves CCTI passes arguments to Windows command scripts (.cmd) without letting cmd.exe treat
// them as commands. The quoting table runs everywhere; the live cmd.exe round trip runs only on
// Windows (Windows CI runs `npm run check`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { cmdQuote, windowsShellInvocation, spawnSafely } = require(path.join(root, 'desktop', 'src', 'windows-command.js'));

// 1. Quoting table.
for (const plain of ['plain', 'npm.cmd', 'uninstall', '--ignore-scripts', '--depth=0', '@convex-dev/agent', 'owner/repo', 'C:\\Users\\Jane\\x.cmd', 'https://h/marketplace.json', 'a+b,c', 'plugin@market']) {
  assert.equal(cmdQuote(plain), plain, `${plain} should pass unchanged`);
}
const quoted = {
  'a&b': '"a&b"',
  'x y': '"x y"',
  'R&D': '"R&D"',
  'C:\\Users\\Jane Doe\\x.cmd': '"C:\\Users\\Jane Doe\\x.cmd"',
  'https://h/marketplace.json?a=1&b=2': '"https://h/marketplace.json?a=1&b=2"',
  '(x)': '"(x)"',
  'a^b': '"a^b"',
  'a|b': '"a|b"',
  'a<b>c': '"a<b>c"',
  'a;b': '"a;b"',
  'x&calc': '"x&calc"',
  '': '""',
  'C:\\trail dir\\': '"C:\\trail dir\\\\"',
};
for (const [input, expected] of Object.entries(quoted)) {
  assert.equal(cmdQuote(input), expected, `${JSON.stringify(input)} should be quoted`);
}
for (const unsafe of ['a%PATH%', '%x', 'a!b', 'a"b', 'a\nb', 'a\rb', 'a\0b', 'R&D "x"', undefined, null, 42, {}, ['a']]) {
  assert.throws(() => cmdQuote(unsafe), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT', `${String(unsafe)} must be refused`);
}
assert.deepEqual(
  windowsShellInvocation('C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\claude.cmd', ['plugin', 'marketplace', 'add', 'C:\\Work\\R&D market']),
  { command: '"C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\claude.cmd"', args: ['plugin', 'marketplace', 'add', '"C:\\Work\\R&D market"'] },
);

const { quoteCommand } = require(path.join(__dirname, '..', 'desktop', 'src', 'windows-command.js'));
assert.equal(quoteCommand('npm.cmd'), 'npm.cmd', 'a bare name stays unquoted so its %~dp0 still resolves to its own folder');
assert.equal(quoteCommand('C:\\Tools\\npm.cmd'), 'C:\\Tools\\npm.cmd');
assert.equal(quoteCommand('C:/x/npm.cmd'), '"C:/x/npm.cmd"', 'a / ends an unquoted command name, so it is quoted');
assert.equal(quoteCommand('C:\\a,b\\claude.cmd'), '"C:\\a,b\\claude.cmd"');

for (const control of ['a\tb', 'a\u007fb', 'a\u001bb']) {
  assert.throws(() => cmdQuote(control), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT', `${JSON.stringify(control)} must be refused`);
}

// 2. spawnSafely decisions, with a recording spawn so nothing runs.
const calls = [];
const recordSpawn = (command, args, options) => { calls.push({ command, args, options }); return { recorded: true }; };
// A bare name is resolved from absolute PATH entries only; the project folder (cwd) is never searched.
const fakeFiles = new Set(['C:\\Tools\\npm.cmd', 'C:\\Program Files\\nodejs\\npm.cmd', 'C:\\Windows\\System32\\where.exe']);
const fakeIsFile = (candidate) => fakeFiles.has(candidate);
const winEnv = { PATH: 'C:\\Tools;C:\\Windows\\System32', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
spawnSafely('npm.cmd', ['uninstall', 'x&calc'], { cwd: 'C:\\p', env: winEnv }, { platform: 'win32', spawn: recordSpawn, isFile: fakeIsFile });
assert.deepEqual(calls.pop(), { command: 'C:\\Tools\\npm.cmd uninstall "x&calc"', args: [], options: { cwd: 'C:\\p', env: winEnv, shell: true } }, 'a Windows .cmd target must be resolved to an absolute path and run through cmd.exe with every argument quoted');
const spacedEnv = { PATH: 'C:\\Program Files\\nodejs', PATHEXT: '.EXE;.CMD' };
spawnSafely('npm.cmd', ['install', 'a'], { cwd: 'C:\\p', env: spacedEnv }, { platform: 'win32', spawn: recordSpawn, isFile: fakeIsFile });
assert.equal(calls.pop().command, '"C:\\Program Files\\nodejs\\npm.cmd" install a', 'an ABSOLUTE .cmd path with a space is quoted (safe for %~dp0, unlike a quoted bare name)');
spawnSafely('where.exe', ['wt'], { env: winEnv }, { platform: 'win32', spawn: recordSpawn, isFile: fakeIsFile });
assert.deepEqual(calls.pop(), { command: 'C:\\Windows\\System32\\where.exe', args: ['wt'], options: { env: winEnv } }, 'a bare .exe is resolved to an absolute path and spawned without a shell');
// A planted npm.cmd in the project folder must never be chosen: the project is not on PATH and
// relative/empty/drive-relative PATH entries are ignored.
const plantedFiles = new Set(['C:\\Project\\npm.cmd', 'npm.cmd', '.\\npm.cmd', 'C:npm.cmd', '\\npm.cmd', 'bin\\npm.cmd']);
const plantedEnv = { PATH: ';.;bin;C:;\\;', PATHEXT: '.CMD' };
assert.throws(() => spawnSafely('npm.cmd', ['install'], { cwd: 'C:\\Project', env: plantedEnv }, { platform: 'win32', spawn: recordSpawn, isFile: (candidate) => plantedFiles.has(candidate) }), (error) => error.code === 'WINDOWS_EXECUTABLE_NOT_FOUND', 'an unresolvable command must fail instead of falling back to the bare name');
assert.equal(calls.length, 0, 'an unresolvable command must never reach spawn');
spawnSafely('C:\\Users\\Jane Doe\\claude.CMD', ['--version'], {}, { platform: 'win32', spawn: recordSpawn });
assert.equal(calls.pop().command, '"C:\\Users\\Jane Doe\\claude.CMD" --version', 'a .cmd path with a space must be quoted');
spawnSafely('C:\\Program Files\\Claude\\claude.exe', ['a&b'], { windowsHide: true }, { platform: 'win32', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'C:\\Program Files\\Claude\\claude.exe', args: ['a&b'], options: { windowsHide: true } }, 'a Windows .exe target must still be spawned directly without a shell');
spawnSafely('npm.cmd', ['a&b'], { cwd: '/p' }, { platform: 'darwin', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'npm.cmd', args: ['a&b'], options: { cwd: '/p' } }, 'non-Windows behavior must not change');
spawnSafely('npm', ['install', 'x y'], { cwd: '/p' }, { platform: 'linux', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'npm', args: ['install', 'x y'], options: { cwd: '/p' } }, 'non-Windows behavior must not change');
assert.throws(() => spawnSafely('npm.cmd', ['a%PATH%'], { env: winEnv }, { platform: 'win32', spawn: recordSpawn, isFile: fakeIsFile }), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT');
assert.throws(() => spawnSafely('C:\\100%\\claude.cmd', ['--version'], {}, { platform: 'win32', spawn: recordSpawn }), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT');
assert.equal(calls.length, 0, 'an unsafe argument or command must never reach spawn');

// 3. resolveWindowsExecutable: absolute PATH entries only, PATHEXT honored, never cwd.
{
  const { resolveWindowsExecutable, isAbsoluteWindowsPath } = require(path.join(root, 'desktop', 'src', 'windows-command.js'));
  const files = new Set([
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Users\\Jane\\AppData\\Roaming\\npm\\claude.cmd',
    'C:\\Users\\Jane\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe',
    '\\\\server\\share\\tools\\tool.bat',
  ]);
  const isFile = (candidate) => files.has(candidate);
  const PATH = [
    '', '.', 'relative\\bin', 'C:', '\\rooted-no-drive',
    '"C:\\Program Files\\PowerShell\\7"',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    'C:\\Users\\Jane\\AppData\\Roaming\\npm',
    'C:\\Users\\Jane\\AppData\\Local\\Microsoft\\WindowsApps',
    '\\\\server\\share\\tools',
  ].join(';');
  const opts = { pathValue: PATH, pathext: '.COM;.EXE;.BAT;.CMD', isFile };
  assert.equal(resolveWindowsExecutable('pwsh.exe', opts), 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'a quoted PATH entry is unquoted');
  assert.equal(resolveWindowsExecutable('powershell.exe', opts), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(resolveWindowsExecutable('claude', opts), 'C:\\Users\\Jane\\AppData\\Roaming\\npm\\claude.cmd', 'PATHEXT is honored for a name without an extension');
  assert.equal(resolveWindowsExecutable('winget', opts), 'C:\\Users\\Jane\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe');
  assert.equal(resolveWindowsExecutable('tool', opts), '\\\\server\\share\\tools\\tool.bat', 'a UNC PATH entry is absolute');
  assert.equal(resolveWindowsExecutable('C:\\Abs\\x.cmd', opts), 'C:\\Abs\\x.cmd', 'an absolute path is used as given');
  // claude.cmd is not found when PATHEXT excludes .CMD.
  assert.throws(() => resolveWindowsExecutable('claude', { ...opts, pathext: '.EXE' }), (error) => error.code === 'WINDOWS_EXECUTABLE_NOT_FOUND');
  // Relative names, drive-relative names and names absent from absolute PATH entries are refused.
  const everywhere = () => true;
  for (const bad of ['.\\npm.cmd', 'bin\\npm.cmd', 'bin/npm.cmd', 'C:npm.cmd', '', '   ', null, undefined]) {
    assert.throws(() => resolveWindowsExecutable(bad, { ...opts, isFile: everywhere }), (error) => error.code === 'WINDOWS_EXECUTABLE_NOT_FOUND', `${JSON.stringify(bad)} must be refused`);
  }
  const seen = [];
  assert.throws(() => resolveWindowsExecutable('npm.cmd', { pathValue: ';.;relative;C:;\\x', pathext: '.CMD', isFile: (candidate) => { seen.push(candidate); return true; } }), (error) => error.code === 'WINDOWS_EXECUTABLE_NOT_FOUND');
  assert.deepEqual(seen, [], 'no relative, empty or drive-relative PATH entry is ever probed');
  for (const value of ['C:\\x', 'c:/x', '\\\\srv\\share']) assert.equal(isAbsoluteWindowsPath(value), true, value);
  for (const value of ['x', '.\\x', 'C:x', '\\x', '\\\\srv', '']) assert.equal(isAbsoluteWindowsPath(value), false, value);
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function run() {
  // 3. Non-Windows smoke check: the real spawn path still passes arguments verbatim.
  if (process.platform !== 'win32') {
    const result = await collect(spawnSafely(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'x y', 'a&b'], {}));
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), ['x y', 'a&b']);
    console.log('Windows command quoting passed (live cmd.exe round trip runs only on Windows).');
    return;
  }

  // 4. Windows only: a real cmd.exe round trip through a .cmd script in a folder whose path
  //    contains a space and `&`, using the same spawnSafely that runProcess and the component
  //    install use.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-wincmd-'));
  const dir = path.join(tempRoot, 'ccti cmd & test');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'probe.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'probe.cmd'), `@"${process.execPath}" "%~dp0probe.js" %*\r\n`, 'utf8');
    const probe = path.join(dir, 'probe.cmd');
    // The last argument is quoted and ends in a backslash, and `a,b` / `+x` pass through %* unquoted.
    const args = ['plain', 'x y', 'a&echo pwned>marker.txt', 'R&D', '(x)', 'a^b', 'a|b', 'https://h/marketplace.json?a=1&b=2', '--depth=0', 'a,b', '+x', 'C:\\trail dir\\'];
    const result = await collect(spawnSafely(probe, args, { cwd: dir, windowsHide: true }));
    assert.equal(result.code, 0, `probe should exit cleanly: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), args, 'every argument must reach the program exactly as given');
    assert.equal(fs.existsSync(path.join(dir, 'marker.txt')), false, 'cmd.exe must not run text after & as a command');
    assert.equal(fs.existsSync(path.join(tempRoot, 'marker.txt')), false, 'cmd.exe must not run text after & as a command');

    let spawned = false;
    assert.throws(() => spawnSafely(probe, ['a%PATH%'], { cwd: dir }, { spawn: () => { spawned = true; } }), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT');
    assert.equal(spawned, false, 'a %VAR% argument must be refused before anything is spawned');

    // A command planted in the working folder (and absent from PATH) must not be found or run.
    fs.writeFileSync(path.join(dir, 'ccti-planted-probe.cmd'), '@echo planted>planted-marker.txt\r\n', 'utf8');
    assert.throws(() => spawnSafely('ccti-planted-probe.cmd', [], { cwd: dir, windowsHide: true }), (error) => error.code === 'WINDOWS_EXECUTABLE_NOT_FOUND');
    assert.equal(fs.existsSync(path.join(dir, 'planted-marker.txt')), false, 'a command in the working folder must never run');
    // The same command, reached through an absolute PATH entry, resolves and runs.
    const viaPath = await collect(spawnSafely('probe.cmd', ['ok'], { cwd: tempRoot, windowsHide: true, env: { ...process.env, PATH: `${dir};${process.env.PATH || process.env.Path || ''}`, Path: undefined } }));
    assert.equal(viaPath.code, 0, `probe via PATH should exit cleanly: ${viaPath.stderr}`);
    assert.deepEqual(JSON.parse(viaPath.stdout.trim()), ['ok']);
    console.log('Windows command quoting and live cmd.exe round trip passed.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
