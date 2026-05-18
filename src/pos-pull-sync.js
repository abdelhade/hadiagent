'use strict';

const http = require('http');
const https = require('https');
const sync = require('./posdb-sync');
const { normalizeMassarUrl } = require('./url-utils');

/**
 * @param {string} massarUrl
 * @param {string} token
 * @returns {Promise<{ ok: boolean, error?: string, categories_count?: number }>}
 */
function pullFromMassar(massarUrl, token) {
    const base = normalizeMassarUrl(massarUrl);
    if (!base) {
        return Promise.resolve({ ok: false, error: 'massar_url_missing' });
    }

    const url = new URL('/pos/api/desktop/agent-sync', base);
    const lib = url.protocol === 'https:' ? https : http;

    const headers = { Accept: 'application/json' };
    if (token) {
        headers['X-Desktop-Token'] = token;
    }

    return new Promise((resolve) => {
        const req = lib.get(
            {
                hostname: url.hostname,
                port:     url.port || (url.protocol === 'https:' ? 443 : 80),
                path:     url.pathname + url.search,
                headers,
                timeout:  8000,
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 401) {
                        resolve({ ok: false, error: 'token_unauthorized' });
                        return;
                    }
                    if (res.statusCode !== 200) {
                        resolve({ ok: false, error: `http_${res.statusCode}` });
                        return;
                    }
                    try {
                        const data = JSON.parse(body);
                        sync.setSyncData({
                            categories:   data.categories,
                            print_config: data.print_config,
                        });
                        resolve({
                            ok:                true,
                            categories_count:  sync.getCategories().length,
                        });
                    } catch (e) {
                        resolve({ ok: false, error: e.message });
                    }
                });
            }
        );

        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, error: 'timeout' });
        });
    });
}

module.exports = { pullFromMassar };
