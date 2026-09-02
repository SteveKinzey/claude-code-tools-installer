const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { inspectProjectPackage, prepareProjectPackage, resolveProjectFolder } = require('./project-prerequisites');

let mainWindow;
let activeInstall = false;
let activeComponentInstall = false;
const discoveredSkillCleanup = new Map();
const reviewedCleanupPlans = new Map();
const reviewedPluginChanges = new Map();
const reviewedClaudeRemovalPlans = new Map();
const compassOnlineEndpoint = process.env.COMPASS_ONLINE_ENDPOINT || 'https://claudetool.app/api/trpc/compass.onlineChat?batch=1';
const anonymousSuccessEndpoint = process.env.ANONYMOUS_SUCCESS_ENDPOINT || 'https://claudetool.app/api/trpc/signals.reportSetupSuccess?batch=1';
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
  const paths = [nativeBin, managedNodeBin, process.env.PATH || ''].filter(Boolean);
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function readCatalog() {
  return JSON.parse(await fs.readFile(catalogResource(), 'utf8'));
}

async function readCatalogDetails() {
  return JSON.parse(await fs.readFile(catalogDetailsResource(), 'utf8'));
}

async function installReviewedPlugins(selectedIds) {
  for (const id of selectedIds) {
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
    const result = await runProcess(locator, [command], { cwd: app.getPath('home'), env: claudeProcessEnv() });
    return result.code === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '' : '';
  } catch {
    return '';
  }
}

async function claudeStatus() {
  const home = app.getPath('home');
  try {
    const result = await runProcess('claude', ['--version'], { cwd: home, env: claudeProcessEnv() });
    const version = result.stdout.trim() || result.stderr.trim();
    const installed = result.code === 0 && version.length > 0;
    const installedPath = installed ? await commandLocation('claude') : '';
    return {
      installed,
      version: installed ? version : '',
      path: installedPath,
      reason: installed ? '' : (result.code === 0 ? 'Claude Code did not return a version.' : 'Claude Code could not be run.'),
    };
  } catch {
    return { installed: false, version: '', path: '', reason: 'Claude Code could not be run.' };
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
      const command = `cd ${quotePosix(folder)}; exec ${quotePosix(status.path)}`;
      const result = await runProcess('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`], { cwd: folder, env: claudeProcessEnv() });
      if (result.code !== 0) throw new Error(result.stderr.trim() || 'Mac Terminal did not open.');
      return { ok: true, message: 'Claude Code opened in the Mac Terminal for the selected folder.' };
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

async function listSkillsAt(rootPath, scope) {
  const skillRoot = path.join(rootPath, '.claude', 'skills');
  try {
    const entries = await fs.readdir(skillRoot, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillPath = path.join(skillRoot, entry.name);
      try {
        await fs.access(path.join(skillPath, 'SKILL.md'));
        skills.push({ id: `skill:${skillPath}`, type: 'skill', name: entry.name, scope, path: skillPath, description: 'A saved set of instructions for Claude Code.' });
      } catch {
        // A folder without SKILL.md is not presented as an installed skill.
      }
    }
    return skills;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    return [{ id: `skill-root:${skillRoot}`, type: 'attention', name: 'Skills folder needs attention', scope, path: skillRoot, description: 'The app could not read this skills folder. It did not change anything.' }];
  }
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
  const locations = [
    { root: home, scope: 'Just you', settings: path.join(home, '.claude', 'settings.json') },
    { root: home, scope: 'Just you', settings: path.join(home, '.claude.json') },
  ];
  let resolvedProjectPath = '';
  if (projectPath) {
    resolvedProjectPath = await validateSetupProjectFolder(projectPath);
    locations.push(
      { root: resolvedProjectPath, scope: 'This project', settings: path.join(resolvedProjectPath, '.claude', 'settings.json') },
      { root: resolvedProjectPath, scope: 'Only you in this project', settings: path.join(resolvedProjectPath, '.claude', 'settings.local.json') },
    );
  }

  const findings = await managedPrerequisiteFindings();
  for (const location of locations) {
    findings.push(...await listSkillsAt(location.root, location.scope));
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

  const claude = await claudeStatus();
  if (claude.installed) {
    const [plugins, connections] = await Promise.all([
      runProcess('claude', ['plugin', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
      runProcess('claude', ['mcp', 'list'], { cwd: home, env: claudeProcessEnv() }).catch(() => ({ code: 1, stdout: '' })),
    ]);
    if (plugins.code === 0) plugins.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((name) => findings.push({ id: `plugin-cli:${name}`, type: 'plugin', name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
    if (connections.code === 0) connections.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean).forEach((name) => findings.push({ id: `connection-cli:${name}`, type: 'connection', name, scope: 'Claude Code', path: 'Claude Code', description: 'Reported by Claude Code.' }));
  }

  const grouped = new Map();
  findings.filter((item) => ['skill', 'plugin', 'connection'].includes(item.type)).forEach((item) => {
    const key = `${item.type}:${normalizedFindingName(item.name)}`;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });
  const duplicates = [...grouped.values()].filter((items) => items.length > 1).map((items) => ({
    name: items[0].name,
    type: items[0].type,
    items,
    explanation: 'This name appears in more than one Claude Code location. That can be useful, but review the scopes before keeping more than one copy.',
  }));
  const discoveryId = randomUUID();
  const skills = findings.filter((item) => item.type === 'skill');
  const manageablePlugins = findings.filter((item) => item.type === 'plugin' && ['Just you', 'This project', 'Only you in this project'].includes(item.scope));
  discoveredSkillCleanup.set(discoveryId, {
    createdAt: Date.now(),
    skills: new Map(skills.map((item) => [item.id, { path: item.path, scope: item.scope }])),
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
  if (cleanScope === 'project') {
    try {
      resolvedProject = await validateSetupProjectFolder(projectPath);
    } catch (error) {
      return { ok: false, error: error.message };
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
    if (!info.isDirectory()) throw new Error();
    try {
      await fs.access(path.join(sourcePath, 'SKILL.md'));
      const root = cleanScope === 'user' ? app.getPath('home') : resolvedProject;
      const destination = path.join(root, '.claude', 'skills', path.basename(sourcePath));
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
  if (review.kind === 'skill-copy') {
    try {
      await fs.access(review.destination);
      return { ok: false, error: 'A skill folder with that name already exists in the selected scope. Review your installed items before adding another copy.' };
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
  const userSkillRoot = path.join(app.getPath('home'), '.claude', 'skills');
  const projectSkillRoot = report.projectPath ? path.join(report.projectPath, '.claude', 'skills') : '';
  const parent = path.dirname(source);
  if (parent !== userSkillRoot && parent !== projectSkillRoot) {
    return { ok: false, error: 'For safety, this skill is outside the Claude Code locations checked by this app.' };
  }
  const isProjectSkill = parent === projectSkillRoot;
  const backupRoot = isProjectSkill
    ? path.join(report.projectPath, '.claude', '.setup-my-claude-disabled')
    : path.join(setupManagerDir(), 'disabled-skills');
  const destination = path.join(backupRoot, `${path.basename(source)}-${Date.now()}-${randomUUID().slice(0, 8)}`);
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
  ipcMain.handle('claude:run', async (_event, payload) => launchClaudeCode(payload || {}));
  ipcMain.handle('claude:review-removal', async () => knownClaudeRemovalPlan());
  ipcMain.handle('claude:apply-removal', async (_event, payload) => applyKnownClaudeRemoval(payload || {}));

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

  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
