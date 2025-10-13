'use strict';

const { splitCsvLine, joinCsvLine } = require('./csv');
const { FILE_KEYS } = require('./parser');

function fixCompObj(content) {
  const lines = String(content || '').split(/\n/);
  return lines
    .map(line => line.replace(/\r$/, ''))
    .map(line => {
      const cells = splitCsvLine(line);
      if (cells.length >= 4 && typeof cells[3] === 'string') {
        cells[3] = cells[3].replace(/-/g, '_').trim();
      }
      for (let i = 0; i < cells.length; i += 1) {
        if (cells[i] === ' ') {
          cells[i] = '';
        }
      }
      return joinCsvLine(cells);
    })
    .join('\n');
}

function fixGeneric(content) {
  const lines = String(content || '').split(/\n/);
  return lines
    .map(line => line.replace(/\r$/, ''))
    .map(line => line.replace(/,\s,/, ',,'))
    .join('\n');
}

function autoFix(files) {
  const next = { ...files };
  FILE_KEYS.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return;
    }
    if (key === 'compobj.txt') {
      next[key] = fixCompObj(next[key]);
    } else {
      next[key] = fixGeneric(next[key]);
    }
  });
  return next;
}

module.exports = {
  autoFix,
};
