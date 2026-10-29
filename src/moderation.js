// Blocks slurs and explicit words in usernames and comments.
// Uses the "obscenity" word list, which also catches look-alike spellings
// (numbers for letters, extra symbols, repeated letters) without flagging
// innocent words like "Scunthorpe" or "assassin".
let matcher = null;
try {
  const { RegExpMatcher, englishDataset, englishRecommendedTransformers } = require('obscenity');
  matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
} catch {
  console.warn('[moderation] run `npm install` to turn on the word filter');
}

function isOffensive(text) {
  if (!matcher || !text) return false;
  const s = String(text);
  // usernames often join words with _ or digits, so also check with those removed
  return matcher.hasMatch(s) || matcher.hasMatch(s.replace(/[_\d]+/g, ' ')) || matcher.hasMatch(s.replace(/[_\d]+/g, ''));
}

module.exports = { isOffensive };
