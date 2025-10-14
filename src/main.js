const tableBody = document.querySelector('#compobj-table tbody');
const rowTemplate = document.getElementById('table-row-template');
const startLineInput = document.getElementById('start-line');
const addRowButton = document.getElementById('add-row');
const exportButton = document.getElementById('export-json');
const exportDialog = document.getElementById('export-dialog');
const exportTextarea = exportDialog.querySelector('textarea');
const inspectorForm = document.getElementById('row-form');
const deleteButton = document.getElementById('delete-row');
const referenceSelect = document.getElementById('reference');

const generateId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2, 10)}`;

let state = {
  rows: [
    createRow({ depth: 2, code: 'KORE', name: 'NationName_167' }),
    createRow({ depth: 3, code: 'C83', name: 'TrophyName_Abbr15_83', reference: 0 }),
    createRow({ depth: 4, code: 'S1', name: 'FCE_League_Stage_1', reference: 1 }),
    createRow({ depth: 5, code: 'G1', name: '', reference: 2 }),
    createRow({ depth: 4, code: 'S2', name: 'FCE_League_Stage_2', reference: 1 }),
    createRow({ depth: 5, code: 'G1', name: 'FCE_Championship_Group', reference: 4 }),
    createRow({ depth: 5, code: 'G2', name: 'FCE_Bottom_Group', reference: 4 }),
    createRow({ depth: 2, code: 'SARB', name: 'NationName_183', reference: 0 }),
    createRow({ depth: 3, code: 'C350', name: 'TrophyName_Abbr15_350', reference: 7 }),
    createRow({ depth: 4, code: 'S1', name: 'FCE_League_Stage', reference: 8 }),
    createRow({ depth: 5, code: 'G1', name: '', reference: 9 })
  ],
  selectedId: null
};

/**
 * Create a new row with unique id. The reference may temporarily be a line index
 * before ids are resolved. When reference is a number, we will convert it after
 * the initial render.
 */
function createRow({ depth = '', code = '', name = '', reference = null } = {}) {
  return {
    id: generateId(),
    depth,
    code,
    name,
    reference
  };
}

function normalizeReferences() {
  const idByIndex = state.rows.map((row) => row.id);
  state.rows.forEach((row) => {
    if (typeof row.reference === 'number') {
      row.reference = idByIndex[row.reference] ?? null;
    }
  });
}

function computeLineMap() {
  const start = Number.parseInt(startLineInput.value, 10) || 1;
  const map = new Map();
  state.rows.forEach((row, index) => {
    map.set(row.id, start + index);
  });
  return map;
}

function renderTable() {
  normalizeReferences();
  tableBody.innerHTML = '';
  const lineMap = computeLineMap();

  state.rows.forEach((row, index) => {
    const instance = rowTemplate.content.firstElementChild.cloneNode(true);
    instance.dataset.rowId = row.id;

    const [lineCell] = instance.getElementsByClassName('column--line');
    lineCell.textContent = lineMap.get(row.id);

    instance.querySelector('[data-field="depth"]').textContent = row.depth ?? '';
    instance.querySelector('[data-field="code"]').textContent = row.code ?? '';
    instance.querySelector('[data-field="name"]').textContent = row.name ?? '';

    const refCell = instance.querySelector('[data-field="reference"]');
    if (row.reference && lineMap.has(row.reference)) {
      refCell.textContent = lineMap.get(row.reference);
    } else {
      refCell.textContent = '';
    }

    if (state.selectedId === row.id) {
      instance.classList.add('is-selected');
    }

    tableBody.appendChild(instance);
  });

  refreshReferenceOptions(lineMap);
}

function refreshReferenceOptions(lineMap) {
  const selectedValue = referenceSelect.value;
  referenceSelect.innerHTML = '<option value="">None</option>';

  state.rows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    const lineNumber = lineMap.get(row.id);
    const label = [lineNumber, row.code, row.name].filter(Boolean).join(' — ');
    option.textContent = label;
    referenceSelect.appendChild(option);
  });

  if (selectedValue && lineMap.has(selectedValue)) {
    referenceSelect.value = selectedValue;
  }
}

function selectRow(rowId) {
  state.selectedId = rowId;
  const row = state.rows.find((r) => r.id === rowId) ?? null;
  const lineMap = computeLineMap();

  tableBody.querySelectorAll('tr').forEach((tr) => {
    tr.classList.toggle('is-selected', tr.dataset.rowId === rowId);
  });

  if (!row) {
    inspectorForm.reset();
    referenceSelect.value = '';
    deleteButton.disabled = true;
    return;
  }

  inspectorForm.depth.value = row.depth ?? '';
  inspectorForm.code.value = row.code ?? '';
  inspectorForm.name.value = row.name ?? '';
  referenceSelect.value = row.reference && lineMap.has(row.reference) ? row.reference : '';
  deleteButton.disabled = false;
}

function addRowAt(index) {
  const newRow = createRow();
  state.rows.splice(index, 0, newRow);
  renderTable();
  selectRow(newRow.id);
}

function removeSelectedRow() {
  if (!state.selectedId) return;
  const index = state.rows.findIndex((row) => row.id === state.selectedId);
  if (index === -1) return;

  const [removed] = state.rows.splice(index, 1);
  state.rows.forEach((row) => {
    if (row.reference === removed.id) {
      row.reference = null;
    }
  });

  state.selectedId = null;
  renderTable();
  selectRow(null);
}

function updateSelectedRow(values) {
  if (!state.selectedId) return;
  const row = state.rows.find((r) => r.id === state.selectedId);
  if (!row) return;

  Object.assign(row, values);
  renderTable();
  selectRow(row.id);
}

function handleTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const rowElement = button.closest('tr');
  const rowId = rowElement?.dataset.rowId;
  const rowIndex = state.rows.findIndex((row) => row.id === rowId);
  if (rowIndex === -1) return;

  switch (button.dataset.action) {
    case 'add-above':
      addRowAt(rowIndex);
      break;
    case 'add-below':
      addRowAt(rowIndex + 1);
      break;
    case 'select':
      selectRow(rowId);
      break;
    default:
      break;
  }
}

function handleFormSubmit(event) {
  event.preventDefault();
  if (!state.selectedId) return;

  const depth = Number.parseInt(inspectorForm.depth.value, 10) || '';
  const code = inspectorForm.code.value.trim();
  const name = inspectorForm.name.value.trim();
  const reference = inspectorForm.reference.value || null;

  updateSelectedRow({ depth, code, name, reference });
}

function handleStartLineChange() {
  renderTable();
  if (state.selectedId) {
    selectRow(state.selectedId);
  }
}

function handleAddRow() {
  addRowAt(state.rows.length);
}

function handleExport() {
  const startLine = Number.parseInt(startLineInput.value, 10) || 1;
  const lineMap = computeLineMap();
  const payload = {
    startLine,
    rows: state.rows.map((row) => ({
      line: lineMap.get(row.id),
      depth: row.depth,
      code: row.code,
      name: row.name,
      referenceLine: row.reference ? lineMap.get(row.reference) ?? null : null,
      referenceId: row.reference ?? null
    }))
  };

  exportTextarea.value = JSON.stringify(payload, null, 2);
  if (typeof exportDialog.showModal === 'function') {
    exportDialog.showModal();
  } else {
    alert(exportTextarea.value);
  }
}

function bootstrap() {
  renderTable();
  selectRow(state.rows[0]?.id ?? null);
}

tableBody.addEventListener('click', handleTableClick);
inspectorForm.addEventListener('submit', handleFormSubmit);
startLineInput.addEventListener('input', handleStartLineChange);
addRowButton.addEventListener('click', handleAddRow);
exportButton.addEventListener('click', handleExport);
deleteButton.addEventListener('click', removeSelectedRow);
referenceSelect.addEventListener('change', () => {
  if (state.selectedId) {
    updateSelectedRow({ reference: referenceSelect.value || null });
  }
});

bootstrap();
