// app.js — Orquestador principal. Conecta almacenamiento (store.js), cálculo
// financiero (finance.js) y generación de WhatsApp (whatsapp.js) con la
// interfaz. Vanilla JS, sin frameworks, pensado para ser liviano en un iPhone.

import * as store from "./store.js";
import {
  calcCuotaPropia,
  resolverTEM,
  calcCuotaTarjeta,
  formatARS,
  formatPercent,
} from "./finance.js";
import { buildWhatsAppMessage, copyToClipboard } from "./whatsapp.js";

/* ============================== ESTADO ============================== */

const state = {
  products: [],
  ownFinancing: null,
  cardFinancing: null,
  meta: null,
  quote: {
    items: [], // {productId, name, price, qty}
    includeOwn: false,
    includeCard: false,
    ownTem: 5,
    ownInstallmentsSelected: [],
    cardRate6: 57,
    cardRate12: 91,
    cardInstallmentsSelected: [],
  },
  editingProductId: null,
  promptResolver: null,
};

/* ============================== HELPERS ============================== */

function $(id) {
  return document.getElementById(id);
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function productDisplayName(p) {
  return [p.name, p.variant].filter(Boolean).join(" ");
}

function productMeta(p) {
  return [p.brand, p.model, p.category].filter(Boolean).join(" · ");
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

function quoteTotal() {
  return state.quote.items.reduce((sum, it) => sum + it.price * it.qty, 0);
}

/* ============================== NAVEGACIÓN ============================== */

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));
  $(`view-${name}`).classList.add("is-active");
  document.querySelector(`.nav-btn[data-nav="${name}"]`)?.classList.add("is-active");
  window.scrollTo(0, 0);
  document.querySelector(".views").scrollTop = 0;
}

function wireNav() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => switchView(el.dataset.nav));
  });
  $("quote-shortcut").addEventListener("click", () => switchView("quote"));
}

/* ============================== HOME ============================== */

function renderHome() {
  const activeCount = state.products.filter((p) => p.active).length;
  $("home-products-sub").textContent = `${activeCount} producto${activeCount === 1 ? "" : "s"}`;
  const n = state.quote.items.length;
  $("home-quote-sub").textContent = n ? `${n} producto${n === 1 ? "" : "s"} cargados` : "Sin productos cargados";
  $("home-tem-value").textContent = formatPercent(state.ownFinancing.tem);
  $("home-card-value").textContent = `${formatPercent(state.cardFinancing.rate6)} / ${formatPercent(state.cardFinancing.rate12)}`;
  $("business-name-label").textContent = state.meta.businessName || "iPoint Carcarañá";
}

function updateQuoteShortcut() {
  const n = state.quote.items.length;
  const btn = $("quote-shortcut");
  btn.hidden = n === 0;
  $("quote-shortcut-count").textContent = String(n);
}

/* ============================== PRODUCTOS ============================== */

function filterProducts(term) {
  const t = (term || "").trim().toLowerCase();
  const list = [...state.products].sort((a, b) => a.name.localeCompare(b.name, "es"));
  if (!t) return list;
  return list.filter((p) =>
    [p.name, p.brand, p.model, p.variant, p.category].filter(Boolean).join(" ").toLowerCase().includes(t)
  );
}

function productRowHTML(p, mode) {
  const name = esc(productDisplayName(p));
  const meta = esc(productMeta(p));
  const price = formatARS(p.price);
  const inactiveClass = !p.active ? " is-inactive" : "";
  const addBtn = `<button class="product-row__add" data-add="${p.id}" aria-label="Agregar">＋</button>`;
  const editBtn = `<button class="product-row__edit" data-edit="${p.id}" aria-label="Editar">✎</button>`;
  return `
    <li class="product-row${inactiveClass}" data-id="${p.id}">
      <div class="product-row__main">
        <div class="product-row__name">${name}</div>
        ${meta ? `<div class="product-row__meta">${meta}</div>` : ""}
        <div class="product-row__price">${price}</div>
      </div>
      ${mode === "manage" ? editBtn : ""}
      ${addBtn}
    </li>
  `;
}

function renderProductList() {
  const term = $("product-search").value;
  const list = filterProducts(term);
  $("product-list").innerHTML = list.map((p) => productRowHTML(p, "manage")).join("");
  $("product-empty").hidden = state.products.length !== 0;
}

function renderQuoteAddResults() {
  const term = $("quote-add-search").value;
  const wrap = $("quote-add-results");
  if (!term.trim()) {
    wrap.innerHTML = "";
    return;
  }
  const list = filterProducts(term).filter((p) => p.active);
  wrap.innerHTML = list.slice(0, 8).map((p) => productRowHTML(p, "add")).join("");
}

async function openProductModal(product) {
  state.editingProductId = product ? product.id : null;
  $("product-modal-title").textContent = product ? "Editar producto" : "Nuevo producto";
  $("pf-id").value = product?.id || "";
  $("pf-name").value = product?.name || "";
  $("pf-brand").value = product?.brand || "";
  $("pf-model").value = product?.model || "";
  $("pf-variant").value = product?.variant || "";
  $("pf-category").value = product?.category || "";
  $("pf-price").value = product ? product.price : "";
  $("pf-active").checked = product ? !!product.active : true;
  $("btn-delete-product").hidden = !product;
  $("product-modal").hidden = false;
}

function closeProductModal() {
  $("product-modal").hidden = true;
  state.editingProductId = null;
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const price = Number($("pf-price").value);
  if (!$("pf-name").value.trim()) {
    toast("Poné un nombre para el producto");
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    toast("El precio no puede ser negativo");
    return;
  }
  const data = {
    id: state.editingProductId || undefined,
    name: $("pf-name").value,
    brand: $("pf-brand").value,
    model: $("pf-model").value,
    variant: $("pf-variant").value,
    category: $("pf-category").value,
    price,
    active: $("pf-active").checked,
  };
  const saved = await store.saveProduct(data);
  const idx = state.products.findIndex((p) => p.id === saved.id);
  if (idx >= 0) state.products[idx] = saved;
  else state.products.push(saved);

  // si el producto editado está en la cotización actual, actualizamos su precio/nombre ahí también
  state.quote.items.forEach((it) => {
    if (it.productId === saved.id) {
      it.name = productDisplayName(saved);
      it.price = saved.price;
    }
  });

  closeProductModal();
  renderProductList();
  renderQuoteItems();
  renderHome();
  toast("Producto guardado");
}

async function handleDeleteProduct() {
  const id = state.editingProductId;
  if (!id) return;
  if (!confirm("¿Eliminar este producto? Esta acción no se puede deshacer.")) return;
  await store.deleteProduct(id);
  state.products = state.products.filter((p) => p.id !== id);
  state.quote.items = state.quote.items.filter((it) => it.productId !== id);
  closeProductModal();
  renderProductList();
  renderQuoteItems();
  renderHome();
  toast("Producto eliminado");
}

/* ============================== COTIZACIÓN: ITEMS ============================== */

function addProductToQuote(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const existing = state.quote.items.find((it) => it.productId === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    state.quote.items.push({
      productId,
      name: productDisplayName(product),
      price: product.price,
      qty: 1,
    });
  }
  renderQuoteItems();
  renderHome();
  updateQuoteShortcut();
  toast(`${productDisplayName(product)} agregado`);
}

function changeQty(productId, delta) {
  const item = state.quote.items.find((it) => it.productId === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.quote.items = state.quote.items.filter((it) => it.productId !== productId);
  }
  renderQuoteItems();
  updateQuoteShortcut();
}

function removeQuoteItem(productId) {
  state.quote.items = state.quote.items.filter((it) => it.productId !== productId);
  renderQuoteItems();
  updateQuoteShortcut();
}

function clearQuote() {
  state.quote.items = [];
  state.quote.includeOwn = false;
  state.quote.includeCard = false;
  $("toggle-own").checked = false;
  $("toggle-card").checked = false;
  $("own-body").hidden = true;
  $("card-body").hidden = true;
  $("quote-add-search").value = "";
  $("quote-add-results").innerHTML = "";
  $("quote-preview").hidden = true;
  renderQuoteItems();
  updateQuoteShortcut();
  renderHome();
}

function quoteItemRowHTML(it) {
  return `
    <li class="quote-item-row" data-id="${it.productId}">
      <div class="quote-item-row__main">
        <div class="quote-item-row__name">${esc(it.name)}</div>
        <div class="quote-item-row__price">${formatARS(it.price * it.qty)}</div>
      </div>
      <div class="qty-stepper">
        <button data-qty-minus="${it.productId}" aria-label="Restar">−</button>
        <span>${it.qty}</span>
        <button data-qty-plus="${it.productId}" aria-label="Sumar">＋</button>
      </div>
      <button class="quote-item-row__remove" data-remove="${it.productId}" aria-label="Quitar">✕</button>
    </li>
  `;
}

function renderQuoteItems() {
  const items = state.quote.items;
  $("quote-items").innerHTML = items.map(quoteItemRowHTML).join("");
  $("quote-empty").hidden = items.length !== 0;

  const total = quoteTotal();
  $("quote-total-row").hidden = items.length === 0;
  $("quote-total-value").textContent = formatARS(total);
  $("quote-financing").hidden = items.length === 0;

  if (items.length === 0) {
    $("quote-preview").hidden = true;
  }

  renderOwnResults();
  renderCardResults();
}

/* ============================== INSTALLMENT PICKERS ============================== */

function renderInstallmentPicker(container, options, selected, onToggle) {
  container.innerHTML = options
    .map((n) => {
      const sel = selected.includes(n) ? " is-selected" : "";
      return `<button type="button" class="installment-chip${sel}" data-n="${n}">${n} cuotas</button>`;
    })
    .join("");
  container.querySelectorAll(".installment-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const n = Number(chip.dataset.n);
      const idx = selected.indexOf(n);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(n);
      onToggle(selected);
    });
  });
}

function renderSavedRateChips(container, list, onPick, formatFn) {
  if (!list.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = list
    .map((r) => `<button type="button" class="saved-rate-chip" data-id="${r.id}">${esc(r.name)} · ${formatFn(r)}</button>`)
    .join("");
  container.querySelectorAll(".saved-rate-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const rate = list.find((r) => r.id === chip.dataset.id);
      if (rate) onPick(rate);
    });
  });
}

/* ============================== FINANCIACIÓN: PROPIA / TARJETA (COTIZAR) ============================== */

function renderOwnPicker() {
  renderInstallmentPicker($("own-installments"), store.OWN_INSTALLMENT_OPTIONS, state.quote.ownInstallmentsSelected, () => {
    renderOwnResults();
  });
}

function renderOwnSavedChips() {
  renderSavedRateChips(
    $("own-saved-rates"),
    state.ownFinancing.savedRates,
    (rate) => {
      state.quote.ownTem = rate.tem;
      $("own-tem").value = rate.tem;
      renderOwnResults();
    },
    (r) => formatPercent(r.tem)
  );
}

function renderOwnResults() {
  const total = quoteTotal();
  const list = $("own-results");
  if (!state.quote.includeOwn || !total || !state.quote.ownInstallmentsSelected.length) {
    list.innerHTML = "";
    return;
  }
  const rows = [...state.quote.ownInstallmentsSelected]
    .sort((a, b) => a - b)
    .map((n) => {
      const cuota = calcCuotaPropia(total, state.quote.ownTem, n);
      return `<li><span>${n} cuotas</span><strong>${formatARS(cuota)}</strong></li>`;
    });
  list.innerHTML = rows.join("");
}

function renderCardPicker() {
  renderInstallmentPicker($("card-installments"), store.CARD_INSTALLMENT_OPTIONS, state.quote.cardInstallmentsSelected, () => {
    renderCardResults();
  });
}

function renderCardSavedChips() {
  renderSavedRateChips(
    $("card-saved-rates"),
    state.cardFinancing.savedConfigs,
    (cfg) => {
      state.quote.cardRate6 = cfg.rate6;
      state.quote.cardRate12 = cfg.rate12;
      $("card-rate6").value = cfg.rate6;
      $("card-rate12").value = cfg.rate12;
      renderCardResults();
    },
    (c) => `${formatPercent(c.rate6)}/${formatPercent(c.rate12)}`
  );
}

function renderCardResults() {
  const total = quoteTotal();
  const list = $("card-results");
  if (!state.quote.includeCard || !total || !state.quote.cardInstallmentsSelected.length) {
    list.innerHTML = "";
    return;
  }
  const rows = [...state.quote.cardInstallmentsSelected]
    .sort((a, b) => a - b)
    .map((n) => {
      const rate = n === 6 ? state.quote.cardRate6 : n === 12 ? state.quote.cardRate12 : 0;
      const { cuota } = calcCuotaTarjeta(total, rate, n);
      return `<li><span>${n} cuotas <small>tasa ${formatPercent(rate)}</small></span><strong>${formatARS(cuota)}</strong></li>`;
    });
  list.innerHTML = rows.join("");
}

function resetQuoteFinancingDefaults() {
  state.quote.ownTem = state.ownFinancing.tem;
  state.quote.ownInstallmentsSelected = [...state.ownFinancing.selectedInstallments];
  state.quote.cardRate6 = state.cardFinancing.rate6;
  state.quote.cardRate12 = state.cardFinancing.rate12;
  state.quote.cardInstallmentsSelected = [...state.cardFinancing.selectedInstallments];

  $("own-tem").value = state.quote.ownTem;
  $("card-rate6").value = state.quote.cardRate6;
  $("card-rate12").value = state.quote.cardRate12;

  renderOwnPicker();
  renderCardPicker();
  renderOwnSavedChips();
  renderCardSavedChips();
}

/* ============================== GENERAR / COPIAR ============================== */

function generateQuote() {
  const total = quoteTotal();
  if (!total) {
    toast("Agregá al menos un producto");
    return;
  }
  if (!state.quote.includeOwn && !state.quote.includeCard) {
    toast("Elegí al menos un tipo de financiación");
    return;
  }
  if (state.quote.includeOwn && !state.quote.ownInstallmentsSelected.length) {
    toast("Elegí al menos una cantidad de cuotas para financiación propia");
    return;
  }
  if (state.quote.includeCard && !state.quote.cardInstallmentsSelected.length) {
    toast("Elegí al menos una cantidad de cuotas para tarjeta");
    return;
  }

  const message = buildWhatsAppMessage(
    {
      items: state.quote.items,
      total,
      includeOwn: state.quote.includeOwn,
      includeCard: state.quote.includeCard,
      ownTem: state.quote.ownTem,
      ownInstallments: state.quote.ownInstallmentsSelected,
      cardRate6: state.quote.cardRate6,
      cardRate12: state.quote.cardRate12,
      cardInstallments: state.quote.cardInstallmentsSelected,
    },
    state.meta.businessName
  );

  $("quote-preview-text").textContent = message;
  $("quote-preview").hidden = false;
  $("quote-preview").scrollIntoView?.({ behavior: "smooth", block: "start" });
}

async function handleCopyQuote() {
  const text = $("quote-preview-text").textContent;
  const ok = await copyToClipboard(text);
  toast(ok ? "Cotización copiada ✅ Pegala en WhatsApp" : "No se pudo copiar. Mantené presionado el texto para copiarlo.");
}

/* ============================== AJUSTES ============================== */

function renderSettings() {
  $("business-name-input").value = state.meta.businessName || "";
  $("settings-own-tem").value = state.ownFinancing.tem;
  $("settings-card-rate6").value = state.cardFinancing.rate6;
  $("settings-card-rate12").value = state.cardFinancing.rate12;

  renderInstallmentPicker(
    $("settings-own-installments"),
    store.OWN_INSTALLMENT_OPTIONS,
    state.ownFinancing.selectedInstallments,
    async (selected) => {
      state.ownFinancing = await store.setOwnSelectedInstallments([...selected]);
    }
  );
  renderInstallmentPicker(
    $("settings-card-installments"),
    store.CARD_INSTALLMENT_OPTIONS,
    state.cardFinancing.selectedInstallments,
    async (selected) => {
      state.cardFinancing = await store.setCardSelectedInstallments([...selected]);
    }
  );

  renderSavedRatesManage();
}

function renderSavedRatesManage() {
  const ownWrap = $("settings-own-saved");
  if (!state.ownFinancing.savedRates.length) {
    ownWrap.innerHTML = `<p class="settings-hint">Todavía no guardaste tasas.</p>`;
  } else {
    ownWrap.innerHTML = state.ownFinancing.savedRates
      .map(
        (r) => `
      <div class="saved-rate-row">
        <span class="saved-rate-row__name">${esc(r.name)}</span>
        <span class="saved-rate-row__val">${formatPercent(r.tem)}</span>
        <button class="saved-rate-row__del" data-del-own-rate="${r.id}">✕</button>
      </div>`
      )
      .join("");
  }

  const cardWrap = $("settings-card-saved");
  if (!state.cardFinancing.savedConfigs.length) {
    cardWrap.innerHTML = `<p class="settings-hint">Todavía no guardaste configuraciones.</p>`;
  } else {
    cardWrap.innerHTML = state.cardFinancing.savedConfigs
      .map(
        (c) => `
      <div class="saved-rate-row">
        <span class="saved-rate-row__name">${esc(c.name)}</span>
        <span class="saved-rate-row__val">${formatPercent(c.rate6)} / ${formatPercent(c.rate12)}</span>
        <button class="saved-rate-row__del" data-del-card-config="${c.id}">✕</button>
      </div>`
      )
      .join("");
  }
}

function openPrompt(title, placeholder) {
  return new Promise((resolve) => {
    $("prompt-modal-title").textContent = title;
    $("prompt-input").value = "";
    $("prompt-input").placeholder = placeholder || "";
    $("prompt-modal").hidden = false;
    state.promptResolver = resolve;
    setTimeout(() => $("prompt-input").focus(), 50);
  });
}

function closePrompt(value) {
  $("prompt-modal").hidden = true;
  if (state.promptResolver) {
    state.promptResolver(value);
    state.promptResolver = null;
  }
}

/* ============================== EXPORTAR / IMPORTAR ============================== */

async function handleExport() {
  const payload = await store.exportData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ipoint-carcarana-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Backup exportado");
}

async function handleImportFile(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!confirm("Importar reemplazará los productos actuales por los del backup. ¿Continuar?")) return;
    const newState = await store.importData(json);
    state.products = newState.products;
    state.ownFinancing = newState.ownFinancing;
    state.cardFinancing = newState.cardFinancing;
    state.meta = newState.meta;
    renderAll();
    toast("Datos importados correctamente");
  } catch (err) {
    console.error(err);
    toast("El archivo no es un backup válido");
  }
}

/* ============================== WIRING ============================== */

function wireProducts() {
  $("product-search").addEventListener("input", renderProductList);
  $("btn-new-product").addEventListener("click", () => openProductModal(null));

  $("product-list").addEventListener("click", (e) => {
    const addId = e.target.closest("[data-add]")?.dataset.add;
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    if (addId) addProductToQuote(addId);
    else if (editId) openProductModal(state.products.find((p) => p.id === editId));
  });

  $("product-modal-backdrop").addEventListener("click", closeProductModal);
  $("btn-cancel-product").addEventListener("click", closeProductModal);
  $("product-form").addEventListener("submit", handleProductSubmit);
  $("btn-delete-product").addEventListener("click", handleDeleteProduct);
}

function wireQuote() {
  $("quote-add-search").addEventListener("input", renderQuoteAddResults);
  $("quote-add-results").addEventListener("click", (e) => {
    const addId = e.target.closest("[data-add]")?.dataset.add;
    if (addId) {
      addProductToQuote(addId);
      $("quote-add-search").value = "";
      $("quote-add-results").innerHTML = "";
    }
  });

  $("quote-items").addEventListener("click", (e) => {
    const plus = e.target.closest("[data-qty-plus]")?.dataset.qtyPlus;
    const minus = e.target.closest("[data-qty-minus]")?.dataset.qtyMinus;
    const remove = e.target.closest("[data-remove]")?.dataset.remove;
    if (plus) changeQty(plus, 1);
    else if (minus) changeQty(minus, -1);
    else if (remove) removeQuoteItem(remove);
  });

  $("btn-clear-quote").addEventListener("click", () => {
    if (state.quote.items.length && !confirm("¿Vaciar la cotización actual?")) return;
    clearQuote();
  });

  $("toggle-own").addEventListener("change", (e) => {
    state.quote.includeOwn = e.target.checked;
    $("own-body").hidden = !e.target.checked;
    renderOwnResults();
  });
  $("toggle-card").addEventListener("change", (e) => {
    state.quote.includeCard = e.target.checked;
    $("card-body").hidden = !e.target.checked;
    renderCardResults();
  });

  $("own-tem").addEventListener("input", (e) => {
    state.quote.ownTem = Math.max(0, Number(e.target.value) || 0);
    renderOwnResults();
  });
  $("card-rate6").addEventListener("input", (e) => {
    state.quote.cardRate6 = Math.max(0, Number(e.target.value) || 0);
    renderCardResults();
  });
  $("card-rate12").addEventListener("input", (e) => {
    state.quote.cardRate12 = Math.max(0, Number(e.target.value) || 0);
    renderCardResults();
  });

  $("btn-generate-quote").addEventListener("click", generateQuote);
  $("btn-copy-quote").addEventListener("click", handleCopyQuote);
  $("btn-new-quote").addEventListener("click", clearQuote);
}

function wireSettings() {
  $("business-name-input").addEventListener("change", async (e) => {
    state.meta = { ...state.meta, businessName: e.target.value.trim() || "iPoint Carcarañá" };
    // guardamos vía store directamente (meta no tiene helper dedicado, se persiste con importData/db config)
    const dbModule = await import("./db.js");
    await dbModule.setConfig("meta", state.meta);
    renderHome();
  });

  $("settings-own-tem").addEventListener("change", async (e) => {
    state.ownFinancing = await store.setOwnTEM(e.target.value);
    renderHome();
  });
  $("settings-card-rate6").addEventListener("change", async (e) => {
    state.cardFinancing = await store.setCardRates(e.target.value, $("settings-card-rate12").value);
    renderHome();
  });
  $("settings-card-rate12").addEventListener("change", async (e) => {
    state.cardFinancing = await store.setCardRates($("settings-card-rate6").value, e.target.value);
    renderHome();
  });

  $("btn-add-own-rate").addEventListener("click", async () => {
    const name = await openPrompt("Guardar tasa de financiación propia", "Ej: Cliente especial");
    if (!name) return;
    state.ownFinancing = await store.saveOwnRate(name, $("settings-own-tem").value);
    renderSavedRatesManage();
    toast("Tasa guardada");
  });
  $("btn-add-card-config").addEventListener("click", async () => {
    const name = await openPrompt("Guardar configuración de tarjeta", "Ej: Tasas promocionales");
    if (!name) return;
    state.cardFinancing = await store.saveCardConfig(name, $("settings-card-rate6").value, $("settings-card-rate12").value);
    renderSavedRatesManage();
    toast("Configuración guardada");
  });

  $("settings-own-saved").addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del-own-rate]")?.dataset.delOwnRate;
    if (!id) return;
    state.ownFinancing = await store.deleteOwnRate(id);
    renderSavedRatesManage();
  });
  $("settings-card-saved").addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del-card-config]")?.dataset.delCardConfig;
    if (!id) return;
    state.cardFinancing = await store.deleteCardConfig(id);
    renderSavedRatesManage();
  });

  $("prompt-cancel").addEventListener("click", () => closePrompt(null));
  $("prompt-modal-backdrop").addEventListener("click", () => closePrompt(null));
  $("prompt-ok").addEventListener("click", () => closePrompt($("prompt-input").value.trim() || null));
  $("prompt-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") closePrompt($("prompt-input").value.trim() || null);
  });

  $("btn-export").addEventListener("click", handleExport);
  $("input-import").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    e.target.value = "";
  });
}

/* ============================== INIT ============================== */

function renderAll() {
  renderHome();
  renderProductList();
  renderQuoteItems();
  resetQuoteFinancingDefaults();
  renderSettings();
  updateQuoteShortcut();
}

async function init() {
  const loaded = await store.loadState();
  state.products = loaded.products;
  state.ownFinancing = loaded.ownFinancing;
  state.cardFinancing = loaded.cardFinancing;
  state.meta = loaded.meta;

  wireNav();
  wireProducts();
  wireQuote();
  wireSettings();

  renderAll();
  switchView("home");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      /* si falla el registro seguimos funcionando online sin PWA offline */
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
