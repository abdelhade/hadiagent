'use strict';

const http = require('http');
const net = require('net');
const { execSync } = require('child_process');

const DEFAULT_PORT_MIN = 5000;
const DEFAULT_PORT_MAX = 5010;

/**
 * @param {number} port
 * @returns {string}
 */
function buildAgentUrl(port) {
    return `http://127.0.0.1:${port}`;
}

/**
 * @param {number} port
 * @returns {Promise<object|null>}
 */
function probeAgentHealth(port) {
    return new Promise((resolve) => {
        const req = http.get(`${buildAgentUrl(port)}/health`, { timeout: 1500 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json?.status === 'ok' && json?.mode === 'posdb-sync') {
                        resolve({ ...json, port: json.port ?? port });
                        return;
                    }
                } catch (_e) { /* ignore */ }
                resolve(null);
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

/**
 * @param {number} min
 * @param {number} max
 * @returns {Promise<{ port: number, health: object }|null>}
 */
async function discoverAgentOnPorts(min = DEFAULT_PORT_MIN, max = DEFAULT_PORT_MAX) {
    for (let port = min; port <= max; port++) {
        const health = await probeAgentHealth(port);
        if (health) {
            return { port, health };
        }
    }
    return null;
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortFree(port) {
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.once('error', () => resolve(false));
        tester.once('listening', () => {
            tester.close(() => resolve(true));
        });
        tester.listen(port, '127.0.0.1');
    });
}

/**
 * @param {number} min
 * @param {number} max
 * @param {number|null} preferred
 * @returns {Promise<number[]>}
 */
async function buildPortTryOrder(min, max, preferred = null) {
    const order = [];
    if (preferred != null && preferred >= min && preferred <= max) {
        order.push(preferred);
    }
    for (let p = min; p <= max; p++) {
        if (!order.includes(p)) {
            order.push(p);
        }
    }
    return order;
}

/**
 * @param {number} port
 * @returns {number|null}
 */
function getPidOnPort(port) {
    try {
        const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8', timeout: 5000 });
        for (const line of out.split('\n')) {
            if (!line.includes('LISTENING')) {
                continue;
            }
            const parts = line.trim().split(/\s+/);
            const local = parts[1] || '';
            if (!local.endsWith(`:${port}`)) {
                continue;
            }
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid > 0) {
                return pid;
            }
        }
    } catch (_e) {
        return null;
    }
    return null;
}

/**
 * @param {number} pid
 */
function killPid(pid) {
    if (!pid || pid === process.pid) {
        return false;
    }
    try {
        execSync(`taskkill /PID ${pid} /F`, { timeout: 8000, stdio: 'ignore' });
        return true;
    } catch (_e) {
        return false;
    }
}

/**
 * @param {number} port
 * @param {number} currentPid
 * @returns {Promise<boolean>}
 */
async function freePortForAgent(port, currentPid = process.pid) {
    const holder = getPidOnPort(port);
    if (!holder || holder === currentPid) {
        return true;
    }

    const health = await probeAgentHealth(port);
    if (health) {
        return false;
    }

    console.warn(`[port-utils] port ${port} held by PID ${holder} (not Agent) — terminating`);
    killPid(holder);
    await new Promise((r) => setTimeout(r, 400));
    const still = getPidOnPort(port);
    return !still || still === currentPid;
}

module.exports = {
    DEFAULT_PORT_MIN,
    DEFAULT_PORT_MAX,
    buildAgentUrl,
    probeAgentHealth,
    discoverAgentOnPorts,
    isPortFree,
    buildPortTryOrder,
    getPidOnPort,
    killPid,
    freePortForAgent,
};
