'use strict';

const cp = require('node:child_process');
const path = require('node:path');

function resolveOpenSsl({ platform = process.platform, env = process.env, exec = cp.execFileSync } = {}) {
  function usable(command) {
    try { exec(command, ['version'], { stdio: 'pipe', timeout: 5000 }); return command; } catch { return null; }
  }
  for (const command of [env.CCTI_TEST_OPENSSL, platform === 'win32' ? 'openssl.exe' : 'openssl'].filter(Boolean)) {
    const found = usable(command);
    if (found) return found;
  }
  if (platform === 'win32') {
    for (const key of ['HKCU\\Software\\GitForWindows', 'HKLM\\Software\\GitForWindows', 'HKLM\\Software\\WOW6432Node\\GitForWindows']) {
      let output;
      try { output = exec('reg.exe', ['query', key, '/v', 'InstallPath'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }); } catch { continue; }
      const install = String(output).match(/InstallPath\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
      if (!install) continue;
      for (const relative of ['usr/bin/openssl.exe', 'mingw64/bin/openssl.exe']) {
        const found = usable(path.win32.join(install, relative));
        if (found) return found;
      }
    }
  }
  throw new Error('OpenSSL is unavailable. Put it on PATH, configure CCTI_TEST_OPENSSL, or install Git for Windows with its recorded installation path.');
}

module.exports = { resolveOpenSsl };
