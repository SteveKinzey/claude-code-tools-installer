#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const { matchTools } = require('../desktop/src/tool-matcher');
const details = require(path.join(__dirname, '..', 'desktop', 'catalog-details.json')).items;

const rank = (results, name) => results.findIndex((item) => item.name === name);

const book = matchTools('I want to sell a digital book', details);
assert.equal(book[0]?.name, 'Stripe', 'selling a digital book must rank Stripe first');
assert.ok(rank(book, 'Autumn') === -1 || rank(book, 'Autumn') > rank(book, 'Stripe'), 'Autumn must not outrank Stripe for a one-time sale');

const gate = matchTools('limit free users to 10 messages per day', details);
assert.equal(gate[0]?.name, 'Autumn', 'per-feature limits must rank Autumn first');
assert.ok(rank(gate, 'Stripe') === -1 || rank(gate, 'Stripe') > rank(gate, 'Autumn'), 'Stripe must not outrank Autumn for feature gating');

assert.ok(rank(matchTools('send text message reminders to customers', details), 'Twilio SMS') !== -1, 'text reminders must surface Twilio SMS');
assert.equal(matchTools('users log in with google', details)[0]?.name, 'Better Auth', 'sign-in must rank Better Auth first');

// Review Focus 2: no guessing on empty, gibberish, or stop-word-only text.
for (const empty of ['', '   ', 'xyzzy', 'the and of to']) {
  assert.deepEqual(matchTools(empty, details), [], `"${empty}" must return no matches rather than a guess`);
}
// Review Focus 3: missing details degrade to no matches.
assert.deepEqual(matchTools('sell a book', []), [], 'missing catalog details must return no matches');
assert.deepEqual(matchTools('sell a book', undefined), [], 'undefined catalog details must return no matches');

const sample = ['A booking app for dog walkers with sign-in', 'an AI chat assistant for support teams', 'sell a digital book', 'test my site in a browser'];
for (const text of sample) {
  const results = matchTools(text, details, { limit: 4 });
  assert.ok(results.length <= 4, 'the limit must be respected');
  for (const item of results) {
    assert.match(item.reason, /^Choose this when /, `${item.name} must carry its own chooseWhen sentence as the reason`);
    assert.ok(['tool', 'component'].includes(item.kind), `${item.name} must carry its kind`);
    assert.ok(['This computer', 'This project'].includes(item.scope), `${item.name} must carry its scope`);
    if (item.closeTo) {
      assert.notEqual(item.closeTo.id, item.id, 'a close match must name a different item');
      assert.match(item.closeTo.reason, /^Choose this when /, 'a close match must quote the rival\'s own reason');
    }
  }
}

const hostile = matchTools('<script>alert(1)</script> '.repeat(500), details);
assert.ok(Array.isArray(hostile), 'very long or markup-like answers must not throw');

console.log('Tool matcher passed: job-level ranking, honest empty results, stated reasons, and close-match comparisons.');
