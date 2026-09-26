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

// 2. spawnSafely decisions, with a recording spawn so nothing runs.
const calls = [];
const recordSpawn = (command, args, options) => { calls.push({ command, args, options }); return { recorded: true }; };
spawnSafely('npm.cmd', ['uninstall', 'x&calc'], { cwd: 'C:\\p' }, { platform: 'win32', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'npm.cmd uninstall "x&calc"', args: [], options: { cwd: 'C:\\p', shell: true } }, 'a Windows .cmd target must run through cmd.exe with every argument quoted');
spawnSafely('C:\\Users\\Jane Doe\\claude.CMD', ['--version'], {}, { platform: 'win32', spawn: recordSpawn });
assert.equal(calls.pop().command, '"C:\\Users\\Jane Doe\\claude.CMD" --version', 'a .cmd path with a space must be quoted');
spawnSafely('C:\\Program Files\\Claude\\claude.exe', ['a&b'], { windowsHide: true }, { platform: 'win32', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'C:\\Program Files\\Claude\\claude.exe', args: ['a&b'], options: { windowsHide: true } }, 'a Windows .exe target must still be spawned directly without a shell');
spawnSafely('npm.cmd', ['a&b'], { cwd: '/p' }, { platform: 'darwin', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'npm.cmd', args: ['a&b'], options: { cwd: '/p' } }, 'non-Windows behavior must not change');
spawnSafely('npm', ['install', 'x y'], { cwd: '/p' }, { platform: 'linux', spawn: recordSpawn });
assert.deepEqual(calls.pop(), { command: 'npm', args: ['install', 'x y'], options: { cwd: '/p' } }, 'non-Windows behavior must not change');
assert.throws(() => spawnSafely('npm.cmd', ['a%PATH%'], {}, { platform: 'win32', spawn: recordSpawn }), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT');
assert.throws(() => spawnSafely('C:\\100%\\claude.cmd', ['--version'], {}, { platform: 'win32', spawn: recordSpawn }), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT');
assert.equal(calls.length, 0, 'an unsafe argument or command must never reach spawn');

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
    const args = ['plain', 'x y', 'a&echo pwned>marker.txt', 'R&D', '(x)', 'a^b', 'a|b', 'https://h/marketplace.json?a=1&b=2', 'C:\\trail dir\\', '--depth=0'];
    const result = await collect(spawnSafely(probe, args, { cwd: dir, windowsHide: true }));
    assert.equal(result.code, 0, `probe should exit cleanly: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), args, 'every argument must reach the program exactly as given');
    assert.equal(fs.existsSync(path.join(dir, 'marker.txt')), false, 'cmd.exe must not run text after & as a command');
    assert.equal(fs.existsSync(path.join(tempRoot, 'marker.txt')), false, 'cmd.exe must not run text after & as a command');

    let spawned = false;
    assert.throws(() => spawnSafely(probe, ['a%PATH%'], { cwd: dir }, { spawn: () => { spawned = true; } }), (error) => error.code === 'UNSAFE_WINDOWS_ARGUMENT');
    assert.equal(spawned, false, 'a %VAR% argument must be refused before anything is spawned');
    console.log('Windows command quoting and live cmd.exe round trip passed.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
