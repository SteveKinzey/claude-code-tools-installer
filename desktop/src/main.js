const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require('electron');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { inspectProjectPackage, prepareProjectPackage, resolveProjectFolder } = require('./project-prerequisites');

let mainWindow;
let activeInstall = false;
let activeComponentInstall = false;
const discoveredSkillCleanup = new Map();
const reviewedCleanupPlans = new Map();
const reviewedBulkCleanupPlans = new Map();
const reviewedBulkRestorePlans = new Map();
const reviewedPluginChanges = new Map();
const reviewedClaudeRemovalPlans = new Map();
const reviewedAppUninstallPlans = new Map();
let activeSkillCleanup = false;
const diagnosticReports = new Map();
const diagnosticTimers = new Map();
const diagnosticReportLifetimeMs = 10 * 60 * 1000;
const maximumDiagnosticReports = 5;
const maximumDiagnosticReportBytes = 64 * 1024;
const maximumSkillHashFiles = 2000;
const maximumSkillHashBytes = 25 * 1024 * 1024;
const compassOnlineEndpoint = process.env.COMPASS_ONLINE_ENDPOINT || 'https://claudetool.app/api/trpc/compass.onlineChat?batch=1';
const anonymousSuccessEndpoint = process.env.ANONYMOUS_SUCCESS_ENDPOINT || 'https://claudetool.app/api/trpc/signals.reportSetupSuccess?batch=1';
const releaseApiEndpoint = 'https://api.github.com/repos/SteveKinzey/claude-code-tools-installer/releases?per_page=100';
const releaseUrlPrefix = 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/';
const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
let updateCheckPromise = null;
let nativeUpdatePromise = null;
let updateCheckTimer = null;
let nativeUpdaterEventsConfigured = false;
let nativeUpdater = null;
let updateStatus = {
  state: 'idle',
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  checkedAt: '',
  message: 'Update status has not been checked yet.',
  artifactDigestSummary: { total: 0, verified: 0, missing: [] },
  digestAlert: null,
  canDownload: false,
  canInstall: false,
};
const reviewedPluginPlans = {
  superpowers: [['plugin', 'marketplace', 'add', 'obra/superpowers-marketplace'], ['plugin', 'install', 'superpowers@superpowers-marketplace', '--scope', 'user']],
  ecc: [['plugin', 'marketplace', 'add', 'https://github.com/affaan-m/ECC'], ['plugin', 'install', 'ecc@ecc', '--scope', 'user']],
  'anthropic-skills': [['plugin', 'marketplace', 'add', 'anthropics/skills']],
  'wshobson-agents': [['plugin', 'marketplace', 'add', 'https://github.com/wshobson/agents'], ['plugin', 'install', 'claude-code-essentials', '--scope', 'user']],
  'claude-plugins-official': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official']],
  'frontend-design': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'frontend-design@claude-plugins-official', '--scope', 'user']],
  'code-review': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'code-review@claude-plugins-official', '--scope', 'user']],
  context7: [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'context7@claude-plugins-official', '--scope', 'user']],
  'skill-creator': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'skill-creator@claude-plugins-official', '--scope', 'user']],
  convex: [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'convex@claude-plugins-official', '--scope', 'user']],
  'claude-hud': [['plugin', 'marketplace', 'add', 'jarrodwatts/claude-hud'], ['plugin', 'install', 'claude-hud', '--scope', 'user']],
};

function setupManagerDir() {
  return path.join(app.getPath('home'), '.setup-my-claude');
}

function terminalPreferencePath() {
  return path.join(app.getPath('userData'), 'terminal-preference.json');
}

function iTerm2BundlePaths() {
  if (process.env.CCTI_TERMINAL_PREFERENCE_TEST === '1' && process.env.CCTI_TEST_ITERM2_BUNDLE_PATH) {
    return [process.env.CCTI_TEST_ITERM2_BUNDLE_PATH];
  }
  return ['/Applications/iTerm.app', path.join(app.getPath('home'), 'Applications', 'iTerm.app')];
}

function supportedTerminalOptions() {
  if (process.platform === 'darwin') {
    return [
      { id: 'default', label: 'Default Terminal', applicationId: 'com.apple.Terminal', alwaysAvailable: true },
      { id: 'iterm2', label: 'iTerm2', applicationId: 'com.googlecode.iterm2', bundlePaths: iTerm2BundlePaths() },
    ];
  }
  return [{ id: 'default', label: process.platform === 'win32' ? 'Default terminal (PowerShell)' : 'Default terminal', alwaysAvailable: true }];
}

async function terminalOptionsWithAvailability() {
  return Promise.all(supportedTerminalOptions().map(async (option) => ({
    id: option.id,
    label: option.label,
    available: option.alwaysAvailable || Boolean((await Promise.all((option.bundlePaths || []).map(pathExists))).find(Boolean)),
  })));
}

function supportedTerminalOption(id) {
  return supportedTerminalOptions().find((option) => option.id === id) || null;
}

async function storedTerminalPreference() {
  try {
    const raw = JSON.parse(await fs.readFile(terminalPreferencePath(), 'utf8'));
    return supportedTerminalOption(raw?.terminalId)?.id || 'default';
  } catch {
    return 'default';
  }
}

async function getTerminalPreference() {
  const [storedId, options] = await Promise.all([storedTerminalPreference(), terminalOptionsWithAvailability()]);
  const selected = options.find((option) => option.id === storedId);
  const available = selected?.available !== false;
  return {
    ok: true,
    selectedId: available ? storedId : 'default',
    storedId,
    options,
    message: available ? `Claude Code will open in ${selected?.label || 'Default Terminal'}.` : `${selected?.label || 'Your selected terminal'} is not installed, so CCTI will use Default Terminal until it is available again.`,
  };
}

async function setTerminalPreference({ terminalId } = {}) {
  const requested = String(terminalId || '');
  const option = supportedTerminalOption(requested);
  if (!option) return { ok: false, error: 'Choose a terminal listed by CCTI. Custom terminal commands are not accepted.' };
  const options = await terminalOptionsWithAvailability();
  if (options.find((item) => item.id === option.id)?.available === false) return { ok: false, error: `${option.label} is not installed. Choose Default Terminal or install ${option.label} first.` };
  try {
    const preferencePath = terminalPreferencePath();
    await fs.mkdir(path.dirname(preferencePath), { recursive: true });
    const temporaryPath = `${preferencePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify({ terminalId: option.id, updatedAt: new Date().toISOString() })}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, preferencePath);
    return { ok: true, selectedId: option.id, options, message: `CCTI will open Claude Code in ${option.label}.` };
  } catch {
    return { ok: false, error: 'CCTI could not save the terminal preference. Your current terminal choice was left unchanged.' };
  }
}

function pluginChecklistPath() {
  return path.join(setupManagerDir(), 'claude-plugin-commands.md');
}

function installerResource(...segments) {
  const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
  return path.join(base, app.isPackaged ? 'installers' : '', ...segments);
}

function claudeProcessEnv() {
  const home = app.getPath('home');
  const nativeBin = process.platform === 'win32' ? '' : path.join(home, '.local', 'bin');
  const managedNodeBin = process.platform === 'win32'
    ? path.join(setupManagerDir(), 'node-runtime')
    : path.join(setupManagerDir(), 'node-runtime', 'bin');
  const commonPaths = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || '', 'npm'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude Code'),
        path.join(process.env.ProgramFiles || '', 'nodejs'),
      ]
    : [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        path.join(home, '.npm-global', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, '.asdf', 'shims'),
        path.join(home, '.cargo', 'bin'),
      ];
  const paths = [nativeBin, managedNodeBin, ...commonPaths, process.env.PATH || ''].filter(Boolean);
  return {
    ...process.env,
    PATH: [...new Set(paths.join(path.delimiter).split(path.delimiter).filter(Boolean))].join(path.delimiter),
  };
}

function catalogResource() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'catalog.json')
    : path.resolve(__dirname, '..', 'catalog.json');
}

function componentCatalogResource() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'convex-components.json')
    : path.resolve(__dirname, '..', 'convex-components.json');
}

function catalogDetailsResource() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'catalog-details.json')
    : path.resolve(__dirname, '..', 'catalog-details.json');
}

function installerDefinition() {
  if (process.platform === 'darwin') {
    return { command: 'bash', script: installerResource('setup-my-claude.sh'), args: [] };
  }
  if (process.platform === 'win32') {
    return { command: 'pwsh.exe', script: installerResource('setup-my-claude.ps1'), args: ['-File'] };
  }
  return { command: 'bash', script: installerResource('setup-my-claude-linux.sh'), args: [] };
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runProcess(command, args, options = {}) {
  const timeoutMs = typeof options.timeout === 'number' ? options.timeout : 30000;
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch {}
        resolve({ code: -1, stdout, stderr: `${stderr}\nProcess timed out after ${timeoutMs}ms.`.trim(), timedOut: true });
      }, timeoutMs);
    }
  });
}

function versionSegments(value) {
  return String(value || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function isNewerVersion(candidate, current) {
  const candidateParts = versionSegments(candidate);
  const currentParts = versionSegments(current);
  for (let index = 0; index < Math.max(candidateParts.length, currentParts.length, 3); index += 1) {
    const left = candidateParts[index] || 0;
    const right = currentParts[index] || 0;
    if (left !== right) return left > right;
  }
  return false;
}

function compareVersions(left, right) {
  const leftParts = versionSegments(left);
  const rightParts = versionSegments(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length, 3); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isVerifiedDesktopArtifact(asset) {
  const name = String(asset?.name || '').toLowerCase();
  const hasReleaseDigest = /^sha256:[a-f0-9]{64}$/i.test(String(asset?.digest || ''));
  const isUploaded = asset?.state === 'uploaded';
  const hasPositiveSize = Number.isFinite(Number(asset?.size)) && Number(asset.size) > 0;
  const isDesktopArchive = /\.(dmg|zip|tar\.gz)$/.test(name) && !/(?:sha256sums|\.sha256)$/.test(name);
  return isUploaded && hasPositiveSize && hasReleaseDigest && isDesktopArchive;
}

function isPublicReleaseRecord(release) {
  const version = String(release?.tag_name || '').replace(/^v/i, '');
  const releaseUrl = String(release?.html_url || '');
  return Boolean(version) && releaseUrl.startsWith(releaseUrlPrefix) && !release?.draft && !release?.prerelease;
}

function newestVerifiedRelease(releases) {
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter(isPublicReleaseRecord)
    .filter((release) => Array.isArray(release.assets) && release.assets.some(isVerifiedDesktopArtifact));
  return candidates.sort((left, right) => compareVersions(String(right.tag_name || ''), String(left.tag_name || '')))[0] || null;
}

function publishUpdateStatus() {
  emit('updates:status', { ...updateStatus });
}

function nativeUpdaterSupported() {
  return process.platform === 'darwin' && app.isPackaged;
}

function getNativeUpdater() {
  if (!nativeUpdater) ({ autoUpdater: nativeUpdater } = require('electron-updater'));
  return nativeUpdater;
}

function updateReleaseUrlFor(version) {
  const normalized = String(version || '').replace(/^v/i, '');
  return normalized ? `${releaseUrlPrefix}tag/v${normalized}` : '';
}

function currentAppVersion() {
  return typeof app.getVersion === 'function' ? app.getVersion() : 'development';
}

function summarizeReleaseArtifactDigests(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const verified = assets.filter((asset) => /^sha256:[a-f0-9]{64}$/i.test(String(asset?.digest || ''))).length;
  const missing = assets
    .filter((asset) => !/^sha256:[a-f0-9]{64}$/i.test(String(asset?.digest || '')))
    .map((asset) => String(asset?.name || 'Unnamed release artifact'));
  return { total: assets.length, verified, missing };
}

async function checkForUpdates() {
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = (async () => {
    const currentVersion = currentAppVersion();
    updateStatus = {
      ...updateStatus,
      state: 'checking',
      currentVersion,
      message: 'Checking for a published CCTI release…',
    };
    publishUpdateStatus();

    if (typeof fetch !== 'function') {
      updateStatus = {
        ...updateStatus,
        state: 'unavailable',
        checkedAt: new Date().toISOString(),
        message: 'Update check unavailable: this app runtime cannot check GitHub releases.',
      };
      publishUpdateStatus();
      return { ...updateStatus };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), 8000);
    try {
      const response = await fetch(releaseApiEndpoint, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Claude-Code-Tools-Installer',
        },
        cache: 'no-store',
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'No public CCTI release is published yet.' : `GitHub returned ${response.status}.`);
      const releases = await response.json();
      const release = newestVerifiedRelease(releases);
      if (!release) throw new Error('No verified public CCTI release is available yet.');
      const latestVersion = String(release?.tag_name || '').replace(/^v/i, '');
      const releaseUrl = String(release?.html_url || '');
      if (!latestVersion || !releaseUrl.startsWith(releaseUrlPrefix)) throw new Error('GitHub returned an incomplete release record.');

      const available = isNewerVersion(latestVersion, currentVersion);
      const artifactDigestSummary = summarizeReleaseArtifactDigests(release);
      const digestAlert = artifactDigestSummary.missing.length
        ? {
          count: artifactDigestSummary.missing.length,
          names: artifactDigestSummary.missing,
          message: `${artifactDigestSummary.missing.length} published release artifact${artifactDigestSummary.missing.length === 1 ? '' : 's'} ${artifactDigestSummary.missing.length === 1 ? 'is' : 'are'} missing a SHA-256 digest.`,
        }
        : null;
      const canDownload = available && nativeUpdaterSupported();
      updateStatus = {
        state: available ? 'available' : 'current',
        currentVersion,
        latestVersion,
        releaseUrl,
        checkedAt: new Date().toISOString(),
        artifactDigestSummary,
        digestAlert,
        canDownload,
        canInstall: false,
        message: available
          ? canDownload
            ? `CCTI ${latestVersion} is available. Select Check for Updates to download the signed update now.`
            : `CCTI ${latestVersion} is available. This build does not support in-app updates; use View Release to update.`
          : compareVersions(latestVersion, currentVersion) === 0
            ? `CCTI ${currentVersion} is the newest published release.`
            : `CCTI ${currentVersion} is ahead of the newest verified public release (${latestVersion}). No download action is needed.`,
      };
      publishUpdateStatus();
      return { ...updateStatus };
    } catch (error) {
      updateStatus = {
        ...updateStatus,
        state: 'unavailable',
        currentVersion,
        checkedAt: new Date().toISOString(),
        message: `Update check unavailable: ${error.name === 'AbortError' ? 'GitHub did not respond in time.' : error.message}`,
      };
      publishUpdateStatus();
      return { ...updateStatus };
    } finally {
      clearTimeout(timeout);
    }
  })();

  try {
    return await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
}

function startBackgroundUpdateChecks() {
  if (typeof app.getVersion !== 'function') return;
  if (updateCheckTimer) return;
  checkForUpdates();
  updateCheckTimer = setInterval(() => { checkForUpdates(); }, updateCheckIntervalMs);
}

async function openPublishedRelease() {
  if (!updateStatus.releaseUrl || !updateStatus.releaseUrl.startsWith(releaseUrlPrefix)) {
    return { ok: false, error: 'There is no verified release page to open yet. Check for updates again.' };
  }
  try {
    await shell.openExternal(updateStatus.releaseUrl);
    return { ok: true };
  } catch {
    return { ok: false, error: 'CCTI could not open the verified release page.' };
  }
}

function configureNativeUpdaterEvents() {
  if (nativeUpdaterEventsConfigured || !nativeUpdaterSupported()) return;
  nativeUpdaterEventsConfigured = true;
  getNativeUpdater().autoDownload = false;
  getNativeUpdater().autoInstallOnAppQuit = false;
  getNativeUpdater().on('checking-for-update', () => {
    updateStatus = {
      ...updateStatus,
      state: 'checking',
      message: 'Checking GitHub for a signed CCTI update…',
      canDownload: false,
      canInstall: false,
    };
    publishUpdateStatus();
  });
  getNativeUpdater().on('update-available', (info) => {
    const latestVersion = String(info?.version || updateStatus.latestVersion || '').replace(/^v/i, '');
    updateStatus = {
      ...updateStatus,
      state: 'downloading',
      latestVersion,
      releaseUrl: updateStatus.releaseUrl || updateReleaseUrlFor(latestVersion),
      message: `Downloading the signed CCTI ${latestVersion} update…`,
      canDownload: false,
      canInstall: false,
    };
    publishUpdateStatus();
  });
  getNativeUpdater().on('update-not-available', () => {
    if (updateStatus.state === 'checking' || updateStatus.state === 'downloading') {
      updateStatus = {
        ...updateStatus,
        state: 'current',
        message: `CCTI ${currentAppVersion()} is the newest signed update available.`,
        canDownload: false,
        canInstall: false,
      };
      publishUpdateStatus();
    }
  });
  getNativeUpdater().on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
    updateStatus = {
      ...updateStatus,
      state: 'downloading',
      message: `Downloading the signed CCTI ${updateStatus.latestVersion || 'latest'} update… ${percent}%`,
      canDownload: false,
      canInstall: false,
    };
    publishUpdateStatus();
  });
  getNativeUpdater().on('update-downloaded', (info) => {
    const latestVersion = String(info?.version || updateStatus.latestVersion || '').replace(/^v/i, '');
    updateStatus = {
      ...updateStatus,
      state: 'downloaded',
      latestVersion,
      releaseUrl: updateStatus.releaseUrl || updateReleaseUrlFor(latestVersion),
      checkedAt: new Date().toISOString(),
      message: `CCTI ${latestVersion} is downloaded and verified. Restart CCTI to apply it now.`,
      canDownload: false,
      canInstall: true,
    };
    publishUpdateStatus();
  });
  getNativeUpdater().on('error', () => {
    if (!nativeUpdatePromise && updateStatus.state !== 'checking' && updateStatus.state !== 'downloading') return;
    updateStatus = {
      ...updateStatus,
      state: 'available',
      message: `CCTI ${updateStatus.latestVersion || 'update'} is available, but its signed in-app update package is not ready. Use View Release to update safely.`,
      canDownload: nativeUpdaterSupported(),
      canInstall: false,
    };
    publishUpdateStatus();
  });
}

async function downloadAvailableUpdate() {
  if (nativeUpdatePromise) return nativeUpdatePromise;
  nativeUpdatePromise = (async () => {
    const status = await checkForUpdates();
    if (status.state === 'current') return status;
    if (status.state !== 'available') return status;
    if (!nativeUpdaterSupported()) {
      return {
        ...status,
        message: `CCTI ${status.latestVersion} is available, but this build cannot update itself. Use View Release to update.`,
      };
    }
    configureNativeUpdaterEvents();
    updateStatus = {
      ...status,
      state: 'checking',
      message: `Checking GitHub for the signed CCTI ${status.latestVersion} update…`,
      canDownload: false,
      canInstall: false,
    };
    publishUpdateStatus();
    try {
      const result = await getNativeUpdater().checkForUpdates();
      if (!result?.updateInfo || !isNewerVersion(result.updateInfo.version, currentAppVersion())) return { ...updateStatus };
      await getNativeUpdater().downloadUpdate();
      return { ...updateStatus };
    } catch {
      updateStatus = {
        ...updateStatus,
        state: 'available',
        message: `CCTI ${status.latestVersion} is available, but its signed in-app update package is not ready. Use View Release to update safely.`,
        canDownload: nativeUpdaterSupported(),
        canInstall: false,
      };
      publishUpdateStatus();
      return { ...updateStatus };
    }
  })();
  try {
    return await nativeUpdatePromise;
  } finally {
    nativeUpdatePromise = null;
  }
}

async function restartAndInstallUpdate() {
  if (!nativeUpdaterSupported() || !updateStatus.canInstall) {
    return { ok: false, error: 'No downloaded CCTI update is ready to install.' };
  }
  try {
    getNativeUpdater().quitAndInstall();
    return { ok: true };
  } catch {
    return { ok: false, error: 'CCTI could not restart to install the downloaded update.' };
  }
}

async function readCatalog() {
  return JSON.parse(await fs.readFile(catalogResource(), 'utf8'));
}

async function readCatalogDetails() {
  return JSON.parse(await fs.readFile(catalogDetailsResource(), 'utf8'));
}

function normalizedPluginId(value) {
  return String(value || '').trim().toLowerCase();
}

function pluginIdsFromList(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map(normalizedPluginId);
}

function pluginIsInstalled(installedIds, requestedId) {
  const requested = normalizedPluginId(requestedId);
  const requestedName = requested.split('@')[0];
  return installedIds.some((installed) => installed === requested || installed === requestedName || installed.startsWith(`${requested}@`) || installed.startsWith(`${requestedName}@`));
}

async function installedClaudePluginIds() {
  const claude = await claudeStatus();
  if (!claude.installed) return [];
  try {
    const result = await runProcess('claude', ['plugin', 'list'], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 8000 });
    return result.code === 0 ? pluginIdsFromList(result.stdout) : [];
  } catch {
    return [];
  }
}

async function installReviewedPlugins(selectedIds) {
  const installedIds = await installedClaudePluginIds();
  for (const id of selectedIds) {
    const installAction = (reviewedPluginPlans[id] || []).find((args) => args[0] === 'plugin' && args[1] === 'install');
    const requestedPlugin = installAction?.[2];
    if (requestedPlugin && pluginIsInstalled(installedIds, requestedPlugin)) {
      emit('installer:output', { stream: 'stdout', text: `[CCTI] Did not add ${id}: ${requestedPlugin} is already available in Claude Code.\n` });
      continue;
    }
    for (const args of reviewedPluginPlans[id] || []) {
      emit('installer:output', { stream: 'stdout', text: `[CCTI] Running reviewed plugin action: claude ${args.join(' ')}\n` });
      const result = await runProcess('claude', args, { cwd: app.getPath('home'), env: claudeProcessEnv() });
      if (result.stdout) emit('installer:output', { stream: 'stdout', text: result.stdout });
      if (result.stderr) emit('installer:output', { stream: result.code === 0 ? 'stdout' : 'stderr', text: result.stderr });
      if (result.code !== 0 && args[1] !== 'marketplace') throw new Error(`CCTI could not install ${id}. Claude Code returned exit code ${result.code}.`);
      if (result.code !== 0) emit('installer:output', { stream: 'stdout', text: '[CCTI] Marketplace was already available or could not refresh. Continuing with the named plugin install.\n' });
    }
  }
}

async function readComponentCatalog() {
  return JSON.parse(await fs.readFile(componentCatalogResource(), 'utf8'));
}

async function commandLocation(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const result = await runProcess(locator, [command], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 3000 });
    return result.code === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '' : '';
  } catch {
    return '';
  }
}

async function claudeStatus() {
  const home = app.getPath('home');
  try {
    let installedPath = await commandLocation('claude');
    if (!installedPath) {
      const candidates = process.platform === 'win32'
        ? [path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), path.join(home, '.local', 'bin', 'claude.exe')]
        : [path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.npm-global', 'bin', 'claude')];
      for (const candidate of candidates) {
        if (await pathExists(candidate)) {
          installedPath = candidate;
          break;
        }
      }
    }
    const targetCmd = installedPath || 'claude';
    const result = await runProcess(targetCmd, ['--version'], { cwd: home, env: claudeProcessEnv(), timeout: 4000 });
    const version = result.stdout.trim() || result.stderr.trim();
    const installed = result.code === 0 && version.length > 0;
    return {
      installed,
      version: installed ? version : '',
      path: installedPath,
      timedOut: Boolean(result.timedOut),
      reason: installed ? '' : (result.timedOut ? 'Claude Code check took longer than expected.' : result.code === 0 ? 'Claude Code did not return a version.' : 'Claude Code could not be run.'),
    };
  } catch {
    const fallbackPath = await commandLocation('claude').catch(() => '');
    return { installed: false, version: '', path: fallbackPath, reason: 'Claude Code could not be run.' };
  }
}

function displayLocalPath(value) {
  const home = app.getPath('home');
  return String(value || '').split(home).join('~');
}

async function diagnosticCommand(command, args) {
  try {
    const result = await runProcess(command, args, { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 4000 });
    const output = (result.stdout || result.stderr || '').trim().replace(/\s+/g, ' ');
    return result.code === 0
      ? `Ready${output ? ` — ${output}` : ''}`
      : `Not ready${result.timedOut ? ' — timed out after 4 seconds' : output ? ` — ${output}` : ''}`;
  } catch (error) {
    return `Not ready — ${error.message}`;
  }
}

async function runDiagnostics() {
  const home = app.getPath('home');
  const env = claudeProcessEnv();
  const candidatePaths = process.platform === 'win32'
    ? [path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), path.join(home, '.local', 'bin', 'claude.exe')]
    : [path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.npm-global', 'bin', 'claude')];
  const [claude, node, npm, git, resolvedClaude] = await Promise.all([
    claudeStatus(),
    diagnosticCommand('node', ['--version']),
    diagnosticCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']),
    diagnosticCommand('git', ['--version']),
    commandLocation('claude'),
  ]);
  const candidates = await Promise.all(candidatePaths.map(async (candidate) => `${displayLocalPath(candidate)}: ${await pathExists(candidate) ? 'found' : 'not found'}`));
  const managedRuntime = process.platform === 'win32'
    ? path.join(setupManagerDir(), 'node-runtime', 'node.exe')
    : path.join(setupManagerDir(), 'node-runtime', 'bin', 'node');
  const report = [
    'CCTI DIAGNOSTICS — local only; this report is not sent anywhere.',
    `Checked: ${new Date().toLocaleString()}`,
    `CCTI version: ${currentAppVersion()}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Electron: ${process.versions.electron || 'unknown'} · Node: ${process.versions.node || 'unknown'}`,
    '',
    'Claude Code',
    `Status: ${claude.installed ? `ready${claude.version ? ` — ${claude.version}` : ''}` : `not ready — ${claude.reason || 'not detected'}`}`,
    `Resolved command: ${displayLocalPath(resolvedClaude || claude.path || 'not found')}`,
    'Known command locations:',
    ...candidates.map((entry) => `  ${entry}`),
    '',
    'Required commands',
    `node: ${node}`,
    `npm: ${npm}`,
    `git: ${git}`,
    `CCTI-managed Node.js: ${await pathExists(managedRuntime) ? `found at ${displayLocalPath(managedRuntime)}` : 'not present'}`,
    '',
    'PATH used by CCTI',
    ...(env.PATH || '').split(path.delimiter).filter(Boolean).map((entry) => `  ${displayLocalPath(entry)}`),
    '',
    'Next step',
    claude.installed
      ? 'Claude Code can run in the CCTI environment. If a later action fails, share this local report with support or compare the command path above with your terminal.'
      : 'Use “Yes, install Claude Code” to run the official installer, or choose “Yes, Claude Code is installed” to continue browsing while you resolve the command path.',
  ].join('\n');
  const safeReport = boundDiagnosticReport(report);
  const diagnosticId = rememberDiagnosticReport(safeReport);
  return { ok: true, diagnosticId, report: safeReport, claudeReady: claude.installed };
}

function boundDiagnosticReport(report) {
  const source = String(report || '');
  if (Buffer.byteLength(source, 'utf8') <= maximumDiagnosticReportBytes) return source;
  const notice = '\n\n[CCTI] Report truncated at 64 KiB to keep local diagnostic memory bounded.';
  const allowedBytes = maximumDiagnosticReportBytes - Buffer.byteLength(notice, 'utf8');
  return `${Buffer.from(source, 'utf8').subarray(0, allowedBytes).toString('utf8')}${notice}`;
}

function purgeExpiredDiagnosticReports(now = Date.now()) {
  for (const [id, stored] of diagnosticReports) {
    if (now - stored.createdAt >= diagnosticReportLifetimeMs) {
      diagnosticReports.delete(id);
      const timer = diagnosticTimers.get(id);
      if (timer) { clearTimeout(timer); diagnosticTimers.delete(id); }
    }
  }
}

function rememberDiagnosticReport(report) {
  purgeExpiredDiagnosticReports();
  while (diagnosticReports.size >= maximumDiagnosticReports) {
    const oldestId = diagnosticReports.keys().next().value;
    if (!oldestId) break;
    diagnosticReports.delete(oldestId);
    const timer = diagnosticTimers.get(oldestId);
    if (timer) { clearTimeout(timer); diagnosticTimers.delete(oldestId); }
  }
  const diagnosticId = randomUUID();
  diagnosticReports.set(diagnosticId, { report, createdAt: Date.now() });
  const cleanupTimer = setTimeout(() => {
    diagnosticReports.delete(diagnosticId);
    diagnosticTimers.delete(diagnosticId);
  }, diagnosticReportLifetimeMs);
  cleanupTimer.unref?.();
  diagnosticTimers.set(diagnosticId, cleanupTimer);
  return diagnosticId;
}

async function exportDiagnosticReport({ diagnosticId } = {}) {
  purgeExpiredDiagnosticReports();
  const stored = diagnosticReports.get(String(diagnosticId || ''));
  if (!stored) {
    return { ok: false, error: 'This diagnostic report is no longer available. Run Diagnostics again before exporting it.' };
  }
  try {
    const defaultName = `ccti-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save CCTI diagnostics',
      defaultPath: defaultName,
      filters: [{ name: 'Text file', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    await fs.writeFile(result.filePath, `${stored.report}\n`, 'utf8');
    return { ok: true, canceled: false, filename: path.basename(result.filePath) };
  } catch (error) {
    return { ok: false, error: `CCTI could not save the diagnostic report: ${error.message}` };
  }
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function startDetached(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false, ...options });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function launchClaudeCode({ projectPath } = {}) {
  const status = await claudeStatus();
  if (!status.installed || !status.path) return { ok: false, error: 'Claude Code is not ready yet. Install it first, then choose Run Claude Code.' };
  let folder = app.getPath('home');
  if (projectPath) {
    try { folder = await resolveProjectFolder(projectPath); } catch (error) { return { ok: false, error: error.message }; }
  }
  try {
    if (process.platform === 'darwin') {
      const preference = await getTerminalPreference();
      const terminal = supportedTerminalOption(preference.selectedId) || supportedTerminalOption('default');
      const command = `cd ${quotePosix(folder)}; exec ${quotePosix(status.path)}`;
      const script = terminal.id === 'iterm2'
        ? ['tell application id "com.googlecode.iterm2"', 'activate', 'create window with default profile', 'tell current session of current window', `write text ${JSON.stringify(command)}`, 'end tell', 'end tell'].join('\n')
        : `tell application id "com.apple.Terminal" to do script ${JSON.stringify(command)}`;
      const result = await runProcess('osascript', ['-e', script], { cwd: folder, env: claudeProcessEnv() });
      if (result.code !== 0) throw new Error(result.stderr.trim() || `${terminal.label} did not open.`);
      const fallbackNote = preference.selectedId === preference.storedId ? '' : ' Your saved iTerm2 preference is unavailable, so CCTI used Default Terminal.';
      return { ok: true, message: `Claude Code opened in ${terminal.label} for the selected folder.${fallbackNote}` };
    }
    if (process.platform === 'win32') {
      const folderArg = folder.replace(/'/g, "''");
      const claudeArg = status.path.replace(/'/g, "''");
      await startDetached('pwsh.exe', ['-NoExit', '-Command', `Set-Location -LiteralPath '${folderArg}'; & '${claudeArg}'`], { cwd: folder, env: claudeProcessEnv() });
      return { ok: true, message: 'Claude Code opened in a PowerShell window for the selected folder.' };
    }
    const launchCommand = `cd ${quotePosix(folder)}; exec ${quotePosix(status.path)}`;
    for (const terminal of [
      ['x-terminal-emulator', ['-e', 'bash', '-lc', launchCommand]],
      ['gnome-terminal', ['--', 'bash', '-lc', launchCommand]],
      ['konsole', ['-e', 'bash', '-lc', launchCommand]],
      ['xterm', ['-e', 'bash', '-lc', launchCommand]],
    ]) {
      if (!await commandLocation(terminal[0])) continue;
      await startDetached(terminal[0], terminal[1], { cwd: folder, env: claudeProcessEnv() });
      return { ok: true, message: 'Claude Code opened in a terminal window for the selected folder.' };
    }
    return { ok: false, error: 'CCTI could not find a supported Linux terminal window to open Claude Code. Nothing was changed.' };
  } catch (error) {
    return { ok: false, error: `CCTI could not open Claude Code: ${error.message}` };
  }
}

async function knownClaudeRemovalPlan() {
  const home = app.getPath('home');
  const nativeLauncher = path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  const nativeVersions = path.join(home, '.local', 'share', 'claude');
  const removable = [];
  const settings = [];
  const attention = [];
  if (await pathExists(nativeLauncher)) removable.push({ kind: 'path', path: nativeLauncher, label: 'Claude Code launcher', scope: 'Claude Code CLI' });
  if (await pathExists(nativeVersions)) removable.push({ kind: 'path', path: nativeVersions, label: 'Claude Code native versions', scope: 'Claude Code CLI' });
  for (const target of [path.join(home, '.claude'), path.join(home, '.claude.json')]) {
    if (await pathExists(target)) settings.push({ kind: 'path', path: target, label: path.basename(target), scope: 'Claude Code settings and history' });
  }
  const cctiData = setupManagerDir();
  if (await pathExists(cctiData)) removable.push({ kind: 'path', path: cctiData, label: 'CCTI-managed setup data and runtime', scope: 'CCTI only' });
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (await commandLocation(npmCommand)) {
    const npm = await runProcess(npmCommand, ['list', '-g', '@anthropic-ai/claude-code', '--depth=0'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1 }));
    if (npm.code === 0) removable.push({ kind: 'command', command: npmCommand, args: ['uninstall', '-g', '@anthropic-ai/claude-code'], label: 'Claude Code installed with npm', scope: 'Claude Code CLI' });
  }
  if (process.platform === 'darwin' && await commandLocation('brew')) {
    for (const cask of ['claude-code', 'claude-code@latest']) {
      const brew = await runProcess('brew', ['list', '--cask', cask], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1 }));
      if (brew.code === 0) removable.push({ kind: 'command', command: 'brew', args: ['uninstall', '--cask', cask], label: `Claude Code ${cask === 'claude-code@latest' ? 'latest' : 'stable'} cask`, scope: 'Claude Code CLI' });
    }
  }
  if (process.platform === 'win32' && await commandLocation('winget')) {
    const winget = await runProcess('winget', ['list', '--id', 'Anthropic.ClaudeCode', '--exact'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1 }));
    if (winget.code === 0) removable.push({ kind: 'command', command: 'winget', args: ['uninstall', '--id', 'Anthropic.ClaudeCode', '--exact', '--silent', '--accept-source-agreements'], label: 'Claude Code installed with Windows Package Manager', scope: 'Claude Code CLI' });
  }
  const status = await claudeStatus();
  if (status.installed && removable.length === 0) attention.push('CCTI found a working Claude Code command but could not confirm a safe supported removal method, so it will not delete an unknown command path.');
  if (process.platform === 'linux') attention.push('A Claude Code install made with a system package manager can need an administrator’s approval. CCTI leaves unrecognized system packages unchanged.');
  if (removable.length === 0 && settings.length === 0) return { ok: false, error: attention[0] || 'CCTI did not find Claude Code files it can safely remove.' };
  const reviewId = randomUUID();
  reviewedClaudeRemovalPlans.set(reviewId, { createdAt: Date.now(), removable, settings });
  for (const [id, plan] of reviewedClaudeRemovalPlans) if (Date.now() - plan.createdAt > 10 * 60 * 1000) reviewedClaudeRemovalPlans.delete(id);
  const detail = (item) => ({ label: item.label, scope: item.scope, path: item.path || 'Known Claude Code package' });
  return { ok: true, reviewId, removable: removable.map(detail), settings: settings.map(detail), protected: ['Claude Desktop app and its data', 'Claude in Chrome, browser profiles, and browser extensions', 'VS Code and JetBrains extensions', 'Any unrelated Anthropic app or account'], attention };
}

async function applyKnownClaudeRemoval({ reviewId, confirmation, removeSettings } = {}) {
  if (confirmation !== 'REMOVE CLAUDE CODE') return { ok: false, error: 'Type REMOVE CLAUDE CODE exactly before CCTI removes anything.' };
  const plan = reviewedClaudeRemovalPlans.get(reviewId);
  if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) return { ok: false, error: 'This removal review has expired. Review the plan again.' };
  if (activeInstall) return { ok: false, error: 'Another CCTI action is running. Wait for it to finish first.' };
  reviewedClaudeRemovalPlans.delete(reviewId);
  activeInstall = true;
  emit('installer:state', { running: true });
  try {
    for (const item of plan.removable) {
      emit('installer:output', { stream: 'stdout', text: `[CCTI] Removing ${item.label}…\n` });
      if (item.kind === 'path') await fs.rm(item.path, { recursive: true, force: true });
      else {
        const result = await runProcess(item.command, item.args, { cwd: app.getPath('home'), env: claudeProcessEnv() });
        if (result.stdout) emit('installer:output', { stream: 'stdout', text: result.stdout });
        if (result.stderr) emit('installer:output', { stream: result.code === 0 ? 'stdout' : 'stderr', text: result.stderr });
        if (result.code !== 0) throw new Error(`${item.label} could not be removed.`);
      }
    }
    if (removeSettings) for (const item of plan.settings) {
      emit('installer:output', { stream: 'stdout', text: `[CCTI] Removing ${item.label}…\n` });
      await fs.rm(item.path, { recursive: true, force: true });
    }
    const after = await claudeStatus();
    return { ok: !after.installed, installed: after.installed, message: after.installed ? 'CCTI removed the reviewed items, but another Claude Code command is still available. It was left in place because CCTI could not verify a safe removal method.' : 'CCTI removed the reviewed Claude Code CLI items. Claude Desktop, Chrome, browser extensions, and unrelated Anthropic products were not touched.' };
  } catch (error) {
    return { ok: false, error: `CCTI stopped during removal: ${error.message}` };
  } finally {
    activeInstall = false;
    emit('installer:state', { running: false });
  }
}



function appUninstallCleanupGuidance() {
  if (process.platform === 'win32') {
    return 'CCTI app data is gone. After CCTI closes, remove it in Windows Installed apps or delete the now-empty extracted CCTI folder. Claude Code and your tools remain untouched.';
  }
  if (process.platform === 'darwin') {
    return 'CCTI app data is gone. After CCTI closes, move Claude Code Tools Installer from Applications to Trash. Claude Code and your tools remain untouched.';
  }
  return 'CCTI app data is gone. After CCTI closes, delete the now-empty extracted CCTI directory. Claude Code and your tools remain untouched.';
}

function platformUninstallGuidance() {
  if (process.platform === 'win32') {
    return 'After this in-app data removal completes, CCTI will close. Use Windows Installed apps for an installed package, or delete the now-empty extracted CCTI folder.';
  }
  if (process.platform === 'darwin') {
    return 'After this in-app data removal completes, CCTI will close. Move Claude Code Tools Installer from Applications to Trash.';
  }
  return 'After this in-app data removal completes, CCTI will close. Delete the now-empty extracted CCTI directory.';
}

function postAppUninstallNotification() {
  const title = 'CCTI app data removed';
  const body = appUninstallCleanupGuidance();
  try {
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) {
      emit('installer:output', { stream: 'stdout', text: '[CCTI] Desktop notifications are unavailable here. Follow the on-screen cleanup instruction.\n' });
      return { requested: false, title, body };
    }
    const notification = new Notification({ title, body, timeoutType: 'never' });
    notification.on('failed', (_event, error) => {
      emit('installer:output', { stream: 'stderr', text: `[CCTI] Desktop notification could not be shown: ${error}\n` });
    });
    notification.show();
    return { requested: true, title, body };
  } catch (error) {
    emit('installer:output', { stream: 'stderr', text: `[CCTI] Desktop notification could not be queued: ${error.message}\n` });
    return { requested: false, title, body };
  }
}

function manifestLine(item) {
  return `- ${item.name} (${item.type} · ${item.scope})`;
}

async function buildInstallationManifest() {
  const generatedAt = new Date().toISOString();
  const timestampUnix = Math.floor(Date.now() / 1000);
  const version = typeof app.getVersion === 'function' ? app.getVersion() : 'unknown';
  const [claude, discovery] = await Promise.all([
    claudeStatus(),
    discoverClaudeSetup().catch(() => ({ findings: [] })),
  ]);
  const activeItems = (discovery.findings || [])
    .filter((item) => ['tool', 'runtime', 'skill', 'plugin', 'connection', 'follow-up'].includes(item.type))
    .map(manifestLine);
  const visibleItems = [...new Set(activeItems)].sort((a, b) => a.localeCompare(b));
  const itemList = visibleItems.length ? visibleItems.join('\n') : '- No discoverable tools or additions were found at export time.';
  const claudeLine = claude.installed
    ? `- Claude Code: ${claude.version || 'installed'}`
    : '- Claude Code: not detected during export';

  const payloadContent = `## Manifest payload\n\nGenerated: ${generatedAt} (Unix: ${timestampUnix})\nPlatform: ${process.platform}\nCCTI version: ${version}\n\n## Privacy boundary\n\nThis manifest lists only product names, categories, scopes, and available versions. It does not contain credentials, secrets, account information, conversation content, raw settings, logs, or absolute folder paths.\n\n## External developer tool\n\n${claudeLine}\n\n## Active tools and additions\n\n${itemList}\n\n## Uninstall boundary\n\nRemoving Claude Code Tools Installer deletes only CCTI-owned data reviewed in the uninstall flow. Claude Code, installed tools, skills, plugins, MCP connections, project files, and browser data remain untouched.\n`;

  const sha256Digest = createHash('sha256').update(payloadContent, 'utf8').digest('hex');

  return `# Claude Code Tools Installer installation manifest\n\n## Integrity\n\n- Export timestamp: ${generatedAt}\n- Payload SHA-256: ${sha256Digest}\n- Verification scope: the exact UTF-8 bytes in the \"Manifest payload\" section below.\n\n${payloadContent}`;
}

let lastExportedManifestPath = '';

async function exportInstallationManifest() {
  try {
    const defaultName = `ccti-installation-manifest-${new Date().toISOString().slice(0, 10)}.md`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save CCTI installation manifest',
      defaultPath: defaultName,
      filters: [{ name: 'Markdown file', extensions: ['md'] }, { name: 'Text file', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    await fs.writeFile(result.filePath, await buildInstallationManifest(), 'utf8');
    lastExportedManifestPath = result.filePath;
    emit('installer:output', { stream: 'stdout', text: `[CCTI] Installation manifest saved as ${path.basename(result.filePath)}.\n` });
    return { ok: true, canceled: false, filename: path.basename(result.filePath), hasLocation: true };
  } catch (error) {
    return { ok: false, error: `CCTI could not save the installation manifest: ${error.message}` };
  }
}

async function openExportedManifestFolder() {
  try {
    if (!lastExportedManifestPath) {
      return { ok: false, error: 'No installation manifest has been exported yet in this session.' };
    }
    if (shell && typeof shell.showItemInFolder === 'function') {
      shell.showItemInFolder(lastExportedManifestPath);
      return { ok: true, revealed: true };
    }
    if (shell && typeof shell.openPath === 'function') {
      await shell.openPath(path.dirname(lastExportedManifestPath));
      return { ok: true, opened: true };
    }
    return { ok: false, error: 'Operating system folder explorer is unavailable in this environment.' };
  } catch (error) {
    return { ok: false, error: `Could not open folder: ${error.message}` };
  }
}

function manifestVerificationCommand() {
  if (process.platform === 'win32') {
    return `$manifest = Read-Host 'Path to your CCTI manifest'
$text = [System.IO.File]::ReadAllText($manifest)
$expected = [regex]::Match($text, '(?m)^- Payload SHA-256: ([a-f0-9]{64})$').Groups[1].Value
$payloadAt = $text.IndexOf("## Manifest payload\`n")
if ($expected.Length -ne 64 -or $payloadAt -lt 0) { throw 'This is not a complete CCTI manifest.' }
$payload = $text.Substring($payloadAt)
$actual = [System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($payload))).ToLowerInvariant()
if ($actual -eq $expected) { Write-Host 'Verified: manifest payload SHA-256 matches.' -ForegroundColor Green } else { Write-Error 'Does not match: the manifest payload was changed or is incomplete.'; exit 1 }`;
  }
  const hashCommand = process.platform === 'darwin' ? 'shasum -a 256' : 'sha256sum';
  return `manifest="$HOME/Downloads/ccti-installation-manifest.md" # Change if you saved it elsewhere
expected=$(sed -nE 's/^- Payload SHA-256: ([0-9a-f]{64})$/\\1/p' "$manifest" | head -n 1)
line=$(grep -n '^## Manifest payload$' "$manifest" | head -n 1 | cut -d: -f1)
[ -n "$expected" ] && [ -n "$line" ] || { echo 'This is not a complete CCTI manifest.' >&2; exit 1; }
actual=$(tail -n +"$line" "$manifest" | ${hashCommand} | awk '{print $1}')
[ "$actual" = "$expected" ] && echo 'Verified: manifest payload SHA-256 matches.' || { echo 'Does not match: the manifest payload was changed or is incomplete.' >&2; exit 1; }`;
}

function verifyManifestText(contents) {
  const expected = contents.match(/^- Payload SHA-256: ([a-f0-9]{64})$/im)?.[1]?.toLowerCase();
  const payloadOffset = contents.indexOf('## Manifest payload\n');
  if (!expected || payloadOffset < 0) {
    return { ok: false, error: 'This file does not include a complete CCTI manifest integrity section.' };
  }
  const actual = createHash('sha256').update(contents.slice(payloadOffset), 'utf8').digest('hex');
  return { ok: true, expected, actual, matched: actual === expected };
}

async function verifyInstallationManifestAtPath(manifestPath) {
  try {
    if (typeof manifestPath !== 'string' || !manifestPath) return { ok: false, error: 'Choose a saved CCTI manifest file.' };
    const metadata = await fs.stat(manifestPath);
    if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) {
      return { ok: false, error: 'Choose a manifest text file smaller than 2 MB.' };
    }
    const contents = await fs.readFile(manifestPath, 'utf8');
    const verification = verifyManifestText(contents);
    if (!verification.ok) return verification;
    return {
      ok: true,
      canceled: false,
      filename: path.basename(manifestPath),
      expected: verification.expected,
      actual: verification.actual,
      matched: verification.matched,
      contents,
    };
  } catch {
    return { ok: false, error: 'CCTI could not read that manifest. Choose a readable manifest text file.' };
  }
}

function publicManifestVerification(result) {
  if (!result.ok) return result;
  const { contents, ...safeResult } = result;
  return safeResult;
}

async function verifyInstallationManifest() {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a CCTI installation manifest to verify',
      filters: [{ name: 'Manifest files', extensions: ['md', 'txt'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, canceled: true };
    return publicManifestVerification(await verifyInstallationManifestAtPath(result.filePaths[0]));
  } catch {
    return { ok: false, error: 'CCTI could not open the manifest picker.' };
  }
}

async function verifyDroppedInstallationManifest({ filePath } = {}) {
  return publicManifestVerification(await verifyInstallationManifestAtPath(filePath));
}

function manifestSectionLines(contents, heading) {
  const marker = `## ${heading}\n`;
  const start = contents.indexOf(marker);
  if (start < 0) return [];
  const section = contents.slice(start + marker.length);
  const nextHeading = section.indexOf('\n## ');
  return section.slice(0, nextHeading < 0 ? undefined : nextHeading)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line && !/not detected|no discoverable tools/i.test(line));
}

function manifestInventory(contents) {
  return [...new Set(manifestSectionLines(contents, 'Active tools and additions'))]
    .sort((left, right) => left.localeCompare(right));
}

function manifestExportTimestamp(contents) {
  const payloadOffset = contents.indexOf('## Manifest payload\n');
  const payload = payloadOffset >= 0 ? contents.slice(payloadOffset) : '';
  const match = payload.match(/^Generated: .+ \(Unix: (\d+)\)$/m);
  const unixSeconds = Number.parseInt(match?.[1] || '', 10);
  return Number.isSafeInteger(unixSeconds) ? unixSeconds : null;
}

async function compareInstallationManifests() {
  try {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose exactly two CCTI manifests to compare',
      filters: [{ name: 'Manifest files', extensions: ['md', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (selection.canceled || !selection.filePaths?.length) return { ok: true, canceled: true };
    if (selection.filePaths.length !== 2 || new Set(selection.filePaths).size !== 2) {
      return { ok: false, error: 'Choose exactly two different CCTI manifest files to compare.' };
    }
    const [first, second] = await Promise.all(selection.filePaths.map(verifyInstallationManifestAtPath));
    if (!first.ok || !first.matched || !second.ok || !second.matched) {
      return { ok: false, error: 'Both manifests must be readable and pass their recorded SHA-256 verification before CCTI compares them.' };
    }
    const firstTimestamp = manifestExportTimestamp(first.contents);
    const secondTimestamp = manifestExportTimestamp(second.contents);
    const orderedByTimestamp = firstTimestamp !== null && secondTimestamp !== null && firstTimestamp !== secondTimestamp;
    const [before, after] = orderedByTimestamp && firstTimestamp > secondTimestamp ? [second, first] : [first, second];
    const beforeTools = manifestInventory(before.contents);
    const afterTools = manifestInventory(after.contents);
    const beforeSet = new Set(beforeTools);
    const afterSet = new Set(afterTools);
    return {
      ok: true,
      canceled: false,
      beforeFilename: before.filename,
      afterFilename: after.filename,
      ordering: orderedByTimestamp ? 'export-timestamp' : 'selected-order',
      added: afterTools.filter((item) => !beforeSet.has(item)),
      removed: beforeTools.filter((item) => !afterSet.has(item)),
      unchanged: afterTools.filter((item) => beforeSet.has(item)),
    };
  } catch {
    return { ok: false, error: 'CCTI could not compare those manifests.' };
  }
}

async function resolveAppUninstallPlan() {
  const home = app.getPath('home');
  const cctiStateDir = setupManagerDir();
  const removable = [];
  if (await pathExists(cctiStateDir)) {
    removable.push({
      kind: 'path',
      path: cctiStateDir,
      label: 'CCTI local data, configuration, checklists, and managed runtime cache (~/.setup-my-claude)',
      scope: 'CCTI app only',
    });
  }
  try {
    const userDataDir = app.getPath('userData');
    // Ensure we only remove the app-specific userData directory (not root home or root temp)
    if (userDataDir && userDataDir !== home && !home.startsWith(userDataDir) && (await pathExists(userDataDir))) {
      removable.push({
        kind: 'path',
        path: userDataDir,
        label: 'CCTI desktop application preferences and window state',
        scope: 'CCTI app only',
      });
    }
  } catch {
    // userData lookup optional
  }

  const protectedItems = [
    'Claude Code CLI executable, settings, and conversation history (~/.claude, ~/.claude.json)',
    'All Claude Code tools, skills, plugins, and MCP connections installed on this computer',
    'Claude Desktop app, browser extensions, and web browser profiles',
    'Project folders, project package files, and Convex components',
  ];

  const reviewId = randomUUID();
  reviewedAppUninstallPlans.set(reviewId, {
    createdAt: Date.now(),
    removable,
  });

  for (const [id, plan] of reviewedAppUninstallPlans) {
    if (Date.now() - plan.createdAt > 10 * 60 * 1000) reviewedAppUninstallPlans.delete(id);
  }

  const platformGuidance = platformUninstallGuidance();

  return {
    ok: true,
    reviewId,
    removable: removable.map((item) => ({ label: item.label, scope: item.scope, path: item.path })),
    protected: protectedItems,
    platformGuidance,
  };
}

async function applyAppUninstall({ reviewId, confirmation } = {}) {
  if (confirmation !== 'UNINSTALL CCTI') {
    return { ok: false, error: 'You must type UNINSTALL CCTI exactly to acknowledge and authorize removal.' };
  }
  const plan = reviewedAppUninstallPlans.get(reviewId);
  if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) {
    return { ok: false, error: 'This uninstall plan has expired. Please review and start the uninstallation again.' };
  }
  if (activeInstall || activeComponentInstall) {
    return { ok: false, error: 'Another setup or installation task is currently running. Please wait for it to complete.' };
  }
  reviewedAppUninstallPlans.delete(reviewId);
  activeInstall = true;
  emit('installer:state', { running: true });
  emit('installer:output', { stream: 'stdout', text: '[CCTI] Starting complete CCTI app removal…\n' });
  emit('installer:output', { stream: 'stdout', text: '[CCTI] Claude Code and all installed tools/plugins will remain completely untouched.\n' });

  try {
    for (const item of plan.removable) {
      emit('installer:output', { stream: 'stdout', text: `[CCTI] Removing ${item.label} (${item.path})…\n` });
      await fs.rm(item.path, { recursive: true, force: true });
    }
    emit('installer:output', { stream: 'stdout', text: '[CCTI] App data and runtime files have been cleanly deleted.\n' });
    emit('installer:output', { stream: 'stdout', text: '[CCTI] Claude Code and your tools remain safe and functional.\n' });
    const notification = postAppUninstallNotification();
    emit('installer:output', { stream: 'stdout', text: `[CCTI] ${notification.body}\n` });

    setTimeout(() => {
      try {
        if (typeof app.quit === 'function') {
          app.quit();
        }
      } catch {
        // ignore quit error
      }
    }, 2000);

    return {
      ok: true,
      message: 'Claude Code Tools Installer data has been completely removed. Claude Code and all installed tools remain untouched. The application will close shortly.',
      cleanupGuidance: appUninstallCleanupGuidance(),
      notificationRequested: notification.requested,
      closedSoon: true,
    };
  } catch (error) {
    return { ok: false, error: `CCTI encountered an issue during uninstall: ${error.message}` };
  } finally {
    activeInstall = false;
    emit('installer:state', { running: false });
  }
}

function spawnInstaller(mode, selectedIds = [], dryRun = false) {
  const definition = installerDefinition();
  const args = [...definition.args, definition.script];
  const option = (windows, posix) => process.platform === 'win32' ? windows : posix;

  if (mode === 'bootstrap') {
    args.push(option('-NoLaunch', '--no-launch'), option('-BootstrapOnly', '--bootstrap-only'));
  } else if (mode === 'project-prerequisites') {
    args.push(option('-NoLaunch', '--no-launch'), option('-ProjectPrerequisites', '--project-prerequisites'));
  } else if (mode === 'claude-only') {
    args.push(option('-NoLaunch', '--no-launch'), option('-ClaudeOnly', '--claude-only'), option('-Yes', '--yes'));
  } else if (mode === 'complete' || mode === 'fresh-complete') {
    args.push(option('-Complete', '--complete'));
    if (mode === 'fresh-complete') args.push(option('-Fresh', '--fresh'), option('-FreshConfirmed', '--fresh-confirmed'));
  } else {
    args.push(option('-NoLaunch', '--no-launch'), option('-Yes', '--yes'));
    if (selectedIds.length > 0) {
      args.push(option('-Item', '--item'), selectedIds.join(','));
    }
  }
  if (dryRun) {
    args.push(option('-DryRun', '--dry-run'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(definition.command, args, {
      cwd: app.getPath('home'),
      windowsHide: true,
      env: claudeProcessEnv(),
    });

    child.stdout.on('data', (chunk) => emit('installer:output', { stream: 'stdout', text: chunk.toString() }));
    child.stderr.on('data', (chunk) => emit('installer:output', { stream: 'stderr', text: chunk.toString() }));
    child.on('error', (error) => reject(new Error(`Could not start ${definition.command}: ${error.message}`)));
    child.on('close', (code) => resolve({ code, args }));
  });
}

async function validateSetupProjectFolder(projectPath) {
  return resolveProjectFolder(projectPath);
}

async function selectedComponents(componentIds) {
  if (!Array.isArray(componentIds) || componentIds.length === 0) {
    throw new Error('Add at least one Convex Component to the project plan.');
  }
  const catalog = await readComponentCatalog();
  const byId = new Map(catalog.components.map((component) => [component.id, component]));
  const selected = componentIds.map((id) => byId.get(id));
  if (selected.some((component) => !component)) {
    throw new Error('One or more selected Convex Components are no longer in the verified catalog.');
  }
  return selected;
}

async function askSitePoweredCompass(payload) {
  const message = String(payload?.message || '').trim();
  if (!message || message.length > 4000) {
    return { ok: false, error: 'Ask one question with up to 4,000 characters.' };
  }
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const safeHistory = history
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string')
    .slice(-5)
    .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 1200) }));
  safeHistory.push({ role: 'user', content: message.slice(0, 1200) });

  try {
    const response = await fetch(compassOnlineEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        '0': { json: { messages: safeHistory } },
      }),
    });
    if (!response.ok) {
      return { ok: false, error: 'Compass could not answer online right now. Nothing on your computer was changed.' };
    }
    const body = await response.json();
    const answer = body?.[0]?.result?.data?.json?.reply || body?.[0]?.result?.data?.reply;
    return { ok: typeof answer === 'string' && answer.trim().length > 0, answer: answer || 'Compass did not receive a text answer. Please try again.' };
  } catch {
    return { ok: false, error: 'Compass could not reach online help. Check your internet connection and try again.' };
  }
}

/** Send only an explicit, three-choice success category. Never include a person, machine, path, tool list, log, or event ID. */
async function reportAnonymousSetupSuccess(payload) {
  const kind = String(payload?.kind || '');
  if (!['complete_setup', 'selected_tools', 'project_components'].includes(kind) || payload?.consent !== true) {
    return { ok: false, error: 'Choose the anonymous success option before sending it.' };
  }
  try {
    const response = await fetch(anonymousSuccessEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ '0': { json: { kind, consent: true } } }),
    });
    if (!response.ok) return { ok: false, error: 'The anonymous count could not be sent right now.' };
    const body = await response.json();
    const recorded = body?.[0]?.result?.data?.json?.recorded ?? body?.[0]?.result?.data?.recorded;
    return { ok: recorded === true, error: recorded === true ? '' : 'The anonymous count could not be confirmed.' };
  } catch {
    return { ok: false, error: 'The anonymous count could not reach the site. Your setup result is unchanged.' };
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return { found: true, json: JSON.parse(await fs.readFile(filePath, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { found: false, json: null };
    return { found: true, json: null, error: 'This settings file could not be read.' };
  }
}

async function managedPrerequisiteFindings() {
  const home = app.getPath('home');
  const baseDir = setupManagerDir();
  const nodeLocation = process.platform === 'win32'
    ? path.join(baseDir, 'node-runtime', 'node.exe')
    : path.join(baseDir, 'node-runtime', 'bin', 'node');
  const findings = [];
  try {
    await fs.access(nodeLocation);
    findings.push({ id: `runtime:${nodeLocation}`, type: 'runtime', name: 'CCTI-managed Node.js', scope: 'This computer', path: nodeLocation, description: 'A runtime CCTI prepared for tools that need Node.js. It is available to this app without changing your project files.' });
  } catch {
    // Only CCTI-managed runtime locations are listed; system-wide tools are outside this checkup scope.
  }
  try {
    const checklist = await fs.stat(pluginChecklistPath());
    if (checklist.size > 0) findings.push({ id: `follow-up:${pluginChecklistPath()}`, type: 'follow-up', name: 'CCTI follow-up checklist', scope: 'Your action may be needed', path: pluginChecklistPath(), description: 'Some selected add-ons need a sign-in, key, license, or upstream step. CCTI did not pretend those steps were finished.' });
  } catch {
    // No app-created follow-up checklist exists yet.
  }
  const claude = await claudeStatus();
  if (claude.installed) findings.push({ id: `tool:claude:${claude.path || home}`, type: 'tool', name: 'Claude Code', scope: 'This computer', path: claude.path || 'Claude Code command location', description: `Claude Code can run${claude.version ? `: ${claude.version}` : ''}.` });
  return findings;
}

function componentPackageFindings(manifest, packageJsonPath) {
  const dependencies = Object.entries({ ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) });
  return [
    { id: `project-file:${packageJsonPath}`, type: 'project-file', name: 'Project package file', scope: 'This project', path: packageJsonPath, description: 'This file keeps the project packages CCTI installed in the selected folder.' },
    ...dependencies.slice(0, 80).map(([name, version]) => ({ id: `project-package:${packageJsonPath}:${name}`, type: 'project-package', name, scope: 'This project', path: packageJsonPath, description: `Project package${version ? ` · ${version}` : ''}.` })),
  ];
}

function normalizedFindingName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function duplicateSkillSort(left, right) {
  const leftDate = Date.parse(left.updatedAt || '') || 0;
  const rightDate = Date.parse(right.updatedAt || '') || 0;
  if (leftDate !== rightDate) return rightDate - leftDate;
  const scopeRank = (item) => item.scope === 'Just you' ? 0 : item.scope === 'This project' ? 1 : 2;
  const scopeDifference = scopeRank(left) - scopeRank(right);
  if (scopeDifference !== 0) return scopeDifference;
  return String(left.path || '').localeCompare(String(right.path || ''));
}

function skillSourceWithinCheckedRoot(report, source) {
  const userSkillRoot = path.join(app.getPath('home'), '.claude', 'skills');
  const projectSkillRoot = report?.projectPath ? path.join(report.projectPath, '.claude', 'skills') : '';
  const parent = path.dirname(source);
  return parent === userSkillRoot || parent === projectSkillRoot;
}

function skillBackupDestination(report, source) {
  const projectSkillRoot = report?.projectPath ? path.join(report.projectPath, '.claude', 'skills') : '';
  const isProjectSkill = path.dirname(source) === projectSkillRoot;
  const backupRoot = isProjectSkill
    ? path.join(report.projectPath, '.claude', '.setup-my-claude-disabled')
    : path.join(setupManagerDir(), 'disabled-skills');
  return path.join(backupRoot, `${path.basename(source)}-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

function backupNameDetails(backupName) {
  const match = String(backupName || '').match(/^(.+)-(\d{13})-([a-f0-9]{8})$/i);
  if (!match || !match[1] || path.basename(match[1]) !== match[1] || match[1].startsWith('.')) return null;
  return { name: match[1], createdAt: Number(match[2]) };
}

function originalSkillNameFromBackup(backupName) {
  return backupNameDetails(backupName)?.name || '';
}

async function listRestorableSkillBackups(projectPath = '') {
  const locations = [{
    backupRoot: path.join(setupManagerDir(), 'disabled-skills'),
    skillRoot: path.join(app.getPath('home'), '.claude', 'skills'),
    scope: 'Just you',
  }];
  if (projectPath) locations.push({
    backupRoot: path.join(projectPath, '.claude', '.setup-my-claude-disabled'),
    skillRoot: path.join(projectPath, '.claude', 'skills'),
    scope: 'This project',
  });
  const backups = [];
  for (const location of locations) {
    let entries;
    try {
      entries = await fs.readdir(location.backupRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      backups.push({ id: `backup-root:${location.backupRoot}`, type: 'attention', name: 'Skill backups folder needs attention', scope: location.scope, path: location.backupRoot, description: 'CCTI could not read this skill backup folder. It was not changed.' });
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const backupDetails = backupNameDetails(entry.name);
      if (!backupDetails) continue;
      const { name, createdAt: backupCreatedAt } = backupDetails;
      const backupPath = path.join(location.backupRoot, entry.name);
      const destination = path.join(location.skillRoot, name);
      try {
        const manifest = await skillContentManifest(backupPath);
        const destinationExists = await pathExists(destination);
        backups.push({
          id: `backup:${backupPath}`,
          type: 'skill-backup',
          name,
          scope: location.scope,
          path: backupPath,
          destination,
          contentHash: manifest.identity,
          files: manifest.files,
          totalBytes: manifest.totalBytes,
          backupCreatedAt,
          restorable: !destinationExists,
          description: destinationExists
            ? 'A preserved skill backup. CCTI will not restore it because its original skill folder already exists.'
            : 'A preserved CCTI skill backup that can be restored to its original Claude Code location.',
        });
      } catch (error) {
        backups.push({ id: `backup:${backupPath}`, type: 'attention', name, scope: location.scope, path: backupPath, destination, description: `This skill backup could not be verified: ${error.message} It was not changed.` });
      }
    }
  }
  const backupsByDestination = new Map();
  for (const backup of backups.filter((item) => item.type === 'skill-backup' && item.restorable)) {
    backupsByDestination.set(backup.destination, [...(backupsByDestination.get(backup.destination) || []), backup]);
  }
  for (const destinationBackups of backupsByDestination.values()) {
    destinationBackups.sort((left, right) => right.backupCreatedAt - left.backupCreatedAt);
    for (const olderBackup of destinationBackups.slice(1)) {
      olderBackup.restorable = false;
      olderBackup.description = 'A preserved CCTI skill backup. CCTI will not restore it automatically because a newer backup targets the same original skill location.';
    }
  }
  return backups;
}

async function skillContentManifest(skillPath) {
  const root = path.resolve(skillPath);
  const files = [];
  let totalBytes = 0;
  const walk = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) throw new Error('A skill contains a symbolic link.');
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maximumSkillHashFiles) throw new Error('A skill contains too many files to verify safely.');
      const metadata = await fs.stat(filePath);
      totalBytes += metadata.size;
      if (totalBytes > maximumSkillHashBytes) throw new Error('A skill is too large to verify safely.');
      const relativePath = path.relative(root, filePath).split(path.sep).join('/');
      const contents = await fs.readFile(filePath);
      files.push({ path: relativePath, size: metadata.size, sha256: createHash('sha256').update(contents).digest('hex') });
    }
  };
  await walk(root);
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('The skill no longer contains SKILL.md.');
  const identity = createHash('sha256').update(files.map((file) => `${file.path}\0${file.sha256}\0${file.size}\n`).join(''), 'utf8').digest('hex');
  return { identity, files, totalBytes };
}

async function describeSkillForDiscovery(skillPath, scope, name) {
  const skillFile = path.join(skillPath, 'SKILL.md');
  const [metadata, manifest] = await Promise.all([
    fs.stat(skillFile),
    skillContentManifest(skillPath),
  ]);
  return {
    id: `skill:${skillPath}`,
    type: 'skill',
    name,
    scope,
    path: skillPath,
    updatedAt: metadata.mtime.toISOString(),
    contentHash: manifest.identity,
    files: manifest.files,
    totalBytes: manifest.totalBytes,
    description: 'A saved set of instructions for Claude Code.',
  };
}

function moveFilesForPreview(move) {
  return (Array.isArray(move.files) ? move.files : []).map((file) => ({
    source: path.join(move.source, ...file.path.split('/')),
    destination: path.join(move.destination, ...file.path.split('/')),
    size: file.size,
    sha256: file.sha256,
  }));
}

function duplicateSkillGroups(skills) {
  const all = Array.isArray(skills) ? skills : [];
  const groups = [];
  const movedByContent = new Set();
  const contentIndex = new Map();
  for (const item of all) {
    const key = String(item.contentHash || '');
    if (!key) continue;
    contentIndex.set(key, [...(contentIndex.get(key) || []), item]);
  }
  for (const items of contentIndex.values()) {
    if (items.length < 2) continue;
    const ordered = [...items].sort(duplicateSkillSort);
    const names = [...new Set(ordered.map((entry) => entry.name))].sort((left, right) => left.localeCompare(right));
    ordered.slice(1).forEach((entry) => movedByContent.add(entry.id));
    groups.push({
      name: names.join(' / '),
      names,
      match: 'content-hash',
      keep: ordered[0],
      moves: ordered.slice(1),
      items: ordered,
    });
  }

  const nameIndex = new Map();
  for (const item of all.filter((entry) => !movedByContent.has(entry.id))) {
    const key = normalizedFindingName(item.name);
    nameIndex.set(key, [...(nameIndex.get(key) || []), item]);
  }
  for (const items of nameIndex.values()) {
    if (items.length < 2) continue;
    const ordered = [...items].sort(duplicateSkillSort);
    groups.push({
      name: ordered[0].name,
      names: [...new Set(ordered.map((entry) => entry.name))],
      match: 'name',
      keep: ordered[0],
      moves: ordered.slice(1),
      items: ordered,
    });
  }
  return groups.sort((left, right) => left.name.localeCompare(right.name));
}

function duplicateSkillCleanupGroups(report) {
  return duplicateSkillGroups([...(report?.skills?.values?.() || [])]);
}

async function listSkillsAt(rootPath, scope) {
  const skillRoot = path.join(rootPath, '.claude', 'skills');
  try {
    const entries = await fs.readdir(skillRoot, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillPath = path.join(skillRoot, entry.name);
      try {
        skills.push(await describeSkillForDiscovery(skillPath, scope, entry.name));
      } catch (error) {
        try {
          await fs.access(path.join(skillPath, 'SKILL.md'));
          skills.push({ id: `skill:${skillPath}`, type: 'attention', name: entry.name, scope, path: skillPath, description: `This skill could not be verified for duplicate cleanup: ${error.message} It was not changed.` });
        } catch {
          // A folder without SKILL.md is not presented as an installed skill.
        }
      }
    }
    return skills;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    return [{ id: `skill-root:${skillRoot}`, type: 'attention', name: 'Skills folder needs attention', scope, path: skillRoot, description: 'The app could not read this skills folder. It did not change anything.' }];
  }
}

async function installedSkillsMatching(skillName, projectPath = '', contentHash = '') {
  const normalizedName = normalizedFindingName(skillName);
  const locations = [{ root: app.getPath('home'), scope: 'Just you' }];
  if (projectPath) locations.push({ root: projectPath, scope: 'This project' });
  const skills = (await Promise.all(locations.map(({ root, scope }) => listSkillsAt(root, scope)))).flat();
  return skills.filter((item) => item.type === 'skill' && (normalizedFindingName(item.name) === normalizedName || (contentHash && item.contentHash === contentHash)));
}

function settingsFindings(json, filePath, scope) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return [{ id: `settings:${filePath}`, type: 'attention', name: 'Settings file needs attention', scope, path: filePath, description: 'This settings file is not in the usual JSON format. The app did not change it.' }];
  }
  const findings = [];
  const addNames = (value, type, description) => {
    const names = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value) : [];
    names.forEach((name) => findings.push({ id: `${type}:${filePath}:${name}`, type, name, scope, path: filePath, description }));
  };
  addNames(json.enabledPlugins, 'plugin', 'A Claude Code add-on enabled in this settings file.');
  addNames(json.mcpServers, 'connection', 'A saved connection that lets Claude Code talk to another service.');
  if (findings.length === 0) findings.push({ id: `settings:${filePath}`, type: 'settings', name: 'Claude Code settings', scope, path: filePath, description: 'A Claude Code settings file. No standard add-on list was found inside it.' });
  return findings;
}

async function discoverClaudeSetup(projectPath = '') {
  const home = app.getPath('home');
  const skillLocations = [{ root: home, scope: 'Just you' }];
  const locations = [
    { root: home, scope: 'Just you', settings: path.join(home, '.claude', 'settings.json') },
    { root: home, scope: 'Just you', settings: path.join(home, '.claude.json') },
  ];
  let resolvedProjectPath = '';
  if (projectPath) {
    resolvedProjectPath = await validateSetupProjectFolder(projectPath);
    skillLocations.push({ root: resolvedProjectPath, scope: 'This project' });
    locations.push(
      { root: resolvedProjectPath, scope: 'This project', settings: path.join(resolvedProjectPath, '.claude', 'settings.json') },
      { root: resolvedProjectPath, scope: 'Only you in this project', settings: path.join(resolvedProjectPath, '.claude', 'settings.local.json') },
    );
  }

  const findings = await managedPrerequisiteFindings();
  for (const location of skillLocations) {
    findings.push(...await listSkillsAt(location.root, location.scope));
  }
  for (const location of locations) {
    const settings = await readJsonIfPresent(location.settings);
    if (settings.found) findings.push(...settingsFindings(settings.json, location.settings, location.scope));
  }

  if (resolvedProjectPath) {
    try {
      const projectPackage = await inspectProjectPackage(resolvedProjectPath);
      if (projectPackage.packageState === 'existing') {
        findings.push(...componentPackageFindings(projectPackage.manifest, projectPackage.packageJsonPath));
      } else {
        findings.push({ id: `project-file-missing:${projectPackage.packageJsonPath}`, type: 'attention', name: 'Project package file will be created when needed', scope: 'This project', path: projectPackage.packageJsonPath, description: 'This selected folder is ready. CCTI creates its package file automatically when you install a project component.' });
      }
    } catch (error) {
      findings.push({ id: `project-file-attention:${resolvedProjectPath}`, type: 'attention', name: 'Project package file needs attention', scope: 'This project', path: path.join(resolvedProjectPath, 'package.json'), description: error.message });
    }
  }
  findings.push(...await listRestorableSkillBackups(resolvedProjectPath));

  const claude = await claudeStatus();
  if (claude.installed) {
    const [plugins, connections] = await Promise.all([
      runProcess('claude', ['plugin', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
      runProcess('claude', ['mcp', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
    ]);
    if (plugins.code === 0) plugins.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((name) => findings.push({ id: `plugin-cli:${name}`, type: 'plugin', name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
    if (connections.code === 0) connections.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean).forEach((name) => findings.push({ id: `connection-cli:${name}`, type: 'connection', name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
  }

  const nonSkillGroups = new Map();
  findings.filter((item) => ['plugin', 'connection'].includes(item.type)).forEach((item) => {
    const key = `${item.type}:${normalizedFindingName(item.name)}`;
    nonSkillGroups.set(key, [...(nonSkillGroups.get(key) || []), item]);
  });
  const skills = findings.filter((item) => item.type === 'skill');
  const skillDuplicates = duplicateSkillGroups(skills).map((group) => {
    const sameName = group.names.length === 1;
    return {
      name: group.name,
      type: 'skill',
      match: group.match,
      names: group.names,
      contentHash: group.items[0].contentHash,
      items: group.items,
      explanation: group.match === 'content-hash'
        ? sameName
          ? 'These skill folders have the same name and identical verified file content. Review the scopes before keeping more than one copy.'
          : 'These skill folders have different names but identical verified file content. Review the scopes before keeping more than one copy.'
        : group.match === 'name'
          ? 'These skill folders have the same name in more than one Claude Code location. Review the scopes and content before keeping more than one copy.'
          : 'These skill folders overlap by name or identical verified file content. Review the scopes and content before keeping more than one copy.',
    };
  });
  const duplicates = [
    ...skillDuplicates,
    ...[...nonSkillGroups.values()].filter((items) => items.length > 1).map((items) => ({
      name: items[0].name,
      type: items[0].type,
      match: 'name',
      items,
      explanation: 'This name appears in more than one Claude Code location. That can be useful, but review the scopes before keeping more than one copy.',
    })),
  ];
  const discoveryId = randomUUID();
  const manageablePlugins = findings.filter((item) => item.type === 'plugin' && ['Just you', 'This project', 'Only you in this project'].includes(item.scope));
  const skillBackups = findings.filter((item) => item.type === 'skill-backup');
  discoveredSkillCleanup.set(discoveryId, {
    createdAt: Date.now(),
    skills: new Map(skills.map((item) => [item.id, {
      id: item.id,
      name: item.name,
      path: item.path,
      scope: item.scope,
      updatedAt: item.updatedAt,
      contentHash: item.contentHash,
      files: item.files,
      totalBytes: item.totalBytes,
    }])),
    backups: new Map(skillBackups.map((item) => [item.id, {
      id: item.id,
      name: item.name,
      path: item.path,
      destination: item.destination,
      scope: item.scope,
      contentHash: item.contentHash,
      files: item.files,
      totalBytes: item.totalBytes,
      restorable: item.restorable,
    }])),
    plugins: new Map(manageablePlugins.map((item) => [item.id, { name: item.name, scope: item.scope }])),
    projectPath: resolvedProjectPath,
  });
  for (const [id, report] of discoveredSkillCleanup) {
    if (Date.now() - report.createdAt > 30 * 60 * 1000) discoveredSkillCleanup.delete(id);
  }
  while (discoveredSkillCleanup.size > 10) {
    discoveredSkillCleanup.delete(discoveredSkillCleanup.keys().next().value);
  }
  return { discoveryId, checkedAt: new Date().toISOString(), projectPath: resolvedProjectPath, findings, duplicates };
}

async function reviewPluginChange({ discoveryId, findingId, action }) {
  const finding = discoveredSkillCleanup.get(discoveryId)?.plugins?.get(findingId);
  if (!finding || !['enable', 'disable'].includes(action)) return { ok: false, error: 'Run the checkup again before changing an add-on.' };
  const scope = finding.scope === 'This project' ? 'project' : finding.scope === 'Only you in this project' ? 'local' : 'user';
  const reviewId = randomUUID();
  reviewedPluginChanges.set(reviewId, { name: finding.name, scope, action, createdAt: Date.now() });
  return { ok: true, reviewId, name: finding.name, scope: finding.scope, action, description: `${action === 'enable' ? 'Turn on' : 'Turn off'} this add-on for ${finding.scope.toLowerCase()}. This does not uninstall it.` };
}

async function applyPluginChange({ reviewId }) {
  const plan = reviewedPluginChanges.get(reviewId);
  if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) return { ok: false, error: 'This review has expired. Run the checkup again.' };
  reviewedPluginChanges.delete(reviewId);
  try {
    const result = await runProcess('claude', ['plugin', plan.action, plan.name, '--scope', plan.scope], { cwd: app.getPath('home'), env: claudeProcessEnv() });
    if (result.code !== 0) return { ok: false, error: result.stderr.trim() || `Claude Code could not ${plan.action} this add-on.` };
    return { ok: true, message: `${plan.name} is now ${plan.action === 'enable' ? 'enabled' : 'disabled'} for the selected scope.` };
  } catch (error) {
    return { ok: false, error: `CCTI could not ${plan.action} this add-on: ${error.message}` };
  }
}

async function chooseSetupProject() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose a project to check', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { canceled: false, projectPath: path.resolve(result.filePaths[0]) };
}

async function chooseCustomSource() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose your skill or plugin folder', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { canceled: false, source: path.resolve(result.filePaths[0]) };
}

function validRepository(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

async function reviewCustomAddOn({ source, scope, projectPath }) {
  const cleanSource = String(source || '').trim();
  const cleanScope = ['user', 'project'].includes(scope) ? scope : 'user';
  let resolvedProject = '';
  const requestedProjectPath = String(projectPath || '').trim();
  if (cleanScope === 'project' || requestedProjectPath) {
    try {
      resolvedProject = await validateSetupProjectFolder(requestedProjectPath);
    } catch (error) {
      if (cleanScope === 'project') return { ok: false, error: error.message };
    }
  }
  if (!cleanSource) return { ok: false, error: 'Choose a folder or enter a trusted marketplace source first.' };

  if (cleanSource.startsWith('https://')) {
    try {
      const url = new URL(cleanSource);
      if (url.username || url.password || !url.pathname.endsWith('marketplace.json')) throw new Error();
      return { ok: true, kind: 'marketplace', source: cleanSource, scope: 'user', command: `claude plugin marketplace add ${cleanSource}`, description: 'Adds this trusted plugin marketplace to your Claude Code checklist. You will run the shown command only after a final confirmation.' };
    } catch {
      return { ok: false, error: 'Use a trusted HTTPS marketplace link that ends in marketplace.json.' };
    }
  }
  if (validRepository(cleanSource)) {
    return { ok: true, kind: 'marketplace', source: cleanSource, scope: 'user', description: 'Adds this reviewed GitHub marketplace to your Claude Code setup after one final confirmation.' };
  }
  const sourcePath = path.resolve(cleanSource);
  try {
    const info = await fs.lstat(sourcePath);
    if (info.isSymbolicLink() || !info.isDirectory()) return { ok: false, error: 'Choose a direct local skill folder, not a symbolic link or file.' };
    try {
      await fs.access(path.join(sourcePath, 'SKILL.md'));
      const root = cleanScope === 'user' ? app.getPath('home') : resolvedProject;
      const destination = path.join(root, '.claude', 'skills', path.basename(sourcePath));
      const sourceManifest = await skillContentManifest(sourcePath);
      const existing = await installedSkillsMatching(path.basename(sourcePath), resolvedProject, sourceManifest.identity);
      if (existing.length > 0) {
        const contentMatch = existing.some((item) => item.contentHash === sourceManifest.identity);
        return {
          ok: true,
          blocked: true,
          kind: 'duplicate-skill',
          match: contentMatch ? 'content-hash' : 'name',
          name: path.basename(sourcePath),
          source: sourcePath,
          scope: cleanScope,
          destination,
          existing,
          description: contentMatch
            ? `CCTI did not add ${path.basename(sourcePath)} because identical skill content is already available in Claude Code.`
            : `CCTI did not add ${path.basename(sourcePath)} because this skill name is already available in Claude Code.`,
        };
      }
      return { ok: true, kind: 'skill-copy', source: sourcePath, scope: cleanScope, destination, description: 'Copies this local skill folder into the selected Claude Code scope. The original folder stays where it is.' };
    } catch {
      try {
        await fs.access(path.join(sourcePath, '.claude-plugin', 'marketplace.json'));
        return { ok: true, kind: 'marketplace', source: sourcePath, scope: 'user', description: 'Adds this reviewed local plugin marketplace to your Claude Code setup after one final confirmation.' };
      } catch {
        return { ok: false, error: 'This folder is not a skill (SKILL.md) or a plugin marketplace (.claude-plugin/marketplace.json).' };
      }
    }
  } catch {
    return { ok: false, error: 'This folder could not be found or read.' };
  }
}

async function applyCustomAddOn(payload) {
  const review = await reviewCustomAddOn(payload);
  if (!review.ok) return review;
  if (review.kind === 'duplicate-skill' || review.blocked) {
    return { ok: false, code: 'already-available', error: review.description, name: review.name, existing: review.existing || [] };
  }
  if (review.kind === 'skill-copy') {
    try {
      await fs.access(review.destination);
      return { ok: false, code: 'already-available', error: `CCTI did not add ${path.basename(review.destination)} because this skill is already available in Claude Code.` };
    } catch {
      await fs.mkdir(path.dirname(review.destination), { recursive: true });
      await fs.cp(review.source, review.destination, { recursive: true, errorOnExist: true });
      return { ok: true, message: `Added your skill to ${review.scope === 'user' ? 'your Claude Code setup' : 'the selected project'}.` };
    }
  }
  try {
    const result = await runProcess('claude', ['plugin', 'marketplace', 'add', review.source], { cwd: app.getPath('home'), env: claudeProcessEnv() });
    if (result.code !== 0) return { ok: false, error: result.stderr.trim() || 'CCTI could not add this marketplace.' };
    return { ok: true, message: 'CCTI added the reviewed marketplace to your Claude Code setup. No plugin from it was installed yet.' };
  } catch (error) {
    return { ok: false, error: `CCTI could not add this marketplace: ${error.message}` };
  }
}

async function reviewCleanup({ discoveryId, findingId }) {
  const report = discoveredSkillCleanup.get(discoveryId);
  const finding = report?.skills.get(findingId);
  if (!finding || !path.isAbsolute(finding.path)) {
    return { ok: false, error: 'For safety, this app only offers cleanup for a skill folder it found during this check.' };
  }
  const source = path.resolve(finding.path);
  if (!skillSourceWithinCheckedRoot(report, source)) {
    return { ok: false, error: 'For safety, this skill is outside the Claude Code locations checked by this app.' };
  }
  const destination = skillBackupDestination(report, source);
  const reviewId = randomUUID();
  const plan = { ok: true, reviewId, discoveryId, findingId, source, destination, description: 'This moves the selected skill to a backup folder. It does not delete it. You can move it back later.' };
  reviewedCleanupPlans.set(reviewId, { ...plan, createdAt: Date.now() });
  for (const [id, review] of reviewedCleanupPlans) {
    if (Date.now() - review.createdAt > 10 * 60 * 1000) reviewedCleanupPlans.delete(id);
  }
  return plan;
}

async function applyCleanup({ reviewId }) {
  const plan = reviewedCleanupPlans.get(reviewId);
  const currentFinding = plan && discoveredSkillCleanup.get(plan.discoveryId)?.skills.get(plan.findingId);
  if (!plan || !currentFinding || currentFinding.path !== plan.source) {
    return { ok: false, error: 'This cleanup review has expired. Run the checkup again and review the backup move before continuing.' };
  }
  try {
    await fs.access(path.join(plan.source, 'SKILL.md'));
    await fs.mkdir(path.dirname(plan.destination), { recursive: true });
    await fs.rename(plan.source, plan.destination);
    discoveredSkillCleanup.get(plan.discoveryId)?.skills.delete(plan.findingId);
    reviewedCleanupPlans.delete(reviewId);
    return { ok: true, message: 'The selected skill was moved to a backup folder. No other settings were changed.' };
  } catch {
    return { ok: false, error: 'The selected skill could not be moved. It may already be gone or no longer be a skill folder.' };
  }
}

async function reviewAllDuplicateSkills({ discoveryId } = {}) {
  const report = discoveredSkillCleanup.get(String(discoveryId || ''));
  if (!report) return { ok: false, error: 'Run the checkup again before removing duplicate skills.' };
  const groups = duplicateSkillCleanupGroups(report);
  const moves = groups.flatMap((group) => group.moves.map((finding) => ({
    findingId: finding.id,
    name: finding.name,
    source: finding.path,
    destination: skillBackupDestination(report, finding.path),
    scope: finding.scope,
    contentHash: finding.contentHash,
    files: finding.files,
  })));
  if (!moves.length) return { ok: false, error: 'This checkup no longer has duplicate skills to move.' };

  const reviewId = randomUUID();
  const plan = {
    ok: true,
    reviewId,
    discoveryId,
    groups: groups.map((group) => ({
      name: group.name,
      names: group.names,
      match: group.match,
      keep: { name: group.keep.name, path: group.keep.path, scope: group.keep.scope, updatedAt: group.keep.updatedAt, contentHash: group.keep.contentHash },
      moveCount: group.moves.length,
    })),
    moves: moves.map(({ name, source, destination, scope, contentHash, files }) => ({ name, source, destination, scope, contentHash, files: moveFilesForPreview({ source, destination, files }) })),
    description: 'CCTI keeps the newest discovered copy of each identical skill content group and moves every other discovered copy to a backup folder. The review lists every backed-up file. Nothing is deleted.',
  };
  reviewedBulkCleanupPlans.set(reviewId, { ...plan, createdAt: Date.now(), moves });
  for (const [id, review] of reviewedBulkCleanupPlans) {
    if (Date.now() - review.createdAt > 10 * 60 * 1000) reviewedBulkCleanupPlans.delete(id);
  }
  return plan;
}

async function applyAllDuplicateSkills({ reviewId } = {}) {
  const plan = reviewedBulkCleanupPlans.get(String(reviewId || ''));
  const report = plan && discoveredSkillCleanup.get(plan.discoveryId);
  if (!plan || !report || Date.now() - plan.createdAt > 10 * 60 * 1000) {
    return { ok: false, error: 'This duplicate cleanup review has expired. Run the checkup again before continuing.' };
  }
  if (activeInstall || activeComponentInstall || activeSkillCleanup) {
    return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before removing duplicate skills.' };
  }

  for (const move of plan.moves) {
    const finding = report.skills.get(move.findingId);
    if (!finding || finding.path !== move.source || finding.contentHash !== move.contentHash || !path.isAbsolute(move.source) || !skillSourceWithinCheckedRoot(report, move.source)) {
      return { ok: false, error: 'The discovered duplicate list changed. Run the checkup again before continuing.' };
    }
    try {
      const currentManifest = await skillContentManifest(move.source);
      if (currentManifest.identity !== move.contentHash || JSON.stringify(currentManifest.files) !== JSON.stringify(move.files)) {
        return { ok: false, error: 'A duplicate skill changed after the preview. Run the checkup again before continuing.' };
      }
    } catch (error) {
      return { ok: false, error: error.code === 'ENOENT' ? 'A duplicate skill folder is no longer available. Run the checkup again before continuing.' : 'CCTI could not recheck one of the duplicate skill folders. Nothing was moved.' };
    }
    try {
      await fs.access(move.destination);
      return { ok: false, error: 'A backup location is already in use. Run the checkup again to create a new cleanup plan.' };
    } catch (error) {
      if (error.code !== 'ENOENT') return { ok: false, error: 'CCTI could not prepare a backup folder. Nothing was moved.' };
    }
  }

  activeSkillCleanup = true;
  const moved = [];
  try {
    for (const move of plan.moves) {
      await fs.mkdir(path.dirname(move.destination), { recursive: true });
      await fs.rename(move.source, move.destination);
      report.skills.delete(move.findingId);
      moved.push(move);
    }
    reviewedBulkCleanupPlans.delete(plan.reviewId);
    return {
      ok: true,
      movedCount: moved.length,
      groupCount: plan.groups.length,
      message: `Moved ${moved.length} duplicate skill ${moved.length === 1 ? 'copy' : 'copies'} to backup folders. CCTI kept the newest discovered copy of each skill. No other settings were changed.`,
    };
  } catch (error) {
    return {
      ok: false,
      movedCount: moved.length,
      error: moved.length
        ? `CCTI moved ${moved.length} reviewed duplicate ${moved.length === 1 ? 'copy' : 'copies'} before stopping. Review the backup folders, then run the checkup again.`
        : 'CCTI could not move the reviewed duplicate skills. Nothing was deleted.',
    };
  } finally {
    activeSkillCleanup = false;
  }
}

function backupSourceWithinCheckedRoot(report, source) {
  const roots = [path.join(setupManagerDir(), 'disabled-skills')];
  if (report?.projectPath) roots.push(path.join(report.projectPath, '.claude', '.setup-my-claude-disabled'));
  return roots.includes(path.dirname(source)) && Boolean(originalSkillNameFromBackup(path.basename(source)));
}

async function reviewAllSkillBackups({ discoveryId } = {}) {
  const report = discoveredSkillCleanup.get(String(discoveryId || ''));
  if (!report?.backups) return { ok: false, error: 'Run the checkup again before restoring skill backups.' };
  const moves = [...report.backups.values()]
    .filter((backup) => backup.restorable && path.isAbsolute(backup.path) && path.isAbsolute(backup.destination))
    .map((backup) => ({
      backupId: backup.id,
      name: backup.name,
      source: backup.path,
      destination: backup.destination,
      scope: backup.scope,
      contentHash: backup.contentHash,
      files: backup.files,
    }));
  if (!moves.length) return { ok: false, error: 'No safe CCTI skill backups are available to restore. Existing active skills are never overwritten.' };
  const reviewId = randomUUID();
  const plan = {
    ok: true,
    reviewId,
    discoveryId,
    moves: moves.map(({ name, source, destination, scope, contentHash, files }) => ({ name, source, destination, scope, contentHash, files: moveFilesForPreview({ source, destination, files }) })),
    description: 'CCTI restores only reviewed skill backups whose original direct skill locations remain empty. It never merges or overwrites active skill folders.',
  };
  reviewedBulkRestorePlans.set(reviewId, { ...plan, createdAt: Date.now(), moves });
  for (const [id, review] of reviewedBulkRestorePlans) {
    if (Date.now() - review.createdAt > 10 * 60 * 1000) reviewedBulkRestorePlans.delete(id);
  }
  return plan;
}

async function applyAllSkillBackups({ reviewId } = {}) {
  const plan = reviewedBulkRestorePlans.get(String(reviewId || ''));
  const report = plan && discoveredSkillCleanup.get(plan.discoveryId);
  if (!plan || !report || Date.now() - plan.createdAt > 10 * 60 * 1000) {
    return { ok: false, error: 'This restore review has expired. Run the checkup again before continuing.' };
  }
  if (activeInstall || activeComponentInstall || activeSkillCleanup) {
    return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before restoring skill backups.' };
  }
  for (const move of plan.moves) {
    const backup = report.backups.get(move.backupId);
    if (!backup || !backup.restorable || backup.path !== move.source || backup.destination !== move.destination || backup.contentHash !== move.contentHash || !backupSourceWithinCheckedRoot(report, move.source)) {
      return { ok: false, error: 'The discovered backup list changed. Run the checkup again before continuing.' };
    }
    if (await pathExists(move.destination)) return { ok: false, error: 'An original skill location is now in use. CCTI will not overwrite it. Run the checkup again.' };
    try {
      const currentManifest = await skillContentManifest(move.source);
      if (currentManifest.identity !== move.contentHash || JSON.stringify(currentManifest.files) !== JSON.stringify(move.files)) {
        return { ok: false, error: 'A skill backup changed after the preview. Run the checkup again before continuing.' };
      }
    } catch (error) {
      return { ok: false, error: error.code === 'ENOENT' ? 'A skill backup is no longer available. Run the checkup again before continuing.' : 'CCTI could not recheck one of the skill backups. Nothing was restored.' };
    }
  }
  activeSkillCleanup = true;
  const restored = [];
  try {
    for (const move of plan.moves) {
      await fs.mkdir(path.dirname(move.destination), { recursive: true });
      await fs.rename(move.source, move.destination);
      report.backups.delete(move.backupId);
      restored.push(move);
    }
    reviewedBulkRestorePlans.delete(plan.reviewId);
    return {
      ok: true,
      restoredCount: restored.length,
      message: `Restored ${restored.length} skill backup ${restored.length === 1 ? 'copy' : 'copies'} to their original Claude Code locations. No active skill was overwritten and no other settings changed.`,
    };
  } catch (error) {
    return {
      ok: false,
      restoredCount: restored.length,
      error: restored.length
        ? `CCTI restored ${restored.length} reviewed skill backup ${restored.length === 1 ? 'copy' : 'copies'} before stopping. Run the checkup again to review what remains.`
        : 'CCTI could not restore the reviewed skill backups. Nothing was overwritten.',
    };
  } finally {
    activeSkillCleanup = false;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#0b1020',
    title: 'Claude Code Tools Installer',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  ipcMain.handle('catalog:get', readCatalog);
  ipcMain.handle('catalog-details:get', readCatalogDetails);
  ipcMain.handle('components:get', readComponentCatalog);
  ipcMain.handle('claude:status', claudeStatus);
  ipcMain.handle('diagnostics:run', runDiagnostics);
  ipcMain.handle('diagnostics:export', async (_event, payload) => exportDiagnosticReport(payload || {}));
  ipcMain.handle('updates:get-status', async () => ({ ...updateStatus }));
  ipcMain.handle('updates:check', checkForUpdates);
  ipcMain.handle('updates:download', downloadAvailableUpdate);
  ipcMain.handle('updates:install', restartAndInstallUpdate);
  ipcMain.handle('updates:open-release', openPublishedRelease);
  ipcMain.handle('terminal:get-preference', getTerminalPreference);
  ipcMain.handle('terminal:set-preference', async (_event, payload) => setTerminalPreference(payload || {}));
  ipcMain.handle('claude:run', async (_event, payload) => launchClaudeCode(payload || {}));
  ipcMain.handle('claude:review-removal', knownClaudeRemovalPlan);
  ipcMain.handle('claude:apply-removal', async (_event, payload) => applyKnownClaudeRemoval(payload || {}));
  ipcMain.handle('setup-manager:choose-project', chooseSetupProject);
  ipcMain.handle('setup-manager:discover', async (_event, { projectPath } = {}) => discoverClaudeSetup(projectPath));
  ipcMain.handle('setup-manager:choose-custom-source', chooseCustomSource);
  ipcMain.handle('setup-manager:review-custom', async (_event, payload) => reviewCustomAddOn(payload || {}));
  ipcMain.handle('setup-manager:apply-custom', async (_event, payload) => applyCustomAddOn(payload || {}));
  ipcMain.handle('setup-manager:review-cleanup', async (_event, payload) => reviewCleanup(payload || {}));
  ipcMain.handle('setup-manager:apply-cleanup', async (_event, payload) => applyCleanup(payload || {}));
  ipcMain.handle('setup-manager:review-all-duplicates', async (_event, payload) => reviewAllDuplicateSkills(payload || {}));
  ipcMain.handle('setup-manager:apply-all-duplicates', async (_event, payload) => applyAllDuplicateSkills(payload || {}));
  ipcMain.handle('setup-manager:review-all-skill-backups', async (_event, payload) => reviewAllSkillBackups(payload || {}));
  ipcMain.handle('setup-manager:apply-all-skill-backups', async (_event, payload) => applyAllSkillBackups(payload || {}));

  ipcMain.handle('claude:install-only', async () => {
    if (activeInstall) return { ok: false, error: 'An installation is already running.', installed: false, version: '' };
    try {
      const before = await claudeStatus();
      if (before.installed) return { ok: true, installed: true, version: before.version, alreadyInstalled: true };
      activeInstall = true;
      emit('installer:state', { running: true });
      const result = await spawnInstaller('claude-only');
      const after = await claudeStatus();
      return {
        ok: result.code === 0 && after.installed,
        code: result.code,
        installed: after.installed,
        version: after.version,
        error: result.code === 0 && !after.installed ? 'Claude Code did not appear after the official installer finished.' : '',
      };
    } catch (error) {
      return { ok: false, error: error.message, installed: false, version: '' };
    } finally {
      activeInstall = false;
      emit('installer:state', { running: false });
    }
  });

  ipcMain.handle('setup:complete', async (_event, { fresh }) => {
    if (activeInstall) return { ok: false, error: 'An installation is already running.' };
    activeInstall = true;
    emit('installer:state', { running: true });
    try {
      const result = await spawnInstaller(fresh ? 'fresh-complete' : 'complete');
      const after = await claudeStatus();
      return { ok: result.code === 0, code: result.code, installed: after.installed, version: after.version };
    } catch (error) {
      return { ok: false, error: error.message, installed: false, version: '' };
    } finally {
      activeInstall = false;
      emit('installer:state', { running: false });
    }
  });

  ipcMain.handle('install:run', async (_event, { selectedIds, dryRun }) => {
    if (activeInstall) return { ok: false, error: 'An installation is already running.' };
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      return { ok: false, error: 'Choose at least one tool before continuing.' };
    }

    activeInstall = true;
    emit('installer:state', { running: true });
    try {
      const reviewedPluginIds = selectedIds.filter((id) => Object.prototype.hasOwnProperty.call(reviewedPluginPlans, id));
      const adapterIds = selectedIds.filter((id) => !Object.prototype.hasOwnProperty.call(reviewedPluginPlans, id));
      const result = adapterIds.length > 0
        ? await spawnInstaller('install', adapterIds, Boolean(dryRun))
        : { code: 0 };
      if (result.code === 0 && !dryRun) await installReviewedPlugins(reviewedPluginIds);
      if (result.code === 0 && dryRun && reviewedPluginIds.length > 0) {
        emit('installer:output', { stream: 'stdout', text: `[CCTI] Preview: ${reviewedPluginIds.length} selected plugin action${reviewedPluginIds.length === 1 ? '' : 's'} would run inside CCTI after Claude Code is ready.\n` });
      }
      return { ok: result.code === 0, code: result.code };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      activeInstall = false;
      emit('installer:state', { running: false });
    }
  });

  ipcMain.handle('components:choose-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your Convex project folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    try {
      return { canceled: false, projectPath: await resolveProjectFolder(result.filePaths[0]) };
    } catch (error) {
      return { canceled: false, error: error.message };
    }
  });

  ipcMain.handle('components:preview', async (_event, { projectPath, componentIds }) => {
    try {
      const [projectPackage, components] = await Promise.all([
        prepareProjectPackage(projectPath, { dryRun: true }),
        selectedComponents(componentIds),
      ]);
      return {
        ok: true,
        projectPath: projectPackage.projectPath,
        components,
        command: `npm install ${components.map((component) => component.packageName).join(' ')}`,
        packageJsonPath: projectPackage.packageJsonPath,
        packageState: projectPackage.packageState,
        note: projectPackage.wouldCreate
          ? 'CCTI will prepare Node.js if needed, create package.json in this selected project folder, then install these packages here. Component-specific configuration remains a separate, reviewed step.'
          : 'CCTI will prepare Node.js if needed, then install these packages in the selected project only. Component-specific configuration remains a separate, reviewed step.',
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('components:install', async (_event, { projectPath, componentIds, dryRun }) => {
    if (activeComponentInstall) return { ok: false, error: 'A project component installation is already running.' };
    try {
      const [projectInspection, components] = await Promise.all([
        inspectProjectPackage(projectPath),
        selectedComponents(componentIds),
      ]);
      const packages = components.map((component) => component.packageName);
      if (dryRun) {
        return { ok: true, preview: true, command: `npm install ${packages.join(' ')}`, components, packageJsonPath: projectInspection.packageJsonPath, packageState: projectInspection.packageState };
      }
      activeComponentInstall = true;
      emit('component:state', { running: true });
      emit('component:output', { stream: 'stdout', text: '[CCTI] Preparing the required project runtime…\n' });
      const prerequisites = await spawnInstaller('project-prerequisites');
      if (prerequisites.code !== 0) return { ok: false, code: prerequisites.code, error: 'CCTI could not prepare the required project runtime. Review the activity details and try again.' };
      const projectPackage = await prepareProjectPackage(projectInspection.projectPath);
      if (projectPackage.created) emit('component:output', { stream: 'stdout', text: `[CCTI] Created required project file: ${projectPackage.packageJsonPath}\n` });
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(npmCommand, ['install', ...packages], { cwd: projectPackage.projectPath, windowsHide: true, env: claudeProcessEnv() });
      child.stdout.on('data', (chunk) => emit('component:output', { stream: 'stdout', text: chunk.toString() }));
      child.stderr.on('data', (chunk) => emit('component:output', { stream: 'stderr', text: chunk.toString() }));
      const result = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve({ code }));
      });
      return { ok: result.code === 0, code: result.code, components, packageJsonPath: projectPackage.packageJsonPath, packageState: projectPackage.packageState };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      activeComponentInstall = false;
      emit('component:state', { running: false });
    }
  });

  ipcMain.handle('telemetry:report-setup-success', async (_event, payload) => reportAnonymousSetupSuccess(payload));
  ipcMain.handle('setup-manager:review-plugin-change', async (_event, payload) => reviewPluginChange(payload));
  ipcMain.handle('setup-manager:apply-plugin-change', async (_event, payload) => applyPluginChange(payload));
  ipcMain.handle('compass:status', async () => ({ onlineAvailable: true, provider: 'Site-powered Compass', model: 'Claude Haiku 4.5' }));
  ipcMain.handle('compass:ask', async (_event, payload) => askSitePoweredCompass(payload));
  ipcMain.handle('app:review-uninstall', async () => resolveAppUninstallPlan());
  ipcMain.handle('app:export-installation-manifest', async () => exportInstallationManifest());
  ipcMain.handle('app:open-manifest-folder', async () => openExportedManifestFolder());
  ipcMain.handle('app:get-manifest-verification-command', async () => ({ ok: true, command: manifestVerificationCommand() }));
  ipcMain.handle('app:verify-installation-manifest', async () => verifyInstallationManifest());
  ipcMain.handle('app:verify-dropped-installation-manifest', async (_event, payload) => verifyDroppedInstallationManifest(payload || {}));
  ipcMain.handle('app:compare-installation-manifests', async () => compareInstallationManifests());
  ipcMain.handle('app:apply-uninstall', async (_event, payload) => applyAppUninstall(payload));

  await createWindow();
  startBackgroundUpdateChecks();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
