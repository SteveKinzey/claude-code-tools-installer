const PROJECT_INTERVIEW_QUESTIONS = [
  { key: 'idea', title: 'What do you want to make?', help: 'Use a few plain words. Example: “A simple booking app for dog walkers.”' },
  { key: 'users', title: 'Who is it for?', help: 'Example: “Small local service businesses and their customers.”' },
  { key: 'problem', title: 'What problem should it solve first?', help: 'Example: “People miss appointments because booking is done by phone.”' },
  { key: 'firstVersion', title: 'What should the first version do?', help: 'Keep it small. Example: “Let a customer pick a time and get a confirmation.”' },
  { key: 'constraints', title: 'Any limits or must-haves?', help: 'Example: “Needs sign-in, works on phones, and should launch quickly.”' },
];

function valueOrPlaceholder(value) {
  const cleaned = String(value || '').trim();
  return cleaned || 'Not decided yet.';
}

function findByName(items, matcher) {
  return items.find((item) => matcher.test(String(item.name || '')));
}

function getToolMatcher() {
  if (typeof window !== 'undefined' && window.CCTIToolMatcher) return window.CCTIToolMatcher;
  if (typeof require === 'function') return require('./tool-matcher');
  return { matchTools: () => [] };
}

function createRecommendations(answers, catalog, components, details) {
  const answerText = Object.values(answers).filter((value) => value !== 'Not decided yet.').join(' ');
  const installable = new Map([
    ...catalog.map((item) => [item.id, { scope: 'This computer', packageName: '' }]),
    ...components.map((item) => [item.id, { scope: 'Selected project', packageName: item.packageName || '' }]),
  ]);
  const results = [];
  const add = (id, name, reason, closeTo = null) => {
    const target = installable.get(id);
    // A suggestion the installer cannot act on is worse than no suggestion.
    if (!target || results.some((result) => result.id === id)) return;
    results.push({ id, name, scope: target.scope, reason, closeTo, packageName: target.packageName });
  };

  const planning = findByName(catalog, /^Planning with Files$/i);
  if (planning) add(planning.id, planning.name, 'Helps turn the agreed first version into small, saved work steps.');
  for (const match of getToolMatcher().matchTools(answerText, details)) {
    add(match.id, match.name, match.reason, match.closeTo);
  }
  return results;
}

/** Add interview suggestions to the Step 2 review lists. Nothing is installed here. */
function queueInterviewSuggestions(recommendations, selected, componentPlan) {
  const nextSelected = new Set(selected);
  const nextComponentPlan = new Set(componentPlan);
  let addedTools = 0;
  let addedComponents = 0;
  for (const item of recommendations || []) {
    if (item.scope === 'This computer' && !nextSelected.has(item.id)) {
      nextSelected.add(item.id);
      addedTools += 1;
    } else if (item.scope === 'Selected project' && !nextComponentPlan.has(item.id)) {
      nextComponentPlan.add(item.id);
      addedComponents += 1;
    }
  }
  return { selected: nextSelected, componentPlan: nextComponentPlan, addedTools, addedComponents };
}

function buildProjectInterviewDraft(answers, catalog = [], components = [], details = []) {
  const values = Object.fromEntries(PROJECT_INTERVIEW_QUESTIONS.map((question) => [question.key, valueOrPlaceholder(answers?.[question.key])]));
  const recommendations = createRecommendations(values, catalog, components, details);
  const suggestionLines = recommendations.length
    ? recommendations.map((item) => `- ${item.name} — ${item.scope}. ${item.reason}${item.closeTo ? ` Close alternative: ${item.closeTo.name}. ${item.closeTo.reason}` : ''}${item.packageName ? ` Package: ${item.packageName}.` : ''}`).join('\n')
    : '- No specific CCTI choice matches yet. Start with the project outline, then use Compass to compare options.';
  const draft = `# Draft product requirements\n\nStatus: Private early draft. Nothing has been selected or installed.\n\n## What you want to make\n${values.idea}\n\n## Who it is for\n${values.users}\n\n## First problem to solve\n${values.problem}\n\n## First version\n${values.firstVersion}\n\n## Limits and must-haves\n${values.constraints}\n\n## Open questions to settle before building\n- What is the smallest working first release?\n- What information will the product need to store?\n- Does any feature need an account, payment, outside service, or sign-in?\n\n## Suggested CCTI choices to review\n${suggestionLines}\n\nThese are suggestions only. Review each one, choose what fits, and approve any install separately.`;
  return { draft, recommendations, values };
}

const projectInterviewApi = { PROJECT_INTERVIEW_QUESTIONS, buildProjectInterviewDraft, queueInterviewSuggestions };

if (typeof module !== 'undefined' && module.exports) module.exports = projectInterviewApi;
if (typeof window !== 'undefined') window.CCTIProjectInterview = projectInterviewApi;
