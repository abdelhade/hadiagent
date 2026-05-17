'use strict';

const http  = require('http');
const https = require('https');
const { loadAssignments } = require('./assignment-store');
const { printContent }    = require('./printer-service');

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS     = 3;

let pollerTimer   = null;
let isPolling     = false;
let mainWindowRef = null;

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(url) {
    let u = (url || '').trim().replace(/\/$/, '');
    if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
        u = 'http://' + u;
    }
    return u;
}

function notifyUI(type, details) {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('server:request', {
            timestamp: new Date().toLocaleTimeString('ar-EG'),
            type,
            ...details,
        });
    }
}

/**
 * HTTP request helper (no external deps — pure Node.js).
 *
 * @param {'GET'|'POST'} method
 * @param {string}       url
 * @param {string}       token
 * @param {object|null}  body
 * @returns {Promise<{status: number, json: object|null}>}
 */
function httpRequest(method, url, token, body = null) {
    return new Promise((resolve) => {
        const transport = url.startsWith('https') ? https : http;
        const payload   = body ? JSON.stringify(body) : null;

        const options = {
            method,
            headers: {
                'Content-Type':  'application/json',
                'Accept':        'application/json',
                'Authorization': token ? `Bearer ${token}` : '',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
            rejectUnauthorized: false,
            timeout: 8000,
        };

        const req = transport.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, json: JSON.parse(data) });
                } catch (_e) {
                    resolve({ status: res.statusCode, json: null });
                }
            });
        });

        req.on('error',   (err) => resolve({ status: 0,   json: null, error: err.message }));
        req.on('timeout', ()    => { req.destroy(); resolve({ status: 0, json: null, error: 'timeout' }); });

        if (payload) req.write(payload);
        req.end();
    });
}

// ── core polling logic ────────────────────────────────────────────────────────

async function pollOnce(serverUrl, token) {
    const pendingUrl = `${serverUrl}/pos/api/queue/pending`;
    const result     = await httpRequest('GET', pendingUrl, token);

    if (!result.json || !result.json.success) {
        console.warn('[QueuePoller] pending fetch failed:', result.status, result.error || '');
        return;
    }

    const jobs = result.json.jobs || [];
    if (jobs.length === 0) return;

    console.log(`[QueuePoller] ${jobs.length} job(s) to process`);

    const assignments = await loadAssignments();

    for (const job of jobs) {
        const ackUrl = `${serverUrl}/pos/api/queue/${job.id}/ack`;

        try {
            let printerName = null;

            if (job.print_type === 'direct') {
                printerName = assignments['_direct_printer'] || null;
            } else if (job.print_type === 'kitchen') {
                printerName = job.category_id ? (assignments[String(job.category_id)] || null) : null;
            }

            if (!printerName) {
                const errMsg = job.print_type === 'direct'
                    ? 'الطابعة المباشرة غير محددة في الإعدادات'
                    : `لا توجد طابعة للقسم ${job.category_id}`;

                console.warn(`[QueuePoller] Job #${job.id}: ${errMsg}`);
                notifyUI(job.print_type === 'direct' ? 'كاشير' : 'مطبخ', { success: false, error: errMsg });

                await httpRequest('POST', ackUrl, token, { success: false, error_message: errMsg });
                continue;
            }

            console.log(`[QueuePoller] Job #${job.id} → printer: ${printerName}`);
            const printOk = await printContent(job.content || '', printerName);

            if (printOk) {
                notifyUI(job.print_type === 'direct' ? 'كاشير' : 'مطبخ', {
                    success: true,
                    printer: printerName,
                    categoryId: job.category_id || null,
                });
                await httpRequest('POST', ackUrl, token, { success: true });
            } else {
                const errMsg = 'فشلت عملية الطباعة في الويندوز';
                notifyUI(job.print_type === 'direct' ? 'كاشير' : 'مطبخ', {
                    success: false,
                    error: errMsg,
                    printer: printerName,
                });
                await httpRequest('POST', ackUrl, token, { success: false, error_message: errMsg });
            }
        } catch (err) {
            console.error(`[QueuePoller] Job #${job.id} exception:`, err.message);
            await httpRequest('POST', ackUrl, token, {
                success: false,
                error_message: err.message,
            }).catch(() => {});
        }
    }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Start polling the Laravel queue.
 *
 * @param {object}      config     { serverUrl, token }
 * @param {BrowserWindow} mainWindow
 */
function startPoller(config, mainWindow) {
    if (pollerTimer) stopPoller();

    mainWindowRef = mainWindow;
    const serverUrl = normalizeUrl(config.serverUrl || '');
    const token     = config.token || '';

    if (!serverUrl) {
        console.warn('[QueuePoller] serverUrl not configured — polling disabled');
        return;
    }

    console.log(`[QueuePoller] Starting — server: ${serverUrl} — interval: ${POLL_INTERVAL_MS}ms`);

    async function tick() {
        if (isPolling) return;
        isPolling = true;
        try {
            await pollOnce(serverUrl, token);
        } catch (err) {
            console.error('[QueuePoller] tick error:', err.message);
        } finally {
            isPolling = false;
        }
    }

    // أول poll فوري بعد ثانية
    setTimeout(tick, 1000);
    pollerTimer = setInterval(tick, POLL_INTERVAL_MS);
}

function stopPoller() {
    if (pollerTimer) {
        clearInterval(pollerTimer);
        pollerTimer = null;
    }
    isPolling = false;
    console.log('[QueuePoller] Stopped');
}

module.exports = { startPoller, stopPoller };
