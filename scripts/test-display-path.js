#!/usr/bin/env node
// Diagnostics scrub the home folder (and with it the account name) from report text. Windows
// paths are case-insensitive, so every casing of the home folder must be scrubbed on win32,
// while macOS/Linux keep exact, case-sensitive matching.
const assert = require('node:assert/strict');
const path = require('node:path');
const { displayPathFor } = require(path.join(__dirname, '..', 'desktop', 'src', 'display-path.js'));

const winHome = 'C:\\Users\\Jane';
assert.equal(displayPathFor('C:\\Users\\Jane\\.local\\bin\\claude.exe', winHome, 'win32'), '~\\.local\\bin\\claude.exe');
assert.equal(displayPathFor('c:\\users\\jane\\AppData\\Roaming\\npm', winHome, 'win32'), '~\\AppData\\Roaming\\npm', 'a lower-case home path must be scrubbed on Windows');
assert.equal(displayPathFor('C:\\USERS\\JANE\\bin', winHome, 'win32'), '~\\bin', 'an upper-case home path must be scrubbed on Windows');
assert.equal(
  displayPathFor('PATH: C:\\Users\\Jane\\bin;c:\\users\\jane\\AppData\\Roaming\\npm;C:\\Windows', winHome, 'win32'),
  'PATH: ~\\bin;~\\AppData\\Roaming\\npm;C:\\Windows',
  'every occurrence, in any casing, must be scrubbed',
);
assert.equal(displayPathFor('c:\\users\\jane', 'c:\\users\\jane', 'win32'), '~');
assert.equal(displayPathFor('C:\\Users\\Janet\\x', winHome, 'win32'), '~t\\x', 'matching stays a plain prefix replacement, as before');
// Regex metacharacters in a home path are matched literally.
assert.equal(displayPathFor('C:\\Users\\J.(a)+ne\\x C:\\Users\\JXaane\\x', 'C:\\Users\\J.(a)+ne', 'win32'), '~\\x C:\\Users\\JXaane\\x');

// macOS and Linux paths are case-sensitive: only the exact home folder is the user's.
assert.equal(displayPathFor('/Users/jane/.local/bin/claude', '/Users/jane', 'darwin'), '~/.local/bin/claude');
assert.equal(displayPathFor('/home/jane/bin:/home/Jane/bin', '/home/jane', 'linux'), '~/bin:/home/Jane/bin');

// Empty input and an unknown home folder never mangle the text.
assert.equal(displayPathFor('', winHome, 'win32'), '');
assert.equal(displayPathFor(undefined, winHome, 'win32'), '');
assert.equal(displayPathFor('C:\\tools', '', 'win32'), 'C:\\tools');

console.log('Display path scrubbing passed: Windows home paths are scrubbed in every casing; macOS/Linux stay exact.');
