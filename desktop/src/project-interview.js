const PROJECT_INTERVIEW_QUESTIONS = [
  { key: 'idea', title: 'What do you want to make?', help: 'Use a few plain words. Example: “A simple booking app for dog walkers.”' },
  { key: 'users', title: 'Who is it for?', help: 'Example: “Small local service businesses and their customers.”' },
  { key: 'problem', title: 'What problem should it solve first?', help: 'Example: “People miss appointments because booking is done by phone.”' },
  { key: 'firstVersion', title: 'What should the first version do?', help: 'Keep it small. Example: “Let a customer pick a time and get a confirmation.”' },
  { key: 'constraints', title: 'Any limits or must-haves?', help: 'Example: “Needs sign-in, works on phones, and should launch quickly.”' },
];

function valueOrPlaceholder(value) {
  const cleaned = String(value || '').trim();
  return cleaned || PLACEHOLDER;
}

function findByName(items, matcher) {
  return items.find((item) => matcher.test(String(item.name || '')));
}

function getToolMatcher() {
  if (typeof window !== 'undefined' && window.CCTIToolMatcher) return window.CCTIToolMatcher;
  if (typeof require === 'function') return require('./tool-matcher');
  return { matchTools: () => [] };
}

const PLACEHOLDER = 'Not decided yet.';
// Hedges say "I have not decided"; they are stripped exactly like the placeholder
// so "I am not sure" can never match an item that mentions "sure".
const HEDGE_PATTERN = /\b(not sure|unsure|don'?t know|do not know|no idea|not yet|maybe|later|none|nothing|n\/a|idk|tbd|undecided|not decided|whatever)\b/i;

function scopeForKind(kind) {
  return kind === 'component' ? 'Selected project' : 'This computer';
}

/** Keep only the parts of an answer that state something; drop hedged clauses. */
function usefulAnswerText(value) {
  const text = String(value || '').trim();
  if (!text || text === PLACEHOLDER) return '';
  return text.split(/[.;!?\n]+|,\s*|\s+but\s+/i).filter((clause) => clause.trim() && !HEDGE_PATTERN.test(clause)).join('. ').trim();
}

function createRecommendations(answers, catalog, components, details) {
  const answerTexts = Object.values(answers).map(usefulAnswerText).filter(Boolean);
  const installable = new Map([
    ...catalog.map((item) => [`tool:${item.id}`, { packageName: '' }]),
    ...components.map((item) => [`component:${item.id}`, { packageName: item.packageName || '' }]),
  ]);
  const results = [];
  const add = (id, name, kind, reason, closeTo = null) => {
    const target = installable.get(`${kind}:${id}`);
    // A suggestion the installer cannot act on is worse than no suggestion.
    if (!target || results.some((result) => result.id === id)) return;
    results.push({ id, name, kind, scope: scopeForKind(kind), reason, closeTo, packageName: target.packageName, prechecked: false });
  };

  const planning = findByName(catalog, /^Planning with Files$/i);
  if (planning) add(planning.id, planning.name, 'tool', 'Helps turn the agreed first version into small, saved work steps.');
  for (const match of getToolMatcher().matchTools(answerTexts, details)) {
    add(match.id, match.name, match.kind, match.reason, match.closeTo);
  }
  // Fix #9: pre-check only the Planning with Files baseline. A matched suggestion can be
  // text-true but job-wrong (see fix9 report), so every matched suggestion starts unchecked
  // and waits for the user to tick what fits.
  if (planning) {
    const baseline = results.find((item) => item.id === planning.id);
    if (baseline) baseline.prechecked = true;
  }
  return results;
}

/**
 * Add the chosen interview suggestions to the Step 2 review lists. Nothing is installed here.
 * @param {Array} recommendations items from buildProjectInterviewDraft
 * @param {Set} selected tool ids already on the review list
 * @param {Set} componentPlan component ids already in the project plan
 * @param {Iterable<string>} [chosenIds] only these ids are added; omit to add every recommendation
 */
function queueInterviewSuggestions(recommendations, selected, componentPlan, chosenIds) {
  const nextSelected = new Set(selected);
  const nextComponentPlan = new Set(componentPlan);
  const chosen = chosenIds ? new Set(chosenIds) : null;
  let addedTools = 0;
  let addedComponents = 0;
  let alreadyTools = 0;
  let alreadyComponents = 0;
  for (const item of recommendations || []) {
    if (chosen && !chosen.has(item.id)) continue;
    if (item.kind === 'tool') {
      if (nextSelected.has(item.id)) alreadyTools += 1;
      else { nextSelected.add(item.id); addedTools += 1; }
    } else if (item.kind === 'component') {
      if (nextComponentPlan.has(item.id)) alreadyComponents += 1;
      else { nextComponentPlan.add(item.id); addedComponents += 1; }
    }
  }
  return { selected: nextSelected, componentPlan: nextComponentPlan, addedTools, addedComponents, alreadyTools, alreadyComponents };
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
