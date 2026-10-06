(function (root) {
  "use strict";
  const NAME_MAX_LENGTH = 12;
  const NAME_PATTERN = /^[A-Za-z0-9]{1,12}$/;
  const BOARD_SIZE = 10;
  // Only Arcade runs end with a result; Zen has no finish to submit.
  const CATEGORIES = ["arcade-falling", "arcade-stationary"];
  // At most 101 spawns in 90 s at 800 points (×4 combo, ×2 Fever) plus six wave bonuses stays far under this.
  const MAX_SCORE = 300000;

  // Used while typing: drops anything that is not a letter or digit.
  const cleanName = value => String(value ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, NAME_MAX_LENGTH);
  const isValidName = value => typeof value === "string" && NAME_PATTERN.test(value);
  const isValidScore = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_SCORE;
  const isValidCategory = value => CATEGORIES.includes(value);
  const isValidEntry = entry => Boolean(entry) && isValidName(entry.name) && isValidScore(entry.score) && Number.isFinite(entry.at);

  // Higher scores first; ties keep the earlier entry ahead.
  const compare = (a, b) => b.score - a.score || a.at - b.at;
  function addEntry(list, entry) {
    const board = [...list.filter(isValidEntry), entry].sort(compare);
    const rank = board.indexOf(entry) + 1;
    return { board: board.slice(0, BOARD_SIZE), rank: rank <= BOARD_SIZE ? rank : null };
  }

  // Global ranks 1–3 earn a trophy on the results screen.
  const PODIUM = ["gold", "silver", "bronze"];
  const podiumTier = rank => (Number.isInteger(rank) && PODIUM[rank - 1]) || null;

  const api = { podiumTier, NAME_MAX_LENGTH, NAME_PATTERN, BOARD_SIZE, CATEGORIES, MAX_SCORE, cleanName, isValidName, isValidScore, isValidCategory, isValidEntry, addEntry };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PiniLeaderboard = api;
})(typeof window !== "undefined" ? window : globalThis);
