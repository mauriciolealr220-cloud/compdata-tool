'use strict';

const { FILE_KEYS } = require('./parser');

function buildIdMaps(compobj) {
  const ids = new Map();
  const byLevel = new Map();
  compobj.entries.forEach(entry => {
    if (!Number.isNaN(entry.id)) {
      ids.set(entry.id, entry);
      if (!byLevel.has(entry.level)) {
        byLevel.set(entry.level, new Map());
      }
      byLevel.get(entry.level).set(entry.id, entry);
    }
  });
  return { ids, byLevel };
}

function createIssue({ file, line, severity = 'error', code, message, details }) {
  return { file, line, severity, code, message, details };
}

function validateCompObj(compobj) {
  const issues = [];
  const seen = new Set();
  compobj.entries.forEach(entry => {
    if (Number.isNaN(entry.id)) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'INVALID_ID',
        message: 'Entry is missing a numeric ID.',
      }));
      return;
    }
    if (seen.has(entry.id)) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'DUPLICATE_ID',
        message: `Duplicate ID ${entry.id}.`,
      }));
    } else {
      seen.add(entry.id);
    }
    if (Number.isNaN(entry.level) || entry.level < 1 || entry.level > 5) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'INVALID_LEVEL',
        message: `Invalid level ${entry.level}.`,
      }));
    }
    if (entry.parentId && Number.isNaN(entry.parentId)) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'INVALID_PARENT',
        message: 'Parent ID must be numeric.',
      }));
    }
  });

  const indexById = new Map();
  compobj.entries.forEach((entry, index) => {
    indexById.set(entry.id, index);
  });

  compobj.entries.forEach(entry => {
    if (!entry.parentId) {
      return;
    }
    if (!indexById.has(entry.parentId)) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'MISSING_PARENT',
        message: `Parent ID ${entry.parentId} does not exist.`,
      }));
      return;
    }
    const parentIndex = indexById.get(entry.parentId);
    if (parentIndex > indexById.get(entry.id)) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'FORWARD_PARENT',
        message: 'Parent must appear before the child in compobj.txt.',
      }));
    }
    const parent = compobj.entries[parentIndex];
    if (parent && parent.level + 1 !== entry.level) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'LEVEL_MISMATCH',
        message: `Level ${entry.level} must be exactly one greater than parent level ${parent.level}.`,
      }));
    }
  });

  compobj.entries.forEach(entry => {
    if (entry.level === 4 && entry.name.includes('-')) {
      issues.push(createIssue({
        file: 'compobj.txt',
        line: entry.lineNumber,
        code: 'HYPHEN_IN_STAGE',
        severity: 'warning',
        message: 'Stage names should not include hyphens. Use underscores instead.',
      }));
    }
  });

  return issues;
}

function validateSettings(settings, idMaps) {
  const issues = [];
  settings.forEach(setting => {
    if (Number.isNaN(setting.targetId)) {
      issues.push(createIssue({
        file: 'settings.txt',
        line: setting.lineNumber,
        code: 'INVALID_TARGET',
        message: 'Target ID must be numeric.',
      }));
      return;
    }
    if (!idMaps.ids.has(setting.targetId)) {
      issues.push(createIssue({
        file: 'settings.txt',
        line: setting.lineNumber,
        code: 'UNKNOWN_TARGET',
        message: `Referenced ID ${setting.targetId} is not present in compobj.txt.`,
      }));
    }
    if (setting.key === 'match_stagetype' && !setting.value) {
      issues.push(createIssue({
        file: 'settings.txt',
        line: setting.lineNumber,
        code: 'MISSING_STAGE_TYPE',
        severity: 'warning',
        message: 'Stage settings should define match_stagetype.',
      }));
    }
  });
  return issues;
}

function validateAdvancement(advancement, idMaps) {
  const issues = [];
  advancement.forEach(row => {
    if (!row.cells.length) {
      return;
    }
    const [fromId, fromSlot, toId] = row.cells;
    if (fromId && !Number.isNaN(Number(fromId))) {
      const id = Number(fromId);
      const source = idMaps.ids.get(id);
      if (!source) {
        issues.push(createIssue({
          file: 'advancement.txt',
          line: row.lineNumber,
          code: 'UNKNOWN_SOURCE_GROUP',
          message: `Source group ${id} does not exist.`,
        }));
      } else if (source.level !== 5) {
        issues.push(createIssue({
          file: 'advancement.txt',
          line: row.lineNumber,
          code: 'SOURCE_NOT_GROUP',
          message: `Source ID ${id} must be a level 5 group.`,
        }));
      }
    }
    if (toId && !Number.isNaN(Number(toId))) {
      const id = Number(toId);
      if (!idMaps.ids.has(id)) {
        issues.push(createIssue({
          file: 'advancement.txt',
          line: row.lineNumber,
          code: 'UNKNOWN_DESTINATION',
          message: `Destination ID ${id} does not exist.`,
        }));
      }
    }
    if (fromSlot && Number(fromSlot) < 0) {
      issues.push(createIssue({
        file: 'advancement.txt',
        line: row.lineNumber,
        code: 'INVALID_SLOT',
        message: 'Advancement slot must be positive.',
      }));
    }
  });
  return issues;
}

function validateSchedule(schedule, idMaps) {
  const issues = [];
  schedule.forEach(row => {
    if (Number.isNaN(row.stageId)) {
      issues.push(createIssue({
        file: 'schedule.txt',
        line: row.lineNumber,
        code: 'INVALID_STAGE',
        message: 'Stage ID must be numeric.',
      }));
      return;
    }
    const stage = idMaps.ids.get(row.stageId);
    if (!stage) {
      issues.push(createIssue({
        file: 'schedule.txt',
        line: row.lineNumber,
        code: 'UNKNOWN_STAGE',
        message: `Stage ${row.stageId} is not defined in compobj.txt.`,
      }));
    } else if (stage.level !== 4) {
      issues.push(createIssue({
        file: 'schedule.txt',
        line: row.lineNumber,
        code: 'STAGE_NOT_LEVEL4',
        message: `Stage ${row.stageId} must be level 4.`,
      }));
    }
    if (!Number.isNaN(row.minGames) && !Number.isNaN(row.maxGames) && row.minGames > row.maxGames) {
      issues.push(createIssue({
        file: 'schedule.txt',
        line: row.lineNumber,
        code: 'RANGE_ERROR',
        message: 'Minimum games cannot exceed maximum games.',
      }));
    }
    if (!Number.isNaN(row.blockCount) && row.blockCount <= 0) {
      issues.push(createIssue({
        file: 'schedule.txt',
        line: row.lineNumber,
        code: 'INVALID_BLOCK_COUNT',
        message: 'Matchday block count must be positive.',
      }));
    }
  });
  return issues;
}

function validateStandings(standings, idMaps) {
  const issues = [];
  standings.forEach(row => {
    if (Number.isNaN(row.groupId)) {
      issues.push(createIssue({
        file: 'standings.txt',
        line: row.lineNumber,
        code: 'INVALID_GROUP',
        message: 'Group ID must be numeric.',
      }));
      return;
    }
    const group = idMaps.ids.get(row.groupId);
    if (!group) {
      issues.push(createIssue({
        file: 'standings.txt',
        line: row.lineNumber,
        code: 'UNKNOWN_GROUP',
        message: `Group ${row.groupId} does not exist.`,
      }));
    } else if (group.level !== 5) {
      issues.push(createIssue({
        file: 'standings.txt',
        line: row.lineNumber,
        code: 'GROUP_NOT_LEVEL5',
        message: 'Standings must reference level 5 group IDs.',
      }));
    }
  });
  return issues;
}

function validateTasks(tasks, idMaps) {
  const issues = [];
  tasks.forEach(row => {
    if (Number.isNaN(row.compId)) {
      issues.push(createIssue({
        file: 'tasks.txt',
        line: row.lineNumber,
        code: 'INVALID_COMP_ID',
        message: 'Competition ID must be numeric.',
      }));
      return;
    }
    if (!idMaps.ids.has(row.compId)) {
      issues.push(createIssue({
        file: 'tasks.txt',
        line: row.lineNumber,
        code: 'UNKNOWN_COMP_ID',
        message: `Competition ${row.compId} does not exist in compobj.txt.`,
      }));
    }
    row.cells.forEach((value, index) => {
      if (!value) {
        return;
      }
      if (index === 3 || index === 4) {
        const id = Number(value);
        if (!Number.isNaN(id) && !idMaps.ids.has(id)) {
          issues.push(createIssue({
            file: 'tasks.txt',
            line: row.lineNumber,
            code: 'UNKNOWN_TASK_TARGET',
            message: `Task references unknown ID ${id}.`,
            severity: 'warning',
          }));
        }
      }
    });
  });
  return issues;
}

function validateWeather(weather, idMaps) {
  const issues = [];
  const federations = idMaps.byLevel.get(1) || new Map();
  const seenFederations = new Set();
  weather.forEach(row => {
    if (Number.isNaN(row.federationId)) {
      issues.push(createIssue({
        file: 'weather.txt',
        line: row.lineNumber,
        code: 'INVALID_FED_ID',
        message: 'Federation ID must be numeric.',
      }));
      return;
    }
    seenFederations.add(row.federationId);
    if (!federations.has(row.federationId)) {
      issues.push(createIssue({
        file: 'weather.txt',
        line: row.lineNumber,
        code: 'UNKNOWN_FED',
        message: `Federation ${row.federationId} does not exist.`,
      }));
    }
  });

  federations.forEach((value, id) => {
    if (!seenFederations.has(id)) {
      issues.push(createIssue({
        file: 'weather.txt',
        line: 0,
        code: 'MISSING_FED_ROW',
        severity: 'warning',
        message: `Federation ${id} is missing weather entries.`,
      }));
    }
  });

  return issues;
}

function validateObjectives(objectives, idMaps) {
  const issues = [];
  objectives.forEach(row => {
    if (Number.isNaN(row.targetId)) {
      issues.push(createIssue({
        file: 'objectives.txt',
        line: row.lineNumber,
        code: 'INVALID_TARGET',
        message: 'Target ID must be numeric.',
      }));
      return;
    }
    if (!idMaps.ids.has(row.targetId)) {
      issues.push(createIssue({
        file: 'objectives.txt',
        line: row.lineNumber,
        code: 'UNKNOWN_TARGET',
        message: `Target ${row.targetId} does not exist.`,
      }));
    }
  });
  return issues;
}

function validateAll(model) {
  const idMaps = buildIdMaps(model.compobj);
  const issues = [];
  issues.push(...validateCompObj(model.compobj));
  issues.push(...validateSettings(model.settings, idMaps));
  issues.push(...validateAdvancement(model.advancement, idMaps));
  issues.push(...validateSchedule(model.schedule, idMaps));
  issues.push(...validateStandings(model.standings, idMaps));
  issues.push(...validateTasks(model.tasks, idMaps));
  issues.push(...validateWeather(model.weather, idMaps));
  issues.push(...validateObjectives(model.objectives, idMaps));
  const ok = issues.every(issue => issue.severity !== 'error');
  return { ok, issues };
}

module.exports = {
  validateAll,
  buildIdMaps,
  FILE_KEYS,
};
