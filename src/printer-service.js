'use strict';

const { execSync } = require('child_process');

/**
 * Enumerates all Windows printers using WMIC (compatible with Windows 7+).
 * Falls back to PowerShell Get-Printer for Windows 8+ if WMIC fails.
 *
 * @returns {Promise<string[]>} Array of printer names, or [] on any error.
 */
async function getInstalledPrinters() {
    // Strategy 1: WMIC — works on Windows XP, 7, 8, 10, 11
    try {
        const output = execSync(
            'wmic printer get name /format:list',
            { encoding: 'utf8', shell: 'cmd.exe', timeout: 5000 }
        );

        const printers = output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('Name='))
            .map((line) => line.replace(/^Name=/, '').trim())
            .filter((name) => name.length > 0);

        if (printers.length > 0) {
            return printers;
        }
    } catch (_err) {
        // WMIC failed, try PowerShell fallback
    }

    // Strategy 2: PowerShell Get-Printer — Windows 8+ only fallback
    try {
        const output = execSync(
            'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
            { encoding: 'utf8', shell: 'cmd.exe', timeout: 5000 }
        );

        return output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    } catch (_err) {
        return [];
    }
}

/**
 * @param {string} content
 * @param {string} printerName
 * @returns {Promise<boolean>}
 */
async function printContent(content, printerName) {
    const { WindowsPrinterAdapter } = require('./printer-adapter');
    const adapter = new WindowsPrinterAdapter();
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>body{font-family:'Courier New',monospace;white-space:pre-wrap;font-size:14px;margin:0;padding:8px;width:78mm}</style>
</head><body>${String(content)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</body></html>`;

    try {
        await adapter.print(html, printerName);
        return true;
    } catch (err) {
        console.error('[Printer Service] Print failed:', err.message);
        return false;
    }
}

module.exports = { getInstalledPrinters, printContent };

