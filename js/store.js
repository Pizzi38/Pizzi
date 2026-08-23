// store.js — Estado central de la app. Junta la capa de almacenamiento (db.js)
// con valores por defecto y expone una API simple para el resto de la app.
// Mantiene DELIBERADAMENTE separadas la configuración de financiación propia
// y la de tarjeta: nunca comparten estructura ni se pisan entre sí.

import * as db from "./db.js";

const STORE_SCHEMA_VERSION = 1;

const OWN_INSTALLMENT_OPTIONS = [3, 6, 9, 12, 18];
const CARD_INSTALLMENT_OPTIONS = [6, 12];

const DEFAULT_OWN_FINANCING = {
  tem: 5, // TEM % por defecto
  selectedInstallments: [3, 6, 12], // cuotas activas para ofrecer
  savedRates: [], // [{id, name, tem}]
};

const DEFAULT_CARD_FINANCING = {
  rate6: 57, // % — valor inicial pedido
  rate12: 91, // % — valor inicial pedido
  selectedInstallments: [6, 12],
  savedConfigs: [], // [{id, name, rate6, rate12}]
};

const DEFAULT_META = {
  businessName: "iPoint Carcarañá",
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ----------------------------- CARGA INICIAL ----------------------------- */

async function loadState() {
  const [products, ownFinancing, cardFinancing, meta] = await Promise.all([
    db.getAllProducts(),
    db.getConfig("ownFinancing", DEFAULT_OWN_FINANCING),
    db.getConfig("cardFinancing", DEFAULT_CARD_FINANCING),
    db.getConfig("meta", DEFAULT_META),
  ]);

  // Migración suave: asegura que existan todos los campos esperados.
  const own = { ...DEFAULT_OWN_FINANCING, ...ownFinancing };
  const card = { ...DEFAULT_CARD_FINANCING, ...cardFinancing };

  return {
    products: products.sort((a, b) => a.name.localeCompare(b.name, "es")),
    ownFinancing: own,
    cardFinancing: card,
    meta: { ...DEFAULT_META, ...meta },
  };
}

/* ----------------------------- PRODUCTOS ----------------------------- */

function newProduct(data) {
  return {
    id: uid(),
    name: data.name?.trim() || "",
    brand: data.brand?.trim() || "",
    model: data.model?.trim() || "",
    variant: data.variant?.trim() || "",
    price: Math.max(0, Number(data.price) || 0),
    category: data.category?.trim() || "General",
    active: data.active !== undefined ? !!data.active : true,
  };
}

async function saveProduct(data) {
  const product = data.id ? { ...data } : newProduct(data);
  if (data.id) {
    // normalizar campos al editar
    product.price = Math.max(0, Number(product.price) || 0);
    product.active = !!product.active;
  }
  await db.saveProduct(product);
  return product;
}

async function deleteProduct(id) {
  await db.deleteProduct(id);
}

/* ----------------------------- FINANCIACIÓN PROPIA ----------------------------- */

async function setOwnTEM(tem) {
  const current = await db.getConfig("ownFinancing", DEFAULT_OWN_FINANCING);
  const value = Math.max(0, Number(tem) || 0);
  const updated = { ...DEFAULT_OWN_FINANCING, ...current, tem: value };
  await db.setConfig("ownFinancing", updated);
  return updated;
}

async function setOwnSelectedInstallments(list) {
  const current = await db.getConfig("ownFinancing", DEFAULT_OWN_FINANCING);
  const updated = { ...DEFAULT_OWN_FINANCING, ...current, selectedInstallments: list };
  await db.setConfig("ownFinancing", updated);
  return updated;
}

async function saveOwnRate(name, tem) {
  const current = await db.getConfig("ownFinancing", DEFAULT_OWN_FINANCING);
  const savedRates = [...(current.savedRates || [])];
  savedRates.push({ id: uid(), name: name.trim(), tem: Math.max(0, Number(tem) || 0) });
  const updated = { ...DEFAULT_OWN_FINANCING, ...current, savedRates };
  await db.setConfig("ownFinancing", updated);
  return updated;
}

async function deleteOwnRate(id) {
  const current = await db.getConfig("ownFinancing", DEFAULT_OWN_FINANCING);
  const savedRates = (current.savedRates || []).filter((r) => r.id !== id);
  const updated = { ...DEFAULT_OWN_FINANCING, ...current, savedRates };
  await db.setConfig("ownFinancing", updated);
  return updated;
}

/* ----------------------------- FINANCIACIÓN CON TARJETA ----------------------------- */

async function setCardRates(rate6, rate12) {
  const current = await db.getConfig("cardFinancing", DEFAULT_CARD_FINANCING);
  const updated = {
    ...DEFAULT_CARD_FINANCING,
    ...current,
    rate6: Math.max(0, Number(rate6) || 0),
    rate12: Math.max(0, Number(rate12) || 0),
  };
  await db.setConfig("cardFinancing", updated);
  return updated;
}

async function setCardSelectedInstallments(list) {
  const current = await db.getConfig("cardFinancing", DEFAULT_CARD_FINANCING);
  const updated = { ...DEFAULT_CARD_FINANCING, ...current, selectedInstallments: list };
  await db.setConfig("cardFinancing", updated);
  return updated;
}

async function saveCardConfig(name, rate6, rate12) {
  const current = await db.getConfig("cardFinancing", DEFAULT_CARD_FINANCING);
  const savedConfigs = [...(current.savedConfigs || [])];
  savedConfigs.push({
    id: uid(),
    name: name.trim(),
    rate6: Math.max(0, Number(rate6) || 0),
    rate12: Math.max(0, Number(rate12) || 0),
  });
  const updated = { ...DEFAULT_CARD_FINANCING, ...current, savedConfigs };
  await db.setConfig("cardFinancing", updated);
  return updated;
}

async function deleteCardConfig(id) {
  const current = await db.getConfig("cardFinancing", DEFAULT_CARD_FINANCING);
  const savedConfigs = (current.savedConfigs || []).filter((c) => c.id !== id);
  const updated = { ...DEFAULT_CARD_FINANCING, ...current, savedConfigs };
  await db.setConfig("cardFinancing", updated);
  return updated;
}

/* ----------------------------- BACKUP: EXPORTAR / IMPORTAR ----------------------------- */

async function exportData() {
  const state = await loadState();
  return {
    appId: "ipoint-carcarana-cotizador",
    version: STORE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: state,
  };
}

async function importData(json) {
  if (!json || !json.data) throw new Error("Archivo de backup inválido.");
  const { products, ownFinancing, cardFinancing, meta } = json.data;

  await db.clearProducts();
  if (Array.isArray(products) && products.length) {
    await db.bulkPutProducts(products);
  }
  if (ownFinancing) await db.setConfig("ownFinancing", { ...DEFAULT_OWN_FINANCING, ...ownFinancing });
  if (cardFinancing) await db.setConfig("cardFinancing", { ...DEFAULT_CARD_FINANCING, ...cardFinancing });
  if (meta) await db.setConfig("meta", { ...DEFAULT_META, ...meta });

  return loadState();
}

export {
  OWN_INSTALLMENT_OPTIONS,
  CARD_INSTALLMENT_OPTIONS,
  loadState,
  saveProduct,
  deleteProduct,
  setOwnTEM,
  setOwnSelectedInstallments,
  saveOwnRate,
  deleteOwnRate,
  setCardRates,
  setCardSelectedInstallments,
  saveCardConfig,
  deleteCardConfig,
  exportData,
  importData,
  uid,
};
