'use strict';

let printers = [];
let assignments = {};

async function init() {
  // Load config into settings fields
  const config = await window.electronAPI.invoke('config:load');
  document.getElementById('input-server-url').value = config.serverUrl || 'https://jac.elhadeerp.com';
  document.getElementById('input-token').value = config.token || 'pos2026';

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

// ── Diagnose Tool ──────────────────────────────────────────────
const diagnoseModal = document.getElementById('diagnose-modal');

document.getElementById('btn-diagnose').addEventListener('click', async () => {
  diagnoseModal.style.display = 'flex';
  const config = await window.electronAPI.invoke('config:load');
  const url = (config.serverUrl || '').trim().replace(/\/$/, '');
  document.getElementById('diagnose-server-info').textContent =
    `السيرفر: ${url || '(غير محدد)'}   |   Token: ${config.token ? config.token.substring(0, 8) + '…' : '(فارغ)'}`;
  document.getElementById('diagnose-results').innerHTML = '<p class="text-muted small">اضغط "تشغيل الاختبار" للبدء…</p>';
});

document.getElementById('btn-close-diagnose').addEventListener('click', () => {
  diagnoseModal.style.display = 'none';
});

document.getElementById('btn-open-settings-from-diagnose').addEventListener('click', () => {
  diagnoseModal.style.display = 'none';
  document.getElementById('settings-panel').style.display = 'block';
});

document.getElementById('btn-run-diagnose').addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-diagnose');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الاختبار…';

  const config = await window.electronAPI.invoke('config:load');
  const results = await window.electronAPI.invoke('diagnose:run', config);

  renderDiagnoseResults(results);
  btn.disabled = false;
  btn.textContent = '▶ تشغيل الاختبار';
});

function renderDiagnoseResults(results) {
  const container = document.getElementById('diagnose-results');
  container.innerHTML = '';

  results.forEach(r => {
    const div = document.createElement('div');
    div.className = `d-flex align-items-start gap-2 mb-2 p-2 rounded border ${r.ok ? 'border-success bg-success bg-opacity-10' : 'border-danger bg-danger bg-opacity-10'}`;

    const icon = document.createElement('span');
    icon.style.fontSize = '1.1rem';
    icon.textContent = r.ok ? '✅' : '❌';

    const body = document.createElement('div');
    body.className = 'small';
    body.innerHTML = `<strong>${r.label}</strong><br><span class="${r.ok ? 'text-success' : 'text-danger'}">${r.detail}</span>`;
    if (r.hint) {
      const hint = document.createElement('div');
      hint.className = 'text-muted mt-1';
      hint.textContent = '💡 ' + r.hint;
      body.appendChild(hint);
    }

    div.appendChild(icon);
    div.appendChild(body);
    container.appendChild(div);
  });
}

// ── Request Logs ──────────────────────────────────────────────
const logsContainer = document.getElementById('logs-container');
let logs = [];

window.electronAPI.on('server:request', (data) => {
  if (logs.length === 0) { logsContainer.innerHTML = ''; }
  
  logs.unshift(data);
  if (logs.length > 50) { logs.pop(); }
  
  renderLogs();
});

document.getElementById('btn-clear-logs').addEventListener('click', () => {
  logs = [];
  logsContainer.innerHTML = '<div class="text-muted text-center py-5">لا توجد طلبات حتى الآن…</div>';
});

function renderLogs() {
  logsContainer.innerHTML = '';
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = `mb-1 p-1 border-bottom ${log.success ? 'text-success' : 'text-danger'}`;
    const statusIcon = log.success ? '✅' : '❌';
    
    let detail = '';
    if (log.type === 'كاشير') {
      detail = `[${log.type}] ${log.printer || 'طابعة غير محددة'}`;
    } else {
      detail = `[${log.type}] قسم ${log.categoryId || '?'} -> ${log.printer || 'طابعة غير محددة'}`;
    }
    
    if (log.error) { detail += ` | خطأ: ${log.error}`; }

    div.innerHTML = `<span class="text-muted">[${log.timestamp}]</span> ${statusIcon} ${detail}`;
    logsContainer.appendChild(div);
  });
}

init();

// ── Print Worker Status (read-only observer) ──────────────────────────────
(function () {
  'use strict';

  var pollingStatusEl = document.getElementById('hw-polling-status');
  var printedCountEl  = document.getElementById('hw-printed-count');
  var errorsCardEl    = document.getElementById('hw-errors-card');
  var errorsUlEl      = document.getElementById('hw-errors-ul');
  var enableToggleEl  = document.getElementById('hw-enable-toggle');
  var toggleBtnEl     = document.getElementById('hw-btn-toggle');

  function hwUpdateStatus() {
    window.electronAPI.invoke('print-worker:status').then(function (s) {
      if (!s) return;
      pollingStatusEl.textContent = s.polling ? '🟢 نشط' : '🔴 متوقف';
      printedCountEl.textContent  = s.printed_count || 0;
      var errors = s.recent_errors || [];
      if (errors.length > 0) {
        errorsUlEl.innerHTML = errors.map(function (e) {
          return '<li class="list-group-item list-group-item-danger small py-1">'
            + (e.timestamp || '').slice(11, 19) + ' | ' + (e.message || '') + '</li>';
        }).join('');
        errorsCardEl.style.display = 'block';
      } else {
        errorsCardEl.style.display = 'none';
      }
    }).catch(function () {});
  }

  if (toggleBtnEl) {
    toggleBtnEl.addEventListener('click', function () {
      window.electronAPI.invoke('print-worker:status').then(function (s) {
        return window.electronAPI.invoke((s && s.polling) ? 'print-worker:stop' : 'print-worker:start');
      }).then(hwUpdateStatus).catch(function () {});
    });
  }

  if (enableToggleEl) {
    window.electronAPI.invoke('config:load').then(function (cfg) {
      enableToggleEl.checked = !!(cfg && cfg.enableLocalPrinting);
    }).catch(function () {});

    enableToggleEl.addEventListener('change', function () {
      window.electronAPI.invoke('config:load').then(function (cfg) {
        return window.electronAPI.invoke('config:save',
          Object.assign({}, cfg, { enableLocalPrinting: enableToggleEl.checked })
        );
      }).then(function () {
        return window.electronAPI.invoke(enableToggleEl.checked ? 'print-worker:start' : 'print-worker:stop');
      }).then(hwUpdateStatus).catch(function () {});
    });
  }

  window.electronAPI.on('print-worker:job-done', hwUpdateStatus);
  hwUpdateStatus();
  setInterval(hwUpdateStatus, 5000);
}());
