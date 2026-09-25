#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const desktop = path.resolve(__dirname, '..', 'desktop');
const { PROJECT_INTERVIEW_QUESTIONS, buildProjectInterviewDraft, queueInterviewSuggestions } = require(path.join(desktop, 'src', 'project-interview'));

const catalog = require(path.join(desktop, 'catalog.json'));
const components = require(path.join(desktop, 'convex-components.json')).components;
const details = require(path.join(desktop, 'catalog-details.json')).items;

const result = buildProjectInterviewDraft({
  idea: 'A shop that sells a digital book',
  users: 'Readers',
  problem: 'People cannot pay online',
  firstVersion: 'Sell the book and let users log in with google',
  constraints: 'Send text message reminders',
}, catalog, components, details);

assert.equal(PROJECT_INTERVIEW_QUESTIONS.length, 5);
assert.match(result.draft, /Private early draft/i);
assert.match(result.draft, /Nothing has been selected or installed/i);
assert.match(result.draft, /Readers/);
const names = result.recommendations.map((item) => item.name);
assert.ok(names.includes('Planning with Files'), 'Planning with Files stays the baseline suggestion');
assert.ok(names.includes('Stripe'), `selling a book must suggest Stripe; got ${names.join(', ')}`);
assert.ok(result.recommendations.every((item) => ['This computer', 'Selected project'].includes(item.scope)));
assert.ok(result.recommendations.every((item) => item.reason.trim().length > 0), 'every suggestion states its reason');
const stripe = result.recommendations.find((item) => item.name === 'Stripe');
assert.equal(stripe.scope, 'Selected project');
assert.equal(stripe.packageName, '@convex-dev/stripe');
assert.match(result.draft, /Stripe — Selected project\. Choose this when/);

// Review Focus 1: the "Not decided yet." placeholder must not produce matches.
const empty = buildProjectInterviewDraft({}, catalog, components, details);
assert.deepEqual(empty.recommendations.map((item) => item.name), ['Planning with Files'], 'blank answers must not invent matches from placeholder text');

// Review Focus 3: no catalog details → baseline only, no throw.
const noDetails = buildProjectInterviewDraft({ idea: 'sell a digital book' }, catalog, components);
assert.deepEqual(noDetails.recommendations.map((item) => item.name), ['Planning with Files'], 'missing catalog details degrade to the baseline, never throw');

// Review Focus 4: a match the installer cannot act on is dropped.
const orphan = buildProjectInterviewDraft({ idea: 'sell a digital book' }, catalog, [], details);
assert.ok(!orphan.recommendations.some((item) => item.name === 'Stripe'), 'a match missing from the install catalogs must be dropped');

// Review Focus 5: queueing keeps existing picks, separates kinds, and is idempotent.
const queued = queueInterviewSuggestions(result.recommendations, new Set(['context7']), new Set());
assert.ok(queued.selected.has('context7'), 'existing tool selections are kept');
assert.ok(queued.selected.has('planning-with-files'));
assert.ok(queued.componentPlan.has(stripe.id), 'project components go to the component plan');
assert.ok(!queued.selected.has(stripe.id), 'components never enter the local-tool queue');
assert.ok(result.recommendations.filter((item) => item.scope === 'This computer').every((item) => !queued.componentPlan.has(item.id)), 'tools never enter the component plan');
const again = queueInterviewSuggestions(result.recommendations, queued.selected, queued.componentPlan);
assert.equal(again.addedTools + again.addedComponents, 0, 'adding the same suggestions twice changes nothing');
assert.equal(queueInterviewSuggestions(undefined, new Set(), new Set()).addedTools, 0);

console.log('Project Interview behavior passed: job-matched, reasoned suggestions stay unselected until the user adds them to the review lists.');
