'use strict';

const { execSync } = require('child_process');
const os   = require('os');
const fs   = require('fs/promises');
const path = require('path');

/**
 * PrinterAdapter interface
 * كل adapter يجب أن ينفّذ: print(html, printerName): Promise<void>
 */

class WindowsPrinterAdapter {
    /**
     * طباعة HTML على طابعة Windows محددة عبر PowerShell
     * @param {string} html
     * @param {string} printerName
     * @returns {Promise<void>}
     */
    async print(html, printerName) {
        const tmpFile = path.join(
            os.tmpdir(),
            `hadi_ticket_${Date.now()}_${Math.random().toString(36).slice(2)}.html`
        );

        await fs.writeFile(tmpFile, html, 'utf8');

        try {
            execSync(
                `Start-Process -FilePath "${tmpFile}" -Verb PrintTo -ArgumentList "${printerName}" -Wait`,
                { shell: 'powershell.exe', timeout: 15000 }
            );
        } finally {
            // حذف الملف المؤقت بعد الطباعة
            fs.unlink(tmpFile).catch(() => {});
        }
    }
}

module.exports = { WindowsPrinterAdapter };
