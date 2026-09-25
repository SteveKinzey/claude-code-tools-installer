#!/usr/bin/env node
// Realistic-beginner fixture for the Project Interview recommendations.
// Each case is written the way a first-time builder actually answers: full
// five-answer interviews, one-liners, and hedges. Every case states what must
// appear and what must not, so matcher tuning cannot quietly regress to
// "one rare word wins" behavior.
const assert = require('node:assert/strict');
const path = require('node:path');
const desktop = path.resolve(__dirname, '..', 'desktop');
const { buildProjectInterviewDraft } = require(path.join(desktop, 'src', 'project-interview'));
const catalog = require(path.join(desktop, 'catalog.json'));
const components = require(path.join(desktop, 'convex-components.json')).components;
const details = require(path.join(desktop, 'catalog-details.json')).items;

const BASELINE = 'Planning with Files';
// Reference repos and harness installs should not answer a product description.
const HARNESS_AND_REFERENCE = ['gstack', 'ECC', 'Superpowers', 'Learn Claude Code', 'Karpathy Skills', 'Ponytail', 'Awesome MCP Servers', 'Awesome Claude Skills', 'Claude HUD', 'System Prompts AI', 'Claude Code Best Practice', 'Caveman', 'Codex in Claude'];
const RARE_PAYMENTS = ['ePayco', 'OxaPay', 'Adyen Payments', 'Idempotency Keys'];

const cases = [
  {
    label: 'bakery, full interview with a hedge',
    answers: {
      idea: 'A website for my bakery',
      users: 'People in my town who want to order birthday cakes',
      problem: 'Customers call me to order and I lose track of the orders',
      firstVersion: 'Show my cakes and let people order and pay online for pickup',
      constraints: 'I am not sure',
    },
    mustNotAppear: ['ePayco', 'QuiCK', 'Code Review', 'AutoSend', 'OxaPay', 'Idempotency Keys', ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'dog walker booking with sign-in and pay',
    answers: { idea: 'A booking app for dog walkers where customers sign in and pay' },
    mustAppear: ['Better Auth'],
    mustNotBeFirst: ['OxaPay'],
    mustNotAppear: ['OxaPay', 'ePayco', ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'online store one-liner',
    answers: { idea: 'online store' },
    mustNotAppear: ['Presence', 'GitHub MCP', 'Playwright MCP', ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'customer support bot',
    answers: { idea: 'customer support bot' },
    mustNotAppear: ['Adyen Payments', 'ePayco', 'Idempotency Keys', ...RARE_PAYMENTS, ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'team chat with live updates',
    answers: { idea: 'A team chat app with live updates' },
    mustNotAppear: ['Claude HUD', 'gstack', ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'family to-do list (vague)',
    answers: { idea: 'A to-do list app for my family' },
    maxMatches: 3,
    mustNotAppear: [...HARNESS_AND_REFERENCE],
  },
  { label: 'hedge: I don\'t know', answers: { idea: 'I don\'t know' }, noMatches: true },
  { label: 'hedge: no idea', answers: { idea: 'no idea' }, noMatches: true },
  { label: 'hedge: maybe later', answers: { idea: 'maybe later' }, noMatches: true },
  {
    label: 'hedges in every answer',
    answers: { idea: 'not sure', users: 'idk', problem: 'n/a', firstVersion: 'None', constraints: 'I don\'t know yet, maybe later' },
    noMatches: true,
  },
  {
    label: 'sell a digital book',
    answers: { idea: 'I want to sell a digital book' },
    mustAppear: ['Stripe'],
    mustBeFirst: 'Stripe',
    mustNotAppear: [...RARE_PAYMENTS],
  },
  {
    label: 'feature gating',
    answers: { idea: 'limit free users to 10 messages per day' },
    mustAppear: ['Autumn'],
    mustBeFirst: 'Autumn',
  },
  {
    label: 'text reminders',
    answers: { idea: 'send text message reminders to customers' },
    mustAppear: ['Twilio SMS'],
    mustNotAppear: [...RARE_PAYMENTS],
  },
  {
    label: 'sign in with google',
    answers: { idea: 'users log in with google' },
    mustAppear: ['Better Auth'],
    mustBeFirst: 'Better Auth',
  },
  {
    label: 'tutoring site, full interview',
    answers: {
      idea: 'A tutoring website',
      users: 'Parents and high school students',
      problem: 'Parents cannot see when I am free to teach',
      firstVersion: 'Let parents book a lesson time and get an email confirmation',
      constraints: 'Must work on phones. Payments maybe later.',
    },
    mustNotAppear: ['ePayco', 'OxaPay', 'QuiCK', 'Idempotency Keys', 'Conflict Free Counter', ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'hiking club newsletter, full interview',
    answers: {
      idea: 'A newsletter for my hiking club',
      users: 'Club members',
      problem: 'I email everyone by hand every week',
      firstVersion: 'Send a weekly newsletter email to all members',
      constraints: 'none',
    },
    mustAppear: ['AWS SES'],
    mustNotAppear: [...RARE_PAYMENTS, ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'coffee shop map',
    answers: { idea: 'Show the closest coffee shops on a map' },
    mustAppear: ['Geospatial'],
    mustBeFirst: 'Geospatial',
  },
  {
    label: 'recipe blog',
    answers: { idea: 'A blog for my recipes' },
    mustAppear: ['Basic Blog'],
    mustNotAppear: [...HARNESS_AND_REFERENCE],
  },
  {
    label: 'chatbot over my documents',
    answers: { idea: 'A chat box that answers customer questions using my files' },
    mustAppearAny: ['AI Agent', 'RAG', 'SiteGPT'],
    mustNotAppear: [...RARE_PAYMENTS, ...HARNESS_AND_REFERENCE],
  },
  {
    label: 'passwordless login',
    answers: { idea: 'Let people log in without a password' },
    mustAppear: ['Convex Passkey-auth'],
  },
  {
    label: 'harness named explicitly',
    answers: { idea: 'I want gstack so Claude acts like a whole team' },
    mustAppear: ['gstack'],
  },
  // Fix #9 held-out interviews: realistic answers outside the original fixture where
  // the old unconditional top-3 pre-check surfaced wrong items already ticked.
  {
    label: 'restaurant menu site, full interview',
    answers: {
      idea: 'A website for my family restaurant',
      users: 'Local diners',
      problem: 'People call to ask about the menu',
      firstVersion: 'Show the menu with prices and our opening hours',
      constraints: 'Must look good on phones',
    },
  },
  {
    label: 'school robotics club sign-up, full interview',
    answers: {
      idea: 'A sign-up page for our school robotics club',
      users: 'Students and parents',
      problem: 'Paper forms get lost',
      firstVersion: 'Students sign up and pick a team',
      constraints: 'Free and simple',
    },
  },
  {
    label: 'tutoring marketplace, full interview',
    answers: {
      idea: 'A marketplace for math tutors',
      users: 'Parents and tutors',
      problem: 'Hard to find a good tutor',
      firstVersion: 'Parents book a session and pay the tutor',
      constraints: 'Needs sign-in',
    },
  },
  {
    label: 'photo sharing one-liner',
    answers: { idea: 'An app where I upload photos and share them with friends' },
  },
];

const failures = [];
const summary = [];
const allCases = [];
for (const testCase of cases) {
  const { recommendations } = buildProjectInterviewDraft(testCase.answers, catalog, components, details);
  allCases.push({ label: testCase.label, recommendations });
  const matched = recommendations.filter((item) => item.name !== BASELINE);
  const names = matched.map((item) => item.name);
  summary.push(`${testCase.label}: ${names.join(', ') || '(none)'}`);
  const fail = (message) => failures.push(`${testCase.label}: ${message} [got: ${names.join(', ') || 'none'}]`);
  if (!recommendations.some((item) => item.name === BASELINE)) fail('the Planning with Files baseline is missing');
  if (testCase.noMatches && names.length) fail('hedge-only answers must produce no matches');
  for (const name of testCase.mustAppear || []) if (!names.includes(name)) fail(`${name} must appear`);
  if (testCase.mustAppearAny && !testCase.mustAppearAny.some((name) => names.includes(name))) fail(`one of ${testCase.mustAppearAny.join(' / ')} must appear`);
  for (const name of new Set(testCase.mustNotAppear || [])) if (names.includes(name)) fail(`${name} must not appear`);
  if (testCase.mustBeFirst && names[0] !== testCase.mustBeFirst) fail(`${testCase.mustBeFirst} must be the top match`);
  for (const name of testCase.mustNotBeFirst || []) if (names[0] === name) fail(`${name} must not be the top match`);
  if (testCase.maxMatches !== undefined && names.length > testCase.maxMatches) fail(`at most ${testCase.maxMatches} matches for a vague answer`);
  // Fix #9: no matched suggestion is ever pre-checked; only Planning with Files may be.
  const preCheckedNames = recommendations.filter((item) => item.prechecked).map((item) => item.name);
  if (preCheckedNames.length !== 1 || preCheckedNames[0] !== BASELINE) fail(`only ${BASELINE} may be pre-checked [prechecked: ${preCheckedNames.join(', ') || 'none'}]`);
  // A close alternative is offered at most once and never as a reverse pair.
  const withClose = matched.filter((item) => item.closeTo);
  if (withClose.length > 1) fail('only the top match may carry a close alternative');
  if (withClose.length && withClose[0] !== matched[0]) fail('the close alternative must belong to the top match');
}

// General assertion across every fixture case: the pre-checked set is always exactly
// the baseline, never a matched suggestion.
for (const { label, recommendations } of allCases) {
  const preCheckedIds = recommendations.filter((item) => item.prechecked).map((item) => item.id);
  const baselineId = recommendations.find((item) => item.name === BASELINE)?.id;
  if (baselineId && (preCheckedIds.length !== 1 || preCheckedIds[0] !== baselineId)) {
    failures.push(`${label}: prechecked set must equal exactly [${baselineId}] [got: ${preCheckedIds.join(', ') || 'none'}]`);
  }
}

if (process.argv.includes('--verbose') || failures.length) console.log(summary.join('\n'));
assert.equal(failures.length, 0, `Realistic interview fixture failed:\n${failures.join('\n')}`);
console.log(`Realistic interview fixture passed: ${cases.length} beginner interviews give relevant, reasoned suggestions and no guesses on hedges.`);
