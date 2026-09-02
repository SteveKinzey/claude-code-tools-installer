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

function createRecommendations(answers, catalog, components) {
  const text = Object.values(answers).join(' ').toLowerCase();
  const results = [];
  const add = (item, scope, reason) => {
    if (!item || results.some((result) => result.id === item.id)) return;
    results.push({ id: item.id, name: item.name, scope, reason, packageName: item.packageName || '' });
  };
  const addTool = (matcher, reason) => add(findByName(catalog, matcher), 'This computer', reason);
  const addComponent = (matcher, reason) => add(findByName(components, matcher), 'Selected project', reason);

  addTool(/^Planning with Files$/i, 'Helps turn the agreed first version into small, saved work steps.');
  if (/design|screen|website|landing|interface|look|brand/.test(text)) addTool(/^Frontend Design$/i, 'Helps with clear screens and simple design decisions.');
  if (/test|testing|browser|quality|bug/.test(text)) addTool(/^Playwright MCP$/i, 'Helps test the project in a browser before sharing it.');
  if (/docs?|documentation|library|framework|api/.test(text)) addTool(/^Context7$/i, 'Helps Claude Code use current documentation when building.');
  if (/auth|sign.?in|login|account|member|user profile/.test(text)) addComponent(/better auth/i, 'A possible project package for sign-in. Review its own setup before using it.');
  if (/chat|agent|ai|assistant|prompt|model/.test(text)) addComponent(/agent|ai/i, 'A possible project package for an AI or chat feature. Review its data and provider needs first.');
  if (/real.?time|live|presence|collaboration|multiplayer|team/.test(text)) addComponent(/presence|real.?time/i, 'A possible project package for live updates or shared presence.');
  if (/database|backend|real.?time|live|convex/.test(text)) addTool(/^Convex for Claude Code$/i, 'Helps Claude Code work with a Convex project when you choose to use Convex.');
  return results;
}

function buildProjectInterviewDraft(answers, catalog = [], components = []) {
  const values = Object.fromEntries(PROJECT_INTERVIEW_QUESTIONS.map((question) => [question.key, valueOrPlaceholder(answers?.[question.key])]));
  const recommendations = createRecommendations(values, catalog, components);
  const suggestionLines = recommendations.length
    ? recommendations.map((item) => `- ${item.name} — ${item.scope}. ${item.reason}${item.packageName ? ` Package: ${item.packageName}.` : ''}`).join('\n')
    : '- No specific CCTI choice matches yet. Start with the project outline, then use Compass to compare options.';
  const draft = `# Draft product requirements\n\nStatus: Private early draft. Nothing has been selected or installed.\n\n## What you want to make\n${values.idea}\n\n## Who it is for\n${values.users}\n\n## First problem to solve\n${values.problem}\n\n## First version\n${values.firstVersion}\n\n## Limits and must-haves\n${values.constraints}\n\n## Open questions to settle before building\n- What is the smallest working first release?\n- What information will the product need to store?\n- Does any feature need an account, payment, outside service, or sign-in?\n\n## Suggested CCTI choices to review\n${suggestionLines}\n\nThese are suggestions only. Review each one, choose what fits, and approve any install separately.`;
  return { draft, recommendations, values };
}

const projectInterviewApi = { PROJECT_INTERVIEW_QUESTIONS, buildProjectInterviewDraft };

if (typeof module !== 'undefined' && module.exports) module.exports = projectInterviewApi;
if (typeof window !== 'undefined') window.CCTIProjectInterview = projectInterviewApi;
