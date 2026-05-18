'use strict';

const { ipcMain } = require('electron');
const repo        = require('./posdb-repository');
const sync        = require('./posdb-sync');

// ── State ──────────────────────────────────────────────────────────────────
let pollingTimer   = null;
let isPolling      = false;
let printedCount   = 0;
let mainWindowRef  = null;
let workerContext  = null;
const recentErrors = [];
const recentlyPrinted = new Map();

function rememberPrinted(localId) {
    recentlyPrinted.set(localId, Date.now());
    if (recentlyPrinted.size > 200) {
        const cutoff = Date.now() - 120000;
        for (const [id, ts] of recentlyPrinted) {
            if (ts < cutoff) {
                recentlyPrinted.delete(id);
            }
        }
    }
}

function wasRecentlyPrinted(localId) {
    const ts = recentlyPrinted.get(localId);
    return ts != null && Date.now() - ts < 60000;
}

async function resolveCategoryPrinterMap(session) {
    const map = sync.buildCategoryPrinterMap();
    if (map.size > 0) {
        return map;
    }
    const categories = await repo.getCategories(session);
    for (const cat of categories) {
        if (cat.printer_name) {
            map.set(String(cat.id), cat.printer_name);
        }
    }
    return map;
}

async function resolvePrintConfig(session) {
    return sync.getPrintConfig() || await repo.getPrintConfig(session);
}

function setWorkerContext(ctx) {
    workerContext = ctx;
    if (ctx?.mainWindow) {
        mainWindowRef = ctx.mainWindow;
    }
}

// ── Structured Logger ──────────────────────────────────────────────────────
/**
 * @param {string} event_type
 * @param {{transaction_id?: string, category_id?: string, message?: string}} data
 */
function log(event_type, data = {}) {
    const entry = {
        timestamp:      new Date().toISOString(),
        event_type,
        transaction_id: data.transaction_id ?? null,
        category_id:    data.category_id    ?? null,
        message:        data.message        ?? '',
    };
    console.log('[print-worker]', JSON.stringify(entry));
}

// ── Category Grouping — معزول تماماً عن منطق الطباعة ─────────────────────
/**
 * تجميع items حسب category_id
 * @param {Array} items
 * @returns {Map<string, Array>}
 */
function groupItemsByCategory(items) {
    const map = new Map();
    for (const item of (items || [])) {
        const key = String(item.category_id ?? 'unknown');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}

// ── HTML Builder ───────────────────────────────────────────────────────────
/**
 * بناء HTML ورقة التحضير لمجموعة واحدة
 * @param {string} categoryName
 * @param {Array} items
 * @param {object} snapshot
 * @returns {string}
 */
function buildTicketHtml(categoryName, items, snapshot) {
    const now     = new Date();
    const timeStr = now.toLocaleTimeString('ar-SA', {
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const itemsHtml = items.map((i) => {
        const noteHtml = i.note
            ? `<div style="font-size:11px;color:#555;padding-right:4px">↳ ${i.note}</div>`
            : '';
        return `<div style="display:flex;justify-content:space-between;border-bottom:1px dashed #999;padding:3px 0">
            <span style="font-size:16px;font-weight:700">${parseFloat(i.quantity)}x ${i.name}</span>
        </div>${noteHtml}`;
    }).join('');

    const tableRow  = snapshot.table_id
        ? `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>الطاولة:</span><span style="font-weight:700">${snapshot.table_id}</span></div>`
        : '';
    const orderRow  = snapshot.server_id
        ? `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>رقم الطلب:</span><span style="font-weight:700">#${snapshot.server_id}</span></div>`
        : '';

    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:14px;direction:rtl;width:78mm}
@media print{@page{size:78mm auto;margin:0}body{margin:0}}
</style></head>
<body>
<div style="text-align:center;font-size:18px;font-weight:900;border-bottom:3px solid #000;padding-bottom:4px;margin-bottom:6px">${categoryName}</div>
${tableRow}${orderRow}
<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>الوقت:</span><span style="font-weight:700">${timeStr}</span></div>
<div style="border-top:3px solid #000;margin:4px 0"></div>
${itemsHtml}
<div style="border-top:3px solid #000;margin:4px 0"></div>
</body></html>`;
}

// ── Transaction Processor ──────────────────────────────────────────────────
/**
 * معالجة transaction واحدة: تقسيم حسب category وطباعة
 * @param {object} snapshot          — deep copy من الـ transaction
 * @param {Map<string, string>} categoryPrinterMap — { category_id → printer_name }
 * @param {object} adapter           — PrinterAdapter instance
 * @returns {Promise<'printed'|'partial'|'failed'>}
 */
/**
 * معالجة أوامر طباعة صريحة من POSDB.print_jobs
 * @returns {Promise<Array<{id: string, status: string, error_message?: string}>>}
 */
async function processPrintJobs(jobs, snapshot, adapter, printConfig) {
    const results = [];

    for (const job of (jobs || [])) {
        if (job.status === 'skipped' || job.status === 'printed') {
            results.push({ id: job.id, status: job.status, error_message: job.error_message || null });
            continue;
        }

        if (!job.printer_name) {
            results.push({
                id: job.id,
                status: 'skipped',
                error_message: job.error_message || 'no_printer',
            });
            continue;
        }

        try {
            log('printer_executing', {
                transaction_id: snapshot.local_id,
                category_id:    job.category_id,
                message:        `job ${job.job_type} on "${job.printer_name}"`,
            });

            const label = job.job_type === 'cashier'
                ? (printConfig?.cashier_title || job.category_name || 'فاتورة مبيعات')
                : (job.category_name || `مجموعة ${job.category_id}`);
            const html = buildTicketHtml(label, job.items || [], snapshot);
            await adapter.print(html, job.printer_name);

            log('printer_success', {
                transaction_id: snapshot.local_id,
                category_id:    job.category_id,
                message:        `job ${job.id} printed`,
            });

            results.push({ id: job.id, status: 'printed', error_message: null });
        } catch (err) {
            const msg = err?.message || String(err);
            log('print_failure', {
                transaction_id: snapshot.local_id,
                category_id:    job.category_id,
                message:        msg,
            });
            recentErrors.unshift({
                timestamp:      new Date().toISOString(),
                event_type:     'print_failure',
                transaction_id: snapshot.local_id,
                category_id:    job.category_id,
                message:        msg,
            });
            if (recentErrors.length > 20) {
                recentErrors.pop();
            }
            results.push({ id: job.id, status: 'failed', error_message: msg });
        }
    }

    return results;
}

function summarizeJobResults(results) {
    if (!results.length) {
        return 'failed';
    }
    const printed = results.filter((r) => r.status === 'printed').length;
    const failed  = results.filter((r) => r.status === 'failed').length;
    if (failed === 0 && printed > 0) {
        return 'printed';
    }
    if (printed > 0) {
        return 'partial';
    }
    return 'failed';
}

async function processTransaction(snapshot, categoryPrinterMap, adapter, printConfig) {
    const printTasks = [];
    const kitchenEnabled = snapshot.print_kitchen !== false;

    if (kitchenEnabled) {
        const grouped = groupItemsByCategory(snapshot.items);
        for (const [categoryId, items] of grouped) {
            const printerName = categoryPrinterMap.get(categoryId);
            if (!printerName) {
                log('printer_skipped', {
                    transaction_id: snapshot.local_id,
                    category_id:    categoryId,
                    message:        'no printer_name in POSDB — skipped',
                });
                continue;
            }
            const categoryName = items[0]?.category_name || `مجموعة ${categoryId}`;
            printTasks.push({
                type:         'kitchen',
                categoryId,
                categoryName,
                printerName,
                items,
            });
        }
    }

    const directPrinter = printConfig?.direct_printer_name;
    if (snapshot.print_requested && snapshot.print_silent && directPrinter) {
        printTasks.push({
            type:        'cashier',
            categoryId:  '_cashier',
            printerName: directPrinter,
            items:       snapshot.items || [],
        });
    }

    if (printTasks.length === 0) {
        log('no_print_tasks', {
            transaction_id: snapshot.local_id,
            message:        kitchenEnabled
                ? 'no categories with printer_name — marking partial'
                : 'no print tasks (kitchen disabled / no cashier)',
        });
        return kitchenEnabled ? 'partial' : 'printed';
    }

    // Promise.allSettled — لا يوقف عند فشل مجموعة
    const results = await Promise.allSettled(
        printTasks.map(async (task) => {
            log('printer_executing', {
                transaction_id: snapshot.local_id,
                category_id:    task.categoryId,
                message:        `printing on "${task.printerName}"`,
            });
            const label = task.type === 'cashier'
                ? (printConfig?.cashier_title || 'فاتورة مبيعات')
                : task.categoryName;
            const html = buildTicketHtml(label, task.items, snapshot);
            await adapter.print(html, task.printerName);
            log('printer_success', {
                transaction_id: snapshot.local_id,
                category_id:    task.categoryId,
                message:        'print succeeded',
            });
        })
    );

    // تسجيل الأخطاء مع context كامل
    results.forEach((r, i) => {
        if (r.status === 'rejected') {
            const errEntry = {
                timestamp:      new Date().toISOString(),
                event_type:     'print_failure',
                transaction_id: snapshot.local_id,
                category_id:    printTasks[i].categoryId,
                message:        r.reason?.message || String(r.reason),
            };
            log('print_failure', errEntry);
            recentErrors.unshift(errEntry);
            if (recentErrors.length > 20) recentErrors.pop();
        }
    });

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed    = results.filter((r) => r.status === 'rejected').length;

    // حساب الحالة النهائية — المجموعات بدون printer_name لا تدخل في الحساب
    if (failed === 0)  return 'printed';
    if (succeeded > 0) return 'partial';
    return 'failed';
}

// ── Polling ────────────────────────────────────────────────────────────────
/**
 * دورة polling واحدة
 * @param {Electron.Session} session
 * @param {object} adapter
 */
async function pollOnce(session, adapter) {
    if (isPolling) return;   // guard صارم لمنع التداخل
    isPolling = true;

    log('poll_cycle_start', { message: 'polling cycle started' });

    try {
        const pending = await repo.getPendingTransactions(session);
        if (!pending.length) { return; }

        log('transactions_found', { message: `found ${pending.length} pending transactions` });

        const categoryPrinterMap = await resolveCategoryPrinterMap(session);
        const printConfig        = await resolvePrintConfig(session);

        for (const transaction of pending) {
            if (wasRecentlyPrinted(transaction.local_id)) {
                continue;
            }
            // Compare-and-set lock — منع التكرار
            const locked = await repo.lockTransaction(session, transaction.local_id);
            if (!locked) {
                log('lock_skipped', {
                    transaction_id: transaction.local_id,
                    message:        'lock failed — already processing or non-pending',
                });
                continue;
            }

            // Transaction Snapshot — deep copy قبل الطباعة
            const snapshot = JSON.parse(JSON.stringify(transaction));

            log('transaction_detected', {
                transaction_id: snapshot.local_id,
                message:        'transaction locked and snapshot taken',
            });

            let finalStatus;
            try {
                finalStatus = await processTransaction(snapshot, categoryPrinterMap, adapter, printConfig);
            } catch (err) {
                log('transaction_error', {
                    transaction_id: snapshot.local_id,
                    message:        err.message,
                });
                finalStatus = 'failed';
            }

            // Atomic update بعد اكتمال جميع الـ print jobs
            switch (finalStatus) {
                case 'printed': await repo.markTransactionPrinted(session, snapshot.local_id); break;
                case 'partial': await repo.markTransactionPartial(session, snapshot.local_id); break;
                case 'failed':  await repo.markTransactionFailed(session, snapshot.local_id);  break;
            }

            log('transaction_done', {
                transaction_id: snapshot.local_id,
                message:        `final status: ${finalStatus}`,
            });

            if (finalStatus === 'printed' || finalStatus === 'partial') {
                printedCount++;
                if (mainWindowRef && !mainWindowRef.isDestroyed()) {
                    mainWindowRef.webContents.send('print-worker:job-done', {
                        count:          printedCount,
                        transaction_id: snapshot.local_id,
                        status:         finalStatus,
                    });
                }
            }
        }
    } finally {
        isPolling = false;
        log('poll_cycle_end', { message: 'polling cycle ended' });
    }
}

/**
 * بدء الـ polling
 * @param {Electron.BrowserWindow} mainWindow
 * @param {Electron.Session} session
 * @param {object} adapter
 * @param {number} intervalMs
 */
function startPolling(mainWindow, session, adapter, intervalMs = 60000) {
    if (pollingTimer) {
        return;
    }
    mainWindowRef = mainWindow;
    setWorkerContext({ session, adapter, mainWindow });
    pollingTimer = setInterval(() => {
        pollOnce(session, adapter).catch((err) =>
            log('poll_error', { message: err.message })
        );
    }, intervalMs);
    log('polling_started', { message: `fallback interval: ${intervalMs}ms` });
}

/**
 * طباعة فورية — يُستدعى من POST /posdb/notify (مع transaction من المتصفح)
 * @param {{ local_id?: string, transaction?: object }} payload
 */
async function triggerPrint(payload = {}) {
    if (!workerContext?.adapter) {
        return [];
    }

    const { session, adapter, mainWindow } = workerContext;

    if (payload?.transaction?.local_id) {
        const localId = payload.transaction.local_id;
        if (wasRecentlyPrinted(localId)) {
            return [];
        }

        const categoryPrinterMap = await resolveCategoryPrinterMap(session);
        const printConfig        = await resolvePrintConfig(session);
        const snapshot           = JSON.parse(JSON.stringify(payload.transaction));
        const pendingJobs        = (payload.print_jobs || []).filter((j) => j.status === 'pending');

        log('notify_print', {
            transaction_id: localId,
            message:        `immediate print, jobs=${pendingJobs.length}, categories=${categoryPrinterMap.size}`,
        });

        let finalStatus;
        let jobResults = [];

        try {
            if (pendingJobs.length > 0) {
                jobResults = await processPrintJobs(pendingJobs, snapshot, adapter, printConfig);
                finalStatus = summarizeJobResults(jobResults);
            } else {
                finalStatus = await processTransaction(snapshot, categoryPrinterMap, adapter, printConfig);
            }
        } catch (err) {
            finalStatus = 'failed';
            log('notify_print_error', { transaction_id: localId, message: err.message });
        }

        rememberPrinted(localId);

        if (finalStatus === 'printed' || finalStatus === 'partial') {
            printedCount++;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('print-worker:job-done', {
                    count:          printedCount,
                    transaction_id: localId,
                    status:         finalStatus,
                });
            }
        }

        return jobResults;
    }

    await pollOnce(session, adapter);
    return [];
}

/**
 * إيقاف الـ polling
 */
function stopPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        log('polling_stopped', { message: 'polling stopped' });
    }
}

// ── IPC Handlers — UI Observer فقط ────────────────────────────────────────
/**
 * @param {Electron.BrowserWindow} mainWindow
 * @param {Electron.Session} session
 * @param {object} adapter
 */
function registerPrintWorkerIpc(mainWindow, session, adapter) {
    ipcMain.handle('print-worker:start', () => {
        startPolling(mainWindow, session, adapter);
        return { success: true };
    });

    ipcMain.handle('print-worker:stop', () => {
        stopPolling();
        return { success: true };
    });

    // read-only status — الـ renderer لا يتحكم في business logic
    ipcMain.handle('print-worker:status', () => ({
        polling:       pollingTimer !== null,
        printed_count: printedCount,
        recent_errors: recentErrors.slice(0, 5),
    }));
}

module.exports = {
    startPolling,
    stopPolling,
    registerPrintWorkerIpc,
    triggerPrint,
    setWorkerContext,
    groupItemsByCategory,
};
