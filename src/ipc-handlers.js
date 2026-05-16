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
}

module.exports = { registerIpcHandlers, setConfigPath };
