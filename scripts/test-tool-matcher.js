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
    // Minor 4: the matcher reports kind only; the interview derives its scope label from kind.
    assert.equal(item.scope, undefined, `${item.name} must not carry a parallel scope vocabulary`);
    if (item.closeTo) {
      assert.notEqual(item.closeTo.id, item.id, 'a close match must name a different item');
      assert.match(item.closeTo.reason, /^Choose this when /, 'a close match must quote the rival\'s own reason');
    }
  }
}

// Important 2: a close alternative belongs only to the top match, only for a same-category
// runner-up within 15% that matched some of the same words, and never as a reverse pair.
for (const text of ['send text message reminders to customers', 'users log in with google', 'A booking app for dog walkers where customers sign in and pay', 'let people log in without a password', 'sell a digital book']) {
  const results = matchTools(text, details);
  results.slice(1).forEach((item) => assert.equal(item.closeTo, null, `${text}: only the top match may name a close alternative (${item.name})`));
  const [top, second] = results;
  if (top?.closeTo) {
    assert.equal(top.closeTo.id, second.id, `${text}: the close alternative must be the runner-up`);
    assert.equal(second.category, top.category, `${text}: a close alternative must be in the same category`);
    assert.ok(second.score >= top.score * 0.85, `${text}: a close alternative must be within 15%`);
  }
}
const texting = matchTools('send text message reminders to customers', details);
assert.ok(texting[0].closeTo, 'near-tied messaging items must state how they differ');

// Critical 1a: one shared word is never enough ("online" alone must not pick Presence).
assert.deepEqual(matchTools('online store', details), [], 'a single shared word must not produce a match');
// Critical 1c: hedges are not words to match on.
for (const hedge of ['I am not sure', 'I don\'t know', 'no idea', 'maybe later', 'none', 'idk']) {
  assert.deepEqual(matchTools(hedge, details), [], `"${hedge}" must return no matches`);
}
// Critical 1b: answers are scored separately, so stray words spread across answers cannot add up.
const spread = ['People who want to order cakes', 'Customers call me', 'Pay online for pickup'];
const joined = matchTools(spread.join(' '), details).map((item) => item.name);
const separate = matchTools(spread, details).map((item) => item.name);
assert.ok(separate.length <= joined.length, 'per-answer scoring must not add matches that joined text would not');
assert.ok(!separate.includes('QuiCK') && !separate.includes('OxaPay'), `scattered single words must not pick niche items; got ${separate.join(', ')}`);
// Minor 5: harness and reference installs do not answer product descriptions unless named.
assert.ok(!matchTools('A team chat app with live updates', details).some((item) => ['Claude HUD', 'gstack'].includes(item.name)), 'harness/reference tools must be demoted for product text');
assert.equal(matchTools('set up gstack so Claude acts like a whole team', details)[0]?.name, 'gstack', 'a named harness tool is still found');

const hostile = matchTools('<script>alert(1)</script> '.repeat(500), details);
assert.ok(Array.isArray(hostile), 'very long or markup-like answers must not throw');

console.log('Tool matcher passed: job-level ranking, two-word evidence, per-answer scoring, hedge stripping, harness demotion, and top-only close-match comparisons.');
