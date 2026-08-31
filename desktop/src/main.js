const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let activeInstall = false;
let activeComponentInstall = false;
const discoveredSkillCleanup = new Map();
const reviewedCleanupPlans = new Map();
const reviewedPluginChanges = new Map();
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
  return {
    ...process.env,
    PATH: nativeBin ? `${nativeBin}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
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

async function claudeStatus() {
  const home = app.getPath('home');
  try {
    const result = await runProcess('claude', ['--version'], { cwd: home, env: claudeProcessEnv() });
    const version = result.stdout.trim() || result.stderr.trim();
    return { installed: result.code === 0, version: result.code === 0 ? version : '' };
  } catch {
    return { installed: false, version: '' };
  }
}

function spawnInstaller(mode, selectedIds = [], dryRun = false) {
  const definition = installerDefinition();
  const args = [...definition.args, definition.script];
  const option = (windows, posix) => process.platform === 'win32' ? windows : posix;

  if (mode === 'bootstrap') {
    args.push(option('-NoLaunch', '--no-launch'), option('-BootstrapOnly', '--bootstrap-only'));
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
      env: { ...process.env },
    });

    child.stdout.on('data', (chunk) => emit('installer:output', { stream: 'stdout', text: chunk.toString() }));
    child.stderr.on('data', (chunk) => emit('installer:output', { stream: 'stderr', text: chunk.toString() }));
    child.on('error', (error) => reject(new Error(`Could not start ${definition.command}: ${error.message}`)));
    child.on('close', (code) => resolve({ code, args }));
  });
}

async function validateProjectFolder(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error('Choose a project folder before continuing.');
  }
  const resolved = path.resolve(projectPath);
  const info = await fs.stat(resolved);
  if (!info.isDirectory()) throw new Error('The selected project path is not a folder.');
  try {
    await fs.access(path.join(resolved, 'package.json'));
  } catch {
    throw new Error('Choose a JavaScript or TypeScript project folder that contains package.json.');
  }
  return resolved;
}

async function validateSetupProjectFolder(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new Error('Choose a project folder before continuing.');
  }
  const resolved = path.resolve(projectPath);
  const info = await fs.stat(resolved);
  if (!info.isDirectory()) throw new Error('The selected project path is not a folder.');
  return resolved;
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

  const findings = [];
  for (const location of locations) {
    findings.push(...await listSkillsAt(location.root, location.scope));
    const settings = await readJsonIfPresent(location.settings);
    if (settings.found) findings.push(...settingsFindings(settings.json, location.settings, location.scope));
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
  ipcMain.handle('components:get', readComponentCatalog);
  ipcMain.handle('claude:status', claudeStatus);
  ipcMain.handle('setup-manager:choose-project', chooseSetupProject);
  ipcMain.handle('setup-manager:discover', async (_event, { projectPath } = {}) => discoverClaudeSetup(projectPath));
  ipcMain.handle('setup-manager:choose-custom-source', chooseCustomSource);
  ipcMain.handle('setup-manager:review-custom', async (_event, payload) => reviewCustomAddOn(payload || {}));
  ipcMain.handle('setup-manager:apply-custom', async (_event, payload) => applyCustomAddOn(payload || {}));
  ipcMain.handle('setup-manager:review-cleanup', async (_event, payload) => reviewCleanup(payload || {}));
  ipcMain.handle('setup-manager:apply-cleanup', async (_event, payload) => applyCleanup(payload || {}));

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
      const result = await spawnInstaller('install', selectedIds, Boolean(dryRun));
      if (result.code === 0 && !dryRun) await installReviewedPlugins(selectedIds);
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
      return { canceled: false, projectPath: await validateProjectFolder(result.filePaths[0]) };
    } catch (error) {
      return { canceled: false, error: error.message };
    }
  });

  ipcMain.handle('components:preview', async (_event, { projectPath, componentIds }) => {
    try {
      const [resolvedProjectPath, components] = await Promise.all([
        validateProjectFolder(projectPath),
        selectedComponents(componentIds),
      ]);
      return {
        ok: true,
        projectPath: resolvedProjectPath,
        components,
        command: `npm install ${components.map((component) => component.packageName).join(' ')}`,
        note: 'This installs package dependencies in the selected project only. Component-specific configuration remains a separate, reviewed step.',
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('components:install', async (_event, { projectPath, componentIds, dryRun }) => {
    if (activeComponentInstall) return { ok: false, error: 'A project component installation is already running.' };
    try {
      const [resolvedProjectPath, components] = await Promise.all([
        validateProjectFolder(projectPath),
        selectedComponents(componentIds),
      ]);
      const packages = components.map((component) => component.packageName);
      if (dryRun) {
        return { ok: true, preview: true, command: `npm install ${packages.join(' ')}`, components };
      }
      activeComponentInstall = true;
      emit('component:state', { running: true });
      const child = spawn('npm', ['install', ...packages], { cwd: resolvedProjectPath, windowsHide: true, env: { ...process.env } });
      child.stdout.on('data', (chunk) => emit('component:output', { stream: 'stdout', text: chunk.toString() }));
      child.stderr.on('data', (chunk) => emit('component:output', { stream: 'stderr', text: chunk.toString() }));
      const result = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve({ code }));
      });
      return { ok: result.code === 0, code: result.code, components };
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
