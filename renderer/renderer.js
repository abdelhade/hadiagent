'use strict';

let printers = [];
let assignments = {};

async function init() {
  // Load config into settings fields
  const config = await window.electronAPI.invoke('config:load');
  document.getElementById('input-server-url').value = config.serverUrl || 'http://127.0.0.1:8080';
  document.getElementById('input-token').value = config.token || 'pos-desktop-agent-token-2024';

  assignments = await window.electronAPI.invoke('assignments:load');
  printers = await window.electronAPI.invoke('printers:get');
  await loadCategories();
}

async function loadCategories() {
  const categories = await window.electronAPI.invoke('categories:get');
  renderDirectPrinter();
  renderCategories(categories);
}

function renderDirectPrinter() {
  const select = document.getElementById('select-direct-printer');
  select.innerHTML = '';

  const noprint = document.createElement('option');
  noprint.value = '';
  noprint.textContent = 'بدون طباعة مباشرة';
  select.appendChild(noprint);

  const savedDirect = assignments['_direct_printer'] || '';

  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === savedDirect) { opt.selected = true; }
    select.appendChild(opt);
  });

  select.value = savedDirect;
}

function renderCategories(categories) {
  const tbody = document.getElementById('categories-body');
  const fallback = document.getElementById('fallback-msg');
  tbody.innerHTML = '';

  if (!categories || categories.length === 0) {
    fallback.style.display = 'block';
    return;
  }
  fallback.style.display = 'none';

  categories.forEach(cat => {
    const tr = document.createElement('tr');
    const savedPrinter = assignments[String(cat.id)] !== undefined ? assignments[String(cat.id)] : '';

    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    select.dataset.categoryId = cat.id;

    const noprint = document.createElement('option');
    noprint.value = '';
    noprint.textContent = 'بدون طباعة';
    select.appendChild(noprint);

    printers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      if (p === savedPrinter) { opt.selected = true; }
      select.appendChild(opt);
    });

    select.value = savedPrinter;

    tr.innerHTML = `<td>${cat.name}</td>`;
    const tdSelect = document.createElement('td');
    tdSelect.appendChild(select);
    tr.appendChild(tdSelect);
    tbody.appendChild(tr);
  });
}

async function saveAll() {
  const selects = document.querySelectorAll('select[data-category-id]');
  const newAssignments = {};
  
  // Save direct printer
  const directSelect = document.getElementById('select-direct-printer');
  if (directSelect) {
    newAssignments['_direct_printer'] = directSelect.value;
  }

  // Save kitchen categories
  selects.forEach(s => { newAssignments[s.dataset.categoryId] = s.value; });
  
  const result = await window.electronAPI.invoke('assignments:save', newAssignments);
  showStatus(result.success ? 'تم الحفظ بنجاح ✓' : 'فشل الحفظ ✗', result.success);
}

function showStatus(msg, success) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = success ? 'text-success small' : 'text-danger small';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// Settings panel toggle
document.getElementById('btn-settings').addEventListener('click', () => {
  const panel = document.getElementById('settings-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

// Save config
document.getElementById('btn-save-config').addEventListener('click', async () => {
  const config = {
    serverUrl: document.getElementById('input-server-url').value.trim(),
    token: document.getElementById('input-token').value.trim(),
  };
  const result = await window.electronAPI.invoke('config:save', config);
  if (result.success) {
    showStatus('تم حفظ الإعدادات ✓', true);
    document.getElementById('settings-panel').style.display = 'none';
    await loadCategories();
  } else {
    showStatus('فشل حفظ الإعدادات ✗', false);
  }
});

document.getElementById('btn-refresh').addEventListener('click', loadCategories);
document.getElementById('btn-save').addEventListener('click', saveAll);

window.electronAPI.on('assignments:saved', (data) => {
  showStatus(data.success ? 'تم الحفظ بنجاح ✓' : 'فشل الحفظ ✗', data.success);
});

init();
