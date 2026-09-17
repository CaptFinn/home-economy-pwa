// IndexedDB storage for cached bootstrap views, the offline write queue and
// the signed-in session: one `home-economy` database, three stores, opened
// fresh per call. memoryStore() mirrors the same seven methods over a Map so
// Task 5's queue — the part of this client most worth testing — can run
// under node, where IndexedDB does not exist.

const DB_NAME = 'home-economy';
const DB_VERSION = 1;
const AUTH_ID = 'me';

// ponytail: openDb() opens a fresh connection every call and none of them is
// ever closed, and there's no onversionchange handler either — fine while
// DB_VERSION never changes, but a later stage bumping it to add a store will
// hit every tab's leaked connections refusing the upgrade (onupgradeneeded
// blocks until they close), and there's nothing here to prompt a reload.
// Fix then: close after each store() call, or track one shared connection
// and add onversionchange to reload/close it.

/** Wraps an IDBRequest in a promise; used for every store op below. */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves to the open database, creating the three stores on first run. */
export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('views', { keyPath: 'key' });
      db.createObjectStore('queue', { keyPath: 'id' });
      db.createObjectStore('auth', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Opens just the one store this call needs — the narrowest transaction. */
async function store(name, mode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function getView(key) {
  const record = await promisify((await store('views', 'readonly')).get(key));
  return record ? record.data : null;
}

export async function putView(key, data) {
  await promisify((await store('views', 'readwrite')).put({ key, data }));
}

export async function listQueue() {
  const items = await promisify((await store('queue', 'readonly')).getAll());
  return items.sort((a, b) => a.at - b.at);
}

export async function putQueued(item) {
  await promisify((await store('queue', 'readwrite')).put(item));
}

export async function removeQueued(id) {
  await promisify((await store('queue', 'readwrite')).delete(id));
}

export async function getAuth() {
  const record = await promisify((await store('auth', 'readonly')).get(AUTH_ID));
  if (!record) return null;
  const { id, ...auth } = record;
  return auth;
}

export async function putAuth(auth) {
  await promisify((await store('auth', 'readwrite')).put({ ...auth, id: AUTH_ID }));
}

/** Same seven methods, backed by a Map — for selfcheck.js only. */
export function memoryStore() {
  const views = new Map();
  const queue = new Map();
  let auth = null;

  return {
    async getView(key) {
      return views.has(key) ? views.get(key) : null;
    },
    async putView(key, data) {
      views.set(key, data);
    },
    async listQueue() {
      return [...queue.values()].sort((a, b) => a.at - b.at);
    },
    async putQueued(item) {
      queue.set(item.id, item);
    },
    async removeQueued(id) {
      queue.delete(id);
    },
    async getAuth() {
      return auth;
    },
    async putAuth(a) {
      auth = { ...a };
    },
  };
}
