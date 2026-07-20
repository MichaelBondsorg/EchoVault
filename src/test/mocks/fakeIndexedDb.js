/**
 * Minimal hand-rolled in-memory fake of the IndexedDB API.
 *
 * Deliberately NOT a full spec implementation — it only supports the exact
 * subset of surface area src/services/capture/idbCaptureDb.js and its
 * consumers (webChunkStore, audioVault) use:
 *   - indexedDB.open(name, version) with onupgradeneeded/onsuccess/onerror
 *   - db.createObjectStore(name, { keyPath }) + store.createIndex(name, keyPath)
 *   - db.objectStoreNames.contains(name)
 *   - db.transaction([...storeNames], mode).objectStore(name)
 *   - store.put/get/delete/getAll (no cursors)
 *   - store.index(name).getAll(range)
 *   - IDBKeyRange.only(value)
 *
 * Keys may be arrays (compound keys), matching real IndexedDB array-keyPath
 * semantics. Comparison is lexicographic, element by element.
 */

const compareKeys = (a, b) => {
  const arrA = Array.isArray(a) ? a : [a];
  const arrB = Array.isArray(b) ? b : [b];
  const len = Math.max(arrA.length, arrB.length);
  for (let i = 0; i < len; i += 1) {
    const x = arrA[i];
    const y = arrB[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
};

const extractKey = (keyPath, value) => {
  if (Array.isArray(keyPath)) return keyPath.map((p) => value[p]);
  return value[keyPath];
};

class FakeIDBKeyRange {
  static only(value) {
    return { type: 'only', value };
  }
}

const asyncResolve = (request, result) => {
  Promise.resolve().then(() => {
    request.result = result;
    if (request.onsuccess) request.onsuccess({ target: request });
  });
};

const asyncReject = (request, error) => {
  Promise.resolve().then(() => {
    request.error = error;
    if (request.onerror) request.onerror({ target: request });
  });
};

const makeRequest = () => ({ result: undefined, error: undefined, onsuccess: null, onerror: null });

const matchesRange = (key, range) => {
  if (!range) return true;
  if (range.type === 'only') return compareKeys(key, range.value) === 0;
  throw new Error('fakeIndexedDb: unsupported range type');
};

const makeStoreApi = (storeRecord) => ({
  put(value) {
    const request = makeRequest();
    const key = extractKey(storeRecord.keyPath, value);
    storeRecord.records.set(JSON.stringify(key), { key, value });
    asyncResolve(request, key);
    return request;
  },
  get(key) {
    const request = makeRequest();
    const entry = storeRecord.records.get(JSON.stringify(key));
    asyncResolve(request, entry ? entry.value : undefined);
    return request;
  },
  delete(key) {
    const request = makeRequest();
    storeRecord.records.delete(JSON.stringify(key));
    asyncResolve(request, undefined);
    return request;
  },
  getAll() {
    const request = makeRequest();
    const values = [...storeRecord.records.values()]
      .sort((a, b) => compareKeys(a.key, b.key))
      .map((r) => r.value);
    asyncResolve(request, values);
    return request;
  },
  index(name) {
    const indexDef = storeRecord.indexes.get(name);
    if (!indexDef) throw new Error(`fakeIndexedDb: unknown index ${name}`);
    return {
      getAll(range) {
        const request = makeRequest();
        const matches = [...storeRecord.records.values()]
          .filter((r) => matchesRange(extractKey(indexDef.keyPath, r.value), range))
          .sort((a, b) => compareKeys(a.key, b.key))
          .map((r) => r.value);
        asyncResolve(request, matches);
        return request;
      },
    };
  },
});

const makeDbWrapper = (dbEntry) => ({
  objectStoreNames: {
    contains: (name) => dbEntry.stores.has(name),
  },
  createObjectStore(name, { keyPath }) {
    const storeRecord = { keyPath, indexes: new Map(), records: new Map() };
    dbEntry.stores.set(name, storeRecord);
    return {
      createIndex(indexName, indexKeyPath) {
        storeRecord.indexes.set(indexName, { keyPath: indexKeyPath });
      },
    };
  },
  transaction(storeNames, _mode) {
    return {
      objectStore(name) {
        const storeRecord = dbEntry.stores.get(name);
        if (!storeRecord) throw new Error(`fakeIndexedDb: unknown store ${name}`);
        return makeStoreApi(storeRecord);
      },
    };
  },
});

export const createFakeIndexedDb = () => {
  const databases = new Map();

  return {
    IDBKeyRange: FakeIDBKeyRange,
    open(name, version) {
      const request = makeRequest();
      Promise.resolve().then(() => {
        let dbEntry = databases.get(name);
        const isNew = !dbEntry;
        if (!dbEntry) {
          dbEntry = { version: 0, stores: new Map() };
          databases.set(name, dbEntry);
        }
        const oldVersion = dbEntry.version;
        const needsUpgrade = isNew || (version !== undefined && version > oldVersion);
        const db = makeDbWrapper(dbEntry);
        request.result = db;
        if (needsUpgrade) {
          dbEntry.version = version ?? 1;
          if (request.onupgradeneeded) request.onupgradeneeded({ target: request, oldVersion });
        }
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    },
    __reset() {
      databases.clear();
    },
  };
};
