const fs = require('fs');

function createPersistence({ msgWalFile, dbFile, getStore, getDb, onError = null }) {
  let persistTimer = null;
  let persistInFlight = false;
  let persistDirty = false;
  let walQueue = Promise.resolve();
  const stats = {
    lastErrorAt: 0,
    lastErrorStage: '',
    errorCount: 0,
    lastFlushAt: 0,
  };

  function reportError(stage, error) {
    stats.errorCount += 1;
    stats.lastErrorAt = Date.now();
    stats.lastErrorStage = stage;
    if (typeof onError === 'function') onError(stage, error);
  }

  function runWalTask(task, stage) {
    walQueue = walQueue.then(task).catch((error) => {
      reportError(stage, error);
    });
    return walQueue;
  }

  function appendWal(event, payload = {}) {
    const line = JSON.stringify({ ts: Date.now(), event, payload });
    runWalTask(async () => {
      await fs.promises.appendFile(msgWalFile, `${line}\n`);
    }, 'append_wal');
  }

  function truncateWalIfLarge(maxBytes = 5 * 1024 * 1024) {
    runWalTask(async () => {
      const st = await fs.promises.stat(msgWalFile);
      if (st.size <= maxBytes) return;
      const keep = Math.floor(maxBytes / 2);
      const fd = await fs.promises.open(msgWalFile, 'r');
      const buf = Buffer.allocUnsafe(keep);
      await fd.read(buf, 0, keep, st.size - keep);
      await fd.close();
      await fs.promises.writeFile(msgWalFile, buf);
    }, 'truncate_wal');
  }

  function clearWal() {
    runWalTask(async () => {
      await fs.promises.writeFile(msgWalFile, '');
    }, 'clear_wal');
  }

  function ensureWalFile() {
    if (!fs.existsSync(msgWalFile)) clearWal();
  }

  async function flushPersist() {
    if (persistInFlight) {
      persistDirty = true;
      return;
    }
    persistInFlight = true;
    do {
      persistDirty = false;
      const sqliteStore = getStore();
      const db = getDb();
      try {
        if (sqliteStore) {
          sqliteStore.persist(db);
        } else {
          await fs.promises.writeFile(dbFile, JSON.stringify(db, null, 2));
        }
      } catch (error) {
        reportError('flush_persist', error);
      }
      stats.lastFlushAt = Date.now();
      appendWal('checkpoint', { at: Date.now() });
      truncateWalIfLarge();
    } while (persistDirty);
    persistInFlight = false;
  }

  function schedulePersist(reason = 'update', payload = {}) {
    appendWal(reason, payload);
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushPersist();
    }, 150);
  }

  async function flushNow() {
    await walQueue.catch(() => {});
    await flushPersist();
    await walQueue.catch(() => {});
  }

  function getStats() {
    return {
      ...stats,
      hasRecentError: stats.lastErrorAt > 0,
      persistInFlight,
      persistDirty,
    };
  }

  return {
    appendWal,
    schedulePersist,
    ensureWalFile,
    flushNow,
    getStats,
  };
}

module.exports = {
  createPersistence,
};
