#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readText = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const html = readText('desktop', 'src', 'renderer', 'index.html');
const renderer = readText('desktop', 'src', 'renderer', 'app.js');
const styles = readText('desktop', 'src', 'renderer', 'styles.css');
const preload = readText('desktop', 'src', 'preload.js');
const main = readText('desktop', 'src', 'main.js');
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));
const duplicateUiTestPath = path.join(root, 'scripts', 'test-duplicate-skill-ui.js');
const duplicateUiLauncherPath = path.join(root, 'scripts', 'run-duplicate-skill-ui-test.js');

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const selectorIds = new Set([...renderer.matchAll(/querySelector\(['"]#([^'"]+)['"]\)/g)].map((match) => match[1]));
const missingIds = [...selectorIds].filter((id) => !ids.has(id));
if (missingIds.length) throw new Error(`Renderer selectors with no HTML ID: ${missingIds.join(', ')}.`);

const calledMethods = new Set([...renderer.matchAll(/window\.installer\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
const exposedMethods = new Set([...preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
const missingBridgeMethods = [...calledMethods].filter((method) => !exposedMethods.has(method));
if (missingBridgeMethods.length) throw new Error(`Renderer calls missing preload methods: ${missingBridgeMethods.join(', ')}.`);

const componentCatalogResource = /from": "convex-components\.json",\s*"to": "convex-components\.json"/.test(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));
if (!componentCatalogResource) throw new Error('Component catalog is missing from the packaged resource list.');
const detailCatalogResource = /from": "catalog-details\.json",\s*"to": "catalog-details\.json"/.test(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));
if (!detailCatalogResource) throw new Error('Plain-language catalog details are missing from the packaged resource list.');

for (const channel of [
  'catalog-details:get',
  'diagnostics:run',
  'diagnostics:export',
  'updates:get-status',
  'updates:check',
  'updates:download',
  'updates:install',
  'updates:open-release',
  'terminal:get-preference',
  'terminal:set-preference',
  'terminal:test-preference',
  'claude:run',
  'claude:review-removal',
  'claude:apply-removal',
  'claude:install-only',
  'setup:verify',
  'setup:choose-project',
  'setup:complete',
  'components:get',
  'components:choose-project',
  'components:preview',
  'components:install',
  'telemetry:report-setup-success',
  'compass:status',
  'compass:ask',
  'setup-manager:choose-project',
  'setup-manager:discover',
  'setup-manager:choose-custom-source',
  'setup-manager:review-custom',
  'setup-manager:apply-custom',
  'setup-manager:review-cleanup',
  'setup-manager:apply-cleanup',
  'setup-manager:review-all-duplicates',
  'setup-manager:apply-all-duplicates',
  'setup-manager:review-all-skill-backups',
  'setup-manager:apply-all-skill-backups',
  'setup-manager:review-skill-backup-replacement',
  'setup-manager:apply-skill-backup-replacement',
  'setup-manager:review-plugin-change',
  'setup-manager:apply-plugin-change',
  'app:review-uninstall',
  'app:export-installation-manifest',
  'app:open-manifest-folder',
  'app:get-manifest-verification-command',
  'app:verify-installation-manifest',
  'app:verify-dropped-installation-manifest',
  'app:compare-installation-manifests',
  'app:apply-uninstall',
]) {
  if (!main.includes(`'${channel}'`)) throw new Error(`Missing main-process handler for ${channel}.`);
}

if (!preload.includes('getCatalogDetails: () => ipcRenderer.invoke(\'catalog-details:get\')') || !main.includes('function catalogDetailsResource()') || !main.includes('async function readCatalogDetails()')) {
  throw new Error('Plain-language catalog details must use one read-only main-process and preload lookup.');
}
if (!renderer.includes('state.catalogDetails = new Map(catalogDetails.items.map((item) => [item.id, item]))') || !renderer.includes('function createInlineDetails(item)') || !renderer.includes("summary.textContent = 'See details and example'")) {
  throw new Error('Every compact catalog card must load and expose its plain-language Details control.');
}
if (!renderer.includes('This does not turn it on.') || !renderer.includes('This does not add it to your plan.') || !html.includes('See details and example')) {
  throw new Error('Catalog Details controls must be clearly discoverable and must not look like selection actions.');
}
if (!html.includes('id="toggle-references-button"') || !html.includes('id="references-content"') || !renderer.includes('function renderReferences()') || !renderer.includes('function toggleReferences()')) {
  throw new Error('CCTI must keep optional original sources and technical terms in a dedicated internal References panel.');
}
if (!renderer.includes("link.textContent = 'Open original source (optional)'") || !renderer.includes("toggleReferencesButton.textContent = isOpening ? 'Close References' : 'Open References'")) {
  throw new Error('References must identify outbound source pages as optional and offer a clear close control.');
}
for (const label of ['What it helps with', 'Choose this when', 'Example', 'Where it goes', 'What CCTI does after you approve', 'You may still need to']) {
  if (!renderer.includes(`detailLine('${label}'`)) throw new Error(`The catalog Details view is missing ${label}.`);
}
if (!renderer.includes("boundary.textContent = 'Reading these details does not add this package to your plan or change your project.'") || !renderer.includes('detail.plainPurpose') || !renderer.includes('detail.chooseWhen')) {
  throw new Error('Project-component Details must be explanatory and must stay separate from plan selection.');
}

if (renderer.includes('startBootstrap') || preload.includes('startBootstrap') || main.includes("'bootstrap:start'")) {
  throw new Error('The user-facing Claude Code check must not use the background bootstrap-only path.');
}
if (!renderer.includes('installClaudeOnly') || !main.includes("spawnInstaller('claude-only')") || !main.includes("option('-ClaudeOnly', '--claude-only')")) {
  throw new Error('The in-app Claude-only installation path must wait for the official installer and re-check the result.');
}
if (!html.includes('id="verify-setup-button"') || !html.includes('id="setup-verification-results"') || !renderer.includes('async function verifySetup()') || !renderer.includes('function renderSetupVerification(result)') || !preload.includes("verifySetup: (payload) => ipcRenderer.invoke('setup:verify', payload)") || !main.includes('async function verifySetupStatus(')) {
  throw new Error('CCTI must provide a plain-language, read-only in-app setup verification panel.');
}
if (!main.includes('completeSetupPluginIds') || !main.includes("option('-AppManagedPlugins', '--app-managed-plugins')") || !main.includes('await installReviewedPlugins(completeSetupPluginIds)')) {
  throw new Error('Complete setup must install supported recommended plugins in CCTI instead of making users run terminal commands.');
}
if (!html.includes('id="complete-setup-global-scope-button"') || !html.includes('id="complete-setup-existing-project-button"') || !html.includes('id="complete-setup-new-project-button"') || !html.includes('id="complete-setup-scope-note"') || !renderer.includes('function syncCompleteSetupScope()') || !renderer.includes('async function chooseCompleteSetupProject(createNew)') || !renderer.includes('chooseCompleteSetupProject({ createNew })') || !preload.includes("chooseCompleteSetupProject: (payload) => ipcRenderer.invoke('setup:choose-project', payload)") || !main.includes("ipcMain.handle('setup:choose-project'") || !main.includes('showSaveDialog(mainWindow') || !main.includes('await fs.mkdir(projectPath)') || !main.includes('async function resolveCompleteSetupScope') || !main.includes("option('-SkillScope', '--skill-scope')")) {
  throw new Error('Complete setup must present native global, existing-project, and new-project skill-scope choices before the installer runs.');
}
if (!renderer.includes("skillScope: state.completeSetupScope.skillScope") || !renderer.includes('completeSetupScopeDescription()') || !main.includes('verifySetupStatus(setupScope)')) {
  throw new Error('Complete setup must send the selected skill scope to both installation and verification.');
}
for (const adapter of ['setup-my-claude.ps1', 'setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  const adapterSource = fs.readFileSync(path.join(root, adapter), 'utf8');
  if (!adapterSource.includes('AppManagedPlugins') && !adapterSource.includes('APP_MANAGED_PLUGINS')) {
    throw new Error(`${adapter} must allow CCTI to keep complete-setup plugin installation inside the desktop app.`);
  }
  if (!adapterSource.includes('SkillScope') && !adapterSource.includes('SKILL_SCOPE') || !adapterSource.includes('skills@latest') || !adapterSource.includes('--yes')) {
    throw new Error(`${adapter} must forward the reviewed global or project skill scope to a noninteractive current skills CLI.`);
  }
}
if (!html.includes('id="run-claude-button"') || !html.includes('id="remove-claude-button"') || !renderer.includes('async function runClaudeCode()') || !renderer.includes('async function removeClaudeCode()')) {
  throw new Error('The setup screen must provide visible Run Claude Code and preview-first removal actions.');
}
if (!html.includes('id="terminal-preference-select"') || !html.includes('id="test-terminal-preference-button"') || !html.includes('id="terminal-preference-note"') || !renderer.includes('async function changeTerminalPreference()') || !renderer.includes('async function testTerminalPreference()') || !preload.includes("getTerminalPreference: () => ipcRenderer.invoke('terminal:get-preference')") || !preload.includes("setTerminalPreference: (payload) => ipcRenderer.invoke('terminal:set-preference', payload)") || !preload.includes("testTerminalPreference: () => ipcRenderer.invoke('terminal:test-preference')") || !main.includes('async function setTerminalPreference') || !main.includes('async function testSelectedTerminal()')) {
  throw new Error('CCTI must offer an accessible terminal preference dropdown and test action through narrow main-process IPC handlers.');
}
if (!main.includes("id: 'iterm2'") || !main.includes("id: 'windows-terminal'") || !main.includes("id: 'gnome-terminal'") || !main.includes('Custom terminal commands are not accepted.') || !main.includes('saved ${supportedTerminalOption(preference.storedId)?.label')) {
  throw new Error('The terminal preference must support detected macOS, Windows, and Linux terminals without accepting arbitrary terminal commands or silently ignoring an unavailable selection.');
}
if (!main.includes('async function launchClaudeCode') || !main.includes('async function knownClaudeRemovalPlan') || !main.includes("confirmation !== 'REMOVE CLAUDE CODE'")) {
  throw new Error('Claude Code lifecycle actions must remain fixed, trusted operations with typed removal confirmation.');
}
if (!html.includes('id="run-diagnostics-button"') || !html.includes('id="copy-diagnostics-button"') || !html.includes('id="export-diagnostics-button"') || !renderer.includes('async function runDiagnostics()') || !renderer.includes('async function copyDiagnosticResults()') || !renderer.includes('async function exportDiagnosticResults()')) {
  throw new Error('Desktop settings must provide local diagnostics with copy and text-export controls.');
}
if (!html.includes('id="runtime-path-health"') || !html.includes('id="runtime-path-health-cards"') || !html.includes('id="runtime-path-health-summary"') || !renderer.includes('function renderRuntimePathHealth(snapshot, diagnostic)') || !renderer.includes('function clearRuntimePathHealth()') || !renderer.includes('window.installer.getRuntimePaths()') || !styles.includes('.runtime-path-health-cards') || !preload.includes("getRuntimePaths: async () =>") || !main.includes("ipcMain.handle('diagnostics:get-runtime-paths'")) {
  throw new Error('Desktop diagnostics must display a local-only runtime PATH health summary through the fixed renderer bridge.');
}
if (!html.includes('without displaying or sending your full PATH') || !renderer.includes('No permissions, shell files, or security settings were changed.')) {
  throw new Error('Runtime PATH health must state its local-only privacy boundary and non-mutating behavior.');
}
if (!html.includes('id="check-updates-button"') || !html.includes('id="install-update-button"') || !html.includes('id="update-status-spinner"') || !html.includes('id="update-status-note" class="update-status-note" role="status" aria-live="polite"') || !html.includes('id="release-integrity-alert"') || !html.includes('id="release-integrity-alert-message"') || !styles.includes('[hidden] { display: none !important; }') || !renderer.includes('function displayUpdateStatus(status)') || !renderer.includes('updateStatusNoteElement.textContent = message') || !renderer.includes('updateStatusSpinnerElement.hidden = !busy') || !renderer.includes('releaseReviewAvailable') || !renderer.includes('downloadAvailableUpdate') || !renderer.includes('installDownloadedUpdate') || !renderer.includes('digestAlert.message')) {
  throw new Error('Desktop settings must hide inactive status affordances, provide signed-update progress and explicit restart-to-apply actions, and pair checksum notices with a release-review action.');
}
if (!main.includes('const githubReleaseTimeoutMs = 12_000') || !main.includes('async function getLatestVerifiedReleaseWithFallback()') || !main.includes('No GitHub sign-in is required.') || !main.includes('Check your internet connection, then try again.') || !main.includes('async function runDiagnostics()') || !main.includes('async function exportDiagnosticReport(') || !main.includes('function startBackgroundUpdateChecks()') || !main.includes('async function downloadAvailableUpdate()') || !main.includes('async function restartAndInstallUpdate()') || !main.includes("emit('updates:status'")) {
  throw new Error('Desktop update checks must use a 12-second GitHub timeout, a validated CCTI release fallback, and accessible network guidance that makes clear no GitHub sign-in is required.');
}
if (!main.includes("require('electron-updater')") || !main.includes('getNativeUpdater().downloadUpdate()') || !main.includes('getNativeUpdater().quitAndInstall()') || !main.includes('nativeUpdaterSupported()')) {
  throw new Error('CCTI must use the native signed updater only for supported packaged releases.');
}
for (const protectedItem of ['Claude Desktop app and its data', 'Claude in Chrome, browser profiles, and browser extensions', 'Any unrelated Anthropic app or account']) {
  if (!main.includes(`'${protectedItem}'`)) throw new Error(`Claude Code removal must explicitly protect ${protectedItem}.`);
}
if (!main.includes('if (result.code === 0 && version) return { ok: true, path: candidate, version };')) {
  throw new Error('Claude Code status must reject an empty successful command response.');
}
if (!main.includes("require('./project-prerequisites')") || !main.includes('prepareProjectPackage(projectPath, { dryRun: true })') || !main.includes("spawnInstaller('project-prerequisites')") || !main.includes("const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'")) {
  throw new Error('Project component installs must automatically prepare the safe project manifest and Node runtime before npm runs.');
}
if (main.includes('Choose a JavaScript or TypeScript project folder that contains package.json.')) {
  throw new Error('CCTI must not block an empty selected project folder solely because package.json is missing.');
}
if (!renderer.includes('CCTI will prepare required project files and runtime automatically') || !renderer.includes('Preparing project and installing components')) {
  throw new Error('The project-component UI must clearly describe automatic prerequisite preparation and progress.');
}
if (!html.includes('CCTI prepares Node.js and creates package.json there when it is missing') || !renderer.includes("item.type === 'project-package'") || !renderer.includes("item.scope === 'This computer'")) {
  throw new Error('The UI must distinguish automatic project preparation and global-versus-project inventory scopes.');
}
if (!html.includes('id="start-project-interview-button"') || !html.includes('../project-interview.js') || !renderer.includes('function beginProjectInterview()') || !renderer.includes('function exportProjectPrd()')) {
  throw new Error('CCTI must offer a private optional Project Interview with local draft export.');
}
if (!fs.readFileSync(path.join(root, 'desktop', 'src', 'project-interview.js'), 'utf8').includes('Nothing has been selected or installed.') || !renderer.includes('buildProjectInterviewDraft(interview.answers, state.catalog, state.componentCatalog.components, [...state.catalogDetails.values()])')) {
  throw new Error('The Project Interview must draft job-matched recommendations without selecting or installing tools.');
}
if (!html.includes('../tool-matcher.js') || html.indexOf('../tool-matcher.js') > html.indexOf('../project-interview.js')) {
  throw new Error('The offline tool matcher must load before the Project Interview.');
}
if (!html.includes('id="queue-interview-suggestions-button"') || !html.includes('Add selected to my review list') || !renderer.includes('function queueInterviewSuggestionsFromDraft()') || !renderer.includes('queueInterviewSuggestions(state.projectInterview.result.recommendations, state.selected, state.componentPlan, state.projectInterview.checked)')) {
  throw new Error('Interview suggestions must be added to the existing review lists only through an explicit user action, and only the items the user checked.');
}
if (!html.includes('id="interview-suggestion-groups"') || !renderer.includes('function renderInterviewSuggestions()') || !renderer.includes("checkbox.type = 'checkbox'") || !renderer.includes('reason.textContent = item.reason') || !renderer.includes('.filter((item) => item.prechecked)')) {
  throw new Error('Each interview suggestion must have its own checkbox with its stated reason, and only the Planning with Files baseline may start checked.');
}
if (/function renderInterviewSuggestions\(\)[\s\S]{0,2500}innerHTML/.test(renderer)) {
  throw new Error('Interview suggestions must be rendered with DOM APIs and textContent, never innerHTML.');
}
if (/queueInterviewSuggestionsFromDraft[\s\S]{0,1200}(runInstall|installComponents|runInstallation)\(/.test(renderer)) {
  throw new Error('Adding interview suggestions must never start an install; Step 3 confirmation still applies.');
}
const unusedBridgeMethods = [...exposedMethods].filter((method) => !calledMethods.has(method));
if (unusedBridgeMethods.length > 0) {
  throw new Error(`Preload methods must have a renderer call site: ${unusedBridgeMethods.join(', ')}.`);
}
for (const adapter of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  if (!fs.readFileSync(path.join(root, adapter), 'utf8').includes('--project-prerequisites')) {
    throw new Error(`${adapter} must offer the app-only project prerequisite mode.`);
  }
}
if (!fs.readFileSync(path.join(root, 'setup-my-claude.ps1'), 'utf8').includes('[switch]$ProjectPrerequisites')) {
  throw new Error('The Windows adapter must offer the app-only project prerequisite mode.');
}
if (!html.includes('id="recheck-claude-button"') || !renderer.includes("recheckClaudeButton.addEventListener('click'")) {
  throw new Error('The first-run flow must offer a plain in-app Claude Code recheck.');
}
if (!fs.readFileSync(path.join(root, 'setup-my-claude.sh'), 'utf8').includes('claude_is_ready()') || !fs.readFileSync(path.join(root, 'setup-my-claude-linux.sh'), 'utf8').includes('claude_is_ready()') || !fs.readFileSync(path.join(root, 'setup-my-claude.ps1'), 'utf8').includes('function Test-ClaudeReady')) {
  throw new Error('Every platform adapter must verify that the Claude command runs before reporting it ready.');
}
if (!renderer.includes("setAttribute('role', 'switch')") || !renderer.includes("toggle.textContent = state.selected.has(tool.id) ? 'On' : 'Off'")) {
  throw new Error('Curated extra tools must use clear accessible On/Off controls.');
}
if (!main.includes('const reviewedPluginPlans') || !main.includes('const reviewedPluginIds') || !main.includes('installReviewedPlugins(reviewedPluginIds)') || !main.includes('runProcess(claudeCommand, args')) {
  throw new Error('Supported fixed plugin choices must run inside CCTI after the approved tool plan succeeds.');
}
if (!main.includes('async function installedSkillsMatching') || !main.includes('skillContentManifest') || !main.includes("kind: 'duplicate-skill'") || !main.includes("code: 'already-available'")) {
  throw new Error('Custom skill additions must stop before copying a skill with an existing name or identical verified content in Claude Code.');
}
if (!main.includes('const reviewedCustomAddOnPlans') || !main.includes('function storeCustomAddOnReview') || !main.includes('async function applyCustomAddOn({ reviewId })') || !renderer.includes('applyCustomAddOn({ reviewId: review.reviewId })')) {
  throw new Error('Custom add-on application must consume an opaque reviewed plan instead of editable renderer inputs.');
}
if (!main.includes('mainWindow.webContents.setWindowOpenHandler') || !main.includes("return { action: 'deny' }") || !main.includes("mainWindow.webContents.on('will-navigate'")) {
  throw new Error('External navigation must be denied in-app and opened only through the main-process browser boundary.');
}
if (!main.includes('ok: result.code === 0 && after.installed') || !main.includes('could not verify Claude Code')) {
  throw new Error('Complete setup must not report success unless Claude Code is verified after the installer exits.');
}
if (!main.includes('const holdsInstallLock = !dryRun') || !/if \(holdsInstallLock\) \{\r?\n\s{6}activeComponentInstall = true;/.test(main)) {
  throw new Error('Component installation must acquire its main-process lock before asynchronous project inspection.');
}
if (!main.includes('CCTI could not check the selected project') || !renderer.includes('async function scanSetup()') || !renderer.includes('No valid project folder is selected.')) {
  throw new Error('A missing selected setup-manager project must return a stable actionable error instead of an unhandled renderer rejection.');
}
if (!main.includes("type: 'skill-link-excluded'") || !main.includes('This linked skill remains available to Claude Code.') || !renderer.includes("item.type === 'skill-link-excluded' ? 'Linked skill · Cleanup excluded'") || !renderer.includes('safely excluded from duplicate cleanup') || !styles.includes('.manager-item-skill-link-excluded')) {
  throw new Error('Linked Claude skills must be presented as safe duplicate-cleanup exclusions, not generic attention findings.');
}
if (!main.includes('async function installedClaudePluginIds') || !main.includes('pluginIsInstalled(installedIds, requestedPlugin)')) {
  throw new Error('Curated plugin installs must skip plugins Claude Code already reports as installed.');
}
if (!html.includes('id="duplicate-skill-dialog"') || !html.includes('aria-modal="true"') || !html.includes('id="deduplicate-all-skills-button"') || !html.includes('id="duplicate-backup-preview"') || !html.includes('id="duplicate-backup-preview-list"') || !html.includes('id="restore-all-skill-backups-button"') || !html.includes('id="restore-listed-skill-backups-button"') || !html.includes('id="review-duplicate-skills-button"') || !renderer.includes('async function deduplicateAllSkills()') || !renderer.includes('async function restoreAllSkillBackups()') || !renderer.includes('showDuplicateBackupPreview') || !renderer.includes('focusDuplicateDialog') || !renderer.includes("duplicateSkillDialogElement.addEventListener('close'") || !renderer.includes('reviewAllDuplicates') || !renderer.includes('applyAllDuplicates') || !renderer.includes('reviewAllSkillBackups') || !renderer.includes('applyAllSkillBackups') || !renderer.includes('reviewSkillBackupReplacement') || !renderer.includes('applySkillBackupReplacement') || !renderer.includes('Review replacement from this backup') || !main.includes('duplicateSkillGroups') || !main.includes('listRestorableSkillBackups') || !main.includes('reviewSkillBackupReplacement') || !main.includes('applySkillBackupReplacement') || !main.includes('content-hash') || !renderer.includes('CCTI did not add another copy')) {
  throw new Error('Duplicate skills must use hash-aware detection, accessible exact-file preview, and root-bounded no-overwrite restore actions.');
}
if (!fs.existsSync(duplicateUiTestPath) || !fs.existsSync(duplicateUiLauncherPath) || !desktopPackage.scripts?.['duplicate-skill-ui:check']?.includes('run-duplicate-skill-ui-test.js') || !desktopPackage.scripts?.check?.includes('duplicate-skill-ui:check')) {
  throw new Error('The complete desktop suite must exercise the rendered duplicate-skill dialog and backup prompt.');
}
if (!fs.existsSync(path.join(root, 'scripts', 'test-complete-setup-verification.js')) || !desktopPackage.scripts?.['complete-setup:check']?.includes('test-complete-setup-verification.js') || !desktopPackage.scripts?.check?.includes('complete-setup:check')) {
  throw new Error('The complete desktop suite must verify the app-managed complete setup and its read-only status check.');
}
for (const adapter of ['setup-my-claude.ps1', 'setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  if (!fs.readFileSync(path.join(root, adapter), 'utf8').includes('this skill is already available in Claude Code')) {
    throw new Error(`${adapter} must explain that CCTI skipped an existing Claude Code skill instead of silently adding a duplicate.`);
  }
}
const catalog = fs.readFileSync(path.join(root, 'desktop', 'catalog.json'), 'utf8');
if (!catalog.includes('"prerequisites":["Node.js","Git","Bun"]') || !renderer.includes('CCTI will check and prepare:') || !renderer.includes('Preparing prerequisites and installing selected tools')) {
  throw new Error('Prerequisite-aware CCTI plans must show ordered in-app preparation before the selected extra runs.');
}
for (const adapter of ['setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  const source = fs.readFileSync(path.join(root, adapter), 'utf8');
  if (!source.includes('ensure_bun')) {
    throw new Error(`${adapter} must install Bun before the supported gstack setup path.`);
  }
}
if (!fs.readFileSync(path.join(root, 'setup-my-claude.ps1'), 'utf8').includes("gstack's final setup is Unix-only")) {
  throw new Error('Windows must keep gstack in a clear in-app pause state until its upstream source supports that platform.');
}
if (!main.includes('const reviewedPluginChanges') || !main.includes("['plugin', plan.action, plan.name, '--scope', plan.scope]") || !renderer.includes("reviewAndApplyPluginChange(item, action)")) {
  throw new Error('Installed plugin changes must use a reviewed, scope-aware Electron action rather than renderer shell access.');
}
if (!html.includes('aria-busy="false"') || !renderer.includes("runStatusElement.classList.add('is-loading')") || !renderer.includes("runStatusElement.setAttribute('aria-busy', 'true')") || !fs.readFileSync(path.join(root, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8').includes('prefers-reduced-motion')) {
  throw new Error('Extra installation must show an accessible loading state that respects reduced-motion preferences.');
}
for (const adapter of ['setup-my-claude.ps1', 'setup-my-claude.sh', 'setup-my-claude-linux.sh']) {
  const source = fs.readFileSync(path.join(root, adapter), 'utf8');
  const claudeOnlyOption = adapter.endsWith('.ps1') ? source.includes('-ClaudeOnly') : source.includes('--claude-only');
  if (!claudeOnlyOption || !source.includes('Ensure-ClaudeReady') && !source.includes('ensure_claude_ready')) {
    throw new Error(`${adapter} must support the Claude-only mode and wait for Claude Code readiness.`);
  }
}

if (preload.includes('connectCompass') || preload.includes('disconnectCompass') || main.includes("'compass:connect'") || main.includes("'compass:disconnect'")) {
  throw new Error('Visitor-owned Compass API-key handlers must not be present.');
}

if (!main.includes('reportAnonymousSetupSuccess') || !main.includes("JSON.stringify({ '0': { json: { kind, consent: true } } })") || !html.includes('no name, email, device ID, folder path, tool list, log, or event ID')) {
  throw new Error('Anonymous success telemetry must remain explicit and payload-minimal.');
}

if (!renderer.includes("duplicate.match === 'content-hash'") || !renderer.includes('This is a name overlap only.') || !html.includes('verified duplicates and name overlaps') || !html.includes('Optional private completion count')) {
  throw new Error('The checkup UI must distinguish a verified identical-content duplicate from an informational same-name overlap, and explain optional completion counting in plain language.');
}


if (!html.includes('id="uninstall-app-button"') || !html.includes('id="export-installation-manifest-button"') || !html.includes('id="open-manifest-folder-button"') || !html.includes('id="verify-installation-manifest-button"') || !html.includes('id="copy-manifest-verification-command-button"') || !html.includes('id="manifest-drop-zone"') || !html.includes('id="compare-installation-manifests-button"') || !html.includes('id="uninstall-panel"') || !renderer.includes('async function uninstallApplication()') || !renderer.includes('async function exportInstallationManifest()') || !renderer.includes('async function verifySavedInstallationManifest()') || !renderer.includes('async function verifyDroppedInstallationManifest(file)') || !renderer.includes('async function compareSavedInstallationManifests()') || !renderer.includes('async function copyManifestVerificationCommand()') || !renderer.includes('async function openManifestFolder()')) {
  throw new Error('The desktop app must include a bottom-placed complete app uninstall action with manifest export, drop verification, and verified comparison.');
}
if (!main.includes('async function resolveAppUninstallPlan()') || !main.includes('async function exportInstallationManifest()') || !main.includes('async function openExportedManifestFolder()') || !main.includes('async function verifyInstallationManifest()') || !main.includes('async function verifyDroppedInstallationManifest(') || !main.includes('async function compareInstallationManifests()') || !main.includes('function manifestVerificationCommand()') || !main.includes('createHash') || !main.includes('function postAppUninstallNotification()') || !main.includes('async function applyAppUninstall(') || !main.includes("confirmation !== 'UNINSTALL CCTI'")) {
  throw new Error('App uninstall must export a privacy-safe manifest, verify and compare it locally, require typed acknowledgment, notify post-uninstall cleanup, and leave Claude Code untouched.');
}

console.log(`Desktop UI contract passed: ${selectorIds.size} renderer IDs and ${calledMethods.size} secure bridge methods verified.`);
