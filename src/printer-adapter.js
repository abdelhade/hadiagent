'use strict';

const { BrowserWindow } = require('electron');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const PRINT_TIMEOUT_MS = 25000;

/**
 * طباعة صامتة عبر Electron — الطريقة الوحيدة الموثوقة لطابعات ESC/POS على Windows
 */
class WindowsPrinterAdapter {
    /**
     * @param {string} html
     * @param {string} printerName — اسم الطابعة كما في Windows (مثال: Xprinter XP-233B)
     * @returns {Promise<void>}
     */
    async print(html, printerName) {
        const name = (printerName || '').trim();
        if (!name) {
            throw new Error('printer_name is empty');
        }

        const tmpFile = path.join(
            os.tmpdir(),
            `hadi_ticket_${Date.now()}_${Math.random().toString(36).slice(2)}.html`
        );

        await fs.writeFile(tmpFile, html, 'utf8');

        try {
            await this._printFile(tmpFile, name);
        } finally {
            fs.unlink(tmpFile).catch(() => {});
        }
    }

    /**
     * @param {string} filePath
     * @param {string} printerName
     */
    _printFile(filePath, printerName) {
        return new Promise((resolve, reject) => {
            const printWin = new BrowserWindow({
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                },
            });

            let settled = false;

            const finish = (fn, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                try {
                    if (!printWin.isDestroyed()) {
                        printWin.close();
                    }
                } catch (_e) { /* ignore */ }
                fn(value);
            };

            const timer = setTimeout(() => {
                finish(reject, new Error(`print timeout (${PRINT_TIMEOUT_MS}ms) on "${printerName}"`));
            }, PRINT_TIMEOUT_MS);

            printWin.webContents.once('did-fail-load', (_event, code, desc) => {
                finish(reject, new Error(`ticket load failed: ${code} ${desc || ''}`.trim()));
            });

            printWin.webContents.once('did-finish-load', () => {
                printWin.webContents.print(
                    {
                        silent:          true,
                        printBackground: true,
                        deviceName:      printerName,
                    },
                    (success, failureReason) => {
                        if (success) {
                            finish(resolve, undefined);
                            return;
                        }
                        const reason = failureReason || 'unknown';
                        finish(reject, new Error(`print failed on "${printerName}": ${reason}`));
                    }
                );
            });

            printWin.loadFile(filePath).catch((err) => {
                finish(reject, err);
            });
        });
    }
}

module.exports = { WindowsPrinterAdapter };
