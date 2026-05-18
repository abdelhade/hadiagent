'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { registerIpcHandlers, loadConfig, saveConfig } = require('./src/ipc-handlers');
const { ensureServer, stopServer } = require('./src/local-server');
const {
    startPolling,
    stopPolling,
    registerPrintWorkerIpc,
    triggerPrint,
    setWorkerContext,
} = require('./src/print-worker');
const { WindowsPrinterAdapter } = require('./src/printer-adapter');
const repo = require('./src/posdb-repository');
const { pullFromMassar } = require('./src/pos-pull-sync');
const { normalizeMassarUrl } = require('./src/url-utils');

let win = null;
let tray = null;
let posWin = null;
let isQuitting = false;
let trayHintShown = false;
let cachedConfig = { serverUrl: '', enableLocalPrinting: true, agentToken: '' };

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

async function refreshCachedConfig() {
    cachedConfig = await loadConfig();
    return cachedConfig;
}

async function runMassarPull() {
    const config = await refreshCachedConfig();
    const massarUrl = normalizeMassarUrl(config.serverUrl);
    if (!massarUrl) {
        return { ok: false, error: 'massar_url_missing' };
    }

    const result = await pullFromMassar(massarUrl, config.agentToken || '');
    if (result.ok) {
        console.log(`[pull-sync] ${result.categories_count} categories from Massar`);
        if (win && !win.isDestroyed()) {
            win.webContents.send('print:event', { type: 'sync', success: true, source: 'massar' });
        }
    } else {
        console.warn('[pull-sync] failed:', result.error);
    }
    return result;
}

async function createPosWindow(serverUrl) {
    if (posWin && !posWin.isDestroyed()) {
        return;
    }

    const massarUrl = normalizeMassarUrl(serverUrl);
    if (!massarUrl) {
        return;
    }

    posWin = new BrowserWindow({
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:pos',
        },
    });

    const posUrl = massarUrl + '/pos/restaurant';
    console.log('[main] POS hidden window:', posUrl);

    posWin.loadURL(posUrl).catch((err) => {
        console.warn('[main] POS window load failed:', err.message);
    });

    posWin.on('closed', () => {
        posWin = null;
    });
}

function hideToTray() {
    if (!win || win.isDestroyed()) {
        return;
    }
    win.hide();
    if (tray && !trayHintShown) {
        trayHintShown = true;
        tray.setToolTip('Hadi Agent — يعمل في الخلفية (انقر مرتين للفتح)');
        try {
            const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
            const icon = nativeImage.createFromPath(iconPath);
            if (!icon.isEmpty()) {
                tray.displayBalloon({
                    icon,
                    title: 'Hadi Agent',
                    content: 'يعمل في الخلفية — الطباعة مستمرة. انقر مرتين على الأيقونة للفتح.',
                });
            }
        } catch (_err) {
            // displayBalloon غير متاح على بعض إصدارات Windows
        }
    }
}

function createWindow() {
    win = new BrowserWindow({
        width: 900,
        height: 700,
        show: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: 'Hadi Agent — طباعة POS',
    });

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    win.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            hideToTray();
        }
    });

    registerIpcHandlers(win);
    createTray();
}

function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('Hadi Agent — POS');

    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: 'إظهار النافذة',
                click: () => {
                    if (win && !win.isDestroyed()) {
                        win.show();
                        win.focus();
                    }
                },
            },
            {
                label: 'إخفاء للخلفية',
                click: () => hideToTray(),
            },
            { type: 'separator' },
            {
                label: 'إنهاء البرنامج',
                click: () => {
                    isQuitting = true;
                    app.quit();
                },
            },
        ])
    );

    tray.on('double-click', () => {
        if (win) {
            win.show();
            win.focus();
        }
    });
}

async function initPrintWorker(mainWindow) {
    const adapter = new WindowsPrinterAdapter();
    const config = await refreshCachedConfig();
    const staleMs = config.staleThresholdMs ?? 300000;

    if (config.serverUrl) {
        await createPosWindow(config.serverUrl);
    }

    const ses = posWin && !posWin.isDestroyed()
        ? posWin.webContents.session
        : session.fromPartition('persist:pos');

    const recovered = await repo.recoverStuckTransactions(ses, staleMs);
    if (recovered > 0) {
        console.log(`[main] recovered ${recovered} stuck transaction(s)`);
    }

    setWorkerContext({ session: ses, adapter, mainWindow });
    registerPrintWorkerIpc(mainWindow, ses, adapter);

    if (config.enableLocalPrinting !== false) {
        const fallbackMs = config.fallbackPollMs ?? 60000;
        startPolling(mainWindow, ses, adapter, fallbackMs);
        setTimeout(() => triggerPrint().catch(() => {}), 5000);
    }
}

app.on('second-instance', () => {
    if (win) {
        win.show();
        win.focus();
    }
});

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) {
        return;
    }

    createWindow();

    await refreshCachedConfig();

    const serverResult = await ensureServer(
        win,
        (payload) => triggerPrint(payload || {}),
        () => ({ token: cachedConfig.agentToken || '' }),
        {
            preferredPort: cachedConfig.agentPort || null,
            portMin:       cachedConfig.agentPortMin ?? 5000,
            portMax:       cachedConfig.agentPortMax ?? 5010,
        }
    );
    if (serverResult.ok && serverResult.port) {
        if (cachedConfig.agentPort !== serverResult.port) {
            cachedConfig.agentPort = serverResult.port;
            await saveConfig(cachedConfig);
        }
        console.log(`[main] Agent listening on port ${serverResult.port}`);
    } else {
        console.warn('[main] Local server not started — run: npm run kill-port');
    }

    await initPrintWorker(win);
    await runMassarPull();

    const { ipcMain } = require('electron');
    ipcMain.on('config:updated', async () => {
        await refreshCachedConfig();
        const config = cachedConfig;
        if (config.serverUrl) {
            if (posWin && !posWin.isDestroyed()) {
                posWin.destroy();
                posWin = null;
            }
            await createPosWindow(config.serverUrl);
        }
        await runMassarPull();
    });

    setInterval(() => {
        runMassarPull().catch(() => {});
    }, 120000);
});

app.on('before-quit', () => {
    isQuitting = true;
    stopServer();
});

app.on('window-all-closed', (e) => {
    e.preventDefault();
});

// لا يُغلق التطبيق عند إغلاق كل النوافذ — يبقى في الـ Tray
app.on('activate', () => {
    if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
    }
});
