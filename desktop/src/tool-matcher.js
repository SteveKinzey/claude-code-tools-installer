// Offline job matching for the Project Interview. Scores the user's own words
// against each catalog item's plain-language "choose this when" text so items
// in the same category that do different jobs are told apart. No network, no I/O.
//
// Evidence rules (tuned against scripts/test-interview-fixtures.js):
// - Each answer is scored on its own and only answers that are real evidence
//   count, so five long answers cannot stack stray single-word coincidences.
// - An answer is evidence for an item only when it matches at least two distinct
//   specific words, or a two-word phrase, from that item's text. Very common
//   catalog words ("customer", "user", "sign") still add weight but never count
//   as evidence on their own.
// - Reference copies and harness installs (how you work, not what you build) are
//   demoted unless the answer names them.

const FIELD_WEIGHTS = [['name', 3], ['chooseWhen', 3], ['example', 2], ['plainPurpose', 1]];
const JOB_FIELD = 'chooseWhen';
const CATEGORY_WEIGHT = 0.5;
const CLOSE_MATCH_RATIO = 0.85;
const MIN_SCORE = 12;
const RELATIVE_FLOOR = 0.5;
const MIN_EVIDENCE = 2;
// A word used by more than this share of catalog items is too common to be evidence.
const COMMON_WORD_SHARE = 0.08;
const DEMOTED_FACTOR = 0.25;
// A matched two-word phrase is strong evidence but should not double-count its words' weight.
const PHRASE_FACTOR = 0.5;
// Coverage boost: an item whose own "choose this when" job is mostly covered by the
// answer (Stripe: "sales"; Better Auth: "log in") beats one that only shares a generic
// word with a niche job (OxaPay: "customers pay ... using Bitcoin").
const COVERAGE_WEIGHT = 2;
const DEMOTED_CATEGORIES = new Set(['Harness', 'Cost & Reference']);
const REFERENCE_ACTION = /reference|a copy of/i;
const PHRASE_PARTICLES = new Set(['in', 'up', 'out', 'on', 'off']);
// Hedge words never count as matches ("I am not sure" must not match "make sure").
const HEDGE_WORDS = 'sure unsure idea know dont don maybe later none nothing idk tbd yet undecided decided whatever na'.split(' ');
const STOP_WORDS = new Set(('a an and any are as at be but by can do does for from get has have how i if in into is it its just let lets like make me more my need needs not of on one or our out over should so some such than that the their them then there these they this those to too up us use using via want wants was we what when where which while who why will with without would you your yours choose example site website app apps project people person thing things way also only each every first new simple easy easily time get gets work works pick lets run runs keep keeps give gives help helps start store stores add adds show shows call calls create creates build builds support supports feature features small quick quickly fast launch am im don t s off')
  .split(' ').concat(HEDGE_WORDS));
// Plain-English equivalents a beginner uses interchangeably ("sign in" = "log in").
const NORMALIZE = new Map([['payment', 'pay'], ['paid', 'pay'], ['sign', 'log'], ['signin', 'log'], ['signup', 'log'], ['login', 'log'], ['logged', 'log']]);

function stem(word) {
  let result = word;
  if (result.length > 5 && result.endsWith('ing')) result = result.slice(0, -3);
  else if (result.length > 4 && result.endsWith('ies')) result = `${result.slice(0, -3)}y`;
  else if (result.length > 4 && result.endsWith('ed')) result = result.slice(0, -2);
  else if (result.length > 3 && result.endsWith('s') && !result.endsWith('ss')) result = result.slice(0, -1);
  return NORMALIZE.get(result) || NORMALIZE.get(word) || result;
}

function rawWords(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function tokens(text) {
  return rawWords(text).filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem);
}

// Adjacent pairs such as "sign in", "text message", "coffee shop": the first word is
// a content word; the second is a content word or a short particle.
function phrases(text) {
  const words = rawWords(text);
  const pairs = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const [first, second] = [words[index], words[index + 1]];
    if (first.length < 2 || STOP_WORDS.has(first)) continue;
    if (PHRASE_PARTICLES.has(second)) pairs.push(`${stem(first)} ${second}`);
    else if (second.length > 1 && !STOP_WORDS.has(second)) pairs.push(`${stem(first)} ${stem(second)}`);
  }
  return pairs;
}

function isDemoted(detail) {
  return DEMOTED_CATEGORIES.has(detail.category) || REFERENCE_ACTION.test(String(detail.cctiAction || ''));
}

function buildIndex(details) {
  const documentFrequency = new Map();
  const entries = details.map((detail) => {
    const fields = FIELD_WEIGHTS.map(([field, weight]) => ({ weight, words: new Set(tokens(detail[field])), phrases: new Set(phrases(detail[field])) }));
    const category = new Set(tokens(detail.category));
    const all = new Set([...fields.flatMap((field) => [...field.words, ...field.phrases]), ...category]);
    for (const term of all) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    return { detail, fields, category, jobWords: new Set(tokens(detail[JOB_FIELD])), nameWords: tokens(detail.name), demoted: isDemoted(detail) };
  });
  const total = details.length;
  const idf = (term) => Math.log((total + 1) / ((documentFrequency.get(term) || 0) + 1)) + 1;
  const isCommon = (term) => (documentFrequency.get(term) || 0) > total * COMMON_WORD_SHARE;
  return { entries, idf, isCommon };
}

function bestFieldWeight(entry, term, kind) {
  return entry.fields.reduce((best, field) => (field[kind].has(term) ? Math.max(best, field.weight) : best), 0);
}

// Score one answer against one item. Returns null unless the answer is real evidence.
function scoreAnswer(entry, answer, index) {
  let score = 0;
  const matched = new Set();
  let evidence = 0;
  for (const word of answer.words) {
    const fieldWeight = bestFieldWeight(entry, word, 'words');
    if (fieldWeight) {
      score += fieldWeight * index.idf(word);
      matched.add(word);
      // Saying what the item is ("blog" for Basic Blog, "chat" for Chat) is stronger evidence than
      // a stray match, so the head noun of its name counts twice ("free" in Conflict Free Counter does not).
      if (!index.isCommon(word)) evidence += word === entry.nameWords[entry.nameWords.length - 1] ? 2 : 1;
    } else if (entry.category.has(word)) {
      score += CATEGORY_WEIGHT * index.idf(word);
    }
  }
  for (const phrase of answer.phrases) {
    const fieldWeight = bestFieldWeight(entry, phrase, 'phrases');
    if (!fieldWeight) continue;
    score += PHRASE_FACTOR * fieldWeight * index.idf(phrase);
    evidence += 2;
    for (const word of tokens(phrase)) matched.add(word);
  }
  if (evidence < MIN_EVIDENCE) return null;
  return { score, matched };
}

// Share of the item's own chooseWhen job (by word weight) that the answers matched.
function coverage(entry, matched, index) {
  let total = 0;
  let hit = 0;
  for (const word of entry.jobWords) {
    total += index.idf(word);
    if (matched.has(word)) hit += index.idf(word);
  }
  return total ? hit / total : 0;
}

function namesItem(entry, answers) {
  if (!entry.nameWords.length) return false;
  return answers.some((answer) => entry.nameWords.every((word) => answer.words.includes(word)));
}

/**
 * Match interview answers to catalog items.
 * @param {string|string[]} answerInput one text, or one text per interview answer
 */
function matchTools(answerInput, details, { limit = 6 } = {}) {
  const texts = (Array.isArray(answerInput) ? answerInput : [answerInput]).map((text) => String(text || '')).filter((text) => text.trim());
  const answers = texts.map((text) => ({ words: [...new Set(tokens(text))], phrases: [...new Set(phrases(text))] })).filter((answer) => answer.words.length);
  if (!answers.length || !Array.isArray(details) || !details.length) return [];
  const index = buildIndex(details);
  const ranked = [];
  for (const entry of index.entries) {
    let score = 0;
    const matched = new Set();
    for (const answer of answers) {
      const result = scoreAnswer(entry, answer, index);
      if (!result) continue;
      score += result.score;
      for (const word of result.matched) matched.add(word);
    }
    if (!score) continue;
    score *= 1 + COVERAGE_WEIGHT * coverage(entry, matched, index);
    if (entry.demoted && !namesItem(entry, answers)) score *= DEMOTED_FACTOR;
    if (score >= MIN_SCORE) ranked.push({ entry, score, matched });
  }
  ranked.sort((left, right) => right.score - left.score || left.entry.detail.name.localeCompare(right.entry.detail.name));
  const floor = (ranked[0]?.score || 0) * RELATIVE_FLOOR;
  const kept = ranked.filter((result) => result.score >= floor).slice(0, limit);
  return kept.map(({ entry, score, matched }, position) => {
    const detail = entry.detail;
    // Only the top match may name a close alternative: the runner-up in the same
    // category, nearly as strong, matched on at least one of the same answer words.
    const runnerUp = position === 0 ? kept[1] : null;
    const rival = runnerUp
      && runnerUp.entry.detail.id !== detail.id
      && runnerUp.entry.detail.category === detail.category
      && runnerUp.score >= score * CLOSE_MATCH_RATIO
      && [...runnerUp.matched].some((word) => matched.has(word))
      ? runnerUp.entry.detail
      : null;
    return {
      id: detail.id,
      name: detail.name,
      kind: detail.kind,
      category: detail.category,
      reason: detail.chooseWhen,
      score: Math.round(score * 100) / 100,
      closeTo: rival ? { id: rival.id, name: rival.name, reason: rival.chooseWhen } : null,
    };
  });
}

const toolMatcherApi = { matchTools, tokens };

if (typeof module !== 'undefined' && module.exports) module.exports = toolMatcherApi;
if (typeof window !== 'undefined') window.CCTIToolMatcher = toolMatcherApi;
