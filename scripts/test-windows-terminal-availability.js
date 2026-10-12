#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function checkWindowsTerminalAvailability(root) {
  const source = fs.readFileSync(path.join(root, 'scripts', 'test-windows-terminal-adapter-runner.js'), 'utf8');
  const start = source.indexOf('function assertRequiredTerminalChoices(availableIds) {');
  const end = source.indexOf('function executableProbe(command) {', start);
  assert.ok(start >= 0 && end > start, 'native runner must contain the actual required-choice validator');
  assert.ok(source.includes('    assertRequiredTerminalChoices(availableIds);'), 'native runner must invoke its tested validator');
  assert.ok(!source.includes("assert.deepEqual(availableIds, ['default', 'windows-terminal']"), 'native runner must not reject legitimate optional terminals');
  const verify = new Function('assert', `${source.slice(start, end)}\nreturn assertRequiredTerminalChoices;`)(assert);
  for (const choices of [
    ['default', 'windows-terminal'],
    ['default', 'windows-terminal', 'git-bash'],
    ['default', 'windows-terminal', 'git-bash', 'warp', 'hyper', 'tabby'],
  ]) assert.doesNotThrow(() => verify(choices));
  for (const choices of [
    ['default', 'git-bash'],
    ['windows-terminal', 'git-bash'],
    ['default', 'default', 'windows-terminal'],
    ['default', 'windows-terminal', 'git-bash', 'git-bash'],
    ['windows-terminal', 'default'],
  ]) assert.throws(() => verify(choices), assert.AssertionError);
  console.log('Windows required-terminal availability regression passed: 8 scenarios retain required choices/order/uniqueness and allow optional terminals.');
};

if (require.main === module) module.exports(path.resolve(__dirname, '..'));
