'use strict';

function showStatus(msg, success) {
    const el = document.getElementById('status-msg');
    if (!el) {
        return;
    }
    el.textContent = msg;
    el.className = success ? 'small text-success' : 'small text-danger';
    setTimeout(() => {
        el.textContent = '';
    }, 3000);
}

async function refreshPosdbSummary() {
    const el = document.getElementById('posdb-summary');
    if (!el) {
        return;
    }

    const [categories, printConfig, agentUrl, agentStatus] = await Promise.all([
        window.electronAPI.invoke('posdb:categories'),
        window.electronAPI.invoke('posdb:print-config'),
        window.electronAPI.invoke('agent:url'),
        window.electronAPI.invoke('agent:status'),
    ]);

    const withPrinter = (categories || []).filter((c) => c.printer_name);
    const lines = [
        `<div><strong>عنوان Agent:</strong> <code>${agentUrl || agentStatus?.url || '—'}</code></div>`,
        `<div><strong>المجموعات:</strong> ${(categories || []).length} (${withPrinter.length} بطابعة)</div>`,
        '<div><strong>طابعة الكاشير:</strong> ' + (printConfig?.direct_printer_name || '—') + '</div>',
        `<div class="text-muted mt-2">الطباعة تتم فوراً عند الحفظ عبر <code>/posdb/notify</code></div>`,
    ];

    if ((categories || []).length > 0) {
        const list = withPrinter
            .slice(0, 12)
            .map((c) => `<li>${c.name} → <code>${c.printer_name}</code></li>`)
            .join('');
        lines.push(`<ul class="mb-0 mt-2 ps-3">${list}</ul>`);
    }

    el.innerHTML = lines.join('');
}

async function init() {
    const config = await window.electronAPI.invoke('config:load');
    const urlInput = document.getElementById('input-server-url');
    const tokenInput = document.getElementById('input-agent-token');
    if (urlInput) {
        urlInput.value = config.serverUrl || '';
    }
    if (tokenInput) {
        tokenInput.value = config.agentToken || '';
    }
    await refreshPosdbSummary();
}

document.getElementById('btn-settings')?.addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
});

document.getElementById('btn-save-config')?.addEventListener('click', async () => {
    const prev = await window.electronAPI.invoke('config:load');
    const config = {
        ...prev,
        serverUrl: document.getElementById('input-server-url')?.value.trim() || '',
        agentToken: document.getElementById('input-agent-token')?.value.trim() || '',
        enableLocalPrinting: document.getElementById('hw-enable-toggle')?.checked !== false,
    };
    const result = await window.electronAPI.invoke('config:save', config);
    if (result.success) {
        showStatus('تم حفظ الإعدادات ✓', true);
        document.getElementById('settings-panel').style.display = 'none';
    } else {
        showStatus('فشل الحفظ ✗', false);
    }
});

document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    await window.electronAPI.invoke('posdb:pull');
    await refreshPosdbSummary();
});

const diagnoseModal = document.getElementById('diagnose-modal');

document.getElementById('btn-diagnose')?.addEventListener('click', () => {
    if (diagnoseModal) {
        diagnoseModal.style.display = 'flex';
    }
    document.getElementById('diagnose-results').innerHTML =
        '<p class="text-muted small">اضغط تشغيل…</p>';
});

document.getElementById('btn-close-diagnose')?.addEventListener('click', () => {
    if (diagnoseModal) {
        diagnoseModal.style.display = 'none';
    }
});

document.getElementById('btn-open-settings-from-diagnose')?.addEventListener('click', () => {
    if (diagnoseModal) {
        diagnoseModal.style.display = 'none';
    }
    document.getElementById('settings-panel').style.display = 'block';
});

document.getElementById('btn-run-diagnose')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-run-diagnose');
    btn.disabled = true;
    const results = await window.electronAPI.invoke('diagnose:run');
    const container = document.getElementById('diagnose-results');
    container.innerHTML = results
        .map(
            (r) =>
                `<div class="mb-2 p-2 rounded border ${r.ok ? 'border-success' : 'border-danger'} small">
          ${r.ok ? '✅' : '❌'} <strong>${r.label}</strong><br>${r.detail}
          ${r.hint ? `<div class="text-muted">${r.hint}</div>` : ''}
        </div>`
        )
        .join('');
    btn.disabled = false;
});

(function printWorkerUi() {
    const pollingStatusEl = document.getElementById('hw-polling-status');
    const printedCountEl = document.getElementById('hw-printed-count');
    const errorsCardEl = document.getElementById('hw-errors-card');
    const errorsUlEl = document.getElementById('hw-errors-ul');
    const enableToggleEl = document.getElementById('hw-enable-toggle');
    const toggleBtnEl = document.getElementById('hw-btn-toggle');

    function hwUpdateStatus() {
        window.electronAPI
            .invoke('print-worker:status')
            .then((s) => {
                if (!s) {
                    return;
                }
                pollingStatusEl.textContent = s.polling ? '🟢 نشط' : '🔴 متوقف';
                printedCountEl.textContent = s.printed_count || 0;
                const errors = s.recent_errors || [];
                if (errors.length > 0) {
                    errorsUlEl.innerHTML = errors
                        .map(
                            (e) =>
                                `<li class="list-group-item list-group-item-danger small py-1">${(e.message || '').slice(0, 120)}</li>`
                        )
                        .join('');
                    errorsCardEl.style.display = 'block';
                } else {
                    errorsCardEl.style.display = 'none';
                }
            })
            .catch(() => {});
    }

    toggleBtnEl?.addEventListener('click', () => {
        window.electronAPI
            .invoke('print-worker:status')
            .then((s) =>
                window.electronAPI.invoke(s?.polling ? 'print-worker:stop' : 'print-worker:start')
            )
            .then(hwUpdateStatus);
    });

    window.electronAPI.invoke('config:load').then((cfg) => {
        if (enableToggleEl) {
            enableToggleEl.checked = cfg?.enableLocalPrinting !== false;
        }
    });

    enableToggleEl?.addEventListener('change', () => {
        window.electronAPI
            .invoke('config:load')
            .then((cfg) =>
                window.electronAPI.invoke('config:save', {
                    ...cfg,
                    enableLocalPrinting: enableToggleEl.checked,
                })
            )
            .then(() =>
                window.electronAPI.invoke(
                    enableToggleEl.checked ? 'print-worker:start' : 'print-worker:stop'
                )
            )
            .then(hwUpdateStatus);
    });

    window.electronAPI.on('print-worker:job-done', hwUpdateStatus);
    window.electronAPI.on('print:event', (ev) => {
        hwUpdateStatus();
        if (ev?.type === 'sync') {
            refreshPosdbSummary();
        }
    });
    hwUpdateStatus();
    setInterval(hwUpdateStatus, 5000);
})();

init();
