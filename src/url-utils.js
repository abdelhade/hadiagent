'use strict';

const { DEFAULT_PORT_MIN, DEFAULT_PORT_MAX, buildAgentUrl } = require('./port-utils');

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeMassarUrl(url) {
    let base = (url || '').trim().replace(/\/$/, '');
    if (!base) {
        return '';
    }
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
        base = 'http://' + base;
    }
    base = base.replace(/\/pos\/restaurant\/?$/i, '');
    return base.replace(/\/$/, '');
}

module.exports = {
    normalizeMassarUrl,
    buildAgentUrl,
    DEFAULT_PORT_MIN,
    DEFAULT_PORT_MAX,
};
