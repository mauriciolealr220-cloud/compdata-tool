'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { splitCsvLine, joinCsvLine } = require('./csv');

const DEFAULT_PREFERENCES = {
  theme: 'night-sky',
  compactMode: false,
  showLineNumbers: true,
  showColors: true,
};

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
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    this.preferencesPath = path.join(this.dataDir, 'preferences.json');
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.lastImportSummary = null;
  }

  async loadAll() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.mkdir(this.uploadsDir, { recursive: true });
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
      const { rows } = this.#parseRows(schema, normaliseLineEndings(content));
      this.files.set(name, { schema, rows });
    }
    await this.#loadPreferences();
    this.recalculate(false);
  }

  async importFiles(filePayloads = []) {
    if (!Array.isArray(filePayloads) || filePayloads.length === 0) {
      throw new Error('No files provided for import.');
    }
    await fsp.mkdir(this.uploadsDir, { recursive: true });
    const summary = [];
    for (const payload of filePayloads) {
      if (!payload || typeof payload.content !== 'string') {
        continue;
      }
      const resolvedName = this.#resolveFileName(payload.detectedName || payload.name, payload.content);
      const schema = FILE_SCHEMAS[resolvedName];
      const normalised = normaliseLineEndings(payload.content);
      const { rows, issues } = this.#parseRows(schema, normalised);
      this.files.set(resolvedName, { schema, rows });
      const originalName = payload.name || payload.originalName || resolvedName;
      summary.push({
        name: resolvedName,
        originalName,
        lines: rows.length,
        issues,
      });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploadName = `${timestamp}_${path.basename(originalName).replace(/[^a-z0-9_.-]+/gi, '-')}`;
      const uploadPath = path.join(this.uploadsDir, uploadName);
      await fsp.writeFile(uploadPath, normalised ? `${normalised}\n` : '', 'utf8');
    }
    this.lastImportSummary = {
      completedAt: new Date().toISOString(),
      files: summary,
    };
    this.recalculate(false);
    this.#markDirty();
    return this.lastImportSummary;
  }

  describe() {
    return {
      files: FILE_ORDER.map(name => this.getFileState(name)),
      status: this.getStatus(),
      references: this.lastReferenceStats,
      preferences: this.preferences,
      importSummary: this.lastImportSummary,
    };
  }

  getStatus() {
    return {
      dirty: this.dirty,
      lastSaved: this.lastSaved,
      modifiedAt: this.modifiedAt,
      totalLines: this.getTotalLines(),
      referenceUpdates: this.lastReferenceStats.updated,
      filesLoaded: this.files.size,
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
      this.lastReferenceStats = { updated: 0, lineMap: {}, broken: 0, missing: 0 };
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
    let broken = 0;
    let missing = 0;
    const validLines = new Set(entry.rows.map(row => Number(row.LineID)).filter(num => Number.isFinite(num)));

    const applyReferences = (rows, schema, options = {}) => {
      if (!schema.references || schema.references.length === 0) {
        return;
      }
      rows.forEach(row => {
        schema.references.forEach(field => {
          const current = safeNumber(row[field]);
          if (current == null) {
            return;
          }
          if (current <= 0) {
            return;
          }
          const mapped = lineMap.get(current);
          if (mapped == null) {
            if (!validLines.has(current)) {
              broken += 1;
              if (options.trackMissingParent) {
                missing += 1;
              }
            }
            return;
          }
          if (mapped !== current) {
            row[field] = String(mapped);
            updates += 1;
          }
        });
      });
    };

    applyReferences(entry.rows, entry.schema, { trackMissingParent: true });
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
    this.lastReferenceStats = { updated: updates, lineMap: lineMapObject, broken, missing };
    if (markDirty) {
      this.#markDirty();
    }
    return this.lastReferenceStats;
  }

  syncReferences() {
    const references = this.recalculate();
    return { references, status: this.getStatus() };
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

  serializeFile(name) {
    const entry = this.#ensureFile(name);
    return entry.rows
      .map(row => entry.schema.columns.map(column => row[column.key] ?? ''))
      .map(cells => joinCsvLine(cells))
      .join('\n');
  }

  listFiles() {
    return FILE_ORDER.map(name => {
      const entry = this.#ensureFile(name);
      return {
        name,
        label: entry.schema.label,
        description: entry.schema.description,
        lines: entry.rows.length,
      };
    });
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

  getPreferences() {
    return this.preferences;
  }

  async savePreferences(preferences = {}) {
    this.preferences = { ...DEFAULT_PREFERENCES, ...this.preferences, ...preferences };
    await fsp.mkdir(path.dirname(this.preferencesPath), { recursive: true });
    await fsp.writeFile(this.preferencesPath, JSON.stringify(this.preferences, null, 2), 'utf8');
    return this.preferences;
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
    const issues = [];
    lines.forEach((line, index) => {
      if (!line && lines.length === 1) {
        return;
      }
      if (!line.trim()) {
        return;
      }
      const cells = splitCsvLine(line);
      if (cells.length < schema.columns.length) {
        issues.push({
          severity: 'warning',
          line: index + 1,
          message: `Missing columns ${cells.length + 1}–${schema.columns.length}`,
        });
      } else if (cells.length > schema.columns.length) {
        issues.push({
          severity: 'warning',
          line: index + 1,
          message: `Extra columns beyond ${schema.columns.length}`,
        });
      }
      const row = { __id: generateRowId() };
      schema.columns.forEach((column, colIndex) => {
        row[column.key] = cells[colIndex] ?? '';
      });
      rows.push(row);
    });
    return { rows, issues };
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

  async #loadPreferences() {
    try {
      const raw = await fsp.readFile(this.preferencesPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.preferences = { ...DEFAULT_PREFERENCES, ...parsed };
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.preferences = { ...DEFAULT_PREFERENCES };
        return;
      }
      throw error;
    }
  }

  #resolveFileName(rawName, content) {
    if (rawName) {
      const lookup = String(rawName).trim().toLowerCase();
      const direct = FILE_ORDER.find(file => file.toLowerCase() === lookup);
      if (direct) {
        return direct;
      }
      const base = path.basename(String(rawName)).toLowerCase();
      const baseMatch = FILE_ORDER.find(file => file.toLowerCase() === base);
      if (baseMatch) {
        return baseMatch;
      }
    }
    const detected = this.#detectFromContent(content);
    if (!detected) {
      throw new Error(`Unable to detect file type for ${rawName || 'uploaded file'}.`);
    }
    return detected;
  }

  #detectFromContent(content) {
    if (!content) {
      return null;
    }
    const lines = normaliseLineEndings(content)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!lines.length) {
      return null;
    }
    let bestMatch = null;
    let bestScore = -Infinity;
    for (const name of FILE_ORDER) {
      const schema = FILE_SCHEMAS[name];
      let score = 0;
      lines.forEach(line => {
        const cells = splitCsvLine(line);
        if (cells.length === schema.columns.length) {
          score += 5;
        } else {
          score -= Math.abs(schema.columns.length - cells.length) * 3;
        }
        schema.columns.forEach((column, index) => {
          const cell = (cells[index] || '').trim();
          if (!cell) {
            score += 0.25;
            return;
          }
          if (column.type === 'number') {
            score += /^-?\d+$/.test(cell) ? 1.5 : -1.5;
          } else {
            score += /[A-Za-z]/.test(cell) ? 1 : 0.4;
          }
        });
      });
      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }
    if (bestScore < 0) {
      return null;
    }
    return bestMatch;
  }
}

module.exports = {
  Workspace,
  FILE_SCHEMAS,
  FILE_ORDER,
};
