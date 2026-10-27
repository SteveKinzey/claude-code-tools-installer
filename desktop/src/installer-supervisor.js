'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

// Complete-setup POSIX children start in a dedicated process group. Killing only
// the shell leaves npm/vendor bootstrap descendants able to write after timeout.
function processTree(child, platform = process.platform) {
  let closed = false;
  let windowsTreeStopped = false;
  child.once('close', () => { closed = true; });
  return {
    alive() {
      if (platform === 'win32') return Number.isInteger(child.pid) && child.pid > 0 ? !closed || !windowsTreeStopped : !closed;
      // Mock children without a PID have no native descendants. Real spawned children
      // always have a PID; probe the entire owned process group even after parent close.
      if (!Number.isInteger(child.pid) || child.pid <= 0) return !closed;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { return error.code !== 'ESRCH'; }
    },
    async signal(signal) {
      if (platform !== 'win32') {
        if (Number.isInteger(child.pid) && child.pid > 0) {
          try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        } else child.kill(signal);
        return;
      }
      if (!Number.isInteger(child.pid) || child.pid <= 0) { child.kill(signal); return; }
      if (closed) {
        if (windowsTreeStopped) return;
        // Never taskkill an exited root's reusable PID. Without a verified tree kill,
        // its surviving descendants are unknown and the mutation lock stays held.
        throw new Error('The installer root already exited before its tree could be verified.');
      }
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('Cannot locate the Windows process-tree terminator.');
      // Keep the root alive until taskkill can enumerate its descendants. A successful
      // /T /F result plus root close is required before permitting a new mutation.
      await new Promise((resolve, reject) => {
        const killer = spawn(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { killer.kill(); reject(new Error('Process-tree termination did not complete.')); }, 5000);
        killer.once('error', (error) => { clearTimeout(timer); reject(error); });
        killer.once('close', (code) => { clearTimeout(timer); if (code === 0) { windowsTreeStopped = true; resolve(); } else reject(new Error('Process-tree termination could not be verified.')); });
      });
    },
  };
}

function superviseInstaller(child, { timeoutMs, fresh = false, onTimeout = () => {}, tree = processTree(child), graceMs = 5000, forceWaitMs = 1000, pollMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let closed = false;
    let code = -1;
    let timer, forceTimer, deadlineTimer, probe;
    let release;
    const whenStopped = new Promise((done) => { release = done; });
    const message = `Complete setup timed out after ${Math.round(timeoutMs / 60000)} minutes. ${fresh ? 'Start fresh may already have deleted reviewed Claude Code data; it has no automatic backup.' : 'Setup may have made partial changes.'} CCTI is stopping the installer and checking its processes before another action is allowed.`;
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(deadlineTimer); clearInterval(probe); };
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const checkStopped = () => {
      let alive = true;
      try { alive = tree.alive(); } catch {}
      if (!closed || alive) return false;
      cleanup();
      release();
      finish({ code: timedOut ? -1 : code, timedOut, ...(timedOut ? { error: message } : {}) });
      return true;
    };
    child.once('error', (error) => {
      if (timedOut) return; // kill errors do not establish exit or cancel escalation.
      cleanup();
      if (!settled) { settled = true; reject(error); }
    });
    child.once('close', (exitCode) => {
      closed = true;
      code = exitCode;
      if (!timedOut) { cleanup(); release(); finish({ code }); }
      else checkStopped();
    });
    if (timeoutMs > 0) timer = setTimeout(() => {
      timedOut = true;
      onTimeout(message);
      Promise.resolve().then(() => tree.signal('SIGTERM')).then(checkStopped, () => {});
      forceTimer = setTimeout(() => {
        Promise.resolve().then(() => tree.signal('SIGKILL')).then(checkStopped, () => {});
      }, graceMs);
      deadlineTimer = setTimeout(() => {
        if (!checkStopped()) finish({ code: -1, timedOut: true, stillRunning: true, whenStopped, error: `${message} The action lock remains active because process exit could not be verified.` });
      }, graceMs + forceWaitMs);
      probe = setInterval(checkStopped, pollMs);
      probe.unref?.();
    }, timeoutMs);
  });
}

module.exports = { processTree, superviseInstaller };
