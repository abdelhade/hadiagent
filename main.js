'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/ipc-handlers');
const { startServer }         = require('./src/local-server');
const { startPoller }         = require('./src/queue-poller');

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

// Prevent the app from quitting when all windows are closed
app.on('window-all-closed', (e) => {
    e.preventDefault();
});
