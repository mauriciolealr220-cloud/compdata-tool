'use strict';

/**
 * Split a CSV line on commas while preserving empty fields. The files used by the
 * game never escape commas, so a simple split is sufficient, but we still trim
 * trailing carriage returns.
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  if (typeof line !== 'string') {
    return [];
  }
  const cleaned = line.replace(/\r$/, '');
  // Splitting on commas preserves consecutive commas as empty strings which is
  // exactly what the data format expects.
  return cleaned.split(',');
}

/**
 * Join an array of cells into a CSV line without introducing additional
 * whitespace. This is used when exporting files back to disk.
 * @param {string[]} cells
 * @returns {string}
 */
function joinCsvLine(cells) {
  if (!Array.isArray(cells)) {
    return '';
  }
  return cells.map(cell => (cell == null ? '' : String(cell))).join(',');
}

module.exports = {
  splitCsvLine,
  joinCsvLine,
};
