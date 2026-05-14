'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/ipc-handlers');
const { startServer } = require('./src/local-server');

let win = null;
let tray = null;

/**
 * Creates the main application window.
 */
function createWindow() {
    win = new BrowserWindow({
        width: 750,
        height: 550,
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

app.whenReady().then(() => {
    createWindow();
    startServer(5000); // Start the local HTTP server for print requests
});

// Prevent the app from quitting when all windows are closed
app.on('window-all-closed', (e) => {
    e.preventDefault();
});
