'use strict';

const fs = require('fs/promises');
const path = require('path');

// Default path uses Electron's app.getPath, but can be overridden for testing
let assignmentsFilePath = null;

/**
 * Returns the path to assignments.json.
 * Uses the overridden path if set (for testing), otherwise uses Electron's userData path.
 *
 * @returns {string}
 */
function getFilePath() {
    if (assignmentsFilePath) {
        return assignmentsFilePath;
    }
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'assignments.json');
}

/**
 * Override the assignments file path (for testing without Electron).
 *
 * @param {string} p
 */
function setFilePath(p) {
    assignmentsFilePath = p;
}

/**
 * Load printer assignments from the JSON file.
 * Returns {} if the file does not exist.
 * Throws on any other error.
 *
 * @returns {Promise<Record<string, string>>}
 */
async function loadAssignments() {
    const filePath = getFilePath();
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return {};
        }
        throw err;
    }
}

/**
 * Save printer assignments to the JSON file atomically.
 * Writes to a .tmp file first, then renames to the target path.
 * Creates the directory if it does not exist.
 *
 * @param {Record<string, string>} assignments
 * @returns {Promise<void>}
 */
async function saveAssignments(assignments) {
    const filePath = getFilePath();
    const tmpPath = filePath + '.tmp';
    const dir = path.dirname(filePath);

    try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(tmpPath, JSON.stringify(assignments), 'utf8');
        await fs.rename(tmpPath, filePath);
    } catch (err) {
        console.error('[assignment-store] Failed to save assignments:', err);
        throw err;
    }
}

module.exports = { loadAssignments, saveAssignments, setFilePath };
