// db.js — Capa de almacenamiento local (IndexedDB). Todo lo que la app necesita
// para funcionar sin conexión vive acá: productos, tasas, configuración y
// preferencias de cuotas. Nada de esto depende de un servidor.

const DB_NAME = "ipoint_carcarana";
const DB_VERSION = 1;

const STORES = {
  products: "products",
  config: "config", // key-value simple: tasas, preferencias, tasas guardadas
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.products)) {
        const store = db.createObjectStore(STORES.products, { keyPath: "id" });
        store.createIndex("active", "active", { unique: false });
        store.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.config)) {
        db.createObjectStore(STORES.config, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

/* ----------------------------- PRODUCTOS ----------------------------- */

async function getAllProducts() {
  const store = await tx(STORES.products);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveProduct(product) {
  const store = await tx(STORES.products, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(product);
    req.onsuccess = () => resolve(product);
    req.onerror = () => reject(req.error);
  });
}

async function deleteProduct(id) {
  const store = await tx(STORES.products, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function bulkPutProducts(products) {
  const store = await tx(STORES.products, "readwrite");
  return new Promise((resolve, reject) => {
    for (const p of products) store.put(p);
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

async function clearProducts() {
  const store = await tx(STORES.products, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ----------------------------- CONFIG (key-value) ----------------------------- */

async function getConfig(key, defaultValue = null) {
  const store = await tx(STORES.config);
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
    req.onerror = () => reject(req.error);
  });
}

async function setConfig(key, value) {
  const store = await tx(STORES.config, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

async function getAllConfig() {
  const store = await tx(STORES.config);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const map = {};
      for (const row of req.result || []) map[row.key] = row.value;
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

export {
  getAllProducts,
  saveProduct,
  deleteProduct,
  bulkPutProducts,
  clearProducts,
  getConfig,
  setConfig,
  getAllConfig,
};
