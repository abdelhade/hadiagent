'use strict';

/**
 * نسخة POSDB المُزامَنة من متصفح الكاشير (Chrome/Edge).
 * IndexedDB في Electron ≠ IndexedDB في المتصفح — لذلك المتصفح يدفع البيانات هنا.
 */

let syncedCategories = [];
let syncedPrintConfig = null;
let syncedAt = null;

function setSyncData({ categories, print_config }) {
    if (Array.isArray(categories)) {
        syncedCategories = categories;
    }
    if (print_config && typeof print_config === 'object') {
        syncedPrintConfig = print_config;
    }
    syncedAt = new Date().toISOString();
    console.log(
        `[posdb-sync] updated: ${syncedCategories.length} categories,`
        + ` direct=${syncedPrintConfig?.direct_printer_name || '—'}`
    );
}

function getCategories() {
    return syncedCategories;
}

function getPrintConfig() {
    return syncedPrintConfig;
}

function getSyncedAt() {
    return syncedAt;
}

function buildCategoryPrinterMap() {
    const map = new Map();
    for (const cat of syncedCategories) {
        if (cat?.printer_name) {
            map.set(String(cat.id), cat.printer_name);
        }
    }
    return map;
}

module.exports = {
    setSyncData,
    getCategories,
    getPrintConfig,
    getSyncedAt,
    buildCategoryPrinterMap,
};
