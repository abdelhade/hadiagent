'use strict';

const { ipcMain } = require('electron');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs/promises');

const { getInstalledPrinters } = require('./printer-service');
const { loadAssignments, saveAssignments } = require('./assignment-store');

// Config file path (stored next to assignments.json)
let configFilePath = null;

function getConfigPath() {
    if (configFilePath) return configFilePath;
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'config.json');
}

function setConfigPath(p) { configFilePath = p; }

async function loadConfig() {
    try {
        const raw = await fs.readFile(getConfigPath(), 'utf8');
        return JSON.parse(raw);
    } catch (_err) {
        return { serverUrl: 'http://127.0.0.1:8080', token: 'pos-desktop-agent-token-2024' };
    }
}

async function saveConfig(config) {
    const dir = path.dirname(getConfigPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getConfigPath(), JSON.stringify(config), 'utf8');
}

/**
 * Fetch categories from the Laravel Desktop API endpoint.
 */
function normalizeUrl(url) {
    let u = (url || '').trim().replace(/\/$/, '');
    if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
        u = 'http://' + u;
    }
    return u || 'http://127.0.0.1:8080';
}

async function fetchCategoriesFromApi() {
    const config = await loadConfig();
    const baseUrl = normalizeUrl(config.serverUrl);
    const token = config.token || '';
    const apiUrl = `${baseUrl}/pos/api/desktop/categories`;

    console.log('[desktop-api] fetching:', apiUrl, '| token:', token ? '✓' : '✗ EMPTY');

    return new Promise((resolve) => {
        const transport = apiUrl.startsWith('https') ? https : http;
        const options = {
            headers: { 'X-Desktop-Token': token, 'Accept': 'application/json' },
        };

        transport.get(apiUrl, options, (res) => {
            let data = '';
            console.log('[desktop-api] status:', res.statusCode);
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log('[desktop-api] response:', data.substring(0, 200));
                try {
                    const parsed = JSON.parse(data);
                    resolve(Array.isArray(parsed.categories) ? parsed.categories : []);
                } catch (_err) { resolve([]); }
            });
        }).on('error', (err) => {
            console.error('[desktop-api] network error:', err.message);
            resolve([]);
        });
    });
}

function registerIpcHandlers(mainWindow) {
    ipcMain.handle('categories:get', async () => {
        try {
            return await fetchCategoriesFromApi();
        } catch (err) {
            console.error('[categories:get] error:', err.message);
            return [];
        }
    });

    ipcMain.handle('printers:get', async () => {
        try { return await getInstalledPrinters(); } catch (_err) { return []; }
    });

    ipcMain.handle('assignments:load', async () => {
        try { return await loadAssignments(); } catch (_err) { return {}; }
    });

    ipcMain.handle('assignments:save', async (_event, assignments) => {
        try {
            await saveAssignments(assignments);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('assignments:saved', { success: true });
            }
            return { success: true };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('assignments:saved', { success: false, error: errorMessage });
            }
            return { success: false, error: errorMessage };
        }
    });

    ipcMain.handle('config:load', async () => {
        try { return await loadConfig(); } catch (_err) { return {}; }
    });

    ipcMain.handle('config:save', async (_event, config) => {
        try {
            await saveConfig(config);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('diagnose:run', async (_event, config) => {
        const results = [];
        const http = require('http');
        const https = require('https');

        let baseUrl = (config.serverUrl || '').trim().replace(/\/$/, '');
        if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
            baseUrl = 'http://' + baseUrl;
        }
        const token = config.token || '';

        // ── Step 1: URL configured? ──
        if (!baseUrl) {
            results.push({ ok: false, label: 'رابط السيرفر', detail: 'لم يتم إدخال رابط السيرفر', hint: 'افتح الإعدادات وأدخل رابط السيرفر مثل: http://192.168.1.10:8080' });
            return results;
        }
        results.push({ ok: true, label: 'رابط السيرفر', detail: baseUrl });

        // ── Step 2: Token configured? ──
        if (!token) {
            results.push({ ok: false, label: 'Desktop Token', detail: 'الـ Token فارغ', hint: 'أدخل الـ Token الصحيح في الإعدادات' });
        } else {
            results.push({ ok: true, label: 'Desktop Token', detail: token.substring(0, 8) + '…' });
        }

        // ── Step 3: Reachability (health endpoint) ──
        const healthUrl = `${baseUrl}/pos/api/desktop/health`;
        const healthResult = await httpGet(healthUrl, token, http, https);
        if (!healthResult.reachable) {
            results.push({ ok: false, label: 'الاتصال بالسيرفر', detail: `تعذّر الوصول — ${healthResult.error}`, hint: 'تأكد أن السيرفر شغال وأن الـ URL صحيح والـ port مفتوح' });
            return results;
        }
        results.push({ ok: true, label: 'الاتصال بالسيرفر', detail: `HTTP ${healthResult.status} — السيرفر يستجيب` });

        // ── Step 4: Auth (categories endpoint) ──
        const catUrl = `${baseUrl}/pos/api/desktop/categories`;
        const catResult = await httpGet(catUrl, token, http, https);
        if (!catResult.reachable) {
            results.push({ ok: false, label: 'جلب الأقسام', detail: `خطأ في الشبكة — ${catResult.error}`, hint: 'تحقق من الاتصال بالشبكة' });
            return results;
        }
        if (catResult.status === 401 || catResult.status === 403) {
            results.push({ ok: false, label: 'التحقق من الـ Token', detail: `HTTP ${catResult.status} — الـ Token غير صحيح أو منتهي`, hint: 'تأكد من الـ Token في إعدادات السيرفر وأعد إدخاله هنا' });
            return results;
        }
        if (catResult.status === 404) {
            results.push({ ok: false, label: 'مسار الـ API', detail: `HTTP 404 — المسار غير موجود على السيرفر`, hint: 'تأكد أن إصدار السيرفر يدعم /pos/api/desktop/categories' });
            return results;
        }
        if (catResult.status !== 200) {
            results.push({ ok: false, label: 'جلب الأقسام', detail: `HTTP ${catResult.status} — استجابة غير متوقعة`, hint: 'راجع logs السيرفر' });
            return results;
        }

        // ── Step 5: Parse categories ──
        try {
            const parsed = JSON.parse(catResult.body);
            const cats = Array.isArray(parsed.categories) ? parsed.categories : [];
            if (cats.length === 0) {
                results.push({ ok: false, label: 'الأقسام', detail: 'الاستجابة ناجحة لكن لا توجد أقسام', hint: 'أضف أقسام في لوحة التحكم على السيرفر' });
            } else {
                results.push({ ok: true, label: 'الأقسام', detail: `تم جلب ${cats.length} قسم بنجاح ✓` });
            }
        } catch (_e) {
            results.push({ ok: false, label: 'تحليل الاستجابة', detail: 'الاستجابة ليست JSON صحيح', hint: `أول 200 حرف: ${catResult.body.substring(0, 200)}` });
        }

        // ── Step 6: Printers ──
        const { getInstalledPrinters } = require('./printer-service');
        try {
            const printerList = await getInstalledPrinters();
            if (printerList.length === 0) {
                results.push({ ok: false, label: 'الطابعات', detail: 'لم يتم العثور على طابعات مثبتة', hint: 'تأكد من تثبيت طابعة على الويندوز' });
            } else {
                results.push({ ok: true, label: 'الطابعات', detail: `${printerList.length} طابعة متاحة: ${printerList.slice(0, 3).join('، ')}${printerList.length > 3 ? '…' : ''}` });
            }
        } catch (e) {
            results.push({ ok: false, label: 'الطابعات', detail: `خطأ: ${e.message}` });
        }

        return results;
    });
}

function httpGet(url, token, http, https) {
    return new Promise((resolve) => {
        const transport = url.startsWith('https') ? https : http;
        const options = { headers: { 'X-Desktop-Token': token, 'Accept': 'application/json' }, timeout: 6000 };
        const req = transport.get(url, options, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ reachable: true, status: res.statusCode, body }));
        });
        req.on('error', (err) => resolve({ reachable: false, error: err.message, status: 0, body: '' }));
        req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'timeout — انتهت مهلة الاتصال', status: 0, body: '' }); });
    });
}

module.exports = { registerIpcHandlers, setConfigPath };
