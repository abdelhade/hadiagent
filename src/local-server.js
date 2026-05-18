'use strict';

const http = require('http');
const sync = require('./posdb-sync');
const {
    buildAgentUrl,
    probeAgentHealth,
    discoverAgentOnPorts,
    buildPortTryOrder,
    freePortForAgent,
    getPidOnPort,
    DEFAULT_PORT_MIN,
    DEFAULT_PORT_MAX,
} = require('./port-utils');

let server = null;
let listening = false;
let activePort = null;
let externalAgent = null;

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {() => { token?: string }} getAuth
 */
function isAuthorized(req, getAuth) {
    const expected = (getAuth()?.token || '').trim();
    if (!expected) {
        return true;
    }

    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const header = (req.headers['x-desktop-token'] || '').trim();
    const provided = header || bearer;

    return provided === expected;
}

function getActivePort() {
    return activePort;
}

function getAgentLocalUrl() {
    if (activePort) {
        return buildAgentUrl(activePort);
    }
    if (externalAgent?.port) {
        return buildAgentUrl(externalAgent.port);
    }
    return null;
}

function isServerListening() {
    return listening;
}

function getServerStatus() {
    if (listening && activePort) {
        return {
            ok: true,
            mode: 'local',
            port: activePort,
            url:  buildAgentUrl(activePort),
            detail: `يعمل على ${buildAgentUrl(activePort)}`,
        };
    }
    if (externalAgent) {
        return {
            ok: false,
            mode: 'external',
            port: externalAgent.port,
            url:  buildAgentUrl(externalAgent.port),
            detail: `نسخة أخرى على :${externalAgent.port} — أغلقها من Task Manager`,
        };
    }
    return { ok: false, mode: 'off', port: null, url: null, detail: 'غير شغال' };
}

function startServer(port, mainWindow, onPosdbNotify, getAuth) {
    if (server && listening && activePort === port) {
        return Promise.resolve(true);
    }

    if (server) {
        try {
            server.close();
        } catch (_e) { /* ignore */ }
        server = null;
        listening = false;
    }

    function notifyUI(details) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('print:event', {
                timestamp: new Date().toLocaleTimeString('ar-EG'),
                ...details,
            });
        }
    }

    server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Desktop-Token, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const needsAuth = req.url === '/posdb/sync' || req.url === '/posdb/notify';
        if (needsAuth && !isAuthorized(req, getAuth)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
            return;
        }

        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                version: '1.2.0',
                mode: 'posdb-sync',
                port: activePort,
                url: activePort ? buildAgentUrl(activePort) : null,
                categories: sync.getCategories().length,
                synced_at: sync.getSyncedAt(),
                token_required: !!(getAuth()?.token || '').trim(),
            }));
            return;
        }

        if (req.url === '/posdb/sync' && req.method === 'POST') {
            try {
                const data = await readJsonBody(req);
                sync.setSyncData({
                    categories:   data.categories,
                    print_config: data.print_config,
                });
                notifyUI({ success: true, type: 'sync', count: sync.getCategories().length });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    categories_count: sync.getCategories().length,
                    port: activePort,
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        if (req.url === '/posdb/notify' && req.method === 'POST') {
            try {
                const data = await readJsonBody(req);
                let jobResults = [];
                if (typeof onPosdbNotify === 'function') {
                    jobResults = await onPosdbNotify(data) || [];
                }
                notifyUI({ success: true, type: 'notify', local_id: data.local_id });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, jobs: jobResults, port: activePort }));
            } catch (e) {
                notifyUI({ success: false, type: 'notify', error: e.message });
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not Found' }));
    });

    return new Promise((resolve) => {
        server.on('error', (err) => {
            listening = false;
            activePort = null;
            server = null;
            if (err.code === 'EADDRINUSE') {
                resolve(false);
                return;
            }
            console.error('[Local Server] error:', err.message);
            resolve(false);
        });

        server.listen(port, '127.0.0.1', () => {
            listening = true;
            activePort = port;
            externalAgent = null;
            console.log(`[Local Server] ${buildAgentUrl(port)} (sync + notify)`);
            resolve(true);
        });
    });
}

/**
 * يبحث عن منفذ حر ضمن النطاق ويشغّل الخادم
 * @param {object} options
 * @returns {Promise<{ ok: boolean, port?: number }>}
 */
async function ensureServer(mainWindow, onPosdbNotify, getAuth, options = {}) {
    const min = options.portMin ?? DEFAULT_PORT_MIN;
    const max = options.portMax ?? DEFAULT_PORT_MAX;
    const preferred = options.preferredPort ?? null;

    const tryOrder = await buildPortTryOrder(min, max, preferred);

    for (const port of tryOrder) {
        const existing = await probeAgentHealth(port);
        const holder = getPidOnPort(port);
        if (existing && holder && holder !== process.pid) {
            externalAgent = { port, health: existing };
            continue;
        }

        await freePortForAgent(port, process.pid);
        const ok = await startServer(port, mainWindow, onPosdbNotify, getAuth);
        if (ok) {
            return { ok: true, port };
        }
    }

    const found = await discoverAgentOnPorts(min, max);
    if (found) {
        externalAgent = found;
        console.warn(
            `[Local Server] Hadi Agent already on :${found.port}`
            + ' — close other instance from Task Manager'
        );
        return { ok: false, port: found.port, external: true };
    }

    return { ok: false };
}

function stopServer() {
    if (server) {
        server.close();
        server = null;
    }
    listening = false;
    activePort = null;
}

module.exports = {
    startServer,
    ensureServer,
    stopServer,
    isServerListening,
    getServerStatus,
    getActivePort,
    getAgentLocalUrl,
    probeAgentHealth,
};
