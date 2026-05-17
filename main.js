'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/ipc-handlers');
const { startServer }         = require('./src/local-server');
const { startPoller }         = require('./src/queue-poller');
const { startPolling, registerPrintWorkerIpc } = require('./src/print-worker');
const { WindowsPrinterAdapter }               = require('./src/printer-adapter');
const repo                                    = require('./src/posdb-repository');

// ── config loader (بدون Electron dependency) ─────────────────────────────────
const fs   = require('fs/promises');

async function loadConfig() {
    try {
        const configPath = require('path').join(app.getPath('userData'), 'config.json');
        const raw = await fs.readFile(configPath, 'utf8');
        return JSON.parse(raw);
    } catch (_err) {
        return { serverUrl: '', token: '' };
    }
}

let win = null;
let tray = null;

/**
 * Creates the main application window.
 */
function createWindow() {
    win = new BrowserWindow({
        width: 1500,
        height: 1000,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: 'إعداد طابعات المجموعات',
    });

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // DevTools disabled for production
    // win.webContents.openDevTools({ mode: 'detach' });

    // Minimize to tray instead of closing
    win.on('close', (e) => {
        e.preventDefault();
        win.hide();
    });

    registerIpcHandlers(win);
    createTray();
}

/**
 * Creates the system tray icon and context menu.
 */
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('إعداد طابعات المجموعات');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'فتح',
            click: () => {
                if (win) {
                    win.show();
                    win.focus();
                }
            },
        },
        { type: 'separator' },
        {
            label: 'إغلاق',
            click: () => {
                app.exit(0);
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    // Double-click to show/focus window
    tray.on('double-click', () => {
        if (win) {
            win.show();
            win.focus();
        }
    });
}

app.whenReady().then(async () => {
    createWindow();
    startServer(5000, win); // Local HTTP server (للاستخدام المحلي)

    // Queue Poller — يسحب طلبات الطباعة من السيرفر كل 3 ثواني
    const config = await loadConfig();
    if (config.serverUrl) {
        startPoller(config, win);
    }

    // Print Worker — طباعة التحضير من POSDB المحلية
    await initPrintWorker(win);

    // إعادة تشغيل الـ poller عند حفظ الـ config من الـ UI
    const { ipcMain } = require('electron');
    ipcMain.on('config:updated', async () => {
        const newConfig = await loadConfig();
        const { stopPoller } = require('./src/queue-poller');
        stopPoller();
        if (newConfig.serverUrl) {
            startPoller(newConfig, win);
        }
    });
});

/**
 * تهيئة print worker للطباعة المحلية من POSDB
 */
async function initPrintWorker(mainWindow) {
    const { session } = require('electron');
    const ses         = session.defaultSession;
    const adapter     = new WindowsPrinterAdapter();
    const config      = await loadConfig();
    const staleMs     = config.staleThresholdMs ?? 300000;

    // استرجاع transactions العالقة
    const recovered = await repo.recoverStuckTransactions(ses, staleMs);
    if (recovered > 0) {
        console.log(`[main] recovered ${recovered} stuck transactions`);
    }

    // تسجيل IPC handlers
    registerPrintWorkerIpc(mainWindow, ses, adapter);

    // تشغيل polling فقط إذا كان الـ flag مفعّلاً
    if (config.enableLocalPrinting === true) {
        startPolling(mainWindow, ses, adapter);
    }
}

// Prevent the app from quitting when all windows are closed
app.on('window-all-closed', (e) => {
    e.preventDefault();
});
