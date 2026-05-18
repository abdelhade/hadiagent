'use strict';

const { ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { getInstalledPrinters } = require('./printer-service');
const repo = require('./posdb-repository');
const sync = require('./posdb-sync');
const { pullFromMassar } = require('./pos-pull-sync');
const { normalizeMassarUrl } = require('./url-utils');
const { getAgentLocalUrl } = require('./local-server');
const { getServerStatus } = require('./local-server');

let configFilePath = null;

function getConfigPath() {
    if (configFilePath) {
        return configFilePath;
    }
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'config.json');
}

function setConfigPath(p) {
    configFilePath = p;
}

async function loadConfig() {
    try {
        const raw = await fs.readFile(getConfigPath(), 'utf8');
        const config = JSON.parse(raw);
        if (config.serverUrl) {
            config.serverUrl = normalizeMassarUrl(config.serverUrl);
        }
        return config;
    } catch (_err) {
        return { serverUrl: '', enableLocalPrinting: true, agentToken: '' };
    }
}

async function saveConfig(config) {
    const normalized = { ...config };
    if (normalized.serverUrl) {
        normalized.serverUrl = normalizeMassarUrl(normalized.serverUrl);
    }
    const dir = path.dirname(getConfigPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getConfigPath(), JSON.stringify(normalized, null, 2), 'utf8');
}

function getPosSession() {
    return session.fromPartition('persist:pos');
}

function registerIpcHandlers(mainWindow) {
    ipcMain.handle('config:load', async () => {
        try {
            return await loadConfig();
        } catch (_err) {
            return {};
        }
    });

    ipcMain.handle('config:save', async (_event, config) => {
        try {
            await saveConfig(config);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('config:saved', { success: true });
            }
            ipcMain.emit('config:updated');
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('printers:get', async () => {
        try {
            return await getInstalledPrinters();
        } catch (_err) {
            return [];
        }
    });

    ipcMain.handle('posdb:categories', async () => {
        const synced = sync.getCategories();
        if (synced.length > 0) {
            return synced;
        }
        try {
            return await repo.getCategories(getPosSession());
        } catch (_err) {
            return [];
        }
    });

    ipcMain.handle('posdb:print-config', async () => {
        const synced = sync.getPrintConfig();
        if (synced) {
            return synced;
        }
        try {
            return await repo.getPrintConfig(getPosSession());
        } catch (_err) {
            return null;
        }
    });

    ipcMain.handle('diagnose:run', async () => {
        const results = [];
        const config = await loadConfig();
        const baseUrl = normalizeMassarUrl(config.serverUrl || '');
        const agentToken = (config.agentToken || '').trim();

        if (!baseUrl) {
            results.push({
                ok: false,
                label: 'رابط Massar',
                detail: 'لم يُحدَّد',
                hint: 'مثال: http://127.0.0.1:8080 (بدون /pos/restaurant)',
            });
        } else {
            results.push({ ok: true, label: 'رابط Massar', detail: baseUrl });
        }

        results.push({
            ok: !!agentToken,
            label: 'Token (Agent)',
            detail: agentToken ? 'مضبوط ✓' : 'غير مضبوط — انسخ HADI_AGENT_TOKEN من .env',
            hint: agentToken ? null : 'يجب أن يطابق قيمة HADI_AGENT_TOKEN في Massar',
        });

        const srv = getServerStatus();
        results.push({
            ok: srv.ok && srv.mode === 'local',
            label: 'خادم Agent (ديناميكي)',
            detail: srv.detail,
            hint: srv.mode === 'external'
                ? 'من Task Manager: أغلق electron.exe القديم ثم npm run kill-port ثم npm start'
                : (srv.ok ? (srv.url ? `المتصفح يكتشف ${srv.url} تلقائياً` : null) : 'شغّل: npm run kill-port ثم npm start'),
        });

        if (baseUrl) {
            const pullResult = await pullFromMassar(baseUrl, agentToken);
            if (pullResult.ok) {
                results.push({
                    ok: true,
                    label: 'سحب من Massar',
                    detail: `${pullResult.categories_count} مجموعة`,
                });
            } else {
                results.push({
                    ok: false,
                    label: 'سحب من Massar',
                    detail: pullResult.error || 'فشل',
                    hint: pullResult.error === 'token_unauthorized'
                        ? 'Token في Agent لا يطابق HADI_AGENT_TOKEN في .env'
                        : 'تأكد أن Massar يعمل وأن المسار /pos/api/desktop/agent-sync متاح',
                });
            }
        }

        const categories = sync.getCategories();
        const withPrinter = categories.filter((c) => c.printer_name);
        const syncedAt = sync.getSyncedAt();

        if (categories.length === 0) {
            results.push({
                ok: false,
                label: 'POSDB — المجموعات',
                detail: 'لم تُزامَن بعد من متصفح الكاشير',
                hint: 'افتح /pos/restaurant في Chrome، أو اضبط Token + رابط Massar ثم أعد التشخيص',
            });
        } else {
            results.push({
                ok: true,
                label: 'POSDB — المجموعات',
                detail: `${categories.length} مجموعة، ${withPrinter.length} مربوطة — آخر مزامنة: ${syncedAt || '—'}`,
            });
        }

        try {
            const printConfig = sync.getPrintConfig() || await repo.getPrintConfig(getPosSession());
            if (printConfig?.direct_printer_name) {
                results.push({
                    ok: true,
                    label: 'طابعة الكاشير',
                    detail: printConfig.direct_printer_name,
                });
            } else {
                results.push({
                    ok: false,
                    label: 'طابعة الكاشير',
                    detail: 'غير معيّنة في POSDB',
                    hint: 'عيّن محطة طابعة افتراضية من إعدادات الطباعة في Massar',
                });
            }
        } catch (e) {
            results.push({ ok: false, label: 'إعدادات الطباعة', detail: e.message });
        }

        try {
            const printerList = await getInstalledPrinters();
            if (printerList.length === 0) {
                results.push({
                    ok: false,
                    label: 'طابعات Windows',
                    detail: 'لا توجد طابعات مثبتة',
                });
            } else {
                results.push({
                    ok: true,
                    label: 'طابعات Windows',
                    detail: `${printerList.length} طابعة: ${printerList.slice(0, 3).join('، ')}`,
                });
            }
        } catch (e) {
            results.push({ ok: false, label: 'طابعات Windows', detail: e.message });
        }

        return results;
    });

    ipcMain.handle('posdb:pull', async () => {
        const config = await loadConfig();
        return pullFromMassar(normalizeMassarUrl(config.serverUrl || ''), config.agentToken || '');
    });

    ipcMain.handle('agent:status', async () => getServerStatus());

    ipcMain.handle('agent:url', async () => getAgentLocalUrl());
}

module.exports = { registerIpcHandlers, setConfigPath, loadConfig, saveConfig };
