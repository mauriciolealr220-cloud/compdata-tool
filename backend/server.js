'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

const DATA_DIR = path.resolve(__dirname, 'data');
const DEFAULT_DIR = path.resolve(DATA_DIR, 'default');

const FILE_DEFINITIONS = {
  'compobj.txt': {
    label: 'Competition Object Tree',
    description: 'Defines the hierarchical structure of the competition.',
    minColumns: 5,
  },
  'compdata.txt': {
    label: 'Competition Metadata',
    description: 'Key/value competition data pairs.',
    minColumns: 2,
  },
  'schedule.txt': {
    label: 'Match Schedule',
    description: 'Kick-off times and fixture ordering.',
    minColumns: 6,
  },
  'standings.txt': {
    label: 'Standings Rules',
    description: 'Defines ranking rules and tie-breakers.',
    minColumns: 2,
  },
  'tasks.txt': {
    label: 'Competition Tasks',
    description: 'Automation rules for filling and updating the competition.',
    minColumns: 4,
  },
  'weather.txt': {
    label: 'Weather Profiles',
    description: 'Seasonal weather definitions per federation.',
    minColumns: 7,
  },
};

const FILE_NAMES = Object.keys(FILE_DEFINITIONS);

function canonicalName(name) {
  if (!name) {
    throw new Error('File name is required.');
  }
  const lower = name.toLowerCase();
  if (!FILE_DEFINITIONS[lower]) {
    throw new Error(`Unsupported file: ${name}`);
  }
  return lower;
}

async function ensureDirectory(targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  return targetDir;
}

async function resolveFilePath(baseDir, name) {
  const canonical = canonicalName(name);
  const candidates = [
    path.join(baseDir, canonical),
    path.join(baseDir, canonical.replace('.txt', '.TXT')),
    path.join(baseDir, canonical.replace('.txt', '.Txt')),
    path.join(baseDir, canonical.toUpperCase()),
  ];

  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fs.constants.F_OK);
      return candidate;
    } catch (err) {
      // continue searching
    }
  }

  if (baseDir === DATA_DIR) {
    // ensure directory exists so write operations can create files
    await ensureDirectory(baseDir);
    return path.join(baseDir, canonical);
  }

  throw new Error(`File ${name} not found in ${baseDir}`);
}

async function readTextFile(name, baseDir = DATA_DIR) {
  const filePath = await resolveFilePath(baseDir, name);
  const raw = await fsp.readFile(filePath, 'utf8');
  return raw.replace(/\r\n/g, '\n');
}

async function writeTextFile(name, content) {
  const canonical = canonicalName(name);
  await ensureDirectory(DATA_DIR);
  const filePath = path.join(DATA_DIR, canonical);
  await fsp.writeFile(filePath, content, 'utf8');
  return filePath;
}

function mapLines(content) {
  return content
    .split(/\n/)
    .map(line => line.trimEnd())
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(entry => entry.line.length > 0 && !entry.line.trim().startsWith('#'));
}

function validateCompobj(content) {
  const issues = [];
  const nodes = [];
  const lines = mapLines(content);
  const ids = new Map();
  const parents = new Map();

  lines.forEach(({ line, index }) => {
    const parts = line.split(',');
    if (parts.length < 5) {
      issues.push({ line: index, type: 'error', message: 'Expected 5 columns (id, level, code, name, parent).' });
      return;
    }

    const [idRaw, levelRaw, codeRaw, nameRaw, parentRaw] = parts;
    const id = Number(idRaw);
    const level = Number(levelRaw);
    const parentId = Number(parentRaw);
    const code = (codeRaw || '').trim();
    const name = (nameRaw || '').trim();

    if (!Number.isInteger(id)) {
      issues.push({ line: index, type: 'error', message: 'ID must be an integer.' });
    } else if (ids.has(id)) {
      issues.push({ line: index, type: 'error', message: `Duplicate ID ${id}.` });
    } else {
      ids.set(id, index);
    }

    if (!Number.isInteger(level)) {
      issues.push({ line: index, type: 'error', message: 'Level must be an integer.' });
    }

    if (!code) {
      issues.push({ line: index, type: 'error', message: 'Code is required.' });
    }

    if (!name) {
      issues.push({ line: index, type: 'warning', message: 'Name is blank.' });
    }

    if (code.startsWith('S') && name && !name.startsWith('FCE_')) {
      issues.push({ line: index, type: 'warning', message: 'Stage names should use the FCE_ prefix.' });
    }

    if (Number.isInteger(parentId)) {
      parents.set(id, parentId);
    }

    nodes.push({ id, level, parentId, lineIndex: index, raw: line });
  });

  nodes.forEach(node => {
    if (!Number.isInteger(node.parentId) && node.level > 0) {
      issues.push({ line: node.lineIndex, type: 'error', message: 'Parent ID is required for child nodes.' });
      return;
    }

    if (node.parentId === node.id) {
      issues.push({ line: node.lineIndex, type: 'error', message: 'A node cannot reference itself as parent.' });
    }

    if (node.level > 0 && !ids.has(node.parentId)) {
      issues.push({ line: node.lineIndex, type: 'error', message: `Missing parent node ${node.parentId}.` });
    }
  });

  return issues;
}

function validateDelimited(content, minColumns, messageBuilder) {
  const issues = [];
  const lines = mapLines(content);
  lines.forEach(({ line, index }) => {
    const parts = line.split(',');
    if (parts.length < minColumns) {
      issues.push({ line: index, type: 'error', message: `Expected at least ${minColumns} comma separated columns.` });
    }

    if (messageBuilder) {
      const customIssue = messageBuilder(parts, index);
      if (customIssue) {
        issues.push(customIssue);
      }
    }
  });
  return issues;
}

function validateCompdata(content) {
  return validateDelimited(content, 2, (parts, index) => {
    const key = (parts[0] || '').trim();
    if (!key) {
      return { line: index, type: 'error', message: 'Key column cannot be blank.' };
    }
    return null;
  });
}

function validateSchedule(content) {
  return validateDelimited(content, 6, (parts, index) => {
    const stage = parts[0]?.trim();
    if (!stage) {
      return { line: index, type: 'error', message: 'Stage ID is required.' };
    }
    return null;
  });
}

function validateStandings(content) {
  return validateDelimited(content, 2, (parts, index) => {
    if (!parts[0] || !parts[1]) {
      return { line: index, type: 'error', message: 'Rule definition requires both rule set and rule key.' };
    }
    return null;
  });
}

function validateTasks(content) {
  return validateDelimited(content, 4, (parts, index) => {
    const command = (parts[1] || '').trim();
    if (!command) {
      return { line: index, type: 'error', message: 'Command column is required.' };
    }
    return null;
  });
}

function validateWeather(content) {
  return validateDelimited(content, 7, (parts, index) => {
    const condition = parts[2]?.trim();
    if (!condition) {
      return { line: index, type: 'warning', message: 'Weather condition column should not be empty.' };
    }
    return null;
  });
}

const VALIDATORS = {
  'compobj.txt': validateCompobj,
  'compdata.txt': validateCompdata,
  'schedule.txt': validateSchedule,
  'standings.txt': validateStandings,
  'tasks.txt': validateTasks,
  'weather.txt': validateWeather,
};

function autoFixCompobj(content) {
  const lines = content.split(/\n/);
  const fixes = [];
  const fixed = lines.map((line, idx) => {
    if (!line.trim()) {
      return line.trim();
    }
    const parts = line.split(',');
    while (parts.length < 5) {
      parts.push('');
    }
    const [id, level, codeRaw, nameRaw, parent] = parts;
    const code = (codeRaw || '').trim();
    let name = (nameRaw || '').trim();
    if (code.startsWith('S') && name && !name.startsWith('FCE_')) {
      name = `FCE_${name}`;
      fixes.push({ line: idx + 1, message: 'Prefixed stage name with FCE_.' });
    }
    const rebuilt = [id.trim(), level.trim(), code, name, (parent || '').trim()].join(',');
    if (rebuilt !== line) {
      fixes.push({ line: idx + 1, message: 'Normalised whitespace.' });
    }
    return rebuilt;
  });
  return { content: fixed.filter(Boolean).join('\n'), fixes };
}

function autoFixDelimited(content) {
  const lines = content.split(/\n/);
  const fixes = [];
  const fixed = lines
    .map((line, idx) => {
      if (!line.trim()) {
        return null;
      }
      const trimmed = line
        .split(',')
        .map(part => part.trim())
        .join(',');
      if (trimmed !== line) {
        fixes.push({ line: idx + 1, message: 'Trimmed extra whitespace.' });
      }
      return trimmed;
    })
    .filter(Boolean);
  return { content: fixed.join('\n'), fixes };
}

const AUTO_FIXERS = {
  'compobj.txt': autoFixCompobj,
  'compdata.txt': autoFixDelimited,
  'schedule.txt': autoFixDelimited,
  'standings.txt': autoFixDelimited,
  'tasks.txt': autoFixDelimited,
  'weather.txt': autoFixDelimited,
};

function compareContent(current, baseline) {
  const currentLines = current.split(/\n/);
  const baselineLines = baseline.split(/\n/);
  const max = Math.max(currentLines.length, baselineLines.length);
  const differences = [];

  for (let i = 0; i < max; i += 1) {
    const currentLine = currentLines[i];
    const baselineLine = baselineLines[i];
    if (currentLine === baselineLine) {
      continue;
    }
    const type = currentLine === undefined ? 'removed' : baselineLine === undefined ? 'added' : 'changed';
    differences.push({
      line: i + 1,
      type,
      current: currentLine ?? null,
      baseline: baselineLine ?? null,
    });
  }

  return differences;
}

async function validateFile(name, providedContent) {
  const canonical = canonicalName(name);
  const validator = VALIDATORS[canonical];
  if (!validator) {
    throw new Error(`No validator defined for ${canonical}`);
  }
  const content = providedContent !== undefined ? providedContent : await readTextFile(canonical);
  const issues = validator(content);
  return { ok: issues.filter(issue => issue.type === 'error').length === 0, issues };
}

async function validateAll() {
  const summaries = {};
  let ok = true;
  for (const name of FILE_NAMES) {
    const result = await validateFile(name);
    summaries[name] = result;
    if (!result.ok) {
      ok = false;
    }
  }
  return { ok, summaries };
}

async function listFiles() {
  const entries = [];
  for (const name of FILE_NAMES) {
    try {
      const filePath = await resolveFilePath(DATA_DIR, name);
      const stat = await fsp.stat(filePath);
      entries.push({
        name,
        label: FILE_DEFINITIONS[name].label,
        size: stat.size,
        modified: stat.mtime,
      });
    } catch (error) {
      entries.push({ name, label: FILE_DEFINITIONS[name].label, missing: true });
    }
  }
  return entries;
}

app.get('/api/files', async (req, res) => {
  try {
    const files = await listFiles();
    res.json({ ok: true, files });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/file/:name', async (req, res) => {
  try {
    const canonical = canonicalName(req.params.name);
    const content = await readTextFile(canonical);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error) {
    res.status(404).send(error.message);
  }
});

app.post('/api/file/:name', async (req, res) => {
  try {
    const canonical = canonicalName(req.params.name);
    const { content } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'Request body must include a string "content" field.' });
    }
    await writeTextFile(canonical, content.replace(/\r\n/g, '\n'));
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/validate/:name', async (req, res) => {
  try {
    const result = await validateFile(req.params.name);
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/validate/all', async (req, res) => {
  try {
    const summary = await validateAll();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/compare/:name', async (req, res) => {
  try {
    const canonical = canonicalName(req.params.name);
    const current = await readTextFile(canonical);
    let baseline;
    try {
      baseline = await readTextFile(canonical, DEFAULT_DIR);
    } catch (err) {
      return res.json({ ok: false, error: `No default file found for ${canonical}.` });
    }
    const differences = compareContent(current, baseline);
    res.json({ ok: true, differences });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/autofix/:name', async (req, res) => {
  try {
    const canonical = canonicalName(req.params.name);
    const fixer = AUTO_FIXERS[canonical];
    if (!fixer) {
      return res.status(400).json({ ok: false, error: `Auto-fix not available for ${canonical}.` });
    }
    const content = typeof req.body?.content === 'string' ? req.body.content : await readTextFile(canonical);
    const result = fixer(content.replace(/\r\n/g, '\n'));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Full-stack competition editor running on port ${PORT}`);
});
