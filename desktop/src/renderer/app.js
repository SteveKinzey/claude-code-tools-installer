const state = {
  catalog: [],
  componentCatalog: { components: [], count: 0 },
  selected: new Set(),
  componentPlan: new Set(),
  componentDetailId: '',
  projectPath: '',
  running: false,
  componentRunning: false,
  claudeInstalled: false,
  claudeApproved: false,
  setupMode: '',
  managerProjectPath: '',
  managerReport: null,
  customAddOnReview: null,
  compass: { online: false, history: [], opened: false },
  anonymousSuccess: { kind: '', reported: false },
};

const catalogElement = document.querySelector('#catalog');
const catalogWorkflowElement = document.querySelector('#catalog-workflow');
const outputElement = document.querySelector('#output');
const summaryElement = document.querySelector('#selection-summary');
const installDescriptionElement = document.querySelector('#install-description');
const installButton = document.querySelector('#install-button');
const runStatusElement = document.querySelector('#run-status');
const bootstrapStatusElement = document.querySelector('#bootstrap-status');
const claudeStatusTextElement = document.querySelector('#claude-status-text');
const setupNoteElement = document.querySelector('#setup-note');
const completeSetupButton = document.querySelector('#complete-setup-button');
const startFreshButton = document.querySelector('#start-fresh-button');
const useExistingButton = document.querySelector('#use-existing-button');
const installClaudeButton = document.querySelector('#install-claude-button');
const browseButton = document.querySelector('#browse-button');
const completionPanelElement = document.querySelector('#completion-panel');
const componentCountElement = document.querySelector('#component-count');
const componentLibraryElement = document.querySelector('#component-library');
const componentLibrarySummaryElement = document.querySelector('#component-library-summary');
const componentSearchElement = document.querySelector('#component-search');
const componentCategoryElement = document.querySelector('#component-category');
const componentResultsElement = document.querySelector('#component-results');
const componentDetailElement = document.querySelector('#component-detail');
const projectPlanSummaryElement = document.querySelector('#project-plan-summary');
const projectPathNoteElement = document.querySelector('#project-path-note');
const componentPlanOutputElement = document.querySelector('#component-plan-output');
const chooseProjectButton = document.querySelector('#choose-project-button');
const previewComponentsButton = document.querySelector('#preview-components-button');
const installComponentsButton = document.querySelector('#install-components-button');
const compassPanelElement = document.querySelector('#compass-panel');
const compassToggleElement = document.querySelector('#compass-toggle');
const compassStatusElement = document.querySelector('#compass-status');
const compassMessagesElement = document.querySelector('#compass-messages');
const compassInputElement = document.querySelector('#compass-input');
const compassConnectFormElement = document.querySelector('#compass-connect-form');
const openCompassConnectButton = document.querySelector('#open-compass-connect');
const setupManagerSummaryElement = document.querySelector('#setup-manager-summary');
const setupManagerResultsElement = document.querySelector('#setup-manager-results');
const managerProjectNoteElement = document.querySelector('#manager-project-note');
const duplicateReviewElement = document.querySelector('#duplicate-review');
const duplicateReviewListElement = document.querySelector('#duplicate-review-list');
const customAddOnSourceElement = document.querySelector('#custom-addon-source');
const customAddOnScopeElement = document.querySelector('#custom-addon-scope');
const customAddOnOutputElement = document.querySelector('#custom-addon-output');
const applyCustomAddOnButton = document.querySelector('#apply-custom-addon-button');
const reportAnonymousSuccessButton = document.querySelector('#report-anonymous-success-button');
const anonymousSuccessMessageElement = document.querySelector('#anonymous-success-message');

function selectedItems() {
  return state.catalog.filter((tool) => state.selected.has(tool.id));
}

function selectedComponents() {
  return state.componentCatalog.components.filter((component) => state.componentPlan.has(component.id));
}

function appendOutput(text, stream = 'stdout') {
  outputElement.textContent += text;
  if (stream === 'stderr') outputElement.classList.add('has-error');
  outputElement.scrollTop = outputElement.scrollHeight;
}

function clearOutput() {
  outputElement.textContent = '';
  outputElement.classList.remove('has-error');
}

function offerAnonymousSuccessCount(kind) {
  state.anonymousSuccess = { kind, reported: false };
  reportAnonymousSuccessButton.disabled = false;
  reportAnonymousSuccessButton.textContent = 'Count this anonymous success';
  anonymousSuccessMessageElement.textContent = '';
  anonymousSuccessMessageElement.className = 'anonymous-success-message';
}

async function reportAnonymousSuccess() {
  if (!state.anonymousSuccess.kind || state.anonymousSuccess.reported) return;
  reportAnonymousSuccessButton.disabled = true;
  anonymousSuccessMessageElement.textContent = 'Sending one anonymous count…';
  anonymousSuccessMessageElement.className = 'anonymous-success-message';
  const result = await window.installer.reportAnonymousSetupSuccess({ kind: state.anonymousSuccess.kind, consent: true });
  if (result.ok) {
    state.anonymousSuccess.reported = true;
    reportAnonymousSuccessButton.textContent = 'Anonymous success counted';
    anonymousSuccessMessageElement.textContent = 'Thank you. Only today’s total for this action type was updated.';
    anonymousSuccessMessageElement.className = 'anonymous-success-message is-success';
  } else {
    reportAnonymousSuccessButton.disabled = false;
    anonymousSuccessMessageElement.textContent = result.error || 'The anonymous count was not sent. Your setup result is unchanged.';
    anonymousSuccessMessageElement.className = 'anonymous-success-message is-error';
  }
}

function revealCatalog() {
  catalogWorkflowElement.classList.remove('is-hidden');
}

function setSetupSelection(mode, note) {
  state.setupMode = mode;
  state.claudeApproved = mode === 'existing' || mode === 'complete';
  setupNoteElement.textContent = note;
  completeSetupButton.classList.toggle('is-selected', mode === 'complete');
  useExistingButton.classList.toggle('is-selected', mode === 'existing');
  browseButton.classList.toggle('is-selected', mode === 'browse');
  revealCatalog();
  updateSummary();
}

function updateSummary() {
  const selected = selectedItems();
  const recommendedCount = selected.filter((tool) => tool.default).length;
  summaryElement.textContent = `${selected.length} of ${state.catalog.length} curated options selected${recommendedCount ? `, including ${recommendedCount} recommended` : ''}.`;

  if (selected.length === 0) {
    installDescriptionElement.textContent = 'Select one or more Claude Code tools to see your plan. Convex Components have a separate project plan.';
  } else if (!state.claudeApproved) {
    installDescriptionElement.textContent = 'Choose “I already have Claude Code” or “Install Claude Code now” in Step 1 before running a tool setup.';
  } else if (document.querySelector('#dry-run').checked) {
    installDescriptionElement.textContent = `Preview the exact changes for ${selected.length} selected option${selected.length === 1 ? '' : 's'}. Nothing will be installed.`;
  } else if (state.setupMode === 'complete') {
    installDescriptionElement.textContent = `Complete setup has selected and installed the ${selected.length} recommended option${selected.length === 1 ? '' : 's'}. You can add or remove tools here later.`;
  } else {
    installDescriptionElement.textContent = `Install ${selected.length} selected option${selected.length === 1 ? '' : 's'}. You will confirm the list before anything changes.`;
  }

  installButton.disabled = state.running || selected.length === 0 || !state.claudeApproved;
  installButton.textContent = document.querySelector('#dry-run').checked ? 'Preview selected changes' : 'Install selected tools';
}

function renderCatalog() {
  const categories = [...new Set(state.catalog.map((tool) => tool.category))];
  catalogElement.replaceChildren();

  for (const category of categories) {
    const tools = state.catalog.filter((tool) => tool.category === category);
    const section = document.createElement('section');
    section.className = 'category-section';

    const heading = document.createElement('div');
    heading.className = 'category-heading';
    const title = document.createElement('h3');
    title.textContent = category;
    const count = document.createElement('span');
    count.textContent = `${tools.length} options`;
    heading.append(title, count);

    const grid = document.createElement('div');
    grid.className = 'tool-grid';
    for (const tool of tools) {
      const card = document.createElement('article');
      card.className = 'tool-card';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tool-toggle';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(state.selected.has(tool.id)));
      toggle.textContent = state.selected.has(tool.id) ? 'On' : 'Off';
      toggle.addEventListener('click', () => {
        if (state.selected.has(tool.id)) state.selected.delete(tool.id);
        else state.selected.add(tool.id);
        renderCatalog();
        updateSummary();
      });

      const body = document.createElement('span');
      body.className = 'tool-card-body';
      const name = document.createElement('span');
      name.className = 'tool-title';
      name.textContent = tool.name;
      if (tool.default) {
        const badge = document.createElement('span');
        badge.className = 'recommended';
        badge.textContent = 'Recommended';
        name.append(badge);
      }
      const classification = document.createElement('span');
      classification.className = 'tool-classification';
      classification.textContent = tool.classification;
      const action = document.createElement('span');
      action.className = 'tool-action';
      action.textContent = tool.action;
      body.append(name, classification, action);
      card.append(body, toggle);
      grid.append(card);
    }
    section.append(heading, grid);
    catalogElement.append(section);
  }
}

async function refreshClaudeStatus() {
  const result = await window.installer.getClaudeStatus();
  state.claudeInstalled = result.installed;
  useExistingButton.disabled = !result.installed;
  startFreshButton.disabled = !result.installed || state.running;
  installClaudeButton.hidden = result.installed;
  installClaudeButton.disabled = result.installed || state.running;

  if (result.installed) {
    const version = result.version ? ` (${result.version})` : '';
    claudeStatusTextElement.textContent = `Yes, Claude Code is installed${version}.`;
    bootstrapStatusElement.textContent = 'Claude Code installed';
    bootstrapStatusElement.className = 'status-chip status-ready';
    if (!state.setupMode) setupNoteElement.textContent = 'You can now choose tools, or choose the recommended setup. Nothing else will change until you choose an action.';
  } else {
    claudeStatusTextElement.textContent = 'No, Claude Code is not installed.';
    bootstrapStatusElement.textContent = 'Claude Code not installed';
    bootstrapStatusElement.className = 'status-chip status-pending';
    if (!state.setupMode) setupNoteElement.textContent = 'Would you like to install Claude Code now? Choose “Yes, install Claude Code.” The app will use the official installer and wait until the check says it is installed.';
  }
  updateSummary();
}

async function installClaudeCode() {
  clearOutput();
  appendOutput('Installing Claude Code through Anthropic’s official installer…\n');
  setupNoteElement.textContent = 'Installing Claude Code now. This app will wait and check that Claude Code is installed before it says the step is finished.';
  runStatusElement.textContent = 'Installing Claude Code';
  installClaudeButton.disabled = true;

  const result = await window.installer.installClaudeOnly();
  installClaudeButton.disabled = false;
  if (result.ok) {
    state.claudeInstalled = true;
    claudeStatusTextElement.textContent = `Yes, Claude Code is installed${result.version ? ` (${result.version})` : ''}.`;
    bootstrapStatusElement.textContent = 'Claude Code installed';
    bootstrapStatusElement.className = 'status-chip status-ready';
    setSetupSelection('existing', 'Claude Code is installed. You can now choose tools in Step 2, or stop here.');
    runStatusElement.textContent = 'Claude Code installed';
  } else {
    state.claudeApproved = false;
    state.setupMode = '';
    bootstrapStatusElement.textContent = 'Claude Code needs attention';
    bootstrapStatusElement.className = 'status-chip status-error';
    setupNoteElement.textContent = 'Claude Code was not installed. Read the activity details, then try “Yes, install Claude Code” again.';
    appendOutput(`${result.error || 'Claude Code installation could not be completed.'}\n`, 'stderr');
    runStatusElement.textContent = 'Needs attention';
  }
  updateSummary();
}

async function runCompleteSetup(fresh = false) {
  const selected = selectedItems();
  const recommendedNames = selected.map((tool) => `• ${tool.name}`).join('\n');
  if (fresh) {
    const confirmation = window.prompt('Start fresh permanently deletes local Claude Code versions, settings, session history, MCP configuration, the local tool stack, and this app-managed Node.js runtime.\n\nType DELETE CLAUDE DATA to continue.');
    if (confirmation !== 'DELETE CLAUDE DATA') return;
  } else if (!window.confirm(`Complete setup will automatically install missing prerequisites, Claude Code, and this recommended tool set:\n\n${recommendedNames}\n\nClaude Code will open after installation so you can sign in. Plugin marketplace commands remain in a checklist for your review.`)) {
    return;
  }

  clearOutput();
  appendOutput(`${fresh ? 'Starting clean reinstall' : 'Starting complete setup'}…\n`);
  setSetupSelection('complete', fresh ? 'Removing local Claude Code data, then rebuilding a clean recommended setup.' : 'Installing prerequisites, Claude Code, and the recommended tool stack.');
  runStatusElement.textContent = fresh ? 'Starting fresh' : 'Complete setup running';
  completeSetupButton.disabled = true;
  startFreshButton.disabled = true;
  const result = await window.installer.runCompleteSetup({ fresh });
  completeSetupButton.disabled = false;
  if (result.ok) {
    state.claudeInstalled = result.installed;
    claudeStatusTextElement.textContent = `Claude Code is ready${result.version ? ` (${result.version})` : ''}.`;
    bootstrapStatusElement.textContent = 'Complete setup finished';
    bootstrapStatusElement.className = 'status-chip status-ready';
    setupNoteElement.textContent = 'Complete setup is finished. Claude Code has opened for sign-in; the recommended local tool stack is ready.';
    runStatusElement.textContent = 'Complete setup finished';
    completionPanelElement.classList.remove('is-hidden');
    offerAnonymousSuccessCount('complete_setup');
  } else {
    state.claudeApproved = false;
    state.setupMode = '';
    bootstrapStatusElement.textContent = 'Setup needs attention';
    bootstrapStatusElement.className = 'status-chip status-error';
    setupNoteElement.textContent = 'Complete setup stopped. Read the activity details, resolve the shown prerequisite issue, then run it again.';
    appendOutput(`${result.error || `Setup stopped with exit code ${result.code}`}.\n`, 'stderr');
    runStatusElement.textContent = 'Needs attention';
  }
  await refreshClaudeStatus();
}

async function runInstallation() {
  const selected = selectedItems();
  const preview = document.querySelector('#dry-run').checked;
  const action = preview ? 'preview' : 'install';
  const names = selected.map((tool) => `• ${tool.name}`).join('\n');
  const claudeMessage = 'Claude Code is installed. Then the app will apply your selected tools.';
  if (!window.confirm(`Confirm ${action} for ${selected.length} option${selected.length === 1 ? '' : 's'}?\n\n${names}\n\n${claudeMessage}\n\nPlugin commands and credential-sensitive tools are saved as clear follow-up steps instead of being silently configured.`)) return;

  clearOutput();
  appendOutput(`${preview ? 'Previewing' : 'Installing'} ${selected.length} selected option${selected.length === 1 ? '' : 's'}…\n`);
  const result = await window.installer.runInstall({ selectedIds: selected.map((tool) => tool.id), dryRun: preview });
  if (result.ok) {
    appendOutput(`\n${preview ? 'Preview' : 'Installation'} completed successfully.\n`);
    runStatusElement.textContent = preview ? 'Preview complete' : 'Installation complete';
    if (!preview) completionPanelElement.classList.remove('is-hidden');
    if (!preview) offerAnonymousSuccessCount('selected_tools');
  } else {
    appendOutput(`\nThe installer stopped: ${result.error || `exit code ${result.code}`}. Review the activity details above.\n`, 'stderr');
    runStatusElement.textContent = 'Needs attention';
  }
}

function chooseBy(predicate) {
  state.selected = new Set(state.catalog.filter(predicate).map((tool) => tool.id));
  renderCatalog();
  updateSummary();
}

function populateComponentCategories() {
  const categories = [...new Set(state.componentCatalog.components.map((component) => component.category))].sort((a, b) => a.localeCompare(b));
  componentCategoryElement.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All categories';
  componentCategoryElement.append(allOption);
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    componentCategoryElement.append(option);
  }
}

function filteredComponents() {
  const term = componentSearchElement.value.trim().toLowerCase();
  const category = componentCategoryElement.value;
  return state.componentCatalog.components.filter((component) => {
    const haystack = `${component.name} ${component.packageName} ${component.category}`.toLowerCase();
    return (!term || haystack.includes(term)) && (!category || component.category === category);
  });
}

function renderComponentDetail() {
  componentDetailElement.replaceChildren();
  const component = state.componentCatalog.components.find((item) => item.id === state.componentDetailId);
  if (!component) {
    const heading = document.createElement('h3');
    heading.textContent = 'Select a component';
    const copy = document.createElement('p');
    copy.textContent = 'Choose Details to see its package identity and project requirements.';
    componentDetailElement.append(heading, copy);
    return;
  }
  const heading = document.createElement('h3');
  heading.textContent = component.name;
  const summary = document.createElement('p');
  summary.textContent = `${component.category} · version ${component.version || 'current directory version'}`;
  const packageLabel = document.createElement('p');
  packageLabel.className = 'package-identity';
  packageLabel.textContent = component.packageName;
  const install = document.createElement('p');
  install.textContent = `Project command: ${component.installCommand}`;
  const boundary = document.createElement('p');
  boundary.className = 'detail-boundary';
  boundary.textContent = 'This package belongs in one Convex project. You will choose that folder and confirm the command before it runs.';
  const source = document.createElement('p');
  source.className = 'source-url';
  source.textContent = `Source: ${component.sourceUrl}`;
  componentDetailElement.append(heading, summary, packageLabel, install, boundary, source);
}

function updateProjectPlan() {
  const planned = selectedComponents();
  projectPlanSummaryElement.textContent = planned.length
    ? `${planned.length} component${planned.length === 1 ? '' : 's'} in this project plan: ${planned.map((component) => component.name).join(', ')}.`
    : 'No Convex Components are in your project plan yet.';
  projectPathNoteElement.textContent = state.projectPath ? `Project folder: ${state.projectPath}` : 'No project folder selected.';
  const enabled = planned.length > 0 && Boolean(state.projectPath) && !state.componentRunning;
  previewComponentsButton.disabled = !enabled;
  installComponentsButton.disabled = !enabled;
  chooseProjectButton.disabled = state.componentRunning;
}

function renderComponents() {
  const matches = filteredComponents();
  componentResultsElement.replaceChildren();
  componentLibrarySummaryElement.textContent = `${matches.length} of ${state.componentCatalog.count} verified components shown. Add only the packages that belong in the project you choose.`;

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-results';
    empty.textContent = 'No components match that search. Try a package name, a use case, or another category.';
    componentResultsElement.append(empty);
  }

  for (const component of matches) {
    const card = document.createElement('article');
    card.className = 'component-card';
    const content = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = component.name;
    const meta = document.createElement('p');
    meta.textContent = `${component.category} · ${component.packageName}`;
    const description = document.createElement('p');
    description.textContent = `Install in a chosen project: ${component.installCommand}`;
    content.append(title, meta, description);

    const actions = document.createElement('div');
    actions.className = 'component-card-actions';
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'button button-ghost';
    details.textContent = 'Details';
    details.addEventListener('click', () => {
      state.componentDetailId = component.id;
      renderComponentDetail();
    });
    const addLabel = document.createElement('label');
    addLabel.className = 'component-select';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.componentPlan.has(component.id);
    input.addEventListener('change', () => {
      if (input.checked) state.componentPlan.add(component.id);
      else state.componentPlan.delete(component.id);
      updateProjectPlan();
    });
    const labelText = document.createElement('span');
    labelText.textContent = 'Add to project plan';
    addLabel.append(input, labelText);
    actions.append(details, addLabel);
    card.append(content, actions);
    componentResultsElement.append(card);
  }
  renderComponentDetail();
  updateProjectPlan();
}

function openComponentLibrary() {
  componentLibraryElement.classList.remove('is-hidden');
  renderComponents();
  componentLibraryElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function chooseProjectFolder() {
  const result = await window.installer.chooseComponentProject();
  if (result.canceled) return;
  if (result.error) {
    componentPlanOutputElement.textContent = result.error;
    componentPlanOutputElement.classList.add('has-error');
    return;
  }
  componentPlanOutputElement.classList.remove('has-error');
  state.projectPath = result.projectPath;
  componentPlanOutputElement.textContent = 'Project selected. Preview the exact package command before installing anything.';
  updateProjectPlan();
}

async function previewComponentPlan() {
  const result = await window.installer.previewComponents({ projectPath: state.projectPath, componentIds: [...state.componentPlan] });
  if (!result.ok) {
    componentPlanOutputElement.textContent = result.error;
    componentPlanOutputElement.classList.add('has-error');
    return;
  }
  componentPlanOutputElement.classList.remove('has-error');
  componentPlanOutputElement.textContent = `Project: ${result.projectPath}\n\nExact command:\n${result.command}\n\n${result.note}`;
}

async function installProjectComponents() {
  const preview = await window.installer.previewComponents({ projectPath: state.projectPath, componentIds: [...state.componentPlan] });
  if (!preview.ok) {
    componentPlanOutputElement.textContent = preview.error;
    componentPlanOutputElement.classList.add('has-error');
    return;
  }
  const names = preview.components.map((component) => `• ${component.name} (${component.packageName})`).join('\n');
  if (!window.confirm(`Install ${preview.components.length} Convex Component${preview.components.length === 1 ? '' : 's'} in this project only?\n\n${names}\n\nProject folder:\n${preview.projectPath}\n\nExact command:\n${preview.command}\n\nThe packages may require follow-up configuration. Nothing else on this computer will be changed.`)) return;
  componentPlanOutputElement.classList.remove('has-error');
  componentPlanOutputElement.textContent = `Installing project dependencies in ${preview.projectPath}…`;
  const result = await window.installer.installComponents({ projectPath: state.projectPath, componentIds: [...state.componentPlan], dryRun: false });
  if (result.ok) {
    componentPlanOutputElement.textContent = `Project component installation completed. Review each component’s configuration before using it.`;
    completionPanelElement.classList.remove('is-hidden');
    offerAnonymousSuccessCount('project_components');
  } else {
    componentPlanOutputElement.textContent = result.error || `The component installer stopped with exit code ${result.code}.`;
    componentPlanOutputElement.classList.add('has-error');
  }
}

function renderSetupManager(report) {
  state.managerReport = report;
  const items = Array.isArray(report?.findings) ? report.findings : [];
  const duplicates = Array.isArray(report?.duplicates) ? report.duplicates : [];
  const skills = items.filter((item) => item.type === 'skill').length;
  const plugins = items.filter((item) => item.type === 'plugin').length;
  const connections = items.filter((item) => item.type === 'connection').length;
  setupManagerSummaryElement.textContent = items.length
    ? `Found ${skills} skill${skills === 1 ? '' : 's'}, ${plugins} add-on${plugins === 1 ? '' : 's'}, and ${connections} saved connection${connections === 1 ? '' : 's'}. This list is a checkup only. Nothing was changed.`
    : 'Nothing was found in the places checked. That is okay. You can still add tools or your own skill when ready.';
  setupManagerResultsElement.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-results';
    empty.textContent = 'No Claude Code skills, add-ons, or saved connections were found in the checked locations.';
    setupManagerResultsElement.append(empty);
  }
  for (const item of items.slice(0, 80)) {
    const card = document.createElement('article');
    card.className = `manager-item manager-item-${item.type}`;
    const title = document.createElement('h3');
    title.textContent = item.name;
    const meta = document.createElement('p');
    meta.textContent = `${item.type === 'skill' ? 'Skill' : item.type === 'plugin' ? 'Add-on' : item.type === 'connection' ? 'Saved connection' : 'Needs attention'} · ${item.scope}`;
    const copy = document.createElement('p');
    copy.textContent = item.description;
    const location = document.createElement('p');
    location.className = 'manager-path';
    location.textContent = item.path;
    card.append(title, meta, copy, location);
    if (item.type === 'plugin' && ['Just you', 'This project', 'Only you in this project'].includes(item.scope)) {
      const controls = document.createElement('div');
      controls.className = 'plugin-controls';
      for (const action of ['enable', 'disable']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = action === 'enable' ? 'button button-secondary' : 'button button-ghost';
        button.textContent = action === 'enable' ? 'Turn on' : 'Turn off';
        button.addEventListener('click', () => reviewAndApplyPluginChange(item, action));
        controls.append(button);
      }
      card.append(controls);
    }
    setupManagerResultsElement.append(card);
  }
  if (items.length > 80) {
    const more = document.createElement('p');
    more.className = 'empty-results';
    more.textContent = `Showing the first 80 of ${items.length} items. Narrow the check by choosing one project folder.`;
    setupManagerResultsElement.append(more);
  }
  duplicateReviewListElement.replaceChildren();
  duplicateReviewElement.classList.toggle('is-hidden', duplicates.length === 0);
  for (const duplicate of duplicates) {
    const group = document.createElement('article');
    group.className = 'duplicate-group';
    const heading = document.createElement('h4');
    heading.textContent = duplicate.name;
    const copy = document.createElement('p');
    copy.textContent = duplicate.explanation;
    group.append(heading, copy);
    for (const item of duplicate.items) {
      const row = document.createElement('div');
      row.className = 'duplicate-row';
      const label = document.createElement('span');
      label.textContent = `${item.scope}: ${item.path}`;
      row.append(label);
      if (item.type === 'skill' && item.path !== 'Claude Code') {
        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'button button-ghost';
        reviewButton.textContent = 'Review backup move';
        reviewButton.addEventListener('click', () => reviewAndApplyCleanup(item));
        row.append(reviewButton);
      }
      group.append(row);
    }
    duplicateReviewListElement.append(group);
  }
}

async function scanSetup() {
  setupManagerSummaryElement.textContent = 'Checking the selected Claude Code locations. Nothing is being changed.';
  setupManagerResultsElement.replaceChildren();
  duplicateReviewElement.classList.add('is-hidden');
  const result = await window.installer.discoverSetup({ projectPath: state.managerProjectPath });
  renderSetupManager(result);
}

async function chooseManagerProject() {
  const result = await window.installer.chooseSetupManagerProject();
  if (result.canceled) return;
  state.managerProjectPath = result.projectPath;
  managerProjectNoteElement.textContent = `Also checking this project: ${result.projectPath}`;
  await scanSetup();
}

async function reviewAndApplyCleanup(finding) {
  const discoveryId = state.managerReport?.discoveryId;
  const review = await window.installer.reviewCleanup({ discoveryId, findingId: finding.id });
  if (!review.ok) {
    appendOutput(`[Checkup] ${review.error}\n`, 'stderr');
    return;
  }
  if (!window.confirm(`Move this skill to a backup folder?\n\n${finding.name}\n\nCurrent location:\n${review.source}\n\nBackup location:\n${review.destination}\n\nThis does not delete the skill. No other settings will change.`)) return;
  const result = await window.installer.applyCleanup({ reviewId: review.reviewId });
  if (!result.ok) {
    appendOutput(`[Checkup] ${result.error}\n`, 'stderr');
    return;
  }
  appendOutput(`[Checkup] ${result.message}\n`);
  await scanSetup();
}

async function chooseCustomSource() {
  const result = await window.installer.chooseCustomSource();
  if (!result.canceled) customAddOnSourceElement.value = result.source;
}

async function reviewAndApplyPluginChange(finding, action) {
  const review = await window.installer.reviewPluginChange({ discoveryId: state.managerReport?.discoveryId, findingId: finding.id, action });
  if (!review.ok) return appendOutput(`[Checkup] ${review.error}\n`, 'stderr');
  if (!window.confirm(`${review.description}\n\nAdd-on: ${review.name}\nScope: ${review.scope}\n\nNothing else will change.`)) return;
  const result = await window.installer.applyPluginChange({ reviewId: review.reviewId });
  appendOutput(`[Checkup] ${result.ok ? result.message : result.error}\n`, result.ok ? 'stdout' : 'stderr');
  if (result.ok) await scanSetup();
}

async function reviewCustomAddOn() {
  const result = await window.installer.reviewCustomAddOn({
    source: customAddOnSourceElement.value,
    scope: customAddOnScopeElement.value,
    projectPath: state.managerProjectPath,
  });
  if (!result.ok) {
    state.customAddOnReview = null;
    applyCustomAddOnButton.disabled = true;
    customAddOnOutputElement.textContent = result.error;
    customAddOnOutputElement.classList.add('has-error');
    return;
  }
  state.customAddOnReview = result;
  customAddOnOutputElement.classList.remove('has-error');
  customAddOnOutputElement.textContent = `${result.description}\n\n${result.command ? `Exact command:\n${result.command}` : `Copy from:\n${result.source}\n\nCopy to:\n${result.destination}`}`;
  applyCustomAddOnButton.disabled = false;
}

async function applyCustomAddOn() {
  if (!state.customAddOnReview) return;
  const review = state.customAddOnReview;
  if (!window.confirm(`Add this reviewed ${review.kind === 'skill-copy' ? 'skill' : 'marketplace'}?\n\n${review.description}\n\n${review.command || `${review.source}\n→\n${review.destination}`}\n\nNothing else will change.`)) return;
  const result = await window.installer.applyCustomAddOn({
    source: customAddOnSourceElement.value,
    scope: customAddOnScopeElement.value,
    projectPath: state.managerProjectPath,
  });
  customAddOnOutputElement.textContent = result.ok ? result.message : result.error;
  customAddOnOutputElement.classList.toggle('has-error', !result.ok);
  if (result.ok) {
    applyCustomAddOnButton.disabled = true;
    state.customAddOnReview = null;
    await scanSetup();
  }
}

function addCompassMessage(role, text) {
  const message = document.createElement('article');
  message.className = `compass-message compass-message-${role}`;
  const label = document.createElement('strong');
  label.textContent = role === 'user' ? 'You' : 'Compass';
  const copy = document.createElement('p');
  copy.textContent = text;
  message.append(label, copy);
  compassMessagesElement.append(message);
  compassMessagesElement.scrollTop = compassMessagesElement.scrollHeight;
}

function catalogMatches(term) {
  const normalized = term.toLowerCase();
  return [
    ...state.catalog.map((item) => ({ ...item, type: 'Claude Code tool' })),
    ...state.componentCatalog.components.map((item) => ({ ...item, type: 'Convex Component', action: item.installCommand })),
  ].filter((item) => `${item.name} ${item.category} ${item.classification || ''} ${item.packageName || ''} ${item.action || ''}`.toLowerCase().includes(normalized));
}

function privateCompassReply(question) {
  const lower = question.toLowerCase();
  const tools = selectedItems();
  const components = selectedComponents();
  if (/compare|overlap|versus|\bvs\b/.test(lower)) {
    if (tools.length + components.length < 2) return 'Pick at least two tools or components first, then I can compare their purpose, where they install, and whether they overlap.';
    const entries = [
      ...tools.map((tool) => `${tool.name}: ${tool.classification}; ${tool.action.toLowerCase()}`),
      ...components.map((component) => `${component.name}: Convex ${component.category} component installed as ${component.packageName} in your chosen project`),
    ];
    return `Here is the useful distinction: ${entries.join(' | ')}. Claude Code tools change your local coding workflow. Convex Components are project packages, so they do not overlap with a local tool merely because their names sound similar.`;
  }
  if (/real.?time|backend|database|convex|chat|multiplayer|auth/.test(lower)) {
    const convexSelected = state.selected.has('convex');
    return `${convexSelected ? 'You already selected' : 'Consider selecting'} Convex for Claude Code if you want Claude to understand and work with a Convex project. Then open the Convex Components Library for the app capability itself. For example, AI Agent suits chat and agent workflows, Better Auth suits authentication, Presence suits live user status, and Workflow suits durable multi-step jobs. Which of those outcomes matters most?`;
  }
  if (/start|begin|new|simple|starter|first/.test(lower)) {
    const recommended = state.catalog.filter((tool) => tool.default).map((tool) => tool.name);
    return `For a low-confusion start, use the recommended setup: ${recommended.join(', ')}. Add Convex only if you are building a Convex-backed app. You can always add more later. Are you mainly improving Claude Code for existing projects, or starting a new app?`;
  }
  if (/credential|token|api key|account|secret/.test(lower)) {
    return 'Compass will flag credential-sensitive choices before installation. This installer never fills in service credentials for you. Select the tool or component first, then review its follow-up setup in the checklist or its project plan.';
  }
  const exactMatches = catalogMatches(lower).slice(0, 4);
  if (exactMatches.length) {
    return `I found ${exactMatches.map((item) => `${item.name} (${item.type})`).join(', ')}. Ask me to compare them, or tell me what you want to build and I will narrow the choices.`;
  }
  return 'I can help with the verified tool and component catalog, but that question needs more open-ended context than the private guide has. If you want, choose “Ask connected AI” below. What are you trying to build or improve?';
}

async function askCompass(question) {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) return;
  addCompassMessage('user', cleanQuestion);
  state.compass.history.push({ role: 'user', content: cleanQuestion });
  compassInputElement.value = '';

  if (!state.compass.online) {
    const answer = privateCompassReply(cleanQuestion);
    addCompassMessage('assistant', answer);
    state.compass.history.push({ role: 'assistant', content: answer });
    return;
  }

  compassInputElement.disabled = true;
  const result = await window.installer.askCompass({
    message: cleanQuestion,
    history: state.compass.history.slice(0, -1),
    selectedToolIds: [...state.selected],
    selectedComponentIds: [...state.componentPlan],
  });
  compassInputElement.disabled = false;
  const answer = result.ok ? result.answer : result.error;
  addCompassMessage('assistant', answer);
  state.compass.history.push({ role: 'assistant', content: answer });
}

function updateCompassConnectionUi() {
  if (state.compass.online) {
    compassStatusElement.textContent = 'Online Compass · free site help · no key needed';
    openCompassConnectButton.textContent = 'Use private Compass instead';
    compassConnectFormElement.classList.add('is-hidden');
  } else {
    compassStatusElement.textContent = 'Private Compass · uses this verified catalog';
    openCompassConnectButton.textContent = 'Need a deeper answer? Ask online Compass';
  }
}

function openCompass() {
  compassPanelElement.classList.remove('is-hidden');
  compassToggleElement.classList.add('is-hidden');
  if (!state.compass.opened) {
    state.compass.opened = true;
    addCompassMessage('assistant', 'I’m Compass. I start privately with this verified catalog and can help you choose, compare, and understand the difference between a Claude Code tool and a Convex Component. What are you trying to build or improve?');
  }
  compassInputElement.focus();
}

function minimizeCompass() {
  compassPanelElement.classList.add('is-hidden');
  compassToggleElement.classList.remove('is-hidden');
}

completeSetupButton.addEventListener('click', () => runCompleteSetup(false));
reportAnonymousSuccessButton.addEventListener('click', reportAnonymousSuccess);
startFreshButton.addEventListener('click', () => runCompleteSetup(true));
useExistingButton.addEventListener('click', () => {
  setSetupSelection('existing', 'Claude Code is already available. Choose your tools in Step 2.');
  runStatusElement.textContent = 'Ready to choose tools';
});
installClaudeButton.addEventListener('click', installClaudeCode);
browseButton.addEventListener('click', () => {
  setSetupSelection('browse', 'You are browsing only. No changes will be made until you choose a Claude Code setup option.');
  runStatusElement.textContent = 'Browsing options only';
});
document.querySelector('#recommended-button').addEventListener('click', () => chooseBy((tool) => tool.default));
document.querySelector('#all-button').addEventListener('click', () => chooseBy(() => true));
document.querySelector('#clear-button').addEventListener('click', () => chooseBy(() => false));
document.querySelector('#dry-run').addEventListener('change', updateSummary);
document.querySelector('#install-button').addEventListener('click', runInstallation);
document.querySelector('#open-components-library').addEventListener('click', openComponentLibrary);
document.querySelector('#close-components-library').addEventListener('click', () => componentLibraryElement.classList.add('is-hidden'));
componentSearchElement.addEventListener('input', renderComponents);
componentCategoryElement.addEventListener('change', renderComponents);
chooseProjectButton.addEventListener('click', chooseProjectFolder);
previewComponentsButton.addEventListener('click', previewComponentPlan);
installComponentsButton.addEventListener('click', installProjectComponents);
document.querySelector('#scan-setup-button').addEventListener('click', scanSetup);
document.querySelector('#choose-manager-project-button').addEventListener('click', chooseManagerProject);
document.querySelector('#choose-custom-source-button').addEventListener('click', chooseCustomSource);
document.querySelector('#review-custom-addon-button').addEventListener('click', reviewCustomAddOn);
applyCustomAddOnButton.addEventListener('click', applyCustomAddOn);
compassToggleElement.addEventListener('click', openCompass);
document.querySelector('#compass-minimize').addEventListener('click', minimizeCompass);
document.querySelector('#compass-form').addEventListener('submit', (event) => {
  event.preventDefault();
  askCompass(compassInputElement.value);
});
document.querySelectorAll('.prompt-chip').forEach((button) => button.addEventListener('click', () => askCompass(button.dataset.compassPrompt || '')));
openCompassConnectButton.addEventListener('click', async () => {
  if (state.compass.online) {
    state.compass.online = false;
    updateCompassConnectionUi();
    addCompassMessage('assistant', 'Private Compass is back on. Your next question will be answered from this verified catalog first.');
    return;
  }
  compassConnectFormElement.classList.remove('is-hidden');
});
document.querySelector('#cancel-compass-connect').addEventListener('click', () => compassConnectFormElement.classList.add('is-hidden'));
document.querySelector('#connect-compass-button').addEventListener('click', async () => {
  state.compass.online = true;
  updateCompassConnectionUi();
  addCompassMessage('assistant', 'Online Compass is ready. Your next question will be sent for a deeper answer. It is free to use and will not install or change anything.');
});

window.installer.onOutput(({ stream, text }) => appendOutput(text, stream));
window.installer.onState(({ running }) => {
  state.running = running;
  if (running) {
    runStatusElement.textContent = 'Installing selected extras…';
    runStatusElement.classList.add('is-loading');
    runStatusElement.setAttribute('aria-busy', 'true');
  } else {
    runStatusElement.classList.remove('is-loading');
    runStatusElement.setAttribute('aria-busy', 'false');
  }
  completeSetupButton.disabled = running;
  startFreshButton.disabled = running || !state.claudeInstalled;
  installClaudeButton.disabled = running || state.claudeInstalled;
  updateSummary();
});
window.installer.onComponentOutput(({ stream, text }) => appendOutput(`[Project components] ${text}`, stream));
window.installer.onComponentState(({ running }) => {
  state.componentRunning = running;
  if (running) runStatusElement.textContent = 'Installing project components';
  else if (runStatusElement.textContent === 'Installing project components') runStatusElement.textContent = 'Project component plan finished';
  updateProjectPlan();
});

(async () => {
  try {
    const [catalog, componentCatalog, compassStatus] = await Promise.all([
      window.installer.getCatalog(),
      window.installer.getComponentCatalog(),
      window.installer.getCompassStatus(),
    ]);
    state.catalog = catalog;
    state.componentCatalog = componentCatalog;
    state.compass.online = false;
    componentCountElement.textContent = componentCatalog.count;
    populateComponentCategories();
    chooseBy((tool) => tool.default);
    updateCompassConnectionUi();
    await refreshClaudeStatus();
  } catch (error) {
    bootstrapStatusElement.textContent = 'App setup failed';
    bootstrapStatusElement.className = 'status-chip status-error';
    claudeStatusTextElement.textContent = 'The app could not check Claude Code.';
    appendOutput(`${error.message}\n`, 'stderr');
  }
})();
