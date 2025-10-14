const FILE_METADATA = [
  { name: 'compobj.txt', label: '🏆 Competition Structure', description: 'Defines competition hierarchy and structure.' },
  { name: 'schedule.txt', label: '🗓 Schedule Editor', description: 'Match order and fixture mapping.' },
  { name: 'tasks.txt', label: '🔁 Task Automation', description: 'Automated game events and triggers.' },
  { name: 'advancement.txt', label: '🧭 Advancement Rules', description: 'Promotion, relegation, and playoff flows.' },
  { name: 'settings.txt', label: '⚙️ Settings', description: 'Competition-specific configuration.' },
  { name: 'weather.txt', label: '☁️ Weather Config', description: 'Match environment and conditions.' },
  { name: 'standings.txt', label: '📊 Standings Rules', description: 'Standings table configuration.' },
  { name: 'objectives.txt', label: '🎯 Objectives', description: 'Manager and club objectives.' },
];

const REFERENCE_COLUMNS = {
  'compobj.txt': ['ParentLine'],
  'schedule.txt': ['StageLine'],
  'tasks.txt': ['TargetStage'],
  'advancement.txt': ['StageFrom', 'StageTo'],
  'settings.txt': ['CompetitionLine'],
  'weather.txt': ['CompetitionLine'],
  'standings.txt': ['StageLine'],
  'objectives.txt': ['CompetitionLine'],
};

const STATE = {
  tables: new Map(),
  sidebarButtons: new Map(),
  tabButtons: new Map(),
  activeFile: null,
  autosave: false,
  suppressEvents: false,
  status: {},
  references: {},
  files: [],
};

const gridWrapper = document.getElementById('grid-wrapper');
const sidebarNav = document.getElementById('sidebar-nav');
const tabBar = document.getElementById('tab-bar');
const sheetTitle = document.getElementById('sheet-title');
const sheetDescription = document.getElementById('sheet-description');
const lineCount = document.getElementById('line-count');
const referenceCount = document.getElementById('reference-count');
const statusBar = document.getElementById('status-bar');
const consoleEl = document.getElementById('console');

const toolbar = document.querySelector('.toolbar');
const syncButton = document.getElementById('sync-button');
const exportButton = document.getElementById('export-zip');
const autosaveToggle = document.getElementById('autosave-toggle');

function getMetadata(name) {
  return FILE_METADATA.find(entry => entry.name === name);
}

function normaliseName(name) {
  return String(name || '').toLowerCase();
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Failed to parse response from ${url}`);
  }
  if (!response.ok || payload.ok === false) {
    const message = payload && payload.error ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}

function appendConsoleEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `console__entry${
    type === 'warn' ? ' console__entry--warn' : type === 'error' ? ' console__entry--error' : type === 'ok' ? ' console__entry--ok' : ''
  }`;
  entry.textContent = message;
  consoleEl.prepend(entry);
  const limit = 200;
  while (consoleEl.children.length > limit) {
    consoleEl.removeChild(consoleEl.lastChild);
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return 'never';
  }
  const now = Date.now();
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) {
    return 'unknown';
  }
  const diff = now - value;
  if (diff < 60_000) {
    return 'just now';
  }
  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return `${minutes}m ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}

function updateStatusBar(status = {}, references = {}) {
  const lines = status.totalLines ?? 0;
  const refUpdates = references.updated ?? status.referenceUpdates ?? 0;
  const saved = status.lastSaved ? formatRelativeTime(status.lastSaved) : 'never';
  const dirty = status.dirty ? ' • unsaved changes' : '';
  statusBar.textContent = `${lines} lines · ${refUpdates} references updated · Last saved ${saved}${dirty}`;
}

function updateSheetHeader(file) {
  if (!file) {
    return;
  }
  const meta = getMetadata(file.name);
  sheetTitle.textContent = meta ? meta.label : file.label || file.name;
  sheetDescription.textContent = meta ? meta.description : file.description || '';
  lineCount.textContent = `${file.rows.length} lines`;
  referenceCount.textContent = `${STATE.references.updated ?? 0} references updated`;
}

function clearHighlights() {
  STATE.tables.forEach(entry => {
    entry.table.getRows().forEach(row => {
      const element = row.getElement();
      element.classList.remove('reference-hit');
      element.classList.remove('validation-error');
    });
  });
}

function highlightReferencesForLine(lineId) {
  clearHighlights();
  if (!lineId) {
    return;
  }
  const targetId = String(lineId);
  STATE.tables.forEach(entry => {
    const refs = REFERENCE_COLUMNS[entry.name] || [];
    if (!refs.length) {
      return;
    }
    entry.table.getRows().forEach(row => {
      const data = row.getData();
      const hasMatch = refs.some(ref => String(data[ref] || '') === targetId);
      if (hasMatch) {
        row.getElement().classList.add('reference-hit');
      }
    });
  });
}

function highlightCompobjRow(lineId) {
  const compEntry = STATE.tables.get('compobj.txt');
  if (!compEntry) {
    return;
  }
  compEntry.table.getRows().forEach(row => {
    const element = row.getElement();
    if (String(row.getData().LineID) === String(lineId)) {
      element.classList.add('reference-hit');
    } else {
      element.classList.remove('reference-hit');
    }
  });
}

function ensureSidebar(files) {
  sidebarNav.innerHTML = '';
  STATE.sidebarButtons.clear();
  files.forEach(file => {
    const meta = getMetadata(file.name);
    const button = document.createElement('button');
    button.className = 'sidebar__link';
    button.dataset.file = file.name;
    button.textContent = meta ? meta.label : file.label;
    button.addEventListener('click', () => setActiveFile(file.name));
    sidebarNav.appendChild(button);
    STATE.sidebarButtons.set(file.name, button);
  });
}

function ensureTabs(files) {
  tabBar.innerHTML = '';
  STATE.tabButtons.clear();
  files.forEach(file => {
    const meta = getMetadata(file.name);
    const tab = document.createElement('button');
    tab.className = 'tab-bar__tab';
    tab.dataset.file = file.name;
    tab.textContent = meta ? meta.label.split(' ').slice(1).join(' ') || file.label : file.label;
    tab.addEventListener('click', () => setActiveFile(file.name));
    tabBar.appendChild(tab);
    STATE.tabButtons.set(file.name, tab);
  });
}

function createTableContainer(name) {
  let entry = STATE.tables.get(name);
  if (entry) {
    return entry;
  }
  const container = document.createElement('div');
  container.className = 'grid-sheet';
  container.dataset.file = name;
  gridWrapper.appendChild(container);
  entry = { name, container, table: null };
  STATE.tables.set(name, entry);
  return entry;
}

function mapColumnsToTabulator(columns) {
  return columns.map(column => {
    const config = {
      title: column.label || column.key,
      field: column.key,
      headerSort: false,
      editor: column.readOnly ? false : column.type === 'number' ? 'number' : 'input',
      hozAlign: column.type === 'number' ? 'right' : 'left',
      minWidth: 120,
    };
    if (column.key === 'LineID') {
      config.frozen = true;
      config.width = 110;
    }
    return config;
  });
}

function ensureTable(file) {
  const entry = createTableContainer(file.name);
  if (!entry.table) {
    const columns = mapColumnsToTabulator(file.columns);
    entry.table = new Tabulator(entry.container, {
      data: file.rows,
      layout: 'fitDataFill',
      reactiveData: false,
      dataTree: false,
      index: '__id',
      selectable: true,
      movableRows: true,
      columns,
      height: '100%',
      placeholder: 'No rows loaded for this file.',
      rowFormatter: row => {
        const element = row.getElement();
        element.dataset.file = file.name;
      },
    });
    entry.table.on('cellEdited', cell => {
      if (STATE.suppressEvents) {
        return;
      }
      const row = cell.getRow();
      const rowData = row.getData();
      const field = cell.getField();
      const value = cell.getValue();
      handleCellEdit(file.name, rowData.__id, field, value).catch(error => {
        appendConsoleEntry(`✖ ${error.message}`, 'error');
        STATE.suppressEvents = true;
        cell.setValue(cell.getOldValue(), true);
        STATE.suppressEvents = false;
      });
    });
    entry.table.on('rowSelectionChanged', (data, rows) => {
      if (file.name === 'compobj.txt') {
        const selected = rows[0];
        const lineId = selected ? selected.getData().LineID : null;
        highlightReferencesForLine(lineId);
      } else {
        const selected = rows[0];
        if (!selected) {
          return;
        }
        const refs = REFERENCE_COLUMNS[file.name] || [];
        const dataObj = selected.getData();
        const target = refs
          .map(ref => dataObj[ref])
          .find(value => value && String(value).trim());
        if (target) {
          highlightCompobjRow(target);
        }
      }
    });
    entry.table.on('rowMoved', () => {
      if (STATE.suppressEvents) {
        return;
      }
      const order = entry.table.getData().map(row => row.__id);
      handleReorder(file.name, order).catch(error => {
        appendConsoleEntry(`✖ ${error.message}`, 'error');
      });
    });
  } else {
    STATE.suppressEvents = true;
    entry.table.replaceData(file.rows).finally(() => {
      STATE.suppressEvents = false;
    });
  }
  entry.table.getColumns().forEach((column, index) => {
    column.updateDefinition(mapColumnsToTabulator(file.columns)[index]);
  });
  return entry;
}

function setActiveFile(name) {
  const normalised = normaliseName(name);
  if (!STATE.tables.has(name)) {
    return;
  }
  STATE.activeFile = name;
  STATE.tables.forEach(entry => {
    if (entry.container.dataset.file === name) {
      entry.container.classList.add('active');
    } else {
      entry.container.classList.remove('active');
    }
  });
  STATE.sidebarButtons.forEach((button, key) => {
    button.classList.toggle('active', key === name);
  });
  STATE.tabButtons.forEach((button, key) => {
    button.classList.toggle('active', key === name);
  });
  const file = STATE.files?.find(entry => entry.name === name);
  updateSheetHeader(file);
}

async function handleCellEdit(fileName, rowId, field, value) {
  if (!rowId || !field) {
    return;
  }
  const payload = await fetchJSON(`/api/edit/${fileName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId, field, value }),
  });
  applyWorkspace(payload);
  appendConsoleEntry(`✎ ${field} updated in ${fileName}`);
  maybeAutosave();
}

async function handleInsert() {
  if (!STATE.activeFile) {
    return;
  }
  const entry = STATE.tables.get(STATE.activeFile);
  if (!entry) {
    return;
  }
  let index = null;
  const selected = entry.table.getSelectedRows();
  if (selected.length) {
    index = selected[0].getPosition(true) + 1;
  }
  const payload = await fetchJSON(`/api/insert/${STATE.activeFile}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index }),
  });
  applyWorkspace(payload);
  appendConsoleEntry(`➕ Row inserted in ${STATE.activeFile}`, 'ok');
  maybeAutosave();
}

async function handleDelete() {
  if (!STATE.activeFile) {
    return;
  }
  const entry = STATE.tables.get(STATE.activeFile);
  if (!entry) {
    return;
  }
  const selected = entry.table.getSelectedRows();
  if (!selected.length) {
    appendConsoleEntry('Select at least one row to delete.', 'warn');
    return;
  }
  const rowIds = selected.map(row => row.getData().__id);
  const payload = await fetchJSON(`/api/delete/${STATE.activeFile}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowIds }),
  });
  applyWorkspace(payload);
  appendConsoleEntry(`🗑 Deleted ${rowIds.length} row(s) from ${STATE.activeFile}`, 'warn');
  maybeAutosave();
}

async function handleReorder(fileName, order) {
  if (!Array.isArray(order) || !order.length) {
    return;
  }
  const payload = await fetchJSON(`/api/reorder/${fileName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  applyWorkspace(payload);
  appendConsoleEntry(`⇅ Reordered ${fileName}`);
  maybeAutosave();
}

async function handleRecalculate() {
  const payload = await fetchJSON('/api/recalculate', {
    method: 'POST',
  });
  applyWorkspace(payload);
  appendConsoleEntry('⭮ Line numbers recalculated and references synced.', 'ok');
  maybeAutosave();
}

async function handleValidate() {
  const result = await fetchJSON('/api/validate', {
    method: 'POST',
  });
  appendConsoleEntry(`Validation completed with ${result.issues.length} issue(s).`, result.ok ? 'ok' : 'warn');
  displayValidation(result.issues);
}

async function handleAutoFix() {
  const payload = await fetchJSON('/api/sync', {
    method: 'POST',
  });
  applyWorkspace(payload);
  appendConsoleEntry('⚡ Auto-fix applied: references synchronised.', 'ok');
  maybeAutosave();
}

async function handleSave() {
  const payload = await fetchJSON('/api/save', {
    method: 'POST',
  });
  applyWorkspace(payload);
  appendConsoleEntry('💾 All files saved and backups created.', 'ok');
}

async function handleSync() {
  await handleRecalculate();
}

function handleExport() {
  window.open('/api/export', '_blank');
  appendConsoleEntry('📦 Exporting workspace to ZIP.', 'ok');
}

function displayValidation(issues = []) {
  clearHighlights();
  if (!issues.length) {
    appendConsoleEntry('✅ Validation passed with no issues.', 'ok');
    return;
  }
  issues.forEach(issue => {
    const message = issue.message || JSON.stringify(issue);
    appendConsoleEntry(`⚠️ ${message}`, issue.severity === 'error' ? 'error' : 'warn');
    const { file, line } = issue;
    if (file && STATE.tables.has(file)) {
      const table = STATE.tables.get(file).table;
      table.getRows().forEach(row => {
        if (String(row.getData().LineID) === String(line)) {
          row.getElement().classList.add('validation-error');
        }
      });
    }
  });
}

function maybeAutosave() {
  if (!STATE.autosave) {
    return;
  }
  handleSave().catch(error => {
    appendConsoleEntry(`Autosave failed: ${error.message}`, 'error');
  });
}

function restoreAutosavePreference() {
  try {
    const stored = localStorage.getItem('compdata-autosave');
    if (stored === 'true') {
      STATE.autosave = true;
      autosaveToggle.checked = true;
    }
  } catch (error) {
    // ignore storage errors
  }
}

function bindToolbar() {
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    switch (action) {
      case 'add':
        handleInsert().catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      case 'delete':
        handleDelete().catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      case 'recalculate':
        handleRecalculate().catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      case 'validate':
        handleValidate().catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      case 'autofix':
        handleAutoFix().catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      case 'save':
        handleSave().catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      default:
        break;
    }
  });
  syncButton.addEventListener('click', () => {
    handleSync().catch(error => appendConsoleEntry(error.message, 'error'));
  });
  exportButton.addEventListener('click', handleExport);
  autosaveToggle.addEventListener('change', () => {
    STATE.autosave = autosaveToggle.checked;
    try {
      localStorage.setItem('compdata-autosave', STATE.autosave ? 'true' : 'false');
    } catch (error) {
      // ignore
    }
    appendConsoleEntry(`Autosave ${STATE.autosave ? 'enabled' : 'disabled'}.`);
    if (STATE.autosave) {
      maybeAutosave();
    }
  });
}

function applyWorkspace(payload) {
  if (!payload) {
    return;
  }
  const files = payload.files || [];
  STATE.files = files;
  STATE.status = payload.status || {};
  STATE.references = payload.references || STATE.references || {};
  updateStatusBar(STATE.status, STATE.references);
  ensureSidebar(files);
  ensureTabs(files);
  files.forEach(file => {
    ensureTable(file);
  });
  if (!STATE.activeFile && files.length) {
    setActiveFile(files[0].name);
  } else if (STATE.activeFile) {
    setActiveFile(STATE.activeFile);
  }
}

async function bootstrap() {
  restoreAutosavePreference();
  bindToolbar();
  try {
    const payload = await fetchJSON('/api/state');
    applyWorkspace(payload);
    appendConsoleEntry('Workspace loaded successfully.', 'ok');
  } catch (error) {
    appendConsoleEntry(`Failed to load workspace: ${error.message}`, 'error');
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
