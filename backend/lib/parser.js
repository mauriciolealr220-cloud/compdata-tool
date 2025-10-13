'use strict';

const { splitCsvLine } = require('./csv');

const FILE_KEYS = [
  'compobj.txt',
  'settings.txt',
  'advancement.txt',
  'schedule.txt',
  'standings.txt',
  'tasks.txt',
  'weather.txt',
  'objectives.txt',
];

function normaliseKey(key) {
  if (!key) return '';
  return key.trim().toLowerCase();
}

function requireFiles(files) {
  const lowerMap = new Map();
  for (const [name, content] of Object.entries(files || {})) {
    lowerMap.set(normaliseKey(name), { name, content });
  }
  const result = {};
  for (const key of FILE_KEYS) {
    const lookup = lowerMap.get(normaliseKey(key));
    if (!lookup) {
      throw new Error(`Missing required file: ${key}`);
    }
    result[key] = lookup.content;
  }
  return result;
}

function parseFileLines(rawContent) {
  const lines = String(rawContent || '').split(/\n/);
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function parseCompObj(content) {
  const lines = parseFileLines(content);
  const entries = [];
  const byId = new Map();
  const children = new Map();
  lines.forEach((line, index) => {
    const cells = splitCsvLine(line);
    const [id, level, code, name, parentId] = cells;
    const entry = {
      id: id ? Number(id) : NaN,
      level: level ? Number(level) : NaN,
      code: code || '',
      name: name || '',
      parentId: parentId ? Number(parentId) : 0,
      raw: line,
      lineNumber: index + 1,
      cells,
    };
    entries.push(entry);
    if (!Number.isNaN(entry.id)) {
      byId.set(entry.id, entry);
      if (!children.has(entry.parentId || 0)) {
        children.set(entry.parentId || 0, []);
      }
      children.get(entry.parentId || 0).push(entry);
    }
  });
  return { lines, entries, byId, children };
}

function parseSettings(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const [targetId, key, value] = splitCsvLine(line);
    return {
      targetId: targetId ? Number(targetId) : NaN,
      key: key || '',
      value: value || '',
      raw: line,
      lineNumber: index + 1,
    };
  });
}

function parseAdvancement(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const cells = splitCsvLine(line);
    return {
      raw: line,
      lineNumber: index + 1,
      cells,
    };
  });
}

function parseSchedule(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const [stageId, dateCode, blockCount, minGames, maxGames, timeCode] = splitCsvLine(line);
    return {
      stageId: stageId ? Number(stageId) : NaN,
      dateCode: dateCode || '',
      blockCount: blockCount ? Number(blockCount) : NaN,
      minGames: minGames ? Number(minGames) : NaN,
      maxGames: maxGames ? Number(maxGames) : NaN,
      timeCode: timeCode || '',
      raw: line,
      lineNumber: index + 1,
    };
  });
}

function parseStandings(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const [groupId, countCode] = splitCsvLine(line);
    return {
      groupId: groupId ? Number(groupId) : NaN,
      countCode: countCode ? Number(countCode) : NaN,
      raw: line,
      lineNumber: index + 1,
    };
  });
}

function parseTasks(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const cells = splitCsvLine(line);
    return {
      compId: cells[0] ? Number(cells[0]) : NaN,
      phase: cells[1] || '',
      action: cells[2] || '',
      cells,
      raw: line,
      lineNumber: index + 1,
    };
  });
}

function parseWeather(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const cells = splitCsvLine(line);
    const federationId = cells.length ? Number(cells[0]) : NaN;
    return {
      federationId,
      cells,
      raw: line,
      lineNumber: index + 1,
    };
  });
}

function parseObjectives(content) {
  const lines = parseFileLines(content);
  return lines.map((line, index) => {
    const [targetId, key, value] = splitCsvLine(line);
    return {
      targetId: targetId ? Number(targetId) : NaN,
      key: key || '',
      value: value || '',
      raw: line,
      lineNumber: index + 1,
    };
  });
}

function parseFiles(files) {
  const required = requireFiles(files);
  const compobj = parseCompObj(required['compobj.txt']);
  return {
    compobj,
    settings: parseSettings(required['settings.txt']),
    advancement: parseAdvancement(required['advancement.txt']),
    schedule: parseSchedule(required['schedule.txt']),
    standings: parseStandings(required['standings.txt']),
    tasks: parseTasks(required['tasks.txt']),
    weather: parseWeather(required['weather.txt']),
    objectives: parseObjectives(required['objectives.txt']),
  };
}

module.exports = {
  parseFiles,
  parseCompObj,
  parseSettings,
  parseAdvancement,
  parseSchedule,
  parseStandings,
  parseTasks,
  parseWeather,
  parseObjectives,
  FILE_KEYS,
};
