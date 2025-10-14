'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { splitCsvLine, joinCsvLine } = require('./csv');

const FILE_SCHEMAS = {
  'compobj.txt': {
    label: 'Competition Structure',
    description: 'Defines competition hierarchy and structure.',
    columns: [
      { key: 'LineID', label: 'Line', type: 'number', readOnly: true },
      { key: 'Level', label: 'Level', type: 'number' },
      { key: 'Code', label: 'Code', type: 'text' },
      { key: 'Name', label: 'Name', type: 'text' },
      { key: 'ParentLine', label: 'Parent Line', type: 'number' },
    ],
    references: ['ParentLine'],
    defaultRow: () => ({
      LineID: '',
      Level: '1',
      Code: 'CNEW',
      Name: 'New Competition',
      ParentLine: '',
    }),
  },
  'schedule.txt': {
    label: 'Schedule Editor',
    description: 'Match order and fixture mapping.',
    columns: [
      { key: 'StageLine', label: 'Stage Line', type: 'number' },
      { key: 'Round', label: 'Round', type: 'number' },
      { key: 'MatchID', label: 'Match ID', type: 'text' },
      { key: 'HomeRef', label: 'Home Ref', type: 'text' },
      { key: 'AwayRef', label: 'Away Ref', type: 'text' },
      { key: 'Date', label: 'Date', type: 'text' },
      { key: 'Stadium', label: 'Stadium', type: 'text' },
      { key: 'Time', label: 'Time', type: 'text' },
    ],
    references: ['StageLine'],
    defaultRow: () => ({
      StageLine: '',
      Round: '1',
      MatchID: 'M1',
      HomeRef: '',
      AwayRef: '',
      Date: '20230801',
      Stadium: 'Default',
      Time: '1900',
    }),
  },
  'tasks.txt': {
    label: 'Task Automation',
    description: 'Automated game events and triggers.',
    columns: [
      { key: 'TaskType', label: 'Task Type', type: 'text' },
      { key: 'Trigger', label: 'Trigger', type: 'text' },
      { key: 'Action', label: 'Action', type: 'text' },
      { key: 'TargetStage', label: 'Target Stage', type: 'number' },
      { key: 'Param1', label: 'Param 1', type: 'text' },
      { key: 'Param2', label: 'Param 2', type: 'text' },
    ],
    references: ['TargetStage'],
    defaultRow: () => ({
      TaskType: 'FillWithTeams',
      Trigger: 'OnStart',
      Action: 'Populate',
      TargetStage: '',
      Param1: '',
      Param2: '',
    }),
  },
  'advancement.txt': {
    label: 'Advancement Rules',
    description: 'Promotion, relegation, and playoff flows.',
    columns: [
      { key: 'StageFrom', label: 'Stage From', type: 'number' },
      { key: 'PositionFrom', label: 'Position From', type: 'number' },
      { key: 'StageTo', label: 'Stage To', type: 'number' },
      { key: 'PositionTo', label: 'Position To', type: 'number' },
      { key: 'Type', label: 'Type', type: 'text' },
    ],
    references: ['StageFrom', 'StageTo'],
    defaultRow: () => ({
      StageFrom: '',
      PositionFrom: '1',
      StageTo: '',
      PositionTo: '1',
      Type: 'Promotion',
    }),
  },
  'settings.txt': {
    label: 'Competition Settings',
    description: 'Competition-specific configuration.',
    columns: [
      { key: 'CompetitionLine', label: 'Competition Line', type: 'number' },
      { key: 'Rule', label: 'Rule', type: 'text' },
      { key: 'Value', label: 'Value', type: 'text' },
    ],
    references: ['CompetitionLine'],
    defaultRow: () => ({
      CompetitionLine: '',
      Rule: 'MaxTeams',
      Value: '16',
    }),
  },
  'weather.txt': {
    label: 'Weather Config',
    description: 'Match environment and conditions.',
    columns: [
      { key: 'CompetitionLine', label: 'Competition Line', type: 'number' },
      { key: 'Season', label: 'Season', type: 'text' },
      { key: 'Region', label: 'Region', type: 'text' },
      { key: 'WeatherType', label: 'Weather Type', type: 'text' },
      { key: 'Temperature', label: 'Temperature', type: 'number' },
      { key: 'ChanceOfRain', label: 'Chance Of Rain', type: 'number' },
    ],
    references: ['CompetitionLine'],
    defaultRow: () => ({
      CompetitionLine: '',
      Season: 'Summer',
      Region: 'Default',
      WeatherType: 'Clear',
      Temperature: '22',
      ChanceOfRain: '5',
    }),
  },
  'standings.txt': {
    label: 'Standings Rules',
    description: 'Standings table configurations and ranking priorities.',
    columns: [
      { key: 'StageLine', label: 'Stage Line', type: 'number' },
      { key: 'Rule', label: 'Rule', type: 'text' },
      { key: 'Parameter', label: 'Parameter', type: 'text' },
    ],
    references: ['StageLine'],
    defaultRow: () => ({
      StageLine: '',
      Rule: 'Points',
      Parameter: '',
    }),
  },
  'objectives.txt': {
    label: 'Objectives',
    description: 'Manager and club objectives.',
    columns: [
      { key: 'CompetitionLine', label: 'Competition Line', type: 'number' },
      { key: 'ObjectiveType', label: 'Objective Type', type: 'text' },
      { key: 'TargetValue', label: 'Target Value', type: 'text' },
      { key: 'Importance', label: 'Importance', type: 'text' },
      { key: 'Reward', label: 'Reward', type: 'text' },
    ],
    references: ['CompetitionLine'],
    defaultRow: () => ({
      CompetitionLine: '',
      ObjectiveType: 'ReachRound',
      TargetValue: 'QuarterFinal',
      Importance: 'High',
      Reward: 'BudgetBoost',
    }),
  },
};

const FILE_ORDER = Object.keys(FILE_SCHEMAS);

function generateRowId() {
  return crypto.randomUUID();
}

function normaliseLineEndings(content) {
  return String(content || '').replace(/\r\n/g, '\n');
}

function sanitiseValue(value, column) {
  const raw = value == null ? '' : String(value);
  if (column.type === 'number') {
    if (!raw.trim()) {
      return '';
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      throw new Error(`Value for ${column.key} must be numeric.`);
    }
    return String(parsed);
  }
  return raw;
}

function safeNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function cloneRowForClient(row, schema) {
  const payload = { __id: row.__id };
  schema.columns.forEach(column => {
    payload[column.key] = row[column.key] ?? '';
  });
  return payload;
}

function backupFilePath(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.txt');
  return path.join(dir, `${base}_backup.txt`);
}

class Workspace {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.files = new Map();
    this.dirty = false;
    this.lastSaved = null;
    this.lastReferenceStats = { updated: 0, lineMap: {} };
    this.modifiedAt = null;
  }

  async loadAll() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    for (const name of FILE_ORDER) {
      const schema = FILE_SCHEMAS[name];
      const filePath = path.join(this.dataDir, name);
      let content = '';
      try {
        content = await fsp.readFile(filePath, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      const rows = this.#parseRows(schema, normaliseLineEndings(content));
      this.files.set(name, { schema, rows });
    }
    this.recalculate(false);
  }

  describe() {
    return {
      files: FILE_ORDER.map(name => this.getFileState(name)),
      status: this.getStatus(),
      references: this.lastReferenceStats,
    };
  }

  getStatus() {
    return {
      dirty: this.dirty,
      lastSaved: this.lastSaved,
      modifiedAt: this.modifiedAt,
      totalLines: this.getTotalLines(),
      referenceUpdates: this.lastReferenceStats.updated,
    };
  }

  getTotalLines() {
    let total = 0;
    for (const entry of this.files.values()) {
      total += entry.rows.length;
    }
    return total;
  }

  getFileState(name) {
    const entry = this.#ensureFile(name);
    return {
      name,
      label: entry.schema.label,
      description: entry.schema.description,
      columns: entry.schema.columns,
      rows: entry.rows.map(row => cloneRowForClient(row, entry.schema)),
    };
  }

  insertRow(name, { index = null, row: provided } = {}) {
    const entry = this.#ensureFile(name);
    const template = this.#createDefaultRow(entry.schema);
    const newRow = this.#materialiseRow(entry.schema, { ...template, ...(provided || {}) });
    if (typeof index === 'number' && index >= 0 && index <= entry.rows.length) {
      entry.rows.splice(index, 0, newRow);
    } else {
      entry.rows.push(newRow);
    }
    this.#markDirty();
    const result = { row: cloneRowForClient(newRow, entry.schema) };
    if (name === 'compobj.txt') {
      result.references = this.recalculate();
    }
    return result;
  }

  deleteRows(name, rowIds = []) {
    const entry = this.#ensureFile(name);
    const idSet = new Set(rowIds);
    const initial = entry.rows.length;
    entry.rows = entry.rows.filter(row => !idSet.has(row.__id));
    const removed = initial - entry.rows.length;
    if (removed === 0) {
      return { removed: 0 };
    }
    this.#markDirty();
    const result = { removed };
    if (name === 'compobj.txt') {
      result.references = this.recalculate();
    }
    return result;
  }

  updateCell(name, rowId, key, value) {
    const entry = this.#ensureFile(name);
    const column = entry.schema.columns.find(col => col.key === key);
    if (!column) {
      throw new Error(`Column ${key} does not exist for ${name}.`);
    }
    const row = entry.rows.find(item => item.__id === rowId);
    if (!row) {
      throw new Error(`Row ${rowId} not found in ${name}.`);
    }
    if (column.readOnly) {
      return { row: cloneRowForClient(row, entry.schema) };
    }
    row[key] = sanitiseValue(value, column);
    this.#markDirty();
    const result = { row: cloneRowForClient(row, entry.schema) };
    if (name === 'compobj.txt' && key === 'LineID') {
      result.references = this.recalculate();
    }
    return result;
  }

  reorder(name, order = []) {
    const entry = this.#ensureFile(name);
    if (!Array.isArray(order) || order.length !== entry.rows.length) {
      throw new Error('Reorder request must include every row identifier.');
    }
    const map = new Map(entry.rows.map(row => [row.__id, row]));
    const reordered = order.map(id => {
      if (!map.has(id)) {
        throw new Error(`Unknown row id ${id} provided for reorder.`);
      }
      return map.get(id);
    });
    entry.rows = reordered;
    this.#markDirty();
    const result = {};
    if (name === 'compobj.txt') {
      result.references = this.recalculate();
    }
    return result;
  }

  recalculate(markDirty = true) {
    const entry = this.#ensureFile('compobj.txt');
    if (entry.rows.length === 0) {
      this.lastReferenceStats = { updated: 0, lineMap: {} };
      if (markDirty) {
        this.#markDirty();
      }
      return this.lastReferenceStats;
    }
    const previousIds = entry.rows.map(row => safeNumber(row.LineID));
    const lineMap = new Map();
    entry.rows.forEach((row, index) => {
      const newId = index + 1;
      const previous = previousIds[index];
      if (previous != null && previous > 0) {
        lineMap.set(previous, newId);
      }
      row.LineID = String(newId);
    });

    let updates = 0;
    const applyReferences = (rows, schema) => {
      if (!schema.references || schema.references.length === 0) {
        return;
      }
      rows.forEach(row => {
        schema.references.forEach(field => {
          const current = safeNumber(row[field]);
          if (current == null) {
            return;
          }
          if (!lineMap.has(current)) {
            return;
          }
          const mapped = lineMap.get(current);
          if (mapped !== current) {
            row[field] = String(mapped);
            updates += 1;
          }
        });
      });
    };

    applyReferences(entry.rows, entry.schema);
    for (const [name, file] of this.files) {
      if (name === 'compobj.txt') {
        continue;
      }
      applyReferences(file.rows, file.schema);
    }

    const lineMapObject = {};
    for (const [from, to] of lineMap.entries()) {
      lineMapObject[from] = to;
    }
    this.lastReferenceStats = { updated: updates, lineMap: lineMapObject };
    if (markDirty) {
      this.#markDirty();
    }
    return this.lastReferenceStats;
  }

  serializeAll() {
    const result = {};
    for (const name of FILE_ORDER) {
      const entry = this.#ensureFile(name);
      result[name] = entry.rows
        .map(row => entry.schema.columns.map(column => row[column.key] ?? ''))
        .map(cells => joinCsvLine(cells))
        .join('\n');
    }
    return result;
  }

  async saveAll() {
    const referenceStats = this.recalculate(false);
    const files = this.serializeAll();
    const saved = [];
    for (const name of FILE_ORDER) {
      const content = files[name] ?? '';
      const filePath = path.join(this.dataDir, name);
      try {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        if (fs.existsSync(filePath)) {
          const backupPath = backupFilePath(filePath);
          await fsp.copyFile(filePath, backupPath);
        }
        await fsp.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
        saved.push({ name, bytes: Buffer.byteLength(content, 'utf8') });
      } catch (error) {
        throw new Error(`Failed to save ${name}: ${error.message}`);
      }
    }
    this.dirty = false;
    this.lastSaved = new Date().toISOString();
    return { saved, references: referenceStats };
  }

  toJSON() {
    return this.describe();
  }

  #ensureFile(name) {
    const entry = this.files.get(name);
    if (!entry) {
      throw new Error(`Unknown file ${name}`);
    }
    return entry;
  }

  #markDirty() {
    this.dirty = true;
    this.modifiedAt = new Date().toISOString();
  }

  #parseRows(schema, content) {
    const lines = normaliseLineEndings(content).split('\n');
    const rows = [];
    lines.forEach(line => {
      if (!line && lines.length === 1) {
        return;
      }
      if (!line.trim()) {
        return;
      }
      const cells = splitCsvLine(line);
      const row = { __id: generateRowId() };
      schema.columns.forEach((column, index) => {
        row[column.key] = cells[index] ?? '';
      });
      rows.push(row);
    });
    return rows;
  }

  #createDefaultRow(schema) {
    const base = {};
    if (typeof schema.defaultRow === 'function') {
      Object.assign(base, schema.defaultRow());
    } else if (schema.defaultRow && typeof schema.defaultRow === 'object') {
      Object.assign(base, schema.defaultRow);
    }
    schema.columns.forEach(column => {
      if (!Object.prototype.hasOwnProperty.call(base, column.key)) {
        base[column.key] = '';
      }
    });
    return base;
  }

  #materialiseRow(schema, values) {
    const row = { __id: generateRowId() };
    schema.columns.forEach(column => {
      const incoming = Object.prototype.hasOwnProperty.call(values, column.key)
        ? values[column.key]
        : '';
      row[column.key] = sanitiseValue(incoming, column);
    });
    return row;
  }
}

module.exports = {
  Workspace,
  FILE_SCHEMAS,
  FILE_ORDER,
};
