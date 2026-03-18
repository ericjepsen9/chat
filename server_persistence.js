const fs = require('fs');

const MAX_WAL_BYTES = 5 * 1024 * 1024;
const PERSIST_DEBOUNCE_MS = 150;
const ERROR_WINDOW_MS = 5 * 60 * 1000;
const WAL_FLUSH_INTERVAL_MS = 50;

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

  // WAL write buffer: batch multiple appendWal calls into a single I/O
  // Use array + join instead of string += to avoid intermediate string allocations
  let walBufferLines = [];
  let walFlushTimer = null;

  function reportError(stage, error) {
    stats.errorCount += 1;
    stats.lastErrorAt = Date.now();
    stats.lastErrorStage = stage;
    if (typeof onError === 'function') onError(stage, error);
  }

  function runWalTask(task, stage, { propagate = false } = {}) {
    const taskPromise = walQueue.then(task);
    walQueue = taskPromise.catch(() => {});
    if (!propagate) {
      taskPromise.catch((error) => {
        reportError(stage, error);
      });
      return walQueue;
    }
    return taskPromise.catch((error) => {
      reportError(stage, error);
      throw error;
    });
  }

  function drainWalBuffer() {
    if (!walBufferLines.length) return;
    const batch = walBufferLines.join('\n') + '\n';
    walBufferLines = [];
    walFlushTimer = null;
    runWalTask(async () => {
      await fs.promises.appendFile(msgWalFile, batch);
    }, 'append_wal');
  }

  function appendWal(event, payload = {}) {
    const line = JSON.stringify({ ts: Date.now(), event, payload });
    walBufferLines.push(line);
    if (!walFlushTimer) {
      walFlushTimer = setTimeout(drainWalBuffer, WAL_FLUSH_INTERVAL_MS);
    }
  }

  async function appendWalGuaranteed(event, payload = {}) {
    // Flush any buffered writes first, then write guaranteed entry immediately
    drainWalBuffer();
    const line = JSON.stringify({ ts: Date.now(), event, payload });
    await runWalTask(async () => {
      await fs.promises.appendFile(msgWalFile, `${line}\n`);
    }, 'append_wal_guaranteed', { propagate: true });
  }

  function truncateWalIfLarge(maxBytes = MAX_WAL_BYTES) {
    runWalTask(async () => {
      const st = await fs.promises.stat(msgWalFile);
      if (st.size <= maxBytes) return;
      const keep = Math.floor(maxBytes / 2);
      const fd = await fs.promises.open(msgWalFile, 'r');
      const buf = Buffer.allocUnsafe(keep);
      await fd.read(buf, 0, keep, st.size - keep);
      await fd.close();
      const firstNewline = buf.indexOf(0x0a);
      const clean = firstNewline >= 0 ? buf.slice(firstNewline + 1) : buf;
      await fs.promises.writeFile(msgWalFile, clean);
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
      let persistOk = false;
      try {
        if (sqliteStore) {
          sqliteStore.save(db);
        } else {
          const tmpFile = dbFile + '.tmp.' + Date.now();
          await fs.promises.writeFile(tmpFile, JSON.stringify(db, (key, value) => key.length > 1 && key[0] === '_' ? undefined : value));
          await fs.promises.rename(tmpFile, dbFile);
        }
        persistOk = true;
      } catch (error) {
        reportError('flush_persist', error);
      }
      stats.lastFlushAt = Date.now();
      // Only checkpoint and truncate WAL if persist succeeded to avoid data loss
      if (persistOk) {
        appendWal('checkpoint', { at: Date.now() });
        truncateWalIfLarge();
      }
    } while (persistDirty);
    persistInFlight = false;
  }

  function schedulePersist(reason = 'update', payload = {}) {
    appendWal(reason, payload);
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  async function schedulePersistCritical(reason = 'critical_update', payload = {}) {
    await appendWalGuaranteed(reason, payload);
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await flushPersist();
    await walQueue.catch(() => {});
  }

  async function flushNow() {
    drainWalBuffer();
    await walQueue.catch(() => {});
    await flushPersist();
    await walQueue.catch(() => {});
  }

  function getStats() {
    return {
      lastErrorAt: stats.lastErrorAt,
      lastErrorStage: stats.lastErrorStage,
      errorCount: stats.errorCount,
      lastFlushAt: stats.lastFlushAt,
      hasRecentError: stats.lastErrorAt > 0 && (Date.now() - stats.lastErrorAt) < ERROR_WINDOW_MS,
      persistInFlight,
      persistDirty,
    };
  }

  return {
    appendWal,
    appendWalGuaranteed,
    schedulePersist,
    schedulePersistCritical,
    ensureWalFile,
    flushNow,
    getStats,
  };
}

module.exports = {
  createPersistence,
};
