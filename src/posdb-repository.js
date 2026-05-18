'use strict';

// الاسم ثابت لا يُغيَّر ولا يُمرَّر كمتغير خارجي
const DB_NAME = 'POSDB';

/**
 * تنفيذ سكريبت في سياق IndexedDB عبر Electron session
 * @param {Electron.Session|null} session
 * @param {string} script
 * @returns {Promise<any>}
 */
async function _exec(session, script) {
    const s = session != null ? session : require('electron').session.defaultSession;
    return s.executeJavaScript(script);
}

/**
 * بناء سكريبت يفتح POSDB ويُنفّذ عملية على object store محدد
 * @param {string} store
 * @param {'readonly'|'readwrite'} mode
 * @param {string} body
 * @returns {string}
 */
function _open(store, mode, body) {
    return `new Promise((resolve, reject) => {
  const req = indexedDB.open(${JSON.stringify(DB_NAME)});
  req.onerror = () => reject(new Error('POSDB open failed'));
  req.onsuccess = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(${JSON.stringify(store)})) {
      db.close();
      resolve(null);
      return;
    }
    const tx     = db.transaction(${JSON.stringify(store)}, ${JSON.stringify(mode)});
    const store_ = tx.objectStore(${JSON.stringify(store)});
    ${body}
  };
})`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * جلب جميع categories من POSDB (تحتوي على printer_name)
 * @param {Electron.Session|null} session
 * @returns {Promise<Array<{id: number, name: string, printer_name: string|null}>>}
 */
/**
 * @param {Electron.Session|null} session
 * @returns {Promise<object|null>}
 */
async function getPrintConfig(session) {
    const script = _open('print_config', 'readonly', `
    const r = store_.get('main');
    r.onsuccess = () => { db.close(); resolve(r.result || null); };
    r.onerror   = () => { db.close(); resolve(null); };`);
    try {
        const result = await _exec(session, script);
        return result && typeof result === 'object' ? result : null;
    } catch (_) {
        return null;
    }
}

async function getCategories(session) {
    const script = _open('categories', 'readonly', `
    const r = store_.getAll();
    r.onsuccess = () => { db.close(); resolve(r.result || []); };
    r.onerror   = () => { db.close(); resolve([]); };`);
    try {
        const result = await _exec(session, script);
        return Array.isArray(result) ? result : [];
    } catch (_) {
        return [];
    }
}

/**
 * جلب transactions بـ print_status = pending أو غير موجود
 * @param {Electron.Session|null} session
 * @returns {Promise<Array>}
 */
async function getPendingTransactions(session) {
    const script = _open('transactions', 'readonly', `
    const r = store_.getAll();
    r.onsuccess = () => {
      db.close();
      resolve((r.result || []).filter(t => !t.print_status || t.print_status === 'pending'));
    };
    r.onerror = () => { db.close(); resolve([]); };`);
    try {
        const result = await _exec(session, script);
        return Array.isArray(result) ? result : [];
    } catch (_) {
        return [];
    }
}

/**
 * Compare-and-set ذري: pending → processing
 * يُعيد true فقط إذا كانت الحالة pending وتم التحديث بنجاح
 * @param {Electron.Session|null} session
 * @param {string} localId
 * @returns {Promise<boolean>}
 */
async function lockTransaction(session, localId) {
    const script = _open('transactions', 'readwrite', `
    const g = store_.get(${JSON.stringify(localId)});
    g.onsuccess = () => {
      const rec = g.result;
      if (!rec || (rec.print_status && rec.print_status !== 'pending')) {
        db.close();
        resolve(false);
        return;
      }
      rec.print_status    = 'processing';
      rec.print_status_at = new Date().toISOString();
      const p = store_.put(rec);
      p.onsuccess = () => { db.close(); resolve(true); };
      p.onerror   = () => { db.close(); resolve(false); };
    };
    g.onerror = () => { db.close(); resolve(false); };`);
    try {
        return await _exec(session, script);
    } catch (_) {
        return false;
    }
}

/**
 * تحديث print_status لـ transaction (atomic)
 * @param {Electron.Session|null} session
 * @param {string} localId
 * @param {string} status
 * @returns {Promise<boolean>}
 */
async function _setStatus(session, localId, status) {
    const script = _open('transactions', 'readwrite', `
    const g = store_.get(${JSON.stringify(localId)});
    g.onsuccess = () => {
      const rec = g.result;
      if (!rec) { db.close(); resolve(false); return; }
      rec.print_status    = ${JSON.stringify(status)};
      rec.print_status_at = new Date().toISOString();
      const p = store_.put(rec);
      p.onsuccess = () => { db.close(); resolve(true); };
      p.onerror   = () => { db.close(); resolve(false); };
    };
    g.onerror = () => { db.close(); resolve(false); };`);
    try {
        return await _exec(session, script);
    } catch (_) {
        return false;
    }
}

/**
 * @param {Electron.Session|null} session
 * @param {string} localId
 */
async function markTransactionPrinted(session, localId) {
    return _setStatus(session, localId, 'printed');
}

async function markTransactionPartial(session, localId) {
    return _setStatus(session, localId, 'partial');
}

async function markTransactionFailed(session, localId) {
    return _setStatus(session, localId, 'failed');
}

/**
 * استرجاع transactions العالقة بـ processing أقدم من staleThresholdMs فقط
 * @param {Electron.Session|null} session
 * @param {number} staleThresholdMs
 * @returns {Promise<number>} عدد الـ transactions المُسترجعة
 */
async function recoverStuckTransactions(session, staleThresholdMs = 300000) {
    const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
    const script = _open('transactions', 'readwrite', `
    const r = store_.getAll();
    r.onsuccess = () => {
      const stuck = (r.result || []).filter(t =>
        t.print_status === 'processing' &&
        t.print_status_at &&
        t.print_status_at < ${JSON.stringify(cutoff)}
      );
      if (!stuck.length) { db.close(); resolve(0); return; }
      let done = 0;
      stuck.forEach(rec => {
        rec.print_status    = 'pending';
        rec.print_status_at = new Date().toISOString();
        const p = store_.put(rec);
        p.onsuccess = () => { if (++done === stuck.length) { db.close(); resolve(stuck.length); } };
        p.onerror   = () => { if (++done === stuck.length) { db.close(); resolve(stuck.length); } };
      });
    };
    r.onerror = () => { db.close(); resolve(0); };`);
    try {
        return await _exec(session, script);
    } catch (_) {
        return 0;
    }
}

module.exports = {
    getCategories,
    getPrintConfig,
    getPendingTransactions,
    lockTransaction,
    markTransactionPrinted,
    markTransactionPartial,
    markTransactionFailed,
    recoverStuckTransactions,
};
