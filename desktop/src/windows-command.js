'use strict';

// Safe spawning of Windows command scripts (.cmd), such as npm.cmd and the claude.cmd shim.
//
// Threat: Node cannot start a .cmd file directly. Current Node refuses to spawn one without a
// shell (EINVAL, the CVE-2024-27980 hardening), and with `shell: true` Node runs
// `cmd.exe /d /s /c "<command> <args joined by spaces>"`. cmd.exe then parses that raw text,
// so an unquoted argument such as `x&calc` (a dependency name read from an untrusted project's
// package.json) or `R&D` (an ordinary folder name) is split at `&` and the rest runs as a second
// command. A path with a space, such as `C:\Users\Jane Doe\...\claude.cmd`, is split into words.
//
// Why these rules hold:
// - A token made only of letters, digits and . _ @ : / \ = + , - contains nothing cmd.exe treats
//   as an operator or separator that changes which program runs, so it is passed unchanged.
// - Anything else is wrapped in double quotes. Inside double quotes cmd.exe treats
//   & | < > ^ ( ) , ; = and spaces as literal text.
// - Double quotes cannot protect `%` or `!`: cmd.exe expands %VAR% (and !VAR! when delayed
//   expansion is on) even inside quotes. An embedded `"` would end the quoted region and cannot
//   be escaped reliably for cmd.exe. Carriage returns, line feeds and NUL end or corrupt the
//   command line. Values containing any of these are refused; nothing is spawned.
// - The .cmd shims hand %* to node.exe, which splits its command line with the Microsoft C
//   runtime rules. There, backslashes immediately before a closing quote escape it, so trailing
//   backslashes inside a quoted value are doubled to reach the program unchanged.

const childProcess = require('node:child_process');
const nodeFs = require('node:fs');
const path = require('node:path');

const PLAIN_TOKEN = /^[A-Za-z0-9._@:/\\=+,-]+$/;
// eslint-disable-next-line no-control-regex
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /["%!\u0000-\u001f\u007f]/;

function unsafeArgumentError(reason) {
  const error = new Error(`CCTI stopped this command because ${reason}. Windows cannot pass it to a command script safely.`);
  error.code = 'UNSAFE_WINDOWS_ARGUMENT';
  return error;
}

function cmdQuote(value) {
  if (typeof value !== 'string') throw unsafeArgumentError('one of its values is not text');
  if (UNSAFE_CHARACTERS.test(value)) throw unsafeArgumentError('one of its values contains a quote, %, !, or a hidden control character');
  if (PLAIN_TOKEN.test(value)) return value;
  return `"${value.replace(/(\\+)$/, '$1$1')}"`;
}

// The command token is quoted whenever it contains anything beyond letters, digits, `. _ @ - :`
// and `\`: cmd.exe ends an unquoted command name at `/ , ; = +` and spaces, so a path such as
// `C:\a,b\claude.cmd` would otherwise fail to launch. A bare name such as `npm.cmd` is left
// unquoted on purpose: when cmd.exe finds a *quoted* bare name on the PATH, the script's own
// `%~dp0` resolves to the working directory instead of the script's folder, and npm.cmd uses
// `%~dp0` to find npm itself.
const PLAIN_COMMAND = /^[A-Za-z0-9._@:\\-]+$/;
function quoteCommand(command) {
  const quoted = cmdQuote(command);
  if (quoted.startsWith('"') || PLAIN_COMMAND.test(quoted)) return quoted;
  return `"${quoted}"`;
}

function windowsShellInvocation(command, args) {
  return { command: quoteCommand(command), args: (args || []).map(cmdQuote) };
}

function usesWindowsCommandShell(command, platform = process.platform) {
  return platform === 'win32' && /\.cmd$/i.test(String(command));
}

// Threat: on Windows, a bare command name (npm.cmd, pwsh.exe, powershell.exe) is looked up in
// the *working directory first* -- by libuv when Node spawns without a shell, and by cmd.exe when
// it runs a .cmd. CCTI runs some commands with a user-chosen project folder as the working
// directory, so a planted `npm.cmd` or `pwsh.exe` in that folder would run instead of the real
// one. resolveWindowsExecutable turns a bare name into an absolute path by searching only
// absolute PATH entries (never the working directory, never an empty, relative or drive-relative
// entry), honoring PATHEXT. It refuses rather than falling back to the bare name.
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const ABSOLUTE_WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;

function executableNotFoundError(command, reason) {
  const error = new Error(`CCTI could not find ${command} in a trusted folder on this computer's PATH${reason ? ` (${reason})` : ''}. Install it or add its folder to PATH, then try again. Nothing was started.`);
  error.code = 'WINDOWS_EXECUTABLE_NOT_FOUND';
  return error;
}

function defaultIsFile(candidate) {
  try {
    return nodeFs.statSync(candidate).isFile();
  } catch {
    // App execution aliases (for example %LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe) are
    // reparse points that stat cannot follow; lstat still proves the entry exists.
    try {
      const entry = nodeFs.lstatSync(candidate);
      return entry.isFile() || entry.isSymbolicLink();
    } catch {
      return false;
    }
  }
}

function isAbsoluteWindowsPath(value) {
  return ABSOLUTE_WINDOWS_PATH.test(String(value || ''));
}

// `options` exists for tests: { pathValue, pathext, isFile }.
function resolveWindowsExecutable(command, options = {}) {
  const name = typeof command === 'string' ? command.trim() : '';
  if (!name) throw executableNotFoundError(String(command), 'no command name was given');
  // A drive or UNC path, or a rooted path such as \Tools\x.exe, never depends on the working
  // folder; a relative or drive-relative path (.\x.cmd, bin\x.cmd, C:x.cmd) does and is refused.
  if (isAbsoluteWindowsPath(name) || (path.win32.isAbsolute(name) && !/^[A-Za-z]:(?![\\/])/.test(name))) return name;
  if (/[\\/]/.test(name) || /^[A-Za-z]:/.test(name)) {
    throw executableNotFoundError(name, 'a relative path would resolve against the working folder');
  }
  const isFile = options.isFile || defaultIsFile;
  const pathValue = options.pathValue !== undefined ? options.pathValue : (process.env.PATH || process.env.Path || '');
  const pathextValue = options.pathext !== undefined ? options.pathext : (process.env.PATHEXT || DEFAULT_PATHEXT);
  const extensions = String(pathextValue || DEFAULT_PATHEXT).split(';').map((ext) => ext.trim()).filter((ext) => /^\.[A-Za-z0-9]+$/.test(ext));
  const hasKnownExtension = extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()));
  const candidates = hasKnownExtension ? [name] : extensions.map((ext) => `${name}${ext.toLowerCase()}`);
  const directories = String(pathValue || '')
    .split(';')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter((entry) => entry && isAbsoluteWindowsPath(entry));
  for (const directory of directories) {
    for (const candidate of candidates) {
      const fullPath = path.win32.join(directory, candidate);
      if (isAbsoluteWindowsPath(fullPath) && isFile(fullPath)) return fullPath;
    }
  }
  throw executableNotFoundError(name);
}

function windowsPathFromEnv(env) {
  const source = env || process.env;
  return source.PATH || source.Path || '';
}

// The single place CCTI spawns a process that may be a Windows .cmd script. On Windows a .cmd
// target is quoted and run through cmd.exe; every other target and every other platform is
// spawned exactly as before, without a shell. Throws UNSAFE_WINDOWS_ARGUMENT (before spawning
// anything) when an argument cannot be passed safely.
// On Windows every command is first resolved to an absolute path (see resolveWindowsExecutable).
// `internals` exists only for tests: { platform, spawn, isFile }.
function spawnSafely(command, args, options = {}, internals = {}) {
  const platform = internals.platform || process.platform;
  const spawnImpl = internals.spawn || ((...spawnArgs) => childProcess.spawn(...spawnArgs));
  const argList = Array.isArray(args) ? args : [];
  if (platform !== 'win32') {
    return spawnImpl(command, argList, options);
  }
  // Never let Windows pick the program from the working folder: resolve to an absolute path
  // from absolute PATH entries first (throws WINDOWS_EXECUTABLE_NOT_FOUND before spawning).
  const resolved = resolveWindowsExecutable(command, {
    pathValue: windowsPathFromEnv(options.env),
    pathext: (options.env || process.env).PATHEXT,
    isFile: internals.isFile,
  });
  if (!usesWindowsCommandShell(resolved, platform)) {
    return spawnImpl(resolved, argList, options);
  }
  const invocation = windowsShellInvocation(resolved, argList);
  // Node's own shell mode joins command and args with spaces; joining here is identical and
  // keeps the fully quoted command line in one visible place.
  const commandLine = [invocation.command, ...invocation.args].join(' ');
  return spawnImpl(commandLine, [], { ...options, shell: true });
}

module.exports = { cmdQuote, quoteCommand, windowsShellInvocation, usesWindowsCommandShell, spawnSafely, resolveWindowsExecutable, isAbsoluteWindowsPath, windowsPathFromEnv };
