const FILE_METADATA = [
  { name: 'compobj.txt', label: '🏆 Competition Structure', description: 'Defines competition hierarchy and structure.' },
  { name: 'schedule.txt', label: '🗓 Schedule', description: 'Match order and fixture mapping.' },
  { name: 'tasks.txt', label: '🔁 Tasks', description: 'Automated game events and triggers.' },
  { name: 'advancement.txt', label: '🧭 Advancement', description: 'Promotion, relegation, and playoff flows.' },
  { name: 'settings.txt', label: '⚙️ Settings', description: 'Competition-specific configuration.' },
  { name: 'weather.txt', label: '☁️ Weather', description: 'Match environment and conditions.' },
  { name: 'standings.txt', label: '📊 Standings', description: 'Standings table configuration.' },
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

const ENTITY_CODES = {
  competition: /^C/i,
  stage: /^S\d+/i,
  group: /^G\d+/i,
  nation: /nation|league|club/i,
};

const TEMPLATE_PRESETS = {
  'tasks.txt': [
    {
      label: 'Knockout Stage Tasks',
      rows: [
        { TaskType: 'BracketSetup', Trigger: 'OnAdvance', Action: 'CreateFixture', TargetStage: '', Param1: 'Knockout', Param2: '' },
        { TaskType: 'StageSeeding', Trigger: 'OnStart', Action: 'SeedByStandings', TargetStage: '', Param1: 'TopTeams', Param2: '' },
      ],
    },
    {
      label: 'Group Stage Tasks',
      rows: [
        { TaskType: 'GroupPopulate', Trigger: 'OnStart', Action: 'AssignTeams', TargetStage: '', Param1: 'GroupA', Param2: 'Seeds' },
        { TaskType: 'RoundRobin', Trigger: 'OnSchedule', Action: 'GenerateMatches', TargetStage: '', Param1: 'HomeAway', Param2: '' },
      ],
    },
  ],
  'objectives.txt': [
    {
      label: 'Win League Objective',
      rows: [
        { CompetitionLine: '', ObjectiveType: 'WinLeague', TargetValue: 'Champion', Importance: 'High', Reward: 'BudgetBoost' },
      ],
    },
    {
      label: 'Avoid Relegation Objective',
      rows: [
        { CompetitionLine: '', ObjectiveType: 'AvoidRelegation', TargetValue: 'SafeZone', Importance: 'Medium', Reward: 'BoardTrust' },
      ],
    },
    {
      label: 'Reach Quarterfinal Objective',
      rows: [
        { CompetitionLine: '', ObjectiveType: 'ReachRound', TargetValue: 'QuarterFinal', Importance: 'Medium', Reward: 'SupporterGrowth' },
      ],
    },
  ],
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
  lineLookup: new Map(),
  collapsedTree: false,
  filters: { code: '', parent: '', text: '' },
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
const summaryPanel = document.getElementById('workspace-summary');

const toolbar = document.querySelector('.toolbar');
const syncButton = document.getElementById('sync-button');
const collapseTreeButton = document.getElementById('collapse-tree');
const exportButton = document.getElementById('export-zip');
const importButton = document.getElementById('import-button');
const exportZipButton = document.getElementById('export-button');
const autosaveToggle = document.getElementById('autosave-toggle');
const saveDropdownButton = document.getElementById('save-individual');
const saveMenu = document.getElementById('save-menu');
const fileInput = document.getElementById('file-input');
const toggleLines = document.getElementById('toggle-lines');
const toggleColors = document.getElementById('toggle-colors');
const toggleCompact = document.getElementById('toggle-compact');
const filterCode = document.getElementById('filter-code');
const filterParent = document.getElementById('filter-parent');
const filterText = document.getElementById('filter-text');

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');
const modalConfirm = document.getElementById('modal-confirm');

const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
document.body.appendChild(tooltip);

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
  const limit = 250;
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

function updateSummaryPanel(status = {}, references = {}) {
  if (!summaryPanel) {
    return;
  }
  summaryPanel.querySelectorAll('li').forEach(item => {
    const field = item.dataset.field;
    switch (field) {
      case 'files':
        item.textContent = `${status.filesLoaded ?? STATE.files.length} Files Loaded`;
        break;
      case 'references':
        item.textContent = `${references.updated ?? status.referenceUpdates ?? 0} References Updated`;
        break;
      case 'broken':
        item.textContent = `${references.broken ?? 0} Broken Links`;
        break;
      case 'missing':
        item.textContent = `${references.missing ?? 0} Missing Parents`;
        break;
      default:
        break;
    }
  });
}

function updateStatusBar(status = {}, references = {}) {
  const lines = status.totalLines ?? 0;
  const refUpdates = references.updated ?? status.referenceUpdates ?? 0;
  const saved = status.lastSaved ? formatRelativeTime(status.lastSaved) : 'never';
  const dirty = status.dirty ? ' • unsaved changes' : '';
  statusBar.textContent = `${lines} lines · ${refUpdates} references updated · Last saved ${saved}${dirty}`;
  updateSummaryPanel(status, references);
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
    tab.textContent = meta ? meta.label : file.label;
    const lastSaved = STATE.status.lastSaved ? formatRelativeTime(STATE.status.lastSaved) : 'never';
    tab.title = `Lines: ${file.rows.length} · Last saved: ${lastSaved}`;
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

function ghostTextForColumn(fileName, key) {
  if (fileName === 'compobj.txt' && key === 'Name') {
    return '— click to enter stage name —';
  }
  return '';
}

function createColumnTooltip(file, column, cell) {
  if (file.name === 'compobj.txt' && column.key === 'ParentLine') {
    const value = cell.getValue();
    if (value && STATE.lineLookup.has(Number(value))) {
      const target = STATE.lineLookup.get(Number(value));
      return `Parent → ${target.Code || 'C'} : ${target.Name || 'Unnamed'}`;
    }
  }
  if (file.name === 'schedule.txt' && column.key === 'MatchID') {
    const row = cell.getRow().getData();
    const home = row.HomeRef || 'Home';
    const away = row.AwayRef || 'Away';
    return `${row.MatchID || 'Match'} → ${home} vs ${away}`;
  }
  if (REFERENCE_COLUMNS[file.name]?.includes(column.key)) {
    const value = cell.getValue();
    if (value && STATE.lineLookup.has(Number(value))) {
      const target = STATE.lineLookup.get(Number(value));
      return `Line ${value} → ${target.Code || 'C'} : ${target.Name || 'Unnamed'}`;
    }
    return value ? `Line ${value} (not found)` : undefined;
  }
  return undefined;
}

function applyEntityClass(element, data, fileName) {
  if (fileName !== 'compobj.txt') {
    return;
  }
  const code = String(data.Code || '').trim();
  element.classList.remove('entity-competition', 'entity-stage', 'entity-group', 'entity-nation', 'entity-empty');
  if (!code) {
    element.classList.add('entity-empty');
    return;
  }
  if (ENTITY_CODES.stage.test(code)) {
    element.classList.add('entity-stage');
  } else if (ENTITY_CODES.group.test(code)) {
    element.classList.add('entity-group');
  } else if (ENTITY_CODES.competition.test(code)) {
    element.classList.add('entity-competition');
  } else if (ENTITY_CODES.nation.test(code)) {
    element.classList.add('entity-nation');
  }
}

function formatRow(row, fileName) {
  const element = row.getElement();
  const data = row.getData();
  element.dataset.file = fileName;
  applyEntityClass(element, data, fileName);
  if (fileName === 'compobj.txt') {
    const level = Number(data.Level || 1) || 1;
    element.style.setProperty('--indent', `${(level - 1) * 18}px`);
    element.querySelectorAll('.tabulator-cell').forEach(cell => {
      if (cell.dataset.field === 'Name') {
        cell.style.paddingLeft = `${16 + (level - 1) * 18}px`;
      }
    });
    if (STATE.collapsedTree && level > 1) {
      element.classList.add('hidden-child');
    } else {
      element.classList.remove('hidden-child');
    }
  }
}

function mapColumnsToTabulator(file, columns) {
  return columns.map(column => {
    const config = {
      title: column.label || column.key,
      field: column.key,
      headerSort: false,
      editor: column.readOnly ? false : column.type === 'number' ? 'number' : 'input',
      hozAlign: column.type === 'number' ? 'center' : 'left',
      minWidth: 140,
      tooltip: cell => createColumnTooltip(file, column, cell),
    };
    if (column.key === 'LineID') {
      config.frozen = true;
      config.width = 110;
    }
    if (file.name === 'compobj.txt' && column.key === 'Code') {
      config.editor = 'list';
      config.editorParams = {
        values: ['C1', 'C2', 'S1', 'S2', 'G1', 'G2', 'Playoff', 'Knockout'],
        autocomplete: true,
      };
    }
    if (file.name === 'compobj.txt' && column.key === 'ParentLine') {
      config.editor = 'list';
      config.editorParams = {
        values: () => Array.from(STATE.lineLookup.keys()).map(key => String(key)),
        autocomplete: true,
      };
    }
    if (file.name === 'compobj.txt' && column.key === 'Name') {
      config.editorParams = {
        elementAttributes: {
          placeholder: '— click to enter stage name —',
        },
      };
    }
    if (!column.readOnly) {
      config.cellClick = (e, cell) => {
        const placeholder = ghostTextForColumn(file.name, column.key);
        if (placeholder && !cell.getValue()) {
          appendConsoleEntry(placeholder, 'info');
        }
      };
    }
    return config;
  });
}

function ensureTable(file) {
  const entry = createTableContainer(file.name);
  if (!entry.table) {
    const columns = mapColumnsToTabulator(file, file.columns);
    entry.table = new Tabulator(entry.container, {
      data: file.rows,
      layout: 'fitDataFill',
      reactiveData: false,
      index: '__id',
      selectable: true,
      movableRows: true,
      columns,
      height: '100%',
      placeholder: 'No rows loaded for this file.',
      rowFormatter: row => formatRow(row, file.name),
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
    entry.table.on('rowSelectionChanged', (_data, rows) => {
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
    entry.table.on('cellMouseEnter', (_e, cell) => {
      showReferenceTooltip(file.name, cell);
    });
    entry.table.on('cellMouseLeave', () => {
      hideTooltip();
    });
  } else {
    STATE.suppressEvents = true;
    entry.table.replaceData(file.rows).finally(() => {
      STATE.suppressEvents = false;
    });
  }
  entry.table.getColumns().forEach((column, index) => {
    column.updateDefinition(mapColumnsToTabulator(file, file.columns)[index]);
  });
  return entry;
}

function setActiveFile(name) {
  if (!STATE.tables.has(name)) {
    return;
  }
  STATE.activeFile = name;
  STATE.tables.forEach(entry => {
    entry.container.classList.toggle('active', entry.container.dataset.file === name);
  });
  STATE.sidebarButtons.forEach((button, key) => {
    button.classList.toggle('active', key === name);
  });
  STATE.tabButtons.forEach((button, key) => {
    button.classList.toggle('active', key === name);
  });
  const file = STATE.files?.find(entry => entry.name === name);
  updateSheetHeader(file);
  updateFiltersForFile(file);
  applyFilters();
}

function updateFiltersForFile(file) {
  if (!file) {
    return;
  }
  const codeValues = new Set();
  const parentValues = new Set();
  file.rows.forEach(row => {
    if (row.Code) {
      codeValues.add(String(row.Code));
    }
    if (row.ParentLine) {
      parentValues.add(String(row.ParentLine));
    }
  });
  const codes = Array.from(codeValues).sort();
  const parents = Array.from(parentValues).sort();
  updateSelectOptions(filterCode, codes);
  updateSelectOptions(filterParent, parents);
  filterCode.disabled = !codes.length;
  filterParent.disabled = !parents.length;
  if (!codes.length) {
    STATE.filters.code = '';
  }
  if (!parents.length) {
    STATE.filters.parent = '';
  }
}

function updateSelectOptions(select, values) {
  const prev = select.value;
  select.innerHTML = '<option value="">All</option>';
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (values.includes(prev)) {
    select.value = prev;
  } else {
    select.value = '';
  }
}

function applyFilters() {
  if (!STATE.activeFile) {
    return;
  }
  const entry = STATE.tables.get(STATE.activeFile);
  if (!entry) {
    return;
  }
  const { code, parent, text } = STATE.filters;
  entry.table.clearFilter(true);
  if (!code && !parent && !text) {
    return;
  }
  const lowered = text.toLowerCase();
  entry.table.setFilter((data /*, row */) => {
    if (code && String(data.Code || '') !== code) {
      return false;
    }
    if (parent && String(data.ParentLine || '') !== parent) {
      return false;
    }
    if (lowered) {
      const values = Object.values(data || {});
      const match = values.some(value => String(value || '').toLowerCase().includes(lowered));
      if (!match) {
        return false;
      }
    }
    return true;
  });
}

function showReferenceTooltip(fileName, cell) {
  const value = cell.getValue();
  if (!value) {
    hideTooltip();
    return;
  }
  const field = cell.getField();
  const isReference = (REFERENCE_COLUMNS[fileName] || []).includes(field);
  if (!isReference && !(fileName === 'compobj.txt' && field === 'ParentLine')) {
    hideTooltip();
    return;
  }
  const numeric = Number(value);
  let text = `Line ${value}`;
  if (!Number.isNaN(numeric) && STATE.lineLookup.has(numeric)) {
    const target = STATE.lineLookup.get(numeric);
    text = `Line ${value} → ${target.Code || 'C'} : ${target.Name || 'Unnamed'}`;
  } else {
    text = `Line ${value} (not found)`;
  }
  tooltip.textContent = text;
  const rect = cell.getElement().getBoundingClientRect();
  tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  tooltip.style.top = `${rect.top + window.scrollY - 12}px`;
  tooltip.classList.add('visible');
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

function buildLineLookup(files) {
  const map = new Map();
  const comp = files.find(entry => entry.name === 'compobj.txt');
  if (!comp) {
    STATE.lineLookup = map;
    return;
  }
  comp.rows.forEach(row => {
    const numeric = Number(row.LineID);
    if (!Number.isNaN(numeric)) {
      map.set(numeric, row);
    }
  });
  STATE.lineLookup = map;
}

function updateSaveMenu(files) {
  saveMenu.innerHTML = '';
  files.forEach(file => {
    const button = document.createElement('button');
    button.textContent = `💾 Save ${file.name}`;
    button.addEventListener('click', () => {
      handleSaveSingle(file.name).catch(error => appendConsoleEntry(error.message, 'error'));
      saveMenu.classList.remove('open');
    });
    saveMenu.appendChild(button);
  });
}

function toggleSaveMenu() {
  saveMenu.classList.toggle('open');
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

async function handleMove(direction) {
  if (!STATE.activeFile) {
    return;
  }
  const entry = STATE.tables.get(STATE.activeFile);
  if (!entry) {
    return;
  }
  const rows = entry.table.getSelectedRows();
  if (!rows.length) {
    appendConsoleEntry('Select a row to move.', 'warn');
    return;
  }
  const row = rows[0];
  if (direction === 'up') {
    row.move('up');
  } else if (direction === 'down') {
    row.move('down');
  }
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
  appendConsoleEntry('💾 Workspace saved to disk.', 'ok');
}

async function handleSync() {
  const payload = await fetchJSON('/api/sync', {
    method: 'POST',
  });
  applyWorkspace(payload);
  const stats = payload.references || payload.sync?.references || {};
  const updated = stats.updated ?? 0;
  const lines = [`✅ ${updated} references synced across ${STATE.files.length} files`];
  if (stats.broken) {
    lines.push(`⚠️ ${stats.broken} unresolved references`);
  }
  if (stats.missing) {
    lines.push(`⚠️ ${stats.missing} orphaned parent links`);
  }
  appendConsoleEntry(`✅ ${updated} references synced across files.`, 'ok');
  if (stats.broken) {
    appendConsoleEntry(`${stats.broken} unresolved references detected.`, 'warn');
  }
  if (stats.missing) {
    appendConsoleEntry(`${stats.missing} orphaned parent links detected.`, 'warn');
  }
  showModal('Sync Summary', lines);
}

async function handleExport() {
  window.open('/api/export', '_blank');
}

async function handleSaveSingle(name) {
  window.open(`/api/export/${name}`, '_blank');
  appendConsoleEntry(`💾 Saved ${name} individually.`, 'ok');
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }
  try {
    const payloads = await Promise.all(
      files.map(file =>
        file
          .text()
          .then(content => ({ name: file.name, content }))
          .catch(() => ({ name: file.name, content: '' }))
      )
    );
    await processImports(payloads);
  } finally {
    fileInput.value = '';
  }
}

async function processImports(files) {
  if (!files.length) {
    appendConsoleEntry('No files selected for import.', 'warn');
    return;
  }
  const payload = await fetchJSON('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  applyWorkspace(payload);
  const summary = payload.import?.files || [];
  if (summary.length) {
    const lines = summary.map(item => {
      const icon = item.issues && item.issues.length ? '⚠️' : '✅';
      return `${icon} ${item.name} loaded (${item.lines} lines)`;
    });
    showModal('Import Summary', lines);
    summary.forEach((item, index) => {
      const type = item.issues && item.issues.length ? 'warn' : 'ok';
      appendConsoleEntry(lines[index], type);
    });
  }
}

function showModal(title, lines = []) {
  modalTitle.textContent = title;
  modalBody.innerHTML = '';
  lines.forEach(text => {
    const entry = document.createElement('div');
    entry.className = 'modal__entry';
    if (/⚠️/.test(text)) {
      entry.classList.add('modal__entry--warn');
    }
    const parts = text.split(' ');
    const icon = parts.shift() || '';
    entry.innerHTML = `<strong>${icon}</strong> <span>${parts.join(' ')}</span>`;
    modalBody.appendChild(entry);
  });
  modal.removeAttribute('hidden');
}

function hideModal() {
  modal.setAttribute('hidden', '');
}

function openTemplateModal() {
  const fileName = STATE.activeFile;
  if (!fileName) {
    appendConsoleEntry('Select a sheet to load templates.', 'warn');
    return;
  }
  const presets = TEMPLATE_PRESETS[fileName];
  if (!presets || !presets.length) {
    appendConsoleEntry('No templates available for this sheet.', 'warn');
    return;
  }
  modalTitle.textContent = 'Template Loader';
  modalBody.innerHTML = '';
  presets.forEach(preset => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'modal__entry modal__entry--action';
    button.innerHTML = `<strong>📚</strong> <span>${preset.label}</span>`;
    button.addEventListener('click', () => {
      applyTemplatePreset(fileName, preset).catch(error => appendConsoleEntry(error.message, 'error'));
    });
    modalBody.appendChild(button);
  });
  modal.removeAttribute('hidden');
}

async function applyTemplatePreset(fileName, preset) {
  hideModal();
  let lastPayload = null;
  for (const row of preset.rows) {
    lastPayload = await fetchJSON(`/api/insert/${fileName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row }),
    });
  }
  if (lastPayload) {
    applyWorkspace(lastPayload);
    appendConsoleEntry(`📚 Template "${preset.label}" applied to ${fileName}.`, 'ok');
    maybeAutosave();
  }
}

function toggleTreeCollapse() {
  STATE.collapsedTree = !STATE.collapsedTree;
  collapseTreeButton.textContent = STATE.collapsedTree ? '📂 Expand Tree' : '🗂 Collapse Tree';
  const comp = STATE.tables.get('compobj.txt');
  if (!comp) {
    return;
  }
  comp.table.getRows().forEach(row => {
    formatRow(row, 'compobj.txt');
  });
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
      case 'move-up':
        handleMove('up').catch(error => appendConsoleEntry(error.message, 'error'));
        break;
      case 'move-down':
        handleMove('down').catch(error => appendConsoleEntry(error.message, 'error'));
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
      case 'templates':
        openTemplateModal();
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
  exportZipButton.addEventListener('click', handleExport);
  collapseTreeButton.addEventListener('click', toggleTreeCollapse);
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileInput);
  saveDropdownButton.addEventListener('click', toggleSaveMenu);
  document.addEventListener('click', event => {
    if (!event.target.closest('.toolbar__save-group')) {
      saveMenu.classList.remove('open');
    }
  });
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
  toggleLines.addEventListener('change', () => {
    document.body.classList.toggle('hide-line-numbers', !toggleLines.checked);
  });
  toggleColors.addEventListener('change', () => {
    document.body.classList.toggle('hide-colors', !toggleColors.checked);
  });
  toggleCompact.addEventListener('change', () => {
    document.body.classList.toggle('compact-mode', toggleCompact.checked);
  });
  filterCode.addEventListener('change', () => {
    STATE.filters.code = filterCode.value;
    applyFilters();
  });
  filterParent.addEventListener('change', () => {
    STATE.filters.parent = filterParent.value;
    applyFilters();
  });
  filterText.addEventListener('input', () => {
    STATE.filters.text = filterText.value;
    applyFilters();
  });
  modalClose.addEventListener('click', hideModal);
  modalConfirm.addEventListener('click', hideModal);
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) {
      return;
    }
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrl = isMac ? event.metaKey : event.ctrlKey;
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave().catch(error => appendConsoleEntry(error.message, 'error'));
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      document.execCommand('undo');
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      document.execCommand('redo');
      return;
    }
    if (ctrl && event.key === 'ArrowUp') {
      event.preventDefault();
      handleMove('up').catch(error => appendConsoleEntry(error.message, 'error'));
      return;
    }
    if (ctrl && event.key === 'ArrowDown') {
      event.preventDefault();
      handleMove('down').catch(error => appendConsoleEntry(error.message, 'error'));
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
  buildLineLookup(files);
  files.forEach(file => {
    ensureTable(file);
  });
  updateSaveMenu(files);
  if (!STATE.activeFile && files.length) {
    setActiveFile(files[0].name);
  } else if (STATE.activeFile) {
    setActiveFile(STATE.activeFile);
  }
}

async function bootstrap() {
  restoreAutosavePreference();
  bindToolbar();
  bindKeyboardShortcuts();
  try {
    const payload = await fetchJSON('/api/state');
    applyWorkspace(payload);
    appendConsoleEntry('Workspace loaded successfully.', 'ok');
  } catch (error) {
    appendConsoleEntry(`Failed to load workspace: ${error.message}`, 'error');
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
