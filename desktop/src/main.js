const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { inspectProjectPackage, prepareProjectPackage, resolveProjectFolder } = require('./project-prerequisites');
const { comparePackageVersions, parsePackageVersion, parseReleaseIdentity } = require('./release-identity');
const { TRACKED_ITEMS, trackedItem } = require('./inventory/tracked-items');
const { buildScan, parsePluginList, parseMcpList } = require('./inventory/scanner');
const { createLedgerStore, newlyInstalledEntries, skillBackupResolutions, extrasRemovalResolutions } = require('./inventory/ledger');
const { reconcileInventory } = require('./inventory/reconcile');
const { compareSkillKeeper, mcpDuplicateGroups, pluginDuplicateGroups, isSafeMcpName, isSafePluginId } = require('./inventory/duplicates');
const { mcpDefinitions, pluginInstalls } = require('./inventory/config-scan');
const { planResolution, groupFingerprint } = require('./inventory/resolvers');

if (process.env.CCTI_ELECTRON_TEST === '1' && process.env.CCTI_TEST_HOME) {
  app.setPath('home', path.resolve(process.env.CCTI_TEST_HOME));
}
let mainWindow;
let activeInstall = false;
let activeComponentInstall = false;
const discoveredSkillCleanup = new Map();
const reviewedCleanupPlans = new Map();
const reviewedBulkCleanupPlans = new Map();
const reviewedBulkRestorePlans = new Map();
const reviewedSkillBackupReplacementPlans = new Map();
const reviewedPluginChanges = new Map();
const reviewedProjectPackageRemovalPlans = new Map();
const reviewedManagedExtrasRemovalPlans = new Map();
const reviewedCustomAddOnPlans = new Map();
const reviewedClaudeRemovalPlans = new Map();
const reviewedAppUninstallPlans = new Map();
const reviewedResolutions = new Map();
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
const releaseServiceEndpoint = 'https://claudetool.app/api/releases/latest';
const releaseUrlPrefix = 'https://github.com/SteveKinzey/claude-code-tools-installer/releases/';
const githubReleaseTimeoutMs = 12_000;
const releaseServiceTimeoutMs = 8_000;
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
  latestPackageVersion: '',
  latestPublicTag: '',
  releaseUrl: '',
  checkedAt: '',
  message: 'Update status has not been checked yet.',
  artifactDigestSummary: { total: 0, verified: 0, missing: [] },
  digestAlert: null,
  canDownload: false,
  canInstall: false,
};
const reviewedPluginPlans = {
  superpowers: [['plugin', 'marketplace', 'add', 'obra/superpowers-marketplace'], ['plugin', 'install', 'superpowers@superpowers-marketplace', '--scope', 'user', '--yes']],
  ecc: [['plugin', 'marketplace', 'add', 'https://github.com/affaan-m/ECC'], ['plugin', 'install', 'ecc@ecc', '--scope', 'user', '--yes']],
  'anthropic-skills': [['plugin', 'marketplace', 'add', 'anthropics/skills']],
  'wshobson-agents': [['plugin', 'marketplace', 'add', 'https://github.com/wshobson/agents'], ['plugin', 'install', 'claude-code-essentials', '--scope', 'user', '--yes']],
  'claude-plugins-official': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official']],
  'frontend-design': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'frontend-design@claude-plugins-official', '--scope', 'user', '--yes']],
  'code-review': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'code-review@claude-plugins-official', '--scope', 'user', '--yes']],
  context7: [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'context7@claude-plugins-official', '--scope', 'user', '--yes']],
  'skill-creator': [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'skill-creator@claude-plugins-official', '--scope', 'user', '--yes']],
  convex: [['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official'], ['plugin', 'install', 'convex@claude-plugins-official', '--scope', 'user', '--yes']],
  'claude-hud': [['plugin', 'marketplace', 'add', 'jarrodwatts/claude-hud'], ['plugin', 'install', 'claude-hud', '--scope', 'user', '--yes']],
};
const completeSetupPluginIds = ['superpowers', 'anthropic-skills', 'claude-hud'];

function setupManagerDir() {
  return path.join(app.getPath('home'), '.setup-my-claude');
}

function managedExtrasManifestPath() {
  return path.join(setupManagerDir(), 'manifest.tsv');
}

function terminalPreferencePath() {
  return path.join(app.getPath('userData'), 'terminal-preference.json');
}

let inventoryStore = null;

function inventoryLedger() {
  if (!inventoryStore) inventoryStore = createLedgerStore(path.join(app.getPath('userData'), 'inventory.json'));
  return inventoryStore;
}

function macBundlePaths(bundleName) {
  if (process.env.CCTI_TERMINAL_PREFERENCE_TEST === '1') {
    if (bundleName === 'iTerm.app' && process.env.CCTI_TEST_ITERM2_BUNDLE_PATH) return [process.env.CCTI_TEST_ITERM2_BUNDLE_PATH];
    try {
      const testPaths = JSON.parse(process.env.CCTI_TEST_TERMINAL_BUNDLE_PATHS || '{}');
      if (typeof testPaths[bundleName] === 'string' && testPaths[bundleName]) return [testPaths[bundleName]];
    } catch {}
  }
  return [`/Applications/${bundleName}`, path.join(app.getPath('home'), 'Applications', bundleName)];
}

function supportedTerminalOptions() {
  if (process.platform === 'darwin') {
    return [
      { id: 'default', label: 'Default Terminal', launcher: 'mac-terminal', applicationId: 'com.apple.Terminal', alwaysAvailable: true },
      { id: 'iterm2', label: 'iTerm2', launcher: 'mac-iterm2', applicationId: 'com.googlecode.iterm2', bundlePaths: macBundlePaths('iTerm.app') },
      { id: 'ghostty', label: 'Ghostty', launcher: 'mac-command', executable: 'ghostty', bundlePaths: macBundlePaths('Ghostty.app') },
      { id: 'wezterm', label: 'WezTerm', launcher: 'mac-command', executable: 'wezterm', bundlePaths: macBundlePaths('WezTerm.app') },
      { id: 'alacritty', label: 'Alacritty', launcher: 'mac-command', executable: 'Alacritty', bundlePaths: macBundlePaths('Alacritty.app') },
      { id: 'kitty', label: 'Kitty', launcher: 'mac-command', executable: 'kitty', bundlePaths: macBundlePaths('kitty.app') },
    ];
  }
  if (process.platform === 'win32') {
    return [
      { id: 'default', label: 'PowerShell', launcher: 'windows-powershell', commands: ['pwsh.exe', 'powershell.exe'] },
      { id: 'windows-terminal', label: 'Windows Terminal', launcher: 'windows-terminal', commands: ['wt.exe'] },
    ];
  }
  return [
    { id: 'default', label: 'Default system terminal', launcher: 'linux-default', commands: ['x-terminal-emulator'] },
    { id: 'gnome-terminal', label: 'GNOME Terminal', launcher: 'linux-gnome', commands: ['gnome-terminal'] },
    { id: 'konsole', label: 'Konsole', launcher: 'linux-konsole', commands: ['konsole'] },
    { id: 'xterm', label: 'XTerm', launcher: 'linux-xterm', commands: ['xterm'] },
    { id: 'kitty', label: 'Kitty', launcher: 'linux-kitty', commands: ['kitty'] },
    { id: 'alacritty', label: 'Alacritty', launcher: 'linux-alacritty', commands: ['alacritty'] },
  ];
}

async function terminalOptionAvailable(option) {
  if (option.alwaysAvailable) return true;
  if (Array.isArray(option.bundlePaths)) return Boolean((await Promise.all(option.bundlePaths.map(pathExists))).find(Boolean));
  if (option.packageExecutable) return Boolean(await firstAvailableTerminalCommand(option));
  return Boolean((await Promise.all((option.commands || []).map(commandLocation))).find(Boolean));
}

async function terminalOptionsWithAvailability() {
  return Promise.all(supportedTerminalOptions().map(async (option) => ({
    id: option.id,
    label: option.label,
    available: await terminalOptionAvailable(option),
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
  const fallback = options.find((option) => option.id === 'default' && option.available) || options.find((option) => option.available) || { id: 'default', label: 'a supported terminal' };
  return {
    ok: true,
    selectedId: available ? storedId : fallback.id,
    storedId,
    options,
    message: available ? `Claude Code will open in ${selected?.label || 'Default Terminal'}.` : `${selected?.label || 'Your selected terminal'} is not installed, so CCTI will use ${fallback.label} until it is available again.`,
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
  const bunBin = process.platform === 'win32' ? '' : path.join(home, '.bun', 'bin');
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
  const inheritedPath = process.env.PATH || process.env.Path || '';
  const resolvedPath = [...new Set([nativeBin, bunBin, managedNodeBin, ...commonPaths, inheritedPath].filter(Boolean).join(path.delimiter).split(path.delimiter).filter(Boolean))].join(path.delimiter);
  return {
    ...process.env,
    PATH: resolvedPath,
    ...(process.platform === 'win32' ? { Path: resolvedPath } : {}),
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
    const usesWindowsCommandShell = process.platform === 'win32' && /\.cmd$/i.test(String(command));
    const child = spawn(command, args, { windowsHide: true, ...options, ...(usesWindowsCommandShell ? { shell: true } : {}) });
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

function isNewerVersion(candidate, current) {
  const comparison = comparePackageVersions(candidate, current);
  return comparison !== null && comparison > 0;
}

function compareVersions(left, right) {
  return comparePackageVersions(left, right) ?? 0;
}

function isVerifiedDesktopArtifact(asset, platform = process.platform) {
  const name = String(asset?.name || '').toLowerCase();
  const hasReleaseDigest = /^sha256:[a-f0-9]{64}$/i.test(String(asset?.digest || ''));
  const isUploaded = asset?.state === 'uploaded';
  const hasPositiveSize = Number.isFinite(Number(asset?.size)) && Number(asset.size) > 0;
  const isDesktopArchive = platform === 'win32'
    ? /-win-x64\.exe$/.test(name)
    : platform === 'darwin'
      ? /(?:^ccti-macos\.(?:dmg|zip)$)|(?:-mac-(?:arm64|x64)\.(?:dmg|zip)$)/.test(name)
      : /-linux-x64\.tar\.gz$/.test(name);
  return isUploaded && hasPositiveSize && hasReleaseDigest && isDesktopArchive;
}

function isPublicReleaseRecord(release) {
  const releaseIdentity = parseReleaseIdentity(String(release?.tag_name || ''));
  const releaseUrl = String(release?.html_url || '');
  return Boolean(releaseIdentity) && releaseUrl.startsWith(releaseUrlPrefix) && !release?.draft && !release?.prerelease;
}

function newestVerifiedRelease(releases, platform = process.platform) {
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter(isPublicReleaseRecord)
    .filter((release) => Array.isArray(release.assets) && release.assets.some((asset) => isVerifiedDesktopArtifact(asset, platform)));
  return candidates.sort((left, right) => {
    const leftIdentity = parseReleaseIdentity(String(left.tag_name || ''));
    const rightIdentity = parseReleaseIdentity(String(right.tag_name || ''));
    return compareVersions(rightIdentity?.packageVersion, leftIdentity?.packageVersion);
  })[0] || null;
}

function currentReleasePlatform() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

function isTrustedReleaseDownload(value) {
  return String(value || '').startsWith(`${releaseUrlPrefix}download/`);
}

function normalizeReleaseServiceResponse(payload, platform) {
  const version = String(payload?.version || '').trim();
  const releaseUrl = String(payload?.releaseUrl || '').trim();
  const releaseIdentity = parseReleaseIdentity(version);
  if (
    payload?.platform !== platform
    || payload?.available !== true
    || !releaseIdentity
    || (payload?.packageVersion !== undefined && String(payload.packageVersion) !== releaseIdentity.packageVersion)
    || !releaseUrl.startsWith(releaseUrlPrefix)
  ) return null;

  const assets = (Array.isArray(payload?.assets) ? payload.assets : []).flatMap((asset) => {
    const name = String(asset?.name || '');
    const size = Number(asset?.size);
    const downloadUrl = String(asset?.downloadUrl || '');
    const digest = String(asset?.sha256 || '').toLowerCase();
    if (!name || !Number.isFinite(size) || size <= 0 || !isTrustedReleaseDownload(downloadUrl) || !/^[a-f0-9]{64}$/.test(digest)) return [];
    return [{ name, size, state: 'uploaded', digest: `sha256:${digest}`, browser_download_url: downloadUrl }];
  });
  if (!assets.some((asset) => isVerifiedDesktopArtifact(asset, platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux'))) return null;

  return {
    tag_name: releaseIdentity.tag,
    html_url: releaseUrl,
    draft: false,
    prerelease: false,
    assets,
  };
}

function releaseCheckError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isReleaseTimeout(error) {
  return error?.name === 'AbortError';
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: controller?.signal });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function getLatestVerifiedGitHubRelease() {
  const response = await fetchWithTimeout(releaseApiEndpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Claude-Code-Tools-Installer',
    },
    cache: 'no-store',
  }, githubReleaseTimeoutMs);
  if (!response.ok) throw releaseCheckError('github-release-response-unavailable');
  const release = newestVerifiedRelease(await response.json());
  if (!release) throw releaseCheckError('github-release-data-unavailable');
  return release;
}

async function getLatestVerifiedReleaseFromService() {
  const platform = currentReleasePlatform();
  const response = await fetchWithTimeout(`${releaseServiceEndpoint}?platform=${platform}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Claude-Code-Tools-Installer',
    },
    cache: 'no-store',
  }, releaseServiceTimeoutMs);
  if (!response.ok) throw releaseCheckError('release-service-response-unavailable');
  const release = normalizeReleaseServiceResponse(await response.json(), platform);
  if (!release) throw releaseCheckError('release-service-data-unavailable');
  return release;
}

async function getLatestVerifiedReleaseWithFallback() {
  try {
    return { release: await getLatestVerifiedGitHubRelease(), source: 'github' };
  } catch (error) {
    if (!isReleaseTimeout(error)) throw error;
    try {
      return { release: await getLatestVerifiedReleaseFromService(), source: 'release-service' };
    } catch {
      throw releaseCheckError('github-timeout-and-release-service-unavailable');
    }
  }
}

function updateCheckUnavailableMessage(error) {
  if (error?.code === 'github-timeout-and-release-service-unavailable') {
    return 'Update check could not finish because GitHub did not respond within 12 seconds and the CCTI backup release service was also unavailable. Check your internet connection, then try again. No GitHub sign-in is required.';
  }
  if (isReleaseTimeout(error)) {
    return 'Update check could not finish because GitHub did not respond within 12 seconds. Check your internet connection, then try again. No GitHub sign-in is required.';
  }
  return 'Update check could not reach the public release service. Check your internet connection, then try again. No GitHub sign-in is required.';
}

function publishUpdateStatus() {
  emit('updates:status', { ...updateStatus });
}

function nativeUpdaterSupported() {
  return (process.platform === 'darwin' || process.platform === 'win32') && app.isPackaged;
}

function getNativeUpdater() {
  if (!nativeUpdater) ({ autoUpdater: nativeUpdater } = require('electron-updater'));
  return nativeUpdater;
}

function updateReleaseUrlFor(version) {
  const releaseIdentity = parseReleaseIdentity(String(version || ''));
  return releaseIdentity ? `${releaseUrlPrefix}tag/${releaseIdentity.tag}` : '';
}

function incompleteUpdateMessage(version) {
  return `CCTI ${version || 'update'} is available, but its signed in-app update did not complete or verify. Your current CCTI app was not changed. Select Check for Updates to retry, or use View Release to update safely.`;
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
        canDownload: false,
        canInstall: false,
        message: 'Update check is unavailable because this app runtime cannot reach public update services. No GitHub sign-in is required.',
      };
      publishUpdateStatus();
      return { ...updateStatus };
    }

    try {
      const { release, source } = await getLatestVerifiedReleaseWithFallback();
      const releaseIdentity = parseReleaseIdentity(String(release?.tag_name || ''));
      const latestVersion = releaseIdentity?.tag.replace(/^v/i, '') || '';
      const latestPackageVersion = releaseIdentity?.packageVersion || '';
      const releaseUrl = String(release?.html_url || '');
      if (!releaseIdentity || !latestPackageVersion || !releaseUrl.startsWith(releaseUrlPrefix)) throw new Error('GitHub returned an incomplete release record.');

      const available = isNewerVersion(latestPackageVersion, currentVersion);
      const releaseSourceNotice = source === 'release-service'
        ? ' GitHub took longer than 12 seconds to respond, so CCTI verified this result through its backup release service. No GitHub sign-in is required.'
        : '';
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
        latestPackageVersion,
        latestPublicTag: releaseIdentity.tag,
        releaseUrl,
        checkedAt: new Date().toISOString(),
        artifactDigestSummary,
        digestAlert,
        canDownload,
        canInstall: false,
        message: available
          ? canDownload
            ? `CCTI ${latestVersion} is available. Select Check for Updates to download the signed update now.${releaseSourceNotice}`
            : `CCTI ${latestVersion} is available. This build does not support in-app updates; use View Release to update.${releaseSourceNotice}`
          : compareVersions(latestPackageVersion, currentVersion) === 0
            ? `CCTI ${latestVersion} is the newest published release.${releaseSourceNotice}`
            : `CCTI ${currentVersion} is ahead of the newest verified public release (${latestVersion}). No download action is needed.${releaseSourceNotice}`,
      };
      publishUpdateStatus();
      return { ...updateStatus };
    } catch (error) {
      updateStatus = {
        ...updateStatus,
        state: 'unavailable',
        currentVersion,
        checkedAt: new Date().toISOString(),
        canDownload: false,
        canInstall: false,
        message: updateCheckUnavailableMessage(error),
      };
      publishUpdateStatus();
      return { ...updateStatus };
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
    const latestPackageVersion = String(info?.version || '');
    if (!parsePackageVersion(latestPackageVersion) || (updateStatus.latestPackageVersion && latestPackageVersion !== updateStatus.latestPackageVersion)) {
      updateStatus = {
        ...updateStatus,
        state: 'available',
        message: 'CCTI rejected an update because its native updater version did not match the verified public release. Your current app was not changed.',
        canDownload: nativeUpdaterSupported(),
        canInstall: false,
      };
      publishUpdateStatus();
      return;
    }
    updateStatus = {
      ...updateStatus,
      state: 'downloading',
      latestPackageVersion,
      releaseUrl: updateStatus.releaseUrl || updateReleaseUrlFor(updateStatus.latestPublicTag),
      message: `Downloading the signed CCTI ${updateStatus.latestVersion || latestPackageVersion} update…`,
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
    const latestPackageVersion = String(info?.version || '');
    if (!parsePackageVersion(latestPackageVersion) || latestPackageVersion !== updateStatus.latestPackageVersion) {
      updateStatus = {
        ...updateStatus,
        state: 'available',
        message: 'CCTI rejected a downloaded update because its native updater version did not match the verified public release. Your current app was not changed.',
        canDownload: nativeUpdaterSupported(),
        canInstall: false,
      };
      publishUpdateStatus();
      return;
    }
    updateStatus = {
      ...updateStatus,
      state: 'downloaded',
      latestPackageVersion,
      releaseUrl: updateStatus.releaseUrl || updateReleaseUrlFor(updateStatus.latestPublicTag),
      checkedAt: new Date().toISOString(),
      message: `CCTI ${updateStatus.latestVersion || latestPackageVersion} is downloaded and verified. Restart CCTI to apply it now.`,
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
      message: incompleteUpdateMessage(updateStatus.latestVersion),
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
      if (!result?.updateInfo || result.updateInfo.version !== status.latestPackageVersion || !isNewerVersion(result.updateInfo.version, currentAppVersion())) {
        if (result?.updateInfo && result.updateInfo.version !== status.latestPackageVersion) {
          updateStatus = {
            ...status,
            state: 'available',
            message: 'CCTI rejected an update because its native updater version did not match the verified public release. Your current app was not changed.',
            canDownload: nativeUpdaterSupported(),
            canInstall: false,
          };
          publishUpdateStatus();
        }
        return { ...updateStatus };
      }
      await getNativeUpdater().downloadUpdate();
      return { ...updateStatus };
    } catch {
      updateStatus = {
        ...updateStatus,
        state: 'available',
        message: incompleteUpdateMessage(status.latestVersion),
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

function outputEntryId(line) {
  return String(line || "").trim().replace(/^[❯•*+-]\s+/, "").split(/[\s:]/)[0];
}

function pluginIdsFromList(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map(outputEntryId)
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
    const result = await runProcess(claude.path || 'claude', ['plugin', 'list'], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 8000 });
    return result.code === 0 ? pluginIdsFromList(result.stdout) : [];
  } catch {
    return [];
  }
}

async function setupCommandReady(command, args = ['--version']) {
  try {
    const result = await runProcess(command, args, { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 6000 });
    const version = String(result.stdout || result.stderr || '').trim().replace(/\s+/g, ' ');
    return { ready: result.code === 0 && version.length > 0, version };
  } catch {
    return { ready: false, version: '' };
  }
}

async function configuredMcpReady(name, claude = null) {
  const names = ['repomix', 'playwright'];
  if (!names.includes(name)) return false;
  const resolvedClaude = claude || await claudeStatus();
  if (!resolvedClaude.installed) return false;
  try {
    const result = await runProcess(resolvedClaude.path || 'claude', ['mcp', 'get', name], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 6000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function configuredMarketplaceText() {
  const claude = await claudeStatus();
  if (!claude.installed) return '';
  try {
    const result = await runProcess(claude.path || 'claude', ['plugin', 'marketplace', 'list'], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 6000 });
    return result.code === 0 ? String(result.stdout || '').toLowerCase() : '';
  } catch {
    return '';
  }
}

async function verifySetupStatus({ skillScope = 'global', projectPath = '' } = {}) {
  const home = app.getPath('home');
  const selectedSkillScope = skillScope === 'project' ? 'project' : 'global';
  const selectedProjectPath = selectedSkillScope === 'project'
    ? await validateSetupProjectFolder(projectPath)
    : '';
  const selectedSkillRoot = selectedSkillScope === 'project'
    ? path.join(selectedProjectPath, '.claude', 'skills')
    : path.join(home, '.claude', 'skills');
  const selectedSkillLocation = selectedSkillScope === 'project'
    ? 'the selected project'
    : 'your Claude Code setup';
  const claude = await claudeStatus();
  const [bun, repomix, repomixMcpReady, playwrightMcpReady, marketplaceText, pluginIds] = await Promise.all([
    setupCommandReady('bun'),
    setupCommandReady('repomix'),
    configuredMcpReady('repomix', claude),
    configuredMcpReady('playwright', claude),
    configuredMarketplaceText(),
    installedClaudePluginIds(),
  ]);
  const checks = [];
  const add = (id, label, ready, message, state = ready ? 'ready' : 'attention') => checks.push({ id, label, state, message });

  add('claude-code', 'Claude Code', claude.installed,
    claude.installed ? `Ready${claude.version ? ` · ${claude.version}` : ''}` : 'Not ready. Select Complete setup to retry the official Claude Code installer.');
  add('bun', 'Bun', bun.ready,
    bun.ready ? `Ready${bun.version ? ` · ${bun.version}` : ''}` : 'Not ready. Select Complete setup to prepare Bun for gstack.');

  const gstackRoot = path.join(home, '.claude', 'skills', 'gstack');
  if (process.platform === 'win32') {
    add('gstack', 'gstack', false, 'gstack’s upstream setup is not available on Windows yet. CCTI did not treat it as installed.', 'unavailable');
  } else {
    const [setupPresent, versionPresent, browserPresent, healthPresent] = await Promise.all([
      pathExists(path.join(gstackRoot, 'setup')),
      pathExists(path.join(gstackRoot, 'VERSION')),
      pathExists(path.join(gstackRoot, 'browse', 'dist', 'browse')),
      pathExists(path.join(home, '.claude', 'skills', 'health', 'SKILL.md')),
    ]);
    const ready = setupPresent && versionPresent && browserPresent && healthPresent;
    add('gstack', 'gstack', ready,
      ready
        ? 'Ready. gstack skills and its browser helper are installed. The optional CSO container feature is not required.'
        : 'Needs attention. Select Complete setup to finish gstack. The optional CSO container notice is not an installation failure.');
  }

  const [tasteSkill, planningSkill] = await Promise.all([
    pathExists(path.join(selectedSkillRoot, 'design-taste-frontend', 'SKILL.md')),
    pathExists(path.join(selectedSkillRoot, 'planning-with-files', 'SKILL.md')),
  ]);
  add('taste-skill', 'taste-skill', tasteSkill,
    tasteSkill ? `Ready. The design-taste skill is available in ${selectedSkillLocation}.` : `Not found in ${selectedSkillLocation}. Select Complete setup to install it there.`);
  add('planning-with-files', 'Planning with Files', planningSkill,
    planningSkill ? `Ready. The planning skill is available in ${selectedSkillLocation}.` : `Not found in ${selectedSkillLocation}. Select Complete setup to install it there.`);
  add('repomix', 'Repomix', repomix.ready && repomixMcpReady,
    repomix.ready && repomixMcpReady
      ? 'Ready. The Repomix command and Claude Code connection are available.'
      : 'Needs attention. Repomix needs both its command and its Claude Code connection. Select Complete setup to repair them.');
  add('playwright-mcp', 'Playwright connection', playwrightMcpReady,
    playwrightMcpReady ? 'Ready. Claude Code can use the Playwright connection.' : 'Not found. Select Complete setup to add it.');
  add('superpowers', 'Superpowers plugin', pluginIsInstalled(pluginIds, 'superpowers@superpowers-marketplace'),
    pluginIsInstalled(pluginIds, 'superpowers@superpowers-marketplace') ? 'Ready. The Superpowers plugin is enabled for your Claude Code setup.' : 'Not found. Select Complete setup to add it inside CCTI.');
  const anthropicSkillsMarketplace = marketplaceText.includes('anthropics/skills');
  add('anthropic-skills', 'Anthropic Skills marketplace', anthropicSkillsMarketplace,
    anthropicSkillsMarketplace
      ? 'Ready. Choose individual Anthropic skills later only when you need them.'
      : 'Not found. Select Complete setup to add the Anthropic Skills marketplace inside CCTI.');
  const productivitySynced = pluginIds.includes('productivity@synced');
  add('productivity', 'Productivity plugin', productivitySynced,
    productivitySynced
      ? 'Ready. Productivity is synced from your Claude.ai account. Run /productivity:start to begin, then /productivity:update to refresh project tasks.'
      : 'Optional. Enable Productivity in your Claude.ai account, then start Claude Code and run /reload-plugins if prompted. CCTI cannot install Claude.ai-synced plugins.',
    productivitySynced ? 'ready' : 'optional');
  add('claude-hud', 'Claude HUD plugin', pluginIsInstalled(pluginIds, 'claude-hud'),
    pluginIsInstalled(pluginIds, 'claude-hud') ? 'Ready. Claude HUD is enabled for your Claude Code setup.' : 'Not found. Select Complete setup to add it inside CCTI.');

  const attention = checks.filter((check) => check.state === 'attention');
  const unavailable = checks.filter((check) => check.state === 'unavailable');
  return {
    ok: true,
    ready: attention.length === 0,
    checks,
    summary: attention.length === 0
      ? `CCTI verified ${checks.filter((check) => check.state === 'ready').length} setup items. Everything CCTI can install on this computer is ready.${unavailable.length ? ` ${unavailable.length} optional item is unavailable on this platform.` : ''}`
      : `CCTI verified ${checks.length - attention.length} of ${checks.length} setup items. ${attention.length} item${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} attention. Select Complete setup to retry; no terminal commands are required.`,
  };
}

async function installReviewedPlugins(selectedIds) {
  const claude = await claudeStatus();
  if (!claude.installed) throw new Error('Claude Code must be ready before CCTI can change a reviewed add-on.');
  const claudeCommand = claude.path || 'claude';
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
      const result = await runProcess(claudeCommand, args, { cwd: app.getPath('home'), env: claudeProcessEnv() });
      if (result.stdout) emit('installer:output', { stream: 'stdout', text: result.stdout });
      if (result.stderr) emit('installer:output', { stream: result.code === 0 ? 'stdout' : 'stderr', text: result.stderr });
      if (result.code !== 0 && args[1] !== 'marketplace') throw new Error(`CCTI could not install ${id}. Claude Code returned exit code ${result.code}.`);
      if (result.code !== 0) emit('installer:output', { stream: 'stdout', text: '[CCTI] Marketplace was already available or could not refresh. Continuing with the named plugin install.\n' });
    }
  }
}

// Tri-state: an id is "present" when observed installed, "unknown" when the probe for it
// could not answer (Claude Code's own check timed out, was blocked, or failed to run; the
// plugin list call failed/timed out; or a specific `mcp get` call threw/timed out), and
// otherwise absent. A tracked item is
// never claimed as a fresh CCTI install off the back of an "unknown" read: recordCctiInstalls
// folds present+unknown into the "before" set, so a degraded before-probe can never make an
// already-present tool look newly installed. Skills are never unknown: pathExists is a plain
// filesystem check with no partial-failure mode worth distinguishing.
async function presentTrackedItems(ids, { skillScope = 'global', projectPath = '' } = {}) {
  const tracked = [...new Set(ids)].map((id) => [id, trackedItem(id)]).filter(([, item]) => item);
  const present = new Set();
  const unknown = new Set();
  if (tracked.length === 0) return { present, unknown };
  const skillRoot = skillScope === 'project' && projectPath
    ? path.join(projectPath, '.claude', 'skills')
    : path.join(app.getPath('home'), '.claude', 'skills');
  const claude = await claudeStatus();
  const claudeCommand = claude.path || 'claude';
  const pluginTracked = tracked.filter(([, item]) => item.kind === 'plugin');
  const mcpTracked = tracked.filter(([, item]) => item.kind === 'mcp');
  // claudeStatus leaves fallbackReason empty only when no Claude Code binary exists at all.
  // A binary that timed out, was blocked, or failed to run means detection failed, not that
  // nothing is installed, so every plugin and MCP id is unknown rather than absent.
  const claudeUndetermined = !claude.installed && Boolean(claude.timedOut || claude.fallbackReason);

  let pluginIds = [];
  let pluginsUnknown = false;
  if (pluginTracked.length > 0 && claudeUndetermined) pluginsUnknown = true;
  if (pluginTracked.length > 0 && claude.installed) {
    try {
      const result = await runProcess(claudeCommand, ['plugin', 'list'], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 8000 });
      if (result.timedOut || result.code !== 0) pluginsUnknown = true;
      else pluginIds = pluginIdsFromList(result.stdout);
    } catch {
      pluginsUnknown = true;
    }
  }

  const mcpState = new Map(await Promise.all(mcpTracked.map(async ([id, item]) => {
    if (!claude.installed) return [id, claudeUndetermined ? 'unknown' : 'absent'];
    try {
      const result = await runProcess(claudeCommand, ['mcp', 'get', item.key], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 6000 });
      if (result.timedOut) return [id, 'unknown'];
      return [id, result.code === 0 ? 'present' : 'absent'];
    } catch {
      return [id, 'unknown'];
    }
  })));

  for (const [id, item] of tracked) {
    if (item.kind === 'skill') {
      if (await pathExists(path.join(skillRoot, item.key, 'SKILL.md'))) present.add(id);
      continue;
    }
    if (item.kind === 'plugin') {
      if (pluginsUnknown) unknown.add(id);
      else if (pluginIsInstalled(pluginIds, item.key)) present.add(id);
      continue;
    }
    if (item.kind === 'mcp') {
      const state = mcpState.get(id);
      if (state === 'unknown') unknown.add(id);
      else if (state === 'present') present.add(id);
    }
  }
  return { present, unknown };
}

async function recordCctiInstalls(ids, before, scope = {}) {
  try {
    const after = await presentTrackedItems(ids, scope);
    const beforeSet = new Set([...before.present, ...before.unknown]);
    const entries = newlyInstalledEntries(ids, beforeSet, after.present, { tracked: TRACKED_ITEMS, catalog: await readCatalog(), skillScope: scope.skillScope, projectPath: scope.projectPath });
    if (entries.length > 0) await inventoryLedger().recordInstalls(entries);
  } catch (error) {
    const message = String(error.message || '').replace(/\.$/, '');
    emit('installer:output', { stream: 'stderr', text: `[CCTI] Your tools were installed, but CCTI could not update its record of them: ${message}. Check this computer again to see them.\n` });
  }
}

async function recordSkillResolutions(moves, projectPath = '') {
  if (!Array.isArray(moves) || moves.length === 0) return;
  try {
    await inventoryLedger().recordResolutions(skillBackupResolutions(moves, { projectPath }));
  } catch {
    // The record is advisory. The backup move already succeeded and is shown to the user.
  }
}

async function recordExtrasRemovals(actions) {
  try {
    const resolutions = extrasRemovalResolutions(actions, { tracked: TRACKED_ITEMS });
    if (resolutions.length > 0) await inventoryLedger().recordResolutions(resolutions);
  } catch {
    // The record is advisory. The removal itself already happened and is reported to the user.
  }
}

async function inventoryFromScan({ findings, pluginList, mcpList, projectPath, duplicateGroups = [] }) {
  try {
    const scan = { ...buildScan({ findings, pluginList, mcpList, projectPath }), duplicateGroups };
    const [history, catalog] = await Promise.all([inventoryLedger().read(), readCatalog()]);
    return reconcileInventory({ scan, ledger: history.ledger, ledgerStatus: history.status, catalog, tracked: TRACKED_ITEMS });
  } catch {
    return null;
  }
}

async function resetInventoryHistory() {
  try {
    const result = await inventoryLedger().reset();
    return { ok: true, preserved: Boolean(result.preservedAs) };
  } catch (error) {
    if (error.code === 'LEDGER_UNAVAILABLE') return { ok: false, error: 'CCTI could not open its record right now. Nothing was changed. Close anything that might be using it, then try again.' };
    return { ok: false, error: 'CCTI could not start a fresh record. Nothing else changed. Restart CCTI and try again.' };
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

function claudeCandidatePaths(home) {
  return process.platform === 'win32'
    ? [path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), path.join(home, '.local', 'bin', 'claude.exe')]
    : [path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.npm-global', 'bin', 'claude')];
}

function uniqueCommandPaths(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    const normalized = String(candidate || '').trim();
    if (!normalized) return false;
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function verifyClaudeCandidate(candidate, home) {
  if (!candidate || !await pathExists(candidate)) return { ok: false, path: candidate, reason: 'missing' };
  try {
    const result = await runProcess(candidate, ['--version'], { cwd: home, env: claudeProcessEnv(), timeout: 4000 });
    const version = (result.stdout || result.stderr || '').trim();
    if (result.code === 0 && version) return { ok: true, path: candidate, version };
    return { ok: false, path: candidate, reason: result.timedOut ? 'timed-out' : 'not-runnable' };
  } catch (error) {
    const code = String(error?.code || '').toUpperCase();
    return {
      ok: false,
      path: candidate,
      reason: code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'spawn-failed',
    };
  }
}

async function claudeStatus() {
  const home = app.getPath('home');
  const resolvedPath = await commandLocation('claude');
  const attempts = [];
  const candidates = uniqueCommandPaths([resolvedPath, ...claudeCandidatePaths(home)]);
  for (const candidate of candidates) {
    const verification = await verifyClaudeCandidate(candidate, home);
    if (verification.ok) {
      return {
        installed: true,
        version: verification.version,
        path: verification.path,
        timedOut: false,
        fallbackUsed: attempts.length > 0,
        fallbackReason: attempts[0]?.reason || '',
        reason: '',
      };
    }
    if (verification.reason !== 'missing') attempts.push(verification);
  }
  const timedOut = attempts.some((attempt) => attempt.reason === 'timed-out');
  const permissionDenied = attempts.some((attempt) => attempt.reason === 'permission-denied');
  return {
    installed: false,
    version: '',
    path: resolvedPath || '',
    timedOut,
    fallbackUsed: false,
    fallbackReason: permissionDenied ? 'permission-denied' : attempts[0]?.reason || '',
    reason: permissionDenied
      ? 'Claude Code was found, but the operating system blocked execution. Run Diagnostics before changing permissions.'
      : timedOut
        ? 'Claude Code check took longer than expected.'
        : 'Claude Code could not be run.',
  };
}

function displayLocalPath(value) {
  const home = app.getPath('home');
  return String(value || '').split(home).join('~');
}

function runtimePathSnapshot() {
  const commandEnv = claudeProcessEnv();
  const home = app.getPath('home');
  const mainProcessPath = process.env.PATH || process.env.Path || '';
  const cctiCommandPath = commandEnv.PATH || commandEnv.Path || '';
  const commandEntries = cctiCommandPath.split(path.delimiter).filter(Boolean);
  const includesPath = (candidate) => commandEntries.some((entry) => (
    process.platform === 'win32'
      ? entry.toLowerCase() === candidate.toLowerCase()
      : entry === candidate
  ));
  const nativeClaudeBin = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'npm') : path.join(home, '.local', 'bin');
  const managedNodeBin = process.platform === 'win32'
    ? path.join(setupManagerDir(), 'node-runtime')
    : path.join(setupManagerDir(), 'node-runtime', 'bin');
  return {
    ok: true,
    mainProcessPath,
    cctiCommandPath,
    mainProcessPathEntryCount: mainProcessPath.split(path.delimiter).filter(Boolean).length,
    cctiCommandPathEntryCount: commandEntries.length,
    cctiIncludesNativeClaudeBin: includesPath(nativeClaudeBin),
    cctiIncludesManagedNodeBin: includesPath(managedNodeBin),
    electronExecPath: process.execPath || '',
    electronVersion: process.versions.electron || '',
    embeddedNodeVersion: process.versions.node || '',
  };
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
  const candidatePaths = claudeCandidatePaths(home);
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
  return {
    ok: true,
    diagnosticId,
    report: safeReport,
    claudeReady: claude.installed,
    claudeFallback: Boolean(claude.fallbackUsed),
    claudeFallbackReason: claude.fallbackReason || '',
  };
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

async function firstAvailableTerminalCommand(option) {
  for (const command of option.commands || []) {
    const resolved = await commandLocation(command);
    if (resolved) return resolved;
  }
  return '';
}

async function firstAvailableTerminalBundle(option) {
  for (const bundlePath of option.bundlePaths || []) {
    if (await pathExists(bundlePath)) return bundlePath;
  }
  return '';
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function openSelectedTerminal({ folder, command, preference }) {
  const terminal = supportedTerminalOption(preference.selectedId) || supportedTerminalOption('default');
  if (!terminal) throw new Error('CCTI could not identify a supported terminal.');
  const env = claudeProcessEnv();
  if (process.platform === 'darwin') {
    if (terminal.launcher === 'mac-terminal' || terminal.launcher === 'mac-iterm2') {
      const script = terminal.launcher === 'mac-iterm2'
        ? ['tell application id "com.googlecode.iterm2"', 'activate', 'create window with default profile', 'tell current session of current window', `write text ${JSON.stringify(command)}`, 'end tell', 'end tell'].join('\n')
        : `tell application id "com.apple.Terminal" to do script ${JSON.stringify(command)}`;
      const result = await runProcess('osascript', ['-e', script], { cwd: folder, env });
      if (result.code !== 0) throw new Error(result.stderr.trim() || `${terminal.label} did not open.`);
      return terminal;
    }
    const bundlePath = await firstAvailableTerminalBundle(terminal);
    if (!bundlePath) throw new Error(`${terminal.label} is no longer installed.`);
    const executable = path.join(bundlePath, 'Contents', 'MacOS', terminal.executable);
    if (terminal.id === 'ghostty') await startDetached(executable, ['-e', 'bash', '-lc', command], { cwd: folder, env });
    else if (terminal.id === 'wezterm') await startDetached(executable, ['start', '--cwd', folder, '--', 'bash', '-lc', command], { cwd: folder, env });
    else if (terminal.id === 'alacritty') await startDetached(executable, ['--working-directory', folder, '-e', 'bash', '-lc', command], { cwd: folder, env });
    else if (terminal.id === 'kitty') await startDetached(executable, ['--directory', folder, 'bash', '-lc', command], { cwd: folder, env });
    else throw new Error(`${terminal.label} does not have a verified launch adapter.`);
    return terminal;
  }
  const terminalCommand = await firstAvailableTerminalCommand(terminal);
  if (!terminalCommand) throw new Error(`${terminal.label} is no longer available.`);
  if (process.platform === 'win32') {
    const launchScript = `Set-Location -LiteralPath ${quotePowerShell(folder)}; ${command}`;
    if (terminal.launcher === 'windows-terminal') {
      await startDetached(terminalCommand, ['-d', folder, 'powershell.exe', '-NoLogo', '-NoProfile', '-NoExit', '-Command', launchScript], { cwd: folder, env });
    } else {
      await startDetached(terminalCommand, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', launchScript], { cwd: folder, env });
    }
    return terminal;
  }
  if (terminal.launcher === 'linux-gnome') await startDetached(terminalCommand, ['--', 'bash', '-lc', command], { cwd: folder, env });
  else if (terminal.launcher === 'linux-kitty') await startDetached(terminalCommand, ['--directory', folder, 'bash', '-lc', command], { cwd: folder, env });
  else if (terminal.launcher === 'linux-alacritty') await startDetached(terminalCommand, ['--working-directory', folder, '-e', 'bash', '-lc', command], { cwd: folder, env });
  else await startDetached(terminalCommand, ['-e', 'bash', '-lc', command], { cwd: folder, env });
  return terminal;
}

async function selectedTerminalForLaunch() {
  const preference = await getTerminalPreference();
  const terminal = supportedTerminalOption(preference.selectedId) || supportedTerminalOption('default');
  if (!terminal) throw new Error('CCTI could not identify a supported terminal.');
  return { preference, terminal };
}

async function launchClaudeCode({ projectPath } = {}) {
  const status = await claudeStatus();
  if (!status.installed || !status.path) return { ok: false, error: 'Claude Code is not ready yet. Install it first, then choose Run Claude Code.' };
  let folder = app.getPath('home');
  if (projectPath) {
    try { folder = await resolveProjectFolder(projectPath); } catch (error) { return { ok: false, error: error.message }; }
  }
  try {
    const { preference } = await selectedTerminalForLaunch();
    const command = process.platform === 'win32'
      ? (/\.cmd$/i.test(status.path)
        ? `& $env:ComSpec '/d' '/s' '/c' ${quotePowerShell(`"${status.path}"`)}`
        : `& ${quotePowerShell(status.path)}`)
      : `cd ${quotePosix(folder)}; exec ${quotePosix(status.path)}`;
    const terminal = await openSelectedTerminal({ folder, command, preference });
    const fallbackNote = preference.selectedId === preference.storedId ? '' : ` Your saved ${supportedTerminalOption(preference.storedId)?.label || 'terminal'} preference is unavailable, so CCTI used ${terminal.label}.`;
    return { ok: true, message: `Claude Code opened in ${terminal.label} for the selected folder.${fallbackNote}` };
  } catch (error) {
    return { ok: false, error: `CCTI could not open Claude Code: ${error.message}` };
  }
}

async function testSelectedTerminal() {
  const folder = app.getPath('home');
  try {
    const { preference } = await selectedTerminalForLaunch();
    const command = process.platform === 'win32'
      ? 'Write-Host "CCTI terminal launch test passed"'
      : 'printf "CCTI terminal launch test passed\\n"; exec "${SHELL:-/bin/zsh}" -l';
    const terminal = await openSelectedTerminal({ folder, command, preference });
    const fallbackNote = preference.selectedId === preference.storedId ? '' : ` ${supportedTerminalOption(preference.storedId)?.label || 'Your saved terminal'} is unavailable, so CCTI used ${terminal.label}.`;
    return { ok: true, message: `Opened ${terminal.label} with the CCTI terminal launch test.${fallbackNote}` };
  } catch (error) {
    return { ok: false, error: `CCTI could not run the terminal test: ${error.message}` };
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

function spawnInstaller(mode, selectedIds = [], dryRun = false, { skillScope = 'global', projectPath = '' } = {}) {
  const definition = installerDefinition();
  const args = [...definition.args, definition.script];
  const option = (windows, posix) => process.platform === 'win32' ? windows : posix;
  const isCompleteSetup = mode === 'complete' || mode === 'fresh-complete';
  const timeoutMs = isCompleteSetup ? 10 * 60 * 1000 : 0;

  if (mode === 'bootstrap') {
    args.push(option('-NoLaunch', '--no-launch'), option('-BootstrapOnly', '--bootstrap-only'));
  } else if (mode === 'project-prerequisites') {
    args.push(option('-NoLaunch', '--no-launch'), option('-ProjectPrerequisites', '--project-prerequisites'));
  } else if (mode === 'claude-only') {
    args.push(option('-NoLaunch', '--no-launch'), option('-ClaudeOnly', '--claude-only'), option('-Yes', '--yes'));
  } else if (mode === 'complete' || mode === 'fresh-complete') {
    args.push(option('-NoLaunch', '--no-launch'), option('-Complete', '--complete'), option('-AppManagedPlugins', '--app-managed-plugins'));
    args.push(option('-SkillScope', '--skill-scope'), skillScope === 'project' ? 'project' : 'global');
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
    let settled = false;
    let timeout = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    const child = spawn(definition.command, args, {
      cwd: skillScope === 'project' && projectPath ? projectPath : app.getPath('home'),
      windowsHide: true,
      env: claudeProcessEnv(),
    });

    child.stdout.on('data', (chunk) => emit('installer:output', { stream: 'stdout', text: chunk.toString() }));
    child.stderr.on('data', (chunk) => emit('installer:output', { stream: 'stderr', text: chunk.toString() }));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(new Error(`Could not start ${definition.command}: ${error.message}`));
    });
    child.on('close', (code) => finish({ code, args }));
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        const error = `Complete setup timed out after ${Math.round(timeoutMs / 60000)} minutes. CCTI stopped waiting and did not remove any existing Claude Code configuration.`;
        emit('installer:output', { stream: 'stderr', text: `[CCTI] ${error}\n` });
        try { child.kill('SIGTERM'); } catch {}
        finish({ code: -1, args, timedOut: true, error });
      }, timeoutMs);
    }
  });
}

async function validateSetupProjectFolder(projectPath) {
  return resolveProjectFolder(projectPath);
}

async function resolveCompleteSetupScope({ skillScope, projectPath } = {}) {
  if (skillScope === 'project') {
    const resolvedProjectPath = await validateSetupProjectFolder(projectPath);
    return { skillScope: 'project', projectPath: resolvedProjectPath };
  }
  return { skillScope: 'global', projectPath: '' };
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
    ...dependencies.slice(0, 80).map(([name, version]) => ({ id: `project-package:${packageJsonPath}:${name}`, type: 'project-package', name, version: String(version || ''), scope: 'This project', path: packageJsonPath, description: `Project package${version ? ` · ${version}` : ''}.` })),
  ];
}

function normalizedFindingName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function duplicateSkillSort(left, right) {
  return compareSkillKeeper(left, right);
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

function isLinkedSkillManifestError(error) {
  return String(error?.message || '') === 'A skill contains a symbolic link.';
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
  return duplicateSkillGroups([...(report?.skills?.values?.() || [])])
    .filter((group) => group.match === 'content-hash');
}

function uniqueDiscoveryFindings(findings) {
  const seen = new Set();
  return (Array.isArray(findings) ? findings : []).filter((finding) => {
    const key = [finding.type, finding.name, finding.scope, finding.path].map((value) => String(value || '')).join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
          if (isLinkedSkillManifestError(error)) {
            skills.push({
              id: `skill-link-excluded:${skillPath}`,
              type: 'skill-link-excluded',
              name: entry.name,
              scope,
              path: skillPath,
              description: 'This linked skill remains available to Claude Code. CCTI excludes skills containing symbolic links from duplicate cleanup, so it will not follow, compare, move, or delete linked files.',
            });
          } else {
            skills.push({ id: `skill:${skillPath}`, type: 'attention', name: entry.name, scope, path: skillPath, description: `This skill could not be verified for duplicate cleanup: ${error.message} It was not changed.` });
          }
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
  let managedExtras;
  try {
    managedExtras = await managedExtrasFromManifest();
  } catch (error) {
    managedExtras = { actions: [], manualItems: [], ignored: 0, error: error.message };
  }
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
  let pluginList = null;
  let mcpList = null;
  let duplicateGroups = [];
  if (claude.installed) {
    const claudeCommand = claude.path || 'claude';
    const [plugins, connections, groups] = await Promise.all([
      runProcess(claudeCommand, ['plugin', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
      runProcess(claudeCommand, ['mcp', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
      currentDuplicateGroups({ claude, homePath: home, projectPath: resolvedProjectPath }).catch(() => ({ groups: [] })),
    ]);
    duplicateGroups = groups.groups;
    pluginList = { ok: plugins.code === 0, text: plugins.stdout || '' };
    mcpList = { ok: connections.code === 0, text: connections.stdout || '' };
    if (plugins.code === 0) parsePluginList(plugins.stdout).forEach((item) => findings.push({ id: `plugin-cli:${item.key}`, type: 'plugin', name: item.name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
    if (connections.code === 0) parseMcpList(connections.stdout).forEach((item) => findings.push({ id: `connection-cli:${item.key}`, type: 'connection', name: item.name, scope: item.origin === 'plugin' ? item.scope : 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
  }

  const uniqueFindings = uniqueDiscoveryFindings(findings);
  const nonSkillGroups = new Map();
  uniqueFindings
    .filter((item) => ['plugin', 'connection'].includes(item.type))
    .filter((item) => !item.id.startsWith('plugin-cli:') && !item.id.startsWith('connection-cli:'))
    .forEach((item) => {
      const key = `${item.type}:${normalizedFindingName(item.name)}`;
      nonSkillGroups.set(key, [...(nonSkillGroups.get(key) || []), item]);
    });
  const skills = uniqueFindings.filter((item) => item.type === 'skill');
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
          ? 'These skill folders have the same name and identical verified file content. A reversible backup review is available if you no longer need both copies.'
          : 'These skill folders have different names but identical verified file content. A reversible backup review is available if you no longer need both copies.'
        : group.match === 'name'
          ? 'These skill folders have the same name in more than one Claude Code location, but their content was not verified as identical. This is informational only.'
          : 'These skill folders overlap by name or verified content. This is informational unless CCTI explicitly labels the content as identical.',
    };
  });
  const duplicates = [
    ...skillDuplicates,
    ...[...nonSkillGroups.values()].filter((items) => items.length > 1).map((items) => ({
      name: items[0].name,
      type: items[0].type,
      match: 'name',
      items,
      explanation: 'This name appears in more than one place. Where the copies are identical, Resolve in “Your skills, add-ons, and connections” removes the extra one; otherwise it’s listed for your information.',
    })),
  ];
  const discoveryId = randomUUID();
  const manageablePlugins = uniqueFindings.filter((item) => item.type === 'plugin' && ['Just you', 'This project', 'Only you in this project'].includes(item.scope));
  const projectPackages = uniqueFindings.filter((item) => item.type === 'project-package' && item.scope === 'This project');
  const skillBackups = uniqueFindings.filter((item) => item.type === 'skill-backup');
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
    projectPackages: new Map(projectPackages.map((item) => [item.id, { name: item.name, version: item.version, packageJsonPath: item.path, projectPath: resolvedProjectPath }])),
    projectPath: resolvedProjectPath,
    homePath: home,
    duplicateGroups: new Map(duplicateGroups.map((group) => [`${group.kind}:${group.key}`, group])),
  });
  for (const [id, report] of discoveredSkillCleanup) {
    if (Date.now() - report.createdAt > 24 * 60 * 60 * 1000) discoveredSkillCleanup.delete(id);
  }
  while (discoveredSkillCleanup.size > 10) {
    discoveredSkillCleanup.delete(discoveredSkillCleanup.keys().next().value);
  }
  return {
    discoveryId,
    checkedAt: new Date().toISOString(),
    projectPath: resolvedProjectPath,
    findings: uniqueFindings,
    duplicates,
    inventory: await inventoryFromScan({ findings: uniqueFindings, pluginList, mcpList, projectPath: resolvedProjectPath, duplicateGroups }),
    managedExtras: {
      actionCount: managedExtras.actions.length,
      manualCount: managedExtras.manualItems.length,
      ignored: managedExtras.ignored,
      error: managedExtras.error || '',
    },
  };
}

// Plan 3: add-on and connection duplicates. Everything here only reads Claude Code's own
// config files and `plugin list --json`; changes go through the claude CLI with arguments
// that never leave the main process.
const RESOLUTION_REFUSALS = {
  'needs-choice': 'Choose which copy to keep first.',
  'invalid-choice': 'CCTI only removes the extra copy for this one, so everything keeps working.',
  'nothing-to-do': 'There is only one copy now. Nothing needs to change.',
};
// Why an informational duplicate is left alone. Each says what to do, if anything.
const INFORMATIONAL_REASONS = {
  'different-setup': 'These are set up differently, so CCTI won’t change them. Nothing needs to be done here.',
  'team-shared': 'One copy is shared with everyone on this project, so CCTI won’t change it. Nothing needs to be done here.',
  'separate-folders': 'These copies are saved for different folders, so they don’t conflict. Nothing needs to change.',
  'project-unknown': 'One copy is saved for a specific folder. Choose that folder with “Also check a project” so CCTI can see it, then check again.',
  'unusual-name': 'This name uses characters CCTI can’t safely pass to Claude Code, so CCTI won’t change it. Nothing needs to be done here.',
  'different-reach': 'These copies are saved in different places, so turning one off could remove it somewhere you still use it. CCTI won’t change them.',
};
const KEEPER_REACH = { user: 'you everywhere', local: 'you in this folder', project: 'everyone on this project' };
const ACTION_LOCKED = 'Another CCTI action is running. Wait for it to finish, then try again.';

async function readConfigText(filePath) {
  try {
    return { text: await fs.readFile(filePath, 'utf8'), unreadable: false };
  } catch (error) {
    return { text: null, unreadable: error.code !== 'ENOENT' };
  }
}

// Claude Code resolves connections per folder: in a folder it sees that folder's local
// copy, the project's .mcp.json, and user copies. A local copy saved for the home folder
// and one saved for another project never meet, so each folder is grouped on its own and
// a folder's local copy is only ever removed from that folder.
function mcpGroupsByFolder(definitions, homePath, projectPath) {
  const inFolder = (folder) => definitions.filter((definition) => definition.scope === 'user' || definition.projectPath === folder);
  const groups = new Map();
  for (const group of mcpDuplicateGroups(inFolder(homePath), { homePath })) groups.set(group.key, group);
  if (projectPath && projectPath !== homePath) {
    for (const group of mcpDuplicateGroups(inFolder(projectPath), { homePath })) groups.set(group.key, group);
  }
  return [...groups.values()];
}

// Never throws. `readable` is false when a source that was asked for could not be read, so
// apply can tell "could not check" apart from "the duplicate is gone".
async function currentDuplicateGroups({ claude, homePath, projectPath = '', kinds = ['mcp', 'plugin'] }) {
  const groups = [];
  let readable = true;
  // The underlying copies are returned too, so apply can confirm afterwards that each
  // targeted copy is gone and the kept one is still there, even once the group dissolves.
  let definitions = [];
  let installs = [];
  if (kinds.includes('mcp')) {
    try {
      const [claudeJson, projectMcpJson] = await Promise.all([
        readConfigText(path.join(homePath, '.claude.json')),
        projectPath ? readConfigText(path.join(projectPath, '.mcp.json')) : Promise.resolve({ text: null, unreadable: false }),
      ]);
      const scanned = mcpDefinitions({ claudeJsonText: claudeJson.text, projectMcpJsonText: projectMcpJson.text, homePath, projectPath });
      if (claudeJson.unreadable || projectMcpJson.unreadable || !scanned.ok) readable = false;
      definitions = scanned.definitions;
      groups.push(...mcpGroupsByFolder(scanned.definitions, homePath, projectPath));
    } catch {
      readable = false;
    }
  }
  if (kinds.includes('plugin')) {
    try {
      // The list has no project folder, so it runs from the checked project when there is
      // one: its project and local installs then belong to that folder. With no project
      // checked, project and local installs have no known folder and stay informational.
      const result = claude?.installed
        ? await runProcess(claude.path || 'claude', ['plugin', 'list', '--json'], { cwd: projectPath || homePath, env: claudeProcessEnv(), timeout: 8000 })
        : null;
      const listed = result && !result.timedOut && result.code === 0 ? pluginInstalls(result.stdout, { projectPath }) : { ok: false, installs: [] };
      if (!listed.ok) readable = false;
      installs = listed.installs;
      groups.push(...pluginDuplicateGroups(listed.installs));
    } catch {
      readable = false;
    }
  }
  return { readable, groups, definitions, installs };
}

// True when a copy from a duplicate group is still active in a fresh read: a connection is
// still saved at that scope and folder under that name; an add-on is still turned on there.
function copyStillActive(kind, copy, current) {
  if (kind === 'mcp') {
    return current.definitions.some((definition) => definition.name === copy.name && definition.scope === copy.scope && (definition.projectPath || '') === (copy.projectPath || ''));
  }
  return current.installs.some((install) => install.id === copy.id && install.scope === copy.scope && install.enabled);
}

const resolutionGroupKey = (group) => `${group.kind}:${group.key}`;

function resolutionSummary(group) {
  if (group.informational) return null;
  return {
    groupKey: resolutionGroupKey(group),
    needsChoice: Boolean(group.needsChoice),
    keeper: Number.isInteger(group.keeper) ? group.keeper : null,
    options: group.copies.map((copy) => copy.label),
  };
}

function createResolutionReview({ discoveryId, report, group, keep }) {
  const plan = planResolution(group, { keep });
  if (!plan.ok && plan.reason === 'informational') return { ok: false, error: INFORMATIONAL_REASONS[group.reason] || INFORMATIONAL_REASONS['different-setup'] };
  if (!plan.ok) return { ok: false, error: RESOLUTION_REFUSALS[plan.reason] || RESOLUTION_REFUSALS['nothing-to-do'] };
  for (const [id, candidate] of reviewedResolutions) {
    if (Date.now() - candidate.createdAt > 24 * 60 * 60 * 1000) reviewedResolutions.delete(id);
  }
  const reviewId = randomUUID();
  reviewedResolutions.set(reviewId, {
    plan,
    group,
    discoveryId,
    homePath: report?.homePath || app.getPath('home'),
    projectPath: report?.projectPath || '',
    createdAt: Date.now(),
  });
  while (reviewedResolutions.size > 20) reviewedResolutions.delete(reviewedResolutions.keys().next().value);
  return {
    ok: true,
    reviewId,
    name: plan.name,
    keepLabel: plan.keep.label,
    changes: plan.changes.map(({ label, undo }) => ({ label, undo })),
  };
}

async function reviewResolution({ discoveryId, groupKey, keep } = {}) {
  const report = discoveredSkillCleanup.get(String(discoveryId || ''));
  const group = report?.duplicateGroups?.get(String(groupKey || ''));
  if (!group) return { ok: false, error: 'CCTI doesn’t have this duplicate on its latest list. Check this computer again, then choose Resolve.' };
  return createResolutionReview({ discoveryId: String(discoveryId), report, group, keep });
}

const sameCopy = (left, right) => left.scope === right.scope && (left.projectPath || '') === (right.projectPath || '') && (left.id || '') === (right.id || '');

async function recordDuplicateResolutions(group, copies) {
  if (copies.length === 0) return;
  try {
    const resolvedAt = new Date().toISOString();
    await inventoryLedger().recordResolutions(copies.map((copy) => (group.kind === 'mcp'
      ? { kind: 'mcp', key: group.key, scope: copy.scope, projectPath: copy.projectPath || '', resolvedAt, action: 'remove' }
      : { kind: 'plugin', key: copy.id, scope: copy.scope, projectPath: copy.projectPath || '', resolvedAt, action: 'disable' })));
  } catch {
    // The record is advisory. The change itself already happened and is reported to the user.
  }
}

async function applyResolution({ reviewId } = {}) {
  if (activeInstall || activeComponentInstall || activeSkillCleanup) return { ok: false, error: ACTION_LOCKED };
  const review = reviewedResolutions.get(String(reviewId || ''));
  if (!review) return { ok: false, error: 'This review is no longer available, so nothing was changed. Check this computer again, then choose Resolve.' };
  const { plan, group } = review;
  const groupKey = resolutionGroupKey(group);
  // Take the lock before re-reading, so nothing else can change the setup between the check and the act.
  activeInstall = true;
  emit('installer:state', { running: true });
  const completed = [];
  try {
    const claude = await claudeStatus();
    if (!claude.installed) return { ok: false, error: 'Claude Code isn’t ready, so nothing was changed. Check this computer again once Claude Code is available.' };
    const current = await currentDuplicateGroups({ claude, homePath: review.homePath, projectPath: review.projectPath, kinds: [group.kind] });
    if (!current.readable) return { ok: false, error: 'CCTI couldn’t read your Claude Code settings right now, so nothing was changed. Try again in a moment.' };
    const rebuilt = current.groups.find((candidate) => resolutionGroupKey(candidate) === groupKey);
    if (!rebuilt || groupFingerprint(rebuilt) !== plan.fingerprint) {
      reviewedResolutions.delete(String(reviewId));
      const report = discoveredSkillCleanup.get(review.discoveryId);
      if (report?.duplicateGroups) {
        if (rebuilt) report.duplicateGroups.set(groupKey, rebuilt);
        else report.duplicateGroups.delete(groupKey);
      }
      if (!rebuilt) {
        return { ok: false, changed: true, error: 'This changed since you looked at it, so nothing was changed. It no longer has more than one copy, so nothing needs to change.', review: null, resolution: null };
      }
      // Re-plan with the same keeper when that copy is still there. A fixed keeper is
      // whichever copy the rebuilt group's rule now picks (the broadest-reach identical
      // connection copy); a chosen add-on copy is matched by identity, not position.
      const keptIndex = rebuilt.needsChoice ? rebuilt.copies.findIndex((copy) => sameCopy(copy, plan.keep)) : -1;
      const next = createResolutionReview({ discoveryId: review.discoveryId, report, group: rebuilt, keep: keptIndex >= 0 ? keptIndex : undefined });
      return {
        ok: false,
        changed: true,
        error: 'This changed since you looked at it, so nothing was changed. Here is how it looks now.',
        review: next.ok ? { reviewId: next.reviewId, name: next.name, keepLabel: next.keepLabel, changes: next.changes } : null,
        resolution: resolutionSummary(rebuilt),
        informational: rebuilt.informational ? { reason: rebuilt.reason, message: INFORMATIONAL_REASONS[rebuilt.reason] || INFORMATIONAL_REASONS['different-setup'] } : null,
      };
    }

    // Last line of defence before the shell-backed Windows launcher: every name, id, and scope
    // passed to the CLI must be plain. Grouping already makes unusual names informational.
    const SAFE_SCOPES = new Set(['user', 'local', 'project']);
    const unsafe = plan.changes.find(({ args }) => {
      const [kind, verb, target, flag, scope] = args;
      const safeTarget = kind === 'mcp' ? isSafeMcpName(target) : isSafePluginId(target);
      return args.length !== 5 || !['mcp', 'plugin'].includes(kind) || !['remove', 'disable'].includes(verb) || !safeTarget || flag !== '--scope' || !SAFE_SCOPES.has(scope);
    });
    if (unsafe) {
      emit('installer:output', { stream: 'stderr', text: '[CCTI] Refused a duplicate change because a name contained characters that are not safe to pass to Claude Code.\n' });
      return { ok: false, error: 'This name uses characters CCTI can’t safely pass to Claude Code, so nothing was changed.', completed: [] };
    }

    const home = app.getPath('home');
    for (const change of plan.changes) {
      const { copy } = change;
      // Project and local scopes belong to a folder; run there so the CLI edits that folder's copy.
      const cwd = copy.scope === 'user' ? home : copy.projectPath || home;
      emit('installer:output', { stream: 'stdout', text: `[CCTI] ${change.label}: claude ${change.args.join(' ')}\n` });
      let result;
      try {
        result = await runProcess(claude.path || 'claude', change.args, { cwd, env: claudeProcessEnv(), timeout: 20000 });
      } catch (error) {
        result = { code: -1, stdout: '', stderr: error.message };
      }
      if (result.stdout) emit('installer:output', { stream: 'stdout', text: result.stdout });
      if (result.stderr) emit('installer:output', { stream: result.code === 0 ? 'stdout' : 'stderr', text: result.stderr });
      if (result.code !== 0) break;
      completed.push({ change, copy });
    }
    if (completed.length < plan.changes.length) {
      const progress = completed.length === 0 ? 'Nothing was changed.' : `${completed.length} of ${plan.changes.length} changes were made.`;
      return { ok: false, error: `Claude Code couldn’t finish resolving ${plan.name}. ${progress} Open the activity details to see why, then try again.`, completed: completed.map(({ change }) => change.label) };
    }
    reviewedResolutions.delete(String(reviewId));
    discoveredSkillCleanup.get(review.discoveryId)?.duplicateGroups?.delete(groupKey);
    // Every command succeeded. Read the setup once more and confirm it looks as reviewed:
    // each targeted copy is gone and the kept copy is still there.
    const after = await currentDuplicateGroups({ claude, homePath: review.homePath, projectPath: review.projectPath, kinds: [group.kind] });
    const stillThere = after.readable ? completed.filter(({ copy }) => copyStillActive(group.kind, copy, after)) : completed;
    const keptGone = !after.readable || !copyStillActive(group.kind, plan.keep, after);
    if (stillThere.length > 0 || keptGone) {
      const details = !after.readable
        ? 'could not re-read the settings after the change'
        : [...stillThere.map(({ change }) => `still present: ${change.label}`), keptGone ? `kept copy missing: ${plan.keep.label}` : ''].filter(Boolean).join('; ');
      emit('installer:output', { stream: 'stderr', text: `[CCTI] After resolving ${plan.name}, the setup doesn’t match the review (${details}).\n` });
      const ran = completed.map(({ change }) => change.label);
      // Only copies confirmed gone are recorded as resolved.
      const confirmed = after.readable ? completed.filter((item) => !stillThere.includes(item)) : [];
      completed.splice(0, completed.length, ...confirmed);
      return { ok: false, error: 'CCTI made the change, but Claude Code’s setup doesn’t look the way it expected. Check this computer again to see how it looks now.', completed: ran };
    }
    const message = group.kind === 'mcp'
      ? `Removed the extra copy of ${plan.name}. The same connection stays saved for ${KEEPER_REACH[plan.keep.scope] || 'you'}, so nothing stops working.`
      : `Turned off the extra copy of ${plan.name}. The one from ${plan.keep.marketplace} stays on. Nothing was uninstalled, so you can turn the other one back on later if you need it.`;
    return { ok: true, message };
  } catch {
    return { ok: false, error: `CCTI couldn’t finish resolving ${plan.name}. ${completed.length === 0 ? 'Nothing was changed.' : `${completed.length} of ${plan.changes.length} changes were made.`} Check this computer again, then try again.`, completed: completed.map(({ change }) => change.label) };
  } finally {
    await recordDuplicateResolutions(group, completed.map(({ copy }) => copy));
    activeInstall = false;
    emit('installer:state', { running: false });
  }
}

async function reviewPluginChange({ discoveryId, findingId, action }) {
  const finding = discoveredSkillCleanup.get(discoveryId)?.plugins?.get(findingId);
  if (!finding || !['enable', 'disable'].includes(action)) return { ok: false, error: 'Check this computer again before changing an add-on.' };
  const scope = finding.scope === 'This project' ? 'project' : finding.scope === 'Only you in this project' ? 'local' : 'user';
  const reviewId = randomUUID();
  reviewedPluginChanges.set(reviewId, { name: finding.name, scope, action, createdAt: Date.now() });
  for (const [id, review] of reviewedPluginChanges) {
    if (Date.now() - review.createdAt > 24 * 60 * 60 * 1000) reviewedPluginChanges.delete(id);
  }
  return { ok: true, reviewId, name: finding.name, scope: finding.scope, action, description: `${action === 'enable' ? 'Turn on' : 'Turn off'} this add-on for ${finding.scope.toLowerCase()}. This does not uninstall it.` };
}

async function applyPluginChange({ reviewId }) {
  const plan = reviewedPluginChanges.get(reviewId);
  if (!plan) return { ok: false, error: 'This review is no longer available. Check this computer again.' };
  reviewedPluginChanges.delete(reviewId);
  try {
    const claude = await claudeStatus();
    if (!claude.installed) return { ok: false, error: 'Claude Code is not ready. Check this computer again after Claude Code is available.' };
    // Distinguish "the list call itself failed or timed out" (detection failed, so we cannot
    // say the add-on is absent) from "the list succeeded and the add-on is not on it" (the
    // add-on really is gone). Run the list directly, the same way presentTrackedItems does,
    // instead of installedClaudePluginIds(), which folds both cases into an empty list.
    let listResult = null;
    try {
      listResult = await runProcess(claude.path || 'claude', ['plugin', 'list'], { cwd: app.getPath('home'), env: claudeProcessEnv(), timeout: 8000 });
    } catch {
      listResult = null;
    }
    if (!listResult || listResult.timedOut || listResult.code !== 0) {
      return { ok: false, error: 'CCTI couldn’t check your add-ons right now, so nothing was changed. Try again in a moment.' };
    }
    const installedIds = pluginIdsFromList(listResult.stdout);
    if (!pluginIsInstalled(installedIds, plan.name)) {
      return { ok: false, error: 'That add-on is no longer installed, so nothing was changed. Check this computer again to see the current list.' };
    }
    // The name comes from settings files; on Windows the CLI launcher runs through the shell.
    if (!(isSafePluginId(plan.name) || isSafeMcpName(plan.name)) || !['user', 'project', 'local'].includes(plan.scope)) {
      return { ok: false, error: 'This add-on’s name uses characters CCTI can’t safely pass to Claude Code, so nothing was changed.' };
    }
    const result = await runProcess(claude.path || 'claude', ['plugin', plan.action, plan.name, '--scope', plan.scope], { cwd: app.getPath('home'), env: claudeProcessEnv() });
    if (result.code !== 0) {
      if (result.stderr) emit('installer:output', { stream: 'stderr', text: result.stderr });
      return { ok: false, error: `Claude Code could not ${plan.action} this add-on. Open the activity details to see why, then try again.` };
    }
    return { ok: true, message: `${plan.name} is now ${plan.action === 'enable' ? 'enabled' : 'disabled'} for the selected scope.` };
  } catch (error) {
    return { ok: false, error: `CCTI could not ${plan.action} this add-on: ${error.message}` };
  }
}

function projectPackageVersion(manifest, name) {
  const dependency = manifest?.dependencies?.[name];
  const devDependency = manifest?.devDependencies?.[name];
  if (typeof dependency === 'string') return dependency;
  if (typeof devDependency === 'string') return devDependency;
  return '';
}

async function reviewProjectPackageRemoval({ discoveryId, findingId }) {
  const report = discoveredSkillCleanup.get(String(discoveryId || ''));
  const finding = report?.projectPackages?.get(String(findingId || ''));
  if (!finding || !report?.projectPath || finding.projectPath !== report.projectPath) {
    return { ok: false, error: 'Check this project again before removing a package.' };
  }
  try {
    const projectPackage = await inspectProjectPackage(finding.projectPath);
    const currentVersion = projectPackage.packageState === 'existing' ? projectPackageVersion(projectPackage.manifest, finding.name) : '';
    if (!currentVersion || projectPackage.packageJsonPath !== finding.packageJsonPath || currentVersion !== finding.version) {
      return { ok: false, error: 'This project package changed after the checkup. Check this project again before removing it.' };
    }
    const reviewId = randomUUID();
    const plan = { reviewId, name: finding.name, version: finding.version, projectPath: finding.projectPath, packageJsonPath: finding.packageJsonPath, createdAt: Date.now() };
    reviewedProjectPackageRemovalPlans.set(reviewId, plan);
    for (const [id, candidate] of reviewedProjectPackageRemovalPlans) {
      if (Date.now() - candidate.createdAt > 10 * 60 * 1000) reviewedProjectPackageRemovalPlans.delete(id);
    }
    return {
      ok: true,
      ...plan,
      command: `npm uninstall --ignore-scripts --no-audit --no-fund ${finding.name}`,
      description: 'Removes this one reviewed package from the selected project only. Package scripts remain disabled. CCTI will not touch your global tools, skills, add-ons, or any other project.',
    };
  } catch (error) {
    return { ok: false, error: `CCTI could not review this project package: ${error.message}` };
  }
}

async function applyProjectPackageRemoval({ reviewId, confirmation }) {
  const plan = reviewedProjectPackageRemovalPlans.get(String(reviewId || ''));
  if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) return { ok: false, error: 'This package removal review has expired. Check this project again.' };
  if (confirmation !== 'REMOVE PROJECT PACKAGE') return { ok: false, error: 'Type REMOVE PROJECT PACKAGE exactly to remove the reviewed package.' };
  if (activeInstall || activeComponentInstall || activeSkillCleanup) return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before removing a project package.' };
  try {
    const projectPackage = await inspectProjectPackage(plan.projectPath);
    const currentVersion = projectPackage.packageState === 'existing' ? projectPackageVersion(projectPackage.manifest, plan.name) : '';
    if (!currentVersion || projectPackage.packageJsonPath !== plan.packageJsonPath || currentVersion !== plan.version) {
      return { ok: false, error: 'This project package changed after review. Check this project again before removing it.' };
    }
    activeComponentInstall = true;
    emit('component:state', { running: true });
    emit('component:output', { stream: 'stdout', text: `[CCTI] Removing reviewed project package ${plan.name} with package scripts disabled…\n` });
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = await runProcess(npmCommand, ['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', plan.name], { cwd: plan.projectPath, env: claudeProcessEnv() });
    if (result.code !== 0) return { ok: false, error: result.stderr.trim() || `CCTI could not remove ${plan.name} from this project.` };
    reviewedProjectPackageRemovalPlans.delete(plan.reviewId);
    return { ok: true, message: `${plan.name} was removed from the selected project. Package scripts were disabled; global tools, skills, add-ons, and other projects were not changed.` };
  } catch (error) {
    return { ok: false, error: `CCTI could not remove the reviewed project package: ${error.message}` };
  } finally {
    activeComponentInstall = false;
    emit('component:state', { running: false });
  }
}

function manifestActionLabel({ kind, target, item }) {
  const knownLabels = {
    path: 'CCTI reference folder',
    skill: 'CCTI-installed skill',
    mcp: 'CCTI-managed MCP connection',
    'npm-global': 'CCTI-installed global package',
    'brew-cask': 'CCTI-installed desktop tool',
    'managed-runtime': 'CCTI-managed Node.js runtime',
  };
  return `${knownLabels[kind] || kind}: ${item || target}`;
}

async function managedExtrasFromManifest() {
  const manifestPath = managedExtrasManifestPath();
  let source;
  try {
    source = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { manifestPath, source: '', digest: '', actions: [], manualItems: [], ignored: 0 };
    throw error;
  }
  const home = app.getPath('home');
  const referenceRoot = path.join(home, '.claude', 'reference-repos');
  const skillRoot = path.join(home, '.claude', 'skills');
  const expectedPathByItem = new Map([
    ['learn-claude-code', path.join(referenceRoot, 'learn-claude-code')],
    ['karpathy-skills', path.join(referenceRoot, 'andrej-karpathy-skills')],
    ['ui-ux-pro-max', path.join(referenceRoot, 'ui-ux-pro-max')],
    ['awesome-claude-skills', path.join(referenceRoot, 'awesome-claude-skills')],
    ['multica', path.join(referenceRoot, 'multica')],
    ['awesome-mcp-servers', path.join(referenceRoot, 'awesome-mcp-servers')],
    ['system-prompts-ai', path.join(referenceRoot, 'system-prompts-and-models-of-ai-tools')],
    ['best-practice', path.join(referenceRoot, 'claude-code-best-practice')],
    ['caveman', path.join(referenceRoot, 'caveman')],
    ['gstack', path.join(skillRoot, 'gstack')],
    ['ponytail', path.join(skillRoot, 'ponytail')],
    ['taste-skill', path.join(skillRoot, 'design-taste-frontend')],
    ['planning-with-files', path.join(skillRoot, 'planning-with-files')],
    ['graphify', path.join(skillRoot, 'graphify')],
  ]);
  const expectedGlobalPackageByItem = new Map([
    ['bun-runtime', 'bun'],
    ['codegraph', '@colbymchenry/codegraph'],
    ['repomix', 'repomix'],
    ['firecrawl', 'firecrawl-cli'],
    ['claude-code-router', '@musistudio/claude-code-router'],
  ]);
  const expectedMcpByItem = new Map([['repomix', 'repomix'], ['playwright-mcp', 'playwright']]);
  const allowedManualItems = new Set(['claude-code', 'claude-mem']);
  const actionsByKey = new Map();
  const manualItems = [];
  let ignored = 0;
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    const [timestamp, kind, target, extra, item] = line.split('\t');
    if (!timestamp || !kind || !target || !item || line.split('\t').length !== 5) {
      ignored += 1;
      continue;
    }
    const expectedPath = expectedPathByItem.get(item);
    const allowed = ((kind === 'path' || kind === 'skill') && expectedPath === path.resolve(target))
      || (kind === 'managed-runtime' && item === 'node-runtime' && path.resolve(target) === path.join(setupManagerDir(), 'node-runtime'))
      || (kind === 'npm-global' && expectedGlobalPackageByItem.get(item) === target)
      || (kind === 'mcp' && expectedMcpByItem.get(item) === target)
      || (kind === 'brew-cask' && item === 'cc-switch' && target === 'cc-switch');
    if (kind === 'manual-review' && allowedManualItems.has(item)) {
      manualItems.push({ item, target, extra, label: `${item}: ${extra || 'Use its documented removal steps.'}` });
      continue;
    }
    if (!allowed) {
      ignored += 1;
      continue;
    }
    const key = `${kind}\u0000${target}`;
    if (!actionsByKey.has(key)) actionsByKey.set(key, { kind, target, item, label: manifestActionLabel({ kind, target, item }), lines: [line] });
    else actionsByKey.get(key).lines.push(line);
  }
  return {
    manifestPath,
    source,
    digest: createHash('sha256').update(source, 'utf8').digest('hex'),
    actions: [...actionsByKey.values()],
    manualItems,
    ignored,
  };
}

async function reviewManagedExtrasRemoval() {
  try {
    const manifest = await managedExtrasFromManifest();
    if (!manifest.actions.length) {
      return { ok: false, error: manifest.manualItems.length ? 'CCTI found only items that require their own documented removal steps. Nothing can be removed automatically.' : 'No CCTI-managed extras are recorded for removal.' };
    }
    const reviewId = randomUUID();
    const plan = { reviewId, manifestPath: manifest.manifestPath, digest: manifest.digest, actions: manifest.actions, manualItems: manifest.manualItems, createdAt: Date.now() };
    reviewedManagedExtrasRemovalPlans.set(reviewId, plan);
    for (const [id, candidate] of reviewedManagedExtrasRemovalPlans) {
      if (Date.now() - candidate.createdAt > 10 * 60 * 1000) reviewedManagedExtrasRemovalPlans.delete(id);
    }
    return {
      ok: true,
      ...plan,
      ignored: manifest.ignored,
      description: 'Removes only the CCTI-managed paths, global packages, MCP connections, desktop tool, and managed runtime listed below. Each target is bound to the CCTI manifest you just reviewed. Claude Code itself and any manual-review item remain untouched.',
    };
  } catch (error) {
    return { ok: false, error: `CCTI could not read its managed extras list: ${error.message}` };
  }
}

async function applyManagedExtrasRemoval({ reviewId, confirmation }) {
  const plan = reviewedManagedExtrasRemovalPlans.get(String(reviewId || ''));
  if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) return { ok: false, error: 'This managed extras review has expired. Check this computer again.' };
  if (confirmation !== 'REMOVE CCTI EXTRAS') return { ok: false, error: 'Type REMOVE CCTI EXTRAS exactly to remove the reviewed items.' };
  if (activeInstall || activeComponentInstall || activeSkillCleanup) return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before removing CCTI-managed extras.' };
  const completedActions = [];
  try {
    const currentManifest = await managedExtrasFromManifest();
    if (currentManifest.digest !== plan.digest) return { ok: false, error: 'The CCTI managed extras list changed after review. Check this computer again before removing it.' };
    activeInstall = true;
    emit('installer:state', { running: true });
    const completedLines = new Set();
    for (const action of plan.actions) {
      emit('installer:output', { stream: 'stdout', text: `[CCTI] Removing reviewed ${action.label}…\n` });
      if (['path', 'skill', 'managed-runtime'].includes(action.kind)) {
        await fs.rm(action.target, { recursive: true, force: true });
      } else if (action.kind === 'mcp') {
        const claude = await claudeStatus();
        if (!claude.installed) return { ok: false, removedCount: completedLines.size, error: 'Claude Code is not ready, so CCTI cannot remove the reviewed MCP connection. No remaining item was changed.' };
        const result = await runProcess(claude.path || 'claude', ['mcp', 'remove', action.target], { cwd: app.getPath('home'), env: claudeProcessEnv() });
        if (result.code !== 0) return { ok: false, removedCount: completedLines.size, error: result.stderr.trim() || `CCTI could not remove the MCP connection ${action.target}. No remaining item was changed.` };
      } else if (action.kind === 'npm-global') {
        const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const result = await runProcess(npmCommand, ['uninstall', '-g', '--ignore-scripts', '--no-audit', '--no-fund', action.target], { cwd: app.getPath('home'), env: claudeProcessEnv() });
        if (result.code !== 0) return { ok: false, removedCount: completedLines.size, error: result.stderr.trim() || `CCTI could not remove the global package ${action.target}. No remaining item was changed.` };
      } else if (action.kind === 'brew-cask') {
        const available = await runProcess('brew', ['list', '--cask', action.target], { cwd: app.getPath('home'), env: claudeProcessEnv() });
        if (available.code === 0) {
          const result = await runProcess('brew', ['uninstall', '--cask', action.target], { cwd: app.getPath('home'), env: claudeProcessEnv() });
          if (result.code !== 0) return { ok: false, removedCount: completedLines.size, error: result.stderr.trim() || `CCTI could not remove the desktop tool ${action.target}. No remaining item was changed.` };
        }
      }
      action.lines.forEach((line) => completedLines.add(line));
      completedActions.push(action);
    }
    const remaining = currentManifest.source.split(/\r?\n/).filter((line) => line && !completedLines.has(line));
    await fs.writeFile(plan.manifestPath, remaining.length ? `${remaining.join('\n')}\n` : '', 'utf8');
    reviewedManagedExtrasRemovalPlans.delete(plan.reviewId);
    const manualNote = plan.manualItems.length ? ` ${plan.manualItems.length} separately managed item${plan.manualItems.length === 1 ? ' remains' : 's remain'} for manual review.` : '';
    return { ok: true, removedCount: plan.actions.length, message: `Removed ${plan.actions.length} reviewed CCTI-managed extra${plan.actions.length === 1 ? '' : 's'}. Claude Code, unrelated tools, and all non-CCTI projects were left alone.${manualNote}` };
  } catch (error) {
    return { ok: false, error: `CCTI could not remove the reviewed managed extras: ${error.message}` };
  } finally {
    // Runs on early returns too, so removals that completed before a failure are recorded.
    await recordExtrasRemovals(completedActions);
    activeInstall = false;
    emit('installer:state', { running: false });
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

function storeCustomAddOnReview(review, sourceManifest = null) {
  const reviewId = randomUUID();
  const plan = {
    kind: review.kind,
    source: review.source,
    scope: review.scope,
    destination: review.destination || '',
    sourceManifest,
    createdAt: Date.now(),
  };
  reviewedCustomAddOnPlans.set(reviewId, plan);
  for (const [id, candidate] of reviewedCustomAddOnPlans) {
    if (Date.now() - candidate.createdAt > 10 * 60 * 1000) reviewedCustomAddOnPlans.delete(id);
  }
  return { ...review, reviewId };
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
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
      return storeCustomAddOnReview({ ok: true, kind: 'marketplace', source: cleanSource, scope: 'user', command: `claude plugin marketplace add ${cleanSource}`, description: 'Adds this trusted plugin marketplace to your Claude Code checklist. You will run the shown command only after a final confirmation.' });
    } catch {
      return { ok: false, error: 'Use a trusted HTTPS marketplace link that ends in marketplace.json.' };
    }
  }
  if (validRepository(cleanSource)) {
    return storeCustomAddOnReview({ ok: true, kind: 'marketplace', source: cleanSource, scope: 'user', description: 'Adds this reviewed GitHub marketplace to your Claude Code setup after one final confirmation.' });
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
      return storeCustomAddOnReview({ ok: true, kind: 'skill-copy', source: sourcePath, scope: cleanScope, destination, description: 'Copies this local skill folder into the selected Claude Code scope. The original folder stays where it is.' }, sourceManifest);
    } catch {
      try {
        await fs.access(path.join(sourcePath, '.claude-plugin', 'marketplace.json'));
        return storeCustomAddOnReview({ ok: true, kind: 'marketplace', source: sourcePath, scope: 'user', description: 'Adds this reviewed local plugin marketplace to your Claude Code setup after one final confirmation.' });
      } catch {
        return { ok: false, error: 'This folder is not a skill (SKILL.md) or a plugin marketplace (.claude-plugin/marketplace.json).' };
      }
    }
  } catch {
    return { ok: false, error: 'This folder could not be found or read.' };
  }
}

async function applyCustomAddOn({ reviewId }) {
  const plan = reviewedCustomAddOnPlans.get(reviewId);
  if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) {
    return { ok: false, error: 'This add-on review has expired. Review the source again before adding it.' };
  }
  reviewedCustomAddOnPlans.delete(reviewId);
  if (plan.kind === 'skill-copy') {
    try {
      const sourceInfo = await fs.lstat(plan.source);
      if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) throw new Error('The reviewed skill folder is no longer a direct readable folder.');
      await fs.access(path.join(plan.source, 'SKILL.md'));
      const currentManifest = await skillContentManifest(plan.source);
      if (!plan.sourceManifest || currentManifest.identity !== plan.sourceManifest.identity || JSON.stringify(currentManifest.files) !== JSON.stringify(plan.sourceManifest.files)) {
        return { ok: false, error: 'The reviewed skill changed after review. Review it again before adding it.' };
      }
      await fs.access(plan.destination);
      return { ok: false, code: 'already-available', error: `CCTI did not add ${path.basename(plan.destination)} because this skill is already available in Claude Code.` };
    } catch {
      try {
        const sourceInfo = await fs.lstat(plan.source);
        if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) return { ok: false, error: 'The reviewed skill folder is no longer a direct readable folder. Review it again before adding it.' };
        await fs.access(path.join(plan.source, 'SKILL.md'));
        const currentManifest = await skillContentManifest(plan.source);
        if (!plan.sourceManifest || currentManifest.identity !== plan.sourceManifest.identity || JSON.stringify(currentManifest.files) !== JSON.stringify(plan.sourceManifest.files)) {
          return { ok: false, error: 'The reviewed skill changed after review. Review it again before adding it.' };
        }
        await fs.mkdir(path.dirname(plan.destination), { recursive: true });
        await fs.cp(plan.source, plan.destination, { recursive: true, errorOnExist: true });
        return { ok: true, message: `Added your skill to ${plan.scope === 'user' ? 'your Claude Code setup' : 'the selected project'}.` };
      } catch (error) {
        return { ok: false, error: `CCTI could not add the reviewed skill: ${error.message}` };
      }
    }
  }
  try {
    const claude = await claudeStatus();
    if (!claude.installed) return { ok: false, error: 'Claude Code is not ready. Check this computer again after Claude Code is available.' };
    const result = await runProcess(claude.path || 'claude', ['plugin', 'marketplace', 'add', plan.source], { cwd: app.getPath('home'), env: claudeProcessEnv() });
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
  const plan = {
    ok: true,
    reviewId,
    discoveryId,
    findingId,
    source,
    destination,
    moves: [{
      name: finding.name,
      scope: finding.scope,
      source,
      destination,
      files: moveFilesForPreview({ source, destination, files: finding.files }),
    }],
    contentHash: finding.contentHash,
    description: 'This moves the selected skill to a backup folder. It does not delete it. You can move it back later.',
  };
  reviewedCleanupPlans.set(reviewId, { ...plan, createdAt: Date.now() });
  for (const [id, review] of reviewedCleanupPlans) {
    if (Date.now() - review.createdAt > 24 * 60 * 60 * 1000) reviewedCleanupPlans.delete(id);
  }
  while (reviewedCleanupPlans.size > 20) {
    reviewedCleanupPlans.delete(reviewedCleanupPlans.keys().next().value);
  }
  return plan;
}

async function applyCleanup({ reviewId }) {
  const plan = reviewedCleanupPlans.get(reviewId);
  const currentFinding = plan && discoveredSkillCleanup.get(plan.discoveryId)?.skills.get(plan.findingId);
  if (!plan || !currentFinding || currentFinding.path !== plan.source) {
    return { ok: false, error: 'This cleanup review is no longer available. Check this computer again and review the backup move before continuing.' };
  }
  try {
    const currentManifest = await skillContentManifest(plan.source);
    if (currentManifest.identity !== plan.contentHash) {
      return { ok: false, error: 'This skill changed after you looked at it, so nothing was moved. Check this computer again to see it as it is now.' };
    }
  } catch {
    return { ok: false, error: 'The selected skill could not be moved. It may already be gone or no longer be a skill folder. Check this computer again to see it as it is now.' };
  }
  try {
    await fs.access(path.join(plan.source, 'SKILL.md'));
    await fs.mkdir(path.dirname(plan.destination), { recursive: true });
    await fs.rename(plan.source, plan.destination);
    const cleanupReport = discoveredSkillCleanup.get(plan.discoveryId);
    cleanupReport?.skills.delete(plan.findingId);
    reviewedCleanupPlans.delete(reviewId);
    await recordSkillResolutions(plan.moves, cleanupReport?.projectPath || '');
    return { ok: true, message: 'The selected skill was moved to a backup folder. No other settings were changed.' };
  } catch {
    return { ok: false, error: 'The selected skill could not be moved. It may already be gone or no longer be a skill folder.' };
  }
}

async function reviewAllDuplicateSkills({ discoveryId } = {}) {
  const report = discoveredSkillCleanup.get(String(discoveryId || ''));
  if (!report) return { ok: false, error: 'Check this computer again before removing duplicate skills.' };
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
    description: 'CCTI keeps the copy Claude Code uses (your personal copy over a project copy, otherwise the newest) of each identical skill content group and moves every other discovered copy to a backup folder. The review lists every backed-up file. Nothing is deleted.',
  };
  reviewedBulkCleanupPlans.set(reviewId, { ...plan, createdAt: Date.now(), moves });
  for (const [id, review] of reviewedBulkCleanupPlans) {
    if (Date.now() - review.createdAt > 24 * 60 * 60 * 1000) reviewedBulkCleanupPlans.delete(id);
  }
  while (reviewedBulkCleanupPlans.size > 20) {
    reviewedBulkCleanupPlans.delete(reviewedBulkCleanupPlans.keys().next().value);
  }
  return plan;
}

async function applyAllDuplicateSkills({ reviewId } = {}) {
  const plan = reviewedBulkCleanupPlans.get(String(reviewId || ''));
  const report = plan && discoveredSkillCleanup.get(plan.discoveryId);
  if (!plan || !report) {
    return { ok: false, error: 'This duplicate cleanup review is no longer available. Check this computer again before continuing.' };
  }
  if (activeInstall || activeComponentInstall || activeSkillCleanup) {
    return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before removing duplicate skills.' };
  }

  // Re-verify the copy each group would KEEP, not just the copies it would move. The plan can
  // sit for up to 24 hours; if the kept copy was deleted or edited after review, moving every
  // other copy in its group would leave no active copy of that skill at all.
  for (const group of plan.groups) {
    try {
      const keeperManifest = await skillContentManifest(group.keep.path);
      if (keeperManifest.identity !== group.keep.contentHash) {
        return { ok: false, error: 'The copy CCTI would keep changed after you looked at it, so nothing was moved. Check this computer again to see the current copies.' };
      }
    } catch {
      return { ok: false, error: 'The copy CCTI would keep changed after you looked at it, so nothing was moved. Check this computer again to see the current copies.' };
    }
  }

  for (const move of plan.moves) {
    const finding = report.skills.get(move.findingId);
    if (!finding || finding.path !== move.source || finding.contentHash !== move.contentHash || !path.isAbsolute(move.source) || !skillSourceWithinCheckedRoot(report, move.source)) {
      return { ok: false, error: 'The discovered duplicate list changed. Check this computer again before continuing.' };
    }
    try {
      const currentManifest = await skillContentManifest(move.source);
      if (currentManifest.identity !== move.contentHash || JSON.stringify(currentManifest.files) !== JSON.stringify(move.files)) {
        return { ok: false, error: 'A duplicate skill changed after the preview. Check this computer again before continuing.' };
      }
    } catch (error) {
      return { ok: false, error: error.code === 'ENOENT' ? 'A duplicate skill folder is no longer available. Check this computer again before continuing.' : 'CCTI could not recheck one of the duplicate skill folders. Nothing was moved.' };
    }
    try {
      await fs.access(move.destination);
      return { ok: false, error: 'A backup location is already in use. Check this computer again to create a new cleanup plan.' };
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
      message: `Moved ${moved.length} duplicate skill ${moved.length === 1 ? 'copy' : 'copies'} to backup folders. CCTI kept the copy Claude Code uses for each skill (your personal copy over a project copy, otherwise the newest). No other settings were changed.`,
    };
  } catch (error) {
    return {
      ok: false,
      movedCount: moved.length,
      error: moved.length
        ? `CCTI moved ${moved.length} reviewed duplicate ${moved.length === 1 ? 'copy' : 'copies'} before stopping. Review the backup folders, then check this computer again.`
        : 'CCTI could not move the reviewed duplicate skills. Nothing was deleted.',
    };
  } finally {
    if (moved.length > 0) await recordSkillResolutions(moved, report.projectPath);
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
  if (!report?.backups) return { ok: false, error: 'Check this computer again before restoring skill backups.' };
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
    return { ok: false, error: 'This restore review has expired. Check this computer again before continuing.' };
  }
  if (activeInstall || activeComponentInstall || activeSkillCleanup) {
    return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before restoring skill backups.' };
  }
  for (const move of plan.moves) {
    const backup = report.backups.get(move.backupId);
    if (!backup || !backup.restorable || backup.path !== move.source || backup.destination !== move.destination || backup.contentHash !== move.contentHash || !backupSourceWithinCheckedRoot(report, move.source)) {
      return { ok: false, error: 'The discovered backup list changed. Check this computer again before continuing.' };
    }
    if (await pathExists(move.destination)) return { ok: false, error: 'An original skill location is now in use. CCTI will not overwrite it. Check this computer again.' };
    try {
      const currentManifest = await skillContentManifest(move.source);
      if (currentManifest.identity !== move.contentHash || JSON.stringify(currentManifest.files) !== JSON.stringify(move.files)) {
        return { ok: false, error: 'A skill backup changed after the preview. Check this computer again before continuing.' };
      }
    } catch (error) {
      return { ok: false, error: error.code === 'ENOENT' ? 'A skill backup is no longer available. Check this computer again before continuing.' : 'CCTI could not recheck one of the skill backups. Nothing was restored.' };
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
        ? `CCTI restored ${restored.length} reviewed skill backup ${restored.length === 1 ? 'copy' : 'copies'} before stopping. Check this computer again to review what remains.`
        : 'CCTI could not restore the reviewed skill backups. Nothing was overwritten.',
    };
  } finally {
    activeSkillCleanup = false;
  }
}

async function reviewSkillBackupReplacement({ discoveryId, backupId } = {}) {
  const report = discoveredSkillCleanup.get(String(discoveryId || ''));
  const backup = report?.backups.get(String(backupId || ''));
  if (!backup || !path.isAbsolute(backup.path) || !path.isAbsolute(backup.destination) || !backupSourceWithinCheckedRoot(report, backup.path) || !skillSourceWithinCheckedRoot(report, backup.destination)) {
    return { ok: false, error: 'Check this computer again and choose a preserved skill backup from its listed location.' };
  }
  if (backup.restorable) {
    return { ok: false, error: 'This backup already has an empty original location. Use Restore safe backup copies instead.' };
  }
  try {
    const [backupManifest, activeManifest] = await Promise.all([
      skillContentManifest(backup.path),
      skillContentManifest(backup.destination),
    ]);
    const activeDestination = skillBackupDestination(report, backup.destination);
    const reviewId = randomUUID();
    const moves = [
      {
        kind: 'archive-active',
        name: backup.name,
        source: backup.destination,
        destination: activeDestination,
        scope: backup.scope,
        contentHash: activeManifest.identity,
        files: activeManifest.files,
      },
      {
        kind: 'restore-preserved',
        name: backup.name,
        source: backup.path,
        destination: backup.destination,
        scope: backup.scope,
        contentHash: backupManifest.identity,
        files: backupManifest.files,
      },
    ];
    const plan = {
      ok: true,
      reviewId,
      discoveryId,
      backupId: backup.id,
      moves: moves.map((move) => ({ ...move, files: moveFilesForPreview(move) })),
      description: 'CCTI first moves the active skill folder to a new CCTI backup, then restores the selected preserved skill copy to the now-empty original location. It does not merge or delete files.',
    };
    reviewedSkillBackupReplacementPlans.set(reviewId, { ...plan, createdAt: Date.now(), moves });
    for (const [id, review] of reviewedSkillBackupReplacementPlans) {
      if (Date.now() - review.createdAt > 10 * 60 * 1000) reviewedSkillBackupReplacementPlans.delete(id);
    }
    return plan;
  } catch {
    return { ok: false, error: 'CCTI could not verify both the active skill and the saved backup. Nothing was changed.' };
  }
}
async function applySkillBackupReplacement({ reviewId } = {}) {
  const plan = reviewedSkillBackupReplacementPlans.get(String(reviewId || ''));
  const report = plan && discoveredSkillCleanup.get(plan.discoveryId);
  if (!plan || !report || Date.now() - plan.createdAt > 10 * 60 * 1000) {
    return { ok: false, error: 'This replacement review has expired. Check this computer again before replacing the active skill.' };
  }
  if (activeInstall || activeComponentInstall || activeSkillCleanup) {
    return { ok: false, error: 'Another CCTI action is running. Wait for it to finish before replacing a skill from backup.' };
  }
  const [activeMove, restoreMove] = plan.moves;
  const backup = report.backups.get(plan.backupId);
  if (!backup || backup.restorable || activeMove?.kind !== 'archive-active' || restoreMove?.kind !== 'restore-preserved' || backup.path !== restoreMove.source || backup.destination !== restoreMove.destination || !backupSourceWithinCheckedRoot(report, restoreMove.source) || !skillSourceWithinCheckedRoot(report, activeMove.source) || activeMove.source !== restoreMove.destination || await pathExists(activeMove.destination)) {
    return { ok: false, error: 'The active skill or backup list changed. Check this computer again before replacing a skill.' };
  }
  try {
    const [activeManifest, backupManifest] = await Promise.all([
      skillContentManifest(activeMove.source),
      skillContentManifest(restoreMove.source),
    ]);
    if (activeManifest.identity !== activeMove.contentHash || JSON.stringify(activeManifest.files) !== JSON.stringify(activeMove.files) || backupManifest.identity !== restoreMove.contentHash || JSON.stringify(backupManifest.files) !== JSON.stringify(restoreMove.files)) {
      return { ok: false, error: 'The active skill or saved backup changed after the preview. Check this computer again before replacing it.' };
    }
  } catch {
    return { ok: false, error: 'CCTI could not recheck the active skill and saved backup. Nothing was changed.' };
  }
  activeSkillCleanup = true;
  let activeMoved = false;
  try {
    await fs.mkdir(path.dirname(activeMove.destination), { recursive: true });
    await fs.rename(activeMove.source, activeMove.destination);
    activeMoved = true;
    await fs.rename(restoreMove.source, restoreMove.destination);
    report.backups.delete(plan.backupId);
    reviewedSkillBackupReplacementPlans.delete(plan.reviewId);
    return {
      ok: true,
      message: 'CCTI saved the active skill as a new backup and restored the selected saved copy to its original Claude Code location. No files were deleted or merged.',
    };
  } catch {
    if (activeMoved && await pathExists(activeMove.destination) && !await pathExists(activeMove.source)) {
      try {
        await fs.rename(activeMove.destination, activeMove.source);
      } catch {
        return { ok: false, error: 'CCTI stopped after moving the active skill to its new backup and could not safely return it. Review the activity log, then check this computer again. The saved backup was not merged or deleted.' };
      }
    }
    return { ok: false, error: 'CCTI could not complete the reviewed replacement. The active skill was returned to its original location when possible; no files were merged or deleted.' };
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

  if (typeof mainWindow.webContents.setWindowOpenHandler === 'function') {
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
  }
  if (typeof mainWindow.webContents.on === 'function') {
    mainWindow.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
  }

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  ipcMain.handle('catalog:get', readCatalog);
  ipcMain.handle('catalog-details:get', readCatalogDetails);
  ipcMain.handle('components:get', readComponentCatalog);
  ipcMain.handle('claude:status', claudeStatus);
  ipcMain.handle('diagnostics:run', runDiagnostics);
  ipcMain.handle('diagnostics:get-runtime-paths', async () => runtimePathSnapshot());
  ipcMain.handle('diagnostics:export', async (_event, payload) => exportDiagnosticReport(payload || {}));
  ipcMain.handle('updates:get-status', async () => ({ ...updateStatus }));
  ipcMain.handle('updates:check', checkForUpdates);
  ipcMain.handle('updates:download', downloadAvailableUpdate);
  ipcMain.handle('updates:install', restartAndInstallUpdate);
  ipcMain.handle('updates:open-release', openPublishedRelease);
  ipcMain.handle('terminal:get-preference', getTerminalPreference);
  ipcMain.handle('terminal:set-preference', async (_event, payload) => setTerminalPreference(payload || {}));
  ipcMain.handle('terminal:test-preference', testSelectedTerminal);
  ipcMain.handle('claude:run', async (_event, payload) => launchClaudeCode(payload || {}));
  ipcMain.handle('claude:review-removal', knownClaudeRemovalPlan);
  ipcMain.handle('claude:apply-removal', async (_event, payload) => applyKnownClaudeRemoval(payload || {}));
  ipcMain.handle('setup-manager:choose-project', chooseSetupProject);
  ipcMain.handle('setup-manager:discover', async (_event, { projectPath } = {}) => {
    try {
      return await discoverClaudeSetup(projectPath);
    } catch (error) {
      return { ok: false, error: `CCTI could not check the selected project: ${error.message}`, findings: [], duplicates: [], discoveryId: '' };
    }
  });
  ipcMain.handle('setup-manager:choose-custom-source', chooseCustomSource);
  ipcMain.handle('setup-manager:review-custom', async (_event, payload) => reviewCustomAddOn(payload || {}));
  ipcMain.handle('setup-manager:apply-custom', async (_event, payload) => applyCustomAddOn(payload || {}));
  ipcMain.handle('setup-manager:review-cleanup', async (_event, payload) => reviewCleanup(payload || {}));
  ipcMain.handle('setup-manager:apply-cleanup', async (_event, payload) => applyCleanup(payload || {}));
  ipcMain.handle('setup-manager:review-all-duplicates', async (_event, payload) => reviewAllDuplicateSkills(payload || {}));
  ipcMain.handle('setup-manager:apply-all-duplicates', async (_event, payload) => applyAllDuplicateSkills(payload || {}));
  ipcMain.handle('setup-manager:review-all-skill-backups', async (_event, payload) => reviewAllSkillBackups(payload || {}));
  ipcMain.handle('setup-manager:apply-all-skill-backups', async (_event, payload) => applyAllSkillBackups(payload || {}));
  ipcMain.handle('setup-manager:review-skill-backup-replacement', async (_event, payload) => reviewSkillBackupReplacement(payload || {}));
  ipcMain.handle('setup-manager:apply-skill-backup-replacement', async (_event, payload) => applySkillBackupReplacement(payload || {}));

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

  ipcMain.handle('setup:verify', async (_event, payload) => {
    try {
      return await verifySetupStatus(payload || {});
    } catch (error) {
      return { ok: false, error: `CCTI could not check the selected skill scope: ${error.message}` };
    }
  });

  ipcMain.handle('setup:choose-project', async (_event, { createNew } = {}) => {
    if (createNew) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Create a project folder for Claude Code skills',
        defaultPath: path.join(app.getPath('home'), 'claude-code-project'),
        buttonLabel: 'Create project folder',
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      try {
        const projectPath = path.resolve(result.filePath);
        await fs.mkdir(projectPath);
        return { canceled: false, projectPath: await validateSetupProjectFolder(projectPath), created: true };
      } catch (error) {
        return { canceled: false, error: error.code === 'EEXIST'
          ? 'That folder already exists. Choose it with “Use an existing project folder,” or choose a different name.'
          : `CCTI could not create that project folder: ${error.message}` };
      }
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a project folder for Claude Code skills',
      defaultPath: app.getPath('home'),
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    try {
      return { canceled: false, projectPath: await validateSetupProjectFolder(result.filePaths[0]) };
    } catch (error) {
      return { canceled: false, error: error.message };
    }
  });

  ipcMain.handle('setup:complete', async (_event, payload = {}) => {
    const { fresh } = payload;
    if (activeInstall) return { ok: false, error: 'An installation is already running.' };
    let setupScope;
    try {
      setupScope = await resolveCompleteSetupScope(payload);
    } catch (error) {
      return { ok: false, error: `Choose a valid project folder before installing project skills: ${error.message}` };
    }
    activeInstall = true;
    emit('installer:state', { running: true });
    const trackedIds = Object.keys(TRACKED_ITEMS);
    const trackedBefore = await presentTrackedItems(trackedIds, setupScope).catch(() => null);
    try {
      const result = await spawnInstaller(fresh ? 'fresh-complete' : 'complete', [], false, setupScope);
      const after = await claudeStatus();
      if (result.code === 0 && after.installed) {
        emit('installer:output', { stream: 'stdout', text: '[CCTI] Installing supported recommended plugins inside the app…\n' });
        await installReviewedPlugins(completeSetupPluginIds);
      }
      const verification = result.code === 0 && after.installed ? await verifySetupStatus(setupScope) : null;
      return {
        ok: result.code === 0 && after.installed && verification?.ready,
        code: result.code,
        installed: after.installed,
        version: after.version,
        skillScope: setupScope.skillScope,
        projectPath: setupScope.projectPath,
        verification,
        error: result.timedOut
          ? result.error
          : result.code !== 0
          ? `Complete setup stopped with exit code ${result.code}. Review the in-app activity details, then select Complete setup to retry.`
          : !after.installed
            ? 'The installer finished, but CCTI could not verify Claude Code. Select Check installation again or Run Diagnostics inside CCTI before continuing.'
            : verification?.ready
              ? ''
              : verification?.summary || 'CCTI could not verify every recommended setup item. Select Complete setup to retry; no terminal commands are required.',
      };
    } catch (error) {
      return { ok: false, error: error.message, installed: false, version: '' };
    } finally {
      if (trackedBefore) await recordCctiInstalls(trackedIds, trackedBefore, setupScope);
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
    let trackedBefore = null;
    try {
      if (!dryRun) trackedBefore = await presentTrackedItems(selectedIds).catch(() => null);
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
      if (trackedBefore) await recordCctiInstalls(selectedIds, trackedBefore);
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
    const holdsInstallLock = !dryRun;
    if (holdsInstallLock) {
      activeComponentInstall = true;
      emit('component:state', { running: true });
    }
    try {
      const [projectInspection, components] = await Promise.all([
        inspectProjectPackage(projectPath),
        selectedComponents(componentIds),
      ]);
      const packages = components.map((component) => component.packageName);
      if (dryRun) {
        return { ok: true, preview: true, command: `npm install ${packages.join(' ')}`, components, packageJsonPath: projectInspection.packageJsonPath, packageState: projectInspection.packageState };
      }
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
      if (holdsInstallLock) {
        activeComponentInstall = false;
        emit('component:state', { running: false });
      }
    }
  });

  ipcMain.handle('telemetry:report-setup-success', async (_event, payload) => reportAnonymousSetupSuccess(payload));
  ipcMain.handle('inventory:reset-history', async () => resetInventoryHistory());
  ipcMain.handle('inventory:review-resolution', async (_event, payload) => reviewResolution(payload || {}));
  ipcMain.handle('inventory:apply-resolution', async (_event, payload) => applyResolution(payload || {}));
  ipcMain.handle('setup-manager:review-plugin-change', async (_event, payload) => reviewPluginChange(payload));
  ipcMain.handle('setup-manager:apply-plugin-change', async (_event, payload) => applyPluginChange(payload));
  ipcMain.handle('setup-manager:review-project-package-removal', async (_event, payload) => reviewProjectPackageRemoval(payload || {}));
  ipcMain.handle('setup-manager:apply-project-package-removal', async (_event, payload) => applyProjectPackageRemoval(payload || {}));
  ipcMain.handle('setup-manager:review-managed-extras-removal', async () => reviewManagedExtrasRemoval());
  ipcMain.handle('setup-manager:apply-managed-extras-removal', async (_event, payload) => applyManagedExtrasRemoval(payload || {}));
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
