'use strict';

/**
 * Reads all categories from the IndexedDB `pos-db` database
 * using Electron's session API to execute JavaScript in the browser context.
 *
 * @param {Electron.Session|null|undefined} sessionObj - Electron session to use.
 *   If null/undefined, falls back to require('electron').session.defaultSession.
 * @returns {Promise<Array<{id: number, name: string}>>} Array of category objects, or [] on any error.
 */
async function readCategoriesFromIndexedDB(sessionObj) {
    const script = `
new Promise((resolve) => {
  const req = indexedDB.open('POSDB');
  req.onerror = () => resolve([]);
  req.onsuccess = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('categories')) {
      db.close();
      resolve([]);
      return;
    }
    const tx = db.transaction('categories', 'readonly');
    const store = tx.objectStore('categories');
    const getAllReq = store.getAll();
    getAllReq.onsuccess = (ev) => {
      db.close();
      resolve(ev.target.result || []);
    };
    getAllReq.onerror = () => { db.close(); resolve([]); };
  };
})
`;

    try {
        const targetSession = sessionObj != null
            ? sessionObj
            : require('electron').session.defaultSession;

        const results = await targetSession.executeJavaScript(script);

        if (!Array.isArray(results)) {
            return [];
        }

        return results.map((item) => ({
            id: item.id,
            name: item.name,
        }));
    } catch (_err) {
        return [];
    }
}

module.exports = { readCategoriesFromIndexedDB };
