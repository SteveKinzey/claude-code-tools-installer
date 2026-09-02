#!/usr/bin/env node
const assert = require('node:assert/strict');
const { PROJECT_INTERVIEW_QUESTIONS, buildProjectInterviewDraft } = require('../desktop/src/project-interview');

const catalog = [
  { id: 'planning-with-files', name: 'Planning with Files' },
  { id: 'frontend-design', name: 'Frontend Design' },
  { id: 'playwright-mcp', name: 'Playwright MCP' },
  { id: 'context7', name: 'Context7' },
  { id: 'convex', name: 'Convex for Claude Code' },
];
const components = [
  { id: 'better-auth', name: 'Better Auth', packageName: '@convex-dev/better-auth' },
  { id: 'convex-agent', name: 'Convex Agent', packageName: '@convex-dev/agent' },
  { id: 'presence', name: 'Presence', packageName: '@convex-dev/presence' },
];

const result = buildProjectInterviewDraft({
  idea: 'A live AI chat tool for teams',
  users: 'Support teams',
  problem: 'Answers get lost',
  firstVersion: 'Sign in and ask questions',
  constraints: 'Needs accounts and a browser test',
}, catalog, components);

assert.equal(PROJECT_INTERVIEW_QUESTIONS.length, 5);
assert.match(result.draft, /Private early draft/i);
assert.match(result.draft, /Nothing has been selected or installed/i);
assert.match(result.draft, /Support teams/);
assert.ok(result.recommendations.some((item) => item.id === 'planning-with-files'));
assert.ok(result.recommendations.some((item) => item.id === 'better-auth'));
assert.ok(result.recommendations.some((item) => item.id === 'convex-agent'));
assert.ok(result.recommendations.some((item) => item.id === 'presence'));
assert.ok(result.recommendations.some((item) => item.id === 'playwright-mcp'));
assert.ok(result.recommendations.every((item) => ['This computer', 'Selected project'].includes(item.scope)));

console.log('Project Interview behavior passed: a private PRD draft and unselected, scope-labeled suggestions are produced from the user’s answers.');
