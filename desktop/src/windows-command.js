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

const PLAIN_TOKEN = /^[A-Za-z0-9._@:/\\=+,-]+$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /["%!\r\n\0]/;

function unsafeArgumentError(reason) {
  const error = new Error(`CCTI stopped this command because ${reason}. Windows cannot pass it to a command script safely.`);
  error.code = 'UNSAFE_WINDOWS_ARGUMENT';
  return error;
}

function cmdQuote(value) {
  if (typeof value !== 'string') throw unsafeArgumentError('one of its values is not text');
  if (UNSAFE_CHARACTERS.test(value)) throw unsafeArgumentError('one of its values contains a quote, %, !, or a line break');
  if (PLAIN_TOKEN.test(value)) return value;
  return `"${value.replace(/(\\+)$/, '$1$1')}"`;
}

// The command token is always quoted: cmd.exe ends an unquoted command name at `/ , ; =`, so a
// path such as `C:\a,b\claude.cmd` would otherwise fail to launch.
function quoteCommand(command) {
  const quoted = cmdQuote(command);
  return quoted.startsWith('"') ? quoted : `"${quoted}"`;
}

function windowsShellInvocation(command, args) {
  return { command: quoteCommand(command), args: (args || []).map(cmdQuote) };
}

function usesWindowsCommandShell(command, platform = process.platform) {
  return platform === 'win32' && /\.cmd$/i.test(String(command));
}

// The single place CCTI spawns a process that may be a Windows .cmd script. On Windows a .cmd
// target is quoted and run through cmd.exe; every other target and every other platform is
// spawned exactly as before, without a shell. Throws UNSAFE_WINDOWS_ARGUMENT (before spawning
// anything) when an argument cannot be passed safely.
// `internals` exists only for tests: { platform, spawn }.
function spawnSafely(command, args, options = {}, internals = {}) {
  const platform = internals.platform || process.platform;
  const spawnImpl = internals.spawn || ((...spawnArgs) => childProcess.spawn(...spawnArgs));
  const argList = Array.isArray(args) ? args : [];
  if (!usesWindowsCommandShell(command, platform)) {
    return spawnImpl(command, argList, options);
  }
  const invocation = windowsShellInvocation(command, argList);
  // Node's own shell mode joins command and args with spaces; joining here is identical and
  // keeps the fully quoted command line in one visible place.
  const commandLine = [invocation.command, ...invocation.args].join(' ');
  return spawnImpl(commandLine, [], { ...options, shell: true });
}

module.exports = { cmdQuote, quoteCommand, windowsShellInvocation, usesWindowsCommandShell, spawnSafely };
