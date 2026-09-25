// Offline job matching for the Project Interview. Scores the user's own words
// against each catalog item's plain-language "choose this when" text so items
// in the same category that do different jobs are told apart. No network, no I/O.

const FIELD_WEIGHTS = [['chooseWhen', 3], ['example', 2], ['plainPurpose', 1]];
const CATEGORY_WEIGHT = 0.5;
const CLOSE_MATCH_RATIO = 0.85;
const MIN_SCORE = 6;
const RELATIVE_FLOOR = 0.45;
const STOP_WORDS = new Set(('a an and any are as at be but by can do does for from get has have how i if in into is it its just let lets like make me more my need needs not of on one or our out over should so some such than that the their them then there these they this those to too up us use using via want wants was we what when where which while who why will with without would you your yours choose example site website app apps project people person thing things way also only each every first new simple easy easily time get gets work works pick lets run runs keep keeps give gives help helps start store stores add adds show shows call calls create creates build builds support supports feature features small quick quickly fast launch')
  .split(' '));

function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem) || [];
}

function buildIndex(details) {
  const documentFrequency = new Map();
  const entries = details.map((detail) => {
    const fields = FIELD_WEIGHTS.map(([field, weight]) => ({ weight, words: new Set(tokens(detail[field])) }));
    const category = new Set(tokens(detail.category));
    const all = new Set([...fields.flatMap((field) => [...field.words]), ...category]);
    for (const word of all) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
    return { detail, fields, category };
  });
  const total = details.length;
  const idf = (word) => Math.log((total + 1) / ((documentFrequency.get(word) || 0) + 1)) + 1;
  return { entries, idf };
}

function scoreEntry(entry, queryWords, idf) {
  let score = 0;
  for (const word of queryWords) {
    const fieldWeight = entry.fields.reduce((best, field) => (field.words.has(word) ? Math.max(best, field.weight) : best), 0);
    const weight = fieldWeight || (entry.category.has(word) ? CATEGORY_WEIGHT : 0);
    score += weight * idf(word);
  }
  return score;
}

function matchTools(answerText, details, { limit = 6 } = {}) {
  const queryWords = [...new Set(tokens(answerText))];
  if (!queryWords.length || !Array.isArray(details) || !details.length) return [];
  const { entries, idf } = buildIndex(details);
  const ranked = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, queryWords, idf) }))
    .filter((result) => result.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score || left.entry.detail.name.localeCompare(right.entry.detail.name));
  const floor = (ranked[0]?.score || 0) * RELATIVE_FLOOR;
  const kept = ranked.filter((result) => result.score >= floor);
  return kept.slice(0, limit).map(({ entry, score }, index) => {
    const detail = entry.detail;
    // Same category, similar score: state the difference instead of faking a winner.
    const rival = ranked.find((other, otherIndex) => otherIndex !== index
      && other.entry.detail.category === detail.category
      && other.score >= score * CLOSE_MATCH_RATIO
      && other.score <= score / CLOSE_MATCH_RATIO);
    return {
      id: detail.id,
      name: detail.name,
      kind: detail.kind,
      scope: detail.scope,
      category: detail.category,
      reason: detail.chooseWhen,
      score: Math.round(score * 100) / 100,
      closeTo: rival ? { id: rival.entry.detail.id, name: rival.entry.detail.name, reason: rival.entry.detail.chooseWhen } : null,
    };
  });
}

const toolMatcherApi = { matchTools, tokens };

if (typeof module !== 'undefined' && module.exports) module.exports = toolMatcherApi;
if (typeof window !== 'undefined') window.CCTIToolMatcher = toolMatcherApi;
