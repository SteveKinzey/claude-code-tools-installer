'use strict';

const assert = require('node:assert/strict');
const { resolveOpenSsl } = require('./resolve-test-openssl.cjs');
const registry = {
  'HKCU\\Software\\GitForWindows': 'C:\\Users\\Fixture\\custom-git',
  'HKLM\\Software\\GitForWindows': 'D:\\Tools\\Git',
  'HKLM\\Software\\WOW6432Node\\GitForWindows': 'E:\\Portable\\Git',
};
function fixture(available, keys = {}) {
  return (command, args) => {
    if (command === 'reg.exe' && keys[args[1]]) return `InstallPath REG_SZ ${keys[args[1]]}\r\n`;
    if (available.includes(command)) return 'OpenSSL fixture';
    throw new Error('fixture unavailable');
  };
}
assert.equal(resolveOpenSsl({ platform: 'win32', env: { CCTI_TEST_OPENSSL: 'F:\\Custom\\openssl.exe' }, exec: fixture(['F:\\Custom\\openssl.exe', 'openssl.exe']) }), 'F:\\Custom\\openssl.exe');
assert.equal(resolveOpenSsl({ platform: 'win32', env: {}, exec: fixture(['openssl.exe']) }), 'openssl.exe');
for (const [key, install] of Object.entries(registry)) {
  const executable = `${install}\\usr\\bin\\openssl.exe`;
  assert.equal(resolveOpenSsl({ platform: 'win32', env: {}, exec: fixture([executable], { [key]: install }) }), executable);
}
assert.equal(resolveOpenSsl({ platform: 'darwin', env: {}, exec: fixture(['openssl']) }), 'openssl');
assert.throws(() => resolveOpenSsl({ platform: 'win32', env: {}, exec: fixture([]) }), /OpenSSL is unavailable/);
console.log('PASS 7 OpenSSL discovery cases: configured, PATH, per-user/custom/system/WOW registry locations, POSIX, and clear refusal; inert fixtures only.');
