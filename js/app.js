// app.js — Orquestador principal. Conecta almacenamiento (store.js), cálculo
// financiero (finance.js) y generación de WhatsApp (whatsapp.js) con la
// interfaz. Vanilla JS, sin frameworks, pensado para ser liviano en un iPhone.
//
// MODELO DE COTIZACIÓN (v2): cada producto agregado a la cotización es un
// bloque INDEPENDIENTE — tiene su propio costo/recargo (USD), su propio
// contado (USD y ARS, según el dólar cargado para esa cotización) y su propia
// financiación (sin financiación / propia / tarjeta). Nunca se suman varios
// productos en un total combinado.

import * as store from "./store.js";
import {
  calcCuotaPropia,
  calcCuotaTarjeta,
  roundUSD,
  roundARS,
  formatARS,
  formatUSD,
  formatARSRate,
  formatPercent,
} from "./finance.js";
import { buildWhatsAppMessage, copyToClipboard } from "./whatsapp.js";

/* ============================== ESTADO ============================== */

const state = {
  products: [],
  ownFinancing: null,
  cardFinancing: null,
  dollar: null,
  meta: null,
  quote: {
    items: [], // {productId, name, qty, costUsd, markupUsd, includeOwn, includeCard, ownInstallmentsSelected, cardInstallmentsSelected}
    dollarRate: 0,
    ownTem: 5,
    cardRate6: 57,
    cardRate12: 91,
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
  return [p.name, p.model, p.variant].filter(Boolean).join(" ");
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

/** Costo+recargo unitario, total en USD para la cantidad, y total en ARS
 *  según el dólar cargado para esta cotización — todo ya redondeado. */
function itemTotals(item) {
  const unitUsd = roundUSD(item.costUsd + item.markupUsd);
  const totalUsd = unitUsd * item.qty;
  const totalArs = roundARS(totalUsd * (state.quote.dollarRate || 0));
  return { unitUsd, totalUsd, totalArs };
}

function ownResultsHTML(item, totalArs) {
  if (!totalArs || !item.ownInstallmentsSelected.length) return "";
  return [...item.ownInstallmentsSelected]
    .sort((a, b) => a - b)
    .map((n) => {
      const cuota = calcCuotaPropia(totalArs, state.quote.ownTem, n);
      return `<li><span>${n} cuotas</span><strong>${formatARS(cuota)}</strong></li>`;
    })
    .join("");
}

function cardResultsHTML(item, totalArs) {
  if (!totalArs || !item.cardInstallmentsSelected.length) return "";
  return [...item.cardInstallmentsSelected]
    .sort((a, b) => a - b)
    .map((n) => {
      const rate = n === 6 ? state.quote.cardRate6 : n === 12 ? state.quote.cardRate12 : 0;
      const { cuota } = calcCuotaTarjeta(totalArs, rate, n);
      return `<li><span>${n} cuotas <small>tasa ${formatPercent(rate)}</small></span><strong>${formatARS(cuota)}</strong></li>`;
    })
    .join("");
}

/* ============================== NAVEGACIÓN ============================== */

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));
  $(`view-${name}`).classList.add("is-active");
  document.querySelector(`.nav-btn[data-nav="${name}"]`)?.classList.add("is-active");
  document.querySelector(".views").scrollTop = 0;
  // Re-renderizamos la vista de destino: por ejemplo, el recargo de un producto
  // puede haberse actualizado desde la pantalla de Cotizar, y Productos tiene
  // que reflejarlo apenas se entra, no solo al reiniciar la app.
  if (name === "products") renderProductList();
  if (name === "home") renderHome();
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
  $("home-dollar-value").textContent = state.dollar.rate ? formatARSRate(state.dollar.rate) : "—";
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
  const contado = roundUSD((p.costUsd || 0) + (p.markupUsd || 0));
  const inactiveClass = !p.active ? " is-inactive" : "";
  const addBtn = `<button class="product-row__add" data-add="${p.id}" aria-label="Agregar">＋</button>`;
  const editBtn = `<button class="product-row__edit" data-edit="${p.id}" aria-label="Editar">✎</button>`;
  return `
    <li class="product-row${inactiveClass}" data-id="${p.id}">
      <div class="product-row__main">
        <div class="product-row__name">${name}</div>
        ${meta ? `<div class="product-row__meta">${meta}</div>` : ""}
        <div class="product-row__price">${formatUSD(contado)}</div>
        <div class="product-row__breakdown">Costo ${formatUSD(p.costUsd || 0)} · Recargo ${formatUSD(p.markupUsd || 0)}</div>
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

function updateProductModalPreview() {
  const cost = Math.max(0, Number($("pf-cost-usd").value) || 0);
  const markup = Math.max(0, Number($("pf-markup-usd").value) || 0);
  $("pf-contado-preview").textContent = `Contado: ${formatUSD(cost + markup)}`;
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
  $("pf-cost-usd").value = product ? product.costUsd : "";
  $("pf-markup-usd").value = product ? product.markupUsd : "";
  $("pf-active").checked = product ? !!product.active : true;
  $("btn-delete-product").hidden = !product;
  updateProductModalPreview();
  $("product-modal").hidden = false;
}

function closeProductModal() {
  $("product-modal").hidden = true;
  state.editingProductId = null;
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const costUsd = Number($("pf-cost-usd").value);
  const markupUsd = Number($("pf-markup-usd").value);
  if (!$("pf-name").value.trim()) {
    toast("Poné un nombre para el producto");
    return;
  }
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    toast("El costo no puede ser negativo");
    return;
  }
  if (!Number.isFinite(markupUsd) || markupUsd < 0) {
    toast("El recargo no puede ser negativo");
    return;
  }
  const data = {
    id: state.editingProductId || undefined,
    name: $("pf-name").value,
    brand: $("pf-brand").value,
    model: $("pf-model").value,
    variant: $("pf-variant").value,
    category: $("pf-category").value,
    costUsd,
    markupUsd,
    active: $("pf-active").checked,
  };
  const saved = await store.saveProduct(data);
  const idx = state.products.findIndex((p) => p.id === saved.id);
  if (idx >= 0) state.products[idx] = saved;
  else state.products.push(saved);

  // si el producto editado está en la cotización actual, actualizamos ahí también
  state.quote.items.forEach((it) => {
    if (it.productId === saved.id) {
      it.name = productDisplayName(saved);
      it.costUsd = saved.costUsd;
      it.markupUsd = saved.markupUsd;
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
  const wasEmpty = state.quote.items.length === 0;
  const existing = state.quote.items.find((it) => it.productId === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    state.quote.items.push({
      productId,
      name: productDisplayName(product),
      qty: 1,
      costUsd: product.costUsd,
      markupUsd: product.markupUsd,
      includeOwn: false,
      includeCard: false,
      ownInstallmentsSelected: [...state.ownFinancing.selectedInstallments],
      cardInstallmentsSelected: [...state.cardFinancing.selectedInstallments],
    });
  }
  renderQuoteItems();
  if (wasEmpty) syncQuoteConfigInputs();
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
  renderHome();
  updateQuoteShortcut();
}

function removeQuoteItem(productId) {
  state.quote.items = state.quote.items.filter((it) => it.productId !== productId);
  renderQuoteItems();
  renderHome();
  updateQuoteShortcut();
}

function clearQuote() {
  state.quote.items = [];
  state.quote.dollarRate = state.dollar.rate;
  state.quote.ownTem = state.ownFinancing.tem;
  state.quote.cardRate6 = state.cardFinancing.rate6;
  state.quote.cardRate12 = state.cardFinancing.rate12;
  $("quote-add-search").value = "";
  $("quote-add-results").innerHTML = "";
  $("quote-preview").hidden = true;
  syncQuoteConfigInputs();
  renderQuoteItems();
  updateQuoteShortcut();
  renderHome();
}

function syncQuoteConfigInputs() {
  $("quote-dollar-rate").value = state.quote.dollarRate || "";
  $("own-tem").value = state.quote.ownTem;
  $("card-rate6").value = state.quote.cardRate6;
  $("card-rate12").value = state.quote.cardRate12;
}

/* ---------- Tarjeta de producto dentro de la cotización ---------- */

function itemCardHTML(item) {
  const { totalUsd, totalArs } = itemTotals(item);

  const finToggles = [
    { key: "includeOwn", label: "Financiación propia", cls: " fin-type-btn--own" },
    { key: "includeCard", label: "Financiación con tarjeta", cls: " fin-type-btn--card" },
  ];
  const finButtons = finToggles
    .map(
      ({ key, label, cls }) =>
        `<button type="button" class="fin-type-btn${cls}${item[key] ? " is-selected" : ""}" data-fintoggle="${item.productId}" data-key="${key}">${label}</button>`
    )
    .join("");

  let ownBody = "";
  if (item.includeOwn) {
    const chips = store.OWN_INSTALLMENT_OPTIONS.map((n) => {
      const sel = item.ownInstallmentsSelected.includes(n) ? " is-selected" : "";
      return `<button type="button" class="installment-chip${sel}" data-installment="${item.productId}" data-kind="own" data-n="${n}">${n} cuotas</button>`;
    }).join("");
    ownBody = `
      <div class="item-fin-body item-fin-body--own">
        <p class="item-fin-body__label">Financiación propia</p>
        <div class="installments-picker">${chips}</div>
        <ul class="result-list" data-result-own="${item.productId}">${ownResultsHTML(item, totalArs)}</ul>
      </div>`;
  }

  let cardBody = "";
  if (item.includeCard) {
    const chips = store.CARD_INSTALLMENT_OPTIONS.map((n) => {
      const sel = item.cardInstallmentsSelected.includes(n) ? " is-selected" : "";
      return `<button type="button" class="installment-chip${sel}" data-installment="${item.productId}" data-kind="card" data-n="${n}">${n} cuotas</button>`;
    }).join("");
    cardBody = `
      <div class="item-fin-body item-fin-body--card">
        <p class="item-fin-body__label">Financiación con tarjeta</p>
        <div class="installments-picker">${chips}</div>
        <ul class="result-list" data-result-card="${item.productId}">${cardResultsHTML(item, totalArs)}</ul>
      </div>`;
  }

  return `
    <li class="quote-item-card" data-id="${item.productId}">
      <div class="quote-item-card__header">
        <div class="quote-item-card__name">${esc(item.name)}</div>
        <button class="quote-item-row__remove" data-remove="${item.productId}" aria-label="Quitar">✕</button>
      </div>
      <div class="quote-item-card__qty">
        <div class="qty-stepper">
          <button type="button" data-qty-minus="${item.productId}" aria-label="Restar">−</button>
          <span>${item.qty}</span>
          <button type="button" data-qty-plus="${item.productId}" aria-label="Sumar">＋</button>
        </div>
      </div>
      <div class="pricing-lines">
        <div class="pricing-line"><span>Costo</span><strong>${formatUSD(item.costUsd)} c/u</strong></div>
        <div class="pricing-line">
          <label for="markup-${item.productId}">Recargo</label>
          <div class="field-with-suffix field-with-suffix--prefix field-with-suffix--sm">
            <span>US$</span>
            <input type="number" id="markup-${item.productId}" data-markup="${item.productId}" value="${item.markupUsd}" min="0" step="1" inputmode="decimal" />
          </div>
        </div>
        <div class="pricing-line pricing-line--total">
          <span>Contado</span>
          <strong data-contado="${item.productId}">${formatUSD(totalUsd)} · ${formatARS(totalArs)}</strong>
        </div>
      </div>
      <div class="fin-type-select">${finButtons}</div>
      ${ownBody}
      ${cardBody}
    </li>
  `;
}

function renderQuoteItems() {
  const items = state.quote.items;
  $("quote-items").innerHTML = items.map(itemCardHTML).join("");
  $("quote-empty").hidden = items.length !== 0;
  $("quote-config").hidden = items.length === 0;
  $("btn-generate-quote").hidden = items.length === 0;
  if (items.length === 0) $("quote-preview").hidden = true;
}

/** Actualiza SOLO los números calculados de un item puntual (sin re-renderizar
 *  toda la lista), para no perder el foco/cursor mientras se escribe el recargo. */
function updateItemComputedDisplay(productId) {
  const item = state.quote.items.find((it) => it.productId === productId);
  if (!item) return;
  const { totalUsd, totalArs } = itemTotals(item);

  const contadoEl = document.querySelector(`[data-contado="${productId}"]`);
  if (contadoEl) contadoEl.textContent = `${formatUSD(totalUsd)} · ${formatARS(totalArs)}`;

  const ownList = document.querySelector(`[data-result-own="${productId}"]`);
  if (ownList) ownList.innerHTML = ownResultsHTML(item, totalArs);

  const cardList = document.querySelector(`[data-result-card="${productId}"]`);
  if (cardList) cardList.innerHTML = cardResultsHTML(item, totalArs);
}

/* ---------- Tasas globales de la cotización (dólar / TEM / tarjeta) ---------- */

function renderOwnSavedChipsGlobal() {
  const container = $("own-saved-rates");
  const list = state.ownFinancing.savedRates;
  if (!list.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = list
    .map((r) => `<button type="button" class="saved-rate-chip" data-id="${r.id}">${esc(r.name)} · ${formatPercent(r.tem)}</button>`)
    .join("");
  container.querySelectorAll(".saved-rate-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const rate = list.find((r) => r.id === chip.dataset.id);
      if (!rate) return;
      state.quote.ownTem = rate.tem;
      $("own-tem").value = rate.tem;
      renderQuoteItems();
    });
  });
}

function renderCardSavedChipsGlobal() {
  const container = $("card-saved-rates");
  const list = state.cardFinancing.savedConfigs;
  if (!list.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = list
    .map((c) => `<button type="button" class="saved-rate-chip" data-id="${c.id}">${esc(c.name)} · ${formatPercent(c.rate6)}/${formatPercent(c.rate12)}</button>`)
    .join("");
  container.querySelectorAll(".saved-rate-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cfg = list.find((c) => c.id === chip.dataset.id);
      if (!cfg) return;
      state.quote.cardRate6 = cfg.rate6;
      state.quote.cardRate12 = cfg.rate12;
      $("card-rate6").value = cfg.rate6;
      $("card-rate12").value = cfg.rate12;
      renderQuoteItems();
    });
  });
}

/* ============================== GENERAR / COPIAR ============================== */

function generateQuote() {
  const items = state.quote.items;
  if (!items.length) {
    toast("Agregá al menos un producto");
    return;
  }
  if (!state.quote.dollarRate || state.quote.dollarRate <= 0) {
    toast("Cargá la cotización del dólar para esta venta");
    return;
  }
  for (const item of items) {
    if (item.includeOwn && !item.ownInstallmentsSelected.length) {
      toast(`Elegí al menos una cuota para "${item.name}" (financiación propia)`);
      return;
    }
    if (item.includeCard && !item.cardInstallmentsSelected.length) {
      toast(`Elegí al menos una cuota para "${item.name}" (tarjeta)`);
      return;
    }
  }

  const payloadItems = items.map((item) => {
    const { totalUsd, totalArs } = itemTotals(item);
    return {
      name: item.name,
      qty: item.qty,
      contadoUsdTotal: totalUsd,
      contadoArsTotal: totalArs,
      includeOwn: item.includeOwn,
      includeCard: item.includeCard,
      ownTem: state.quote.ownTem,
      ownInstallments: item.ownInstallmentsSelected,
      cardRate6: state.quote.cardRate6,
      cardRate12: state.quote.cardRate12,
      cardInstallments: item.cardInstallmentsSelected,
    };
  });

  const message = buildWhatsAppMessage(payloadItems);

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
  $("settings-dollar-rate").value = state.dollar.rate || "";
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
    state.dollar = newState.dollar;
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
  $("pf-cost-usd").addEventListener("input", updateProductModalPreview);
  $("pf-markup-usd").addEventListener("input", updateProductModalPreview);
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

  $("btn-clear-quote").addEventListener("click", () => {
    if (state.quote.items.length && !confirm("¿Vaciar la cotización actual?")) return;
    clearQuote();
  });

  // Tasas globales de la cotización (dólar / TEM / tarjeta)
  $("quote-dollar-rate").addEventListener("input", (e) => {
    state.quote.dollarRate = Math.max(0, Number(e.target.value) || 0);
    renderQuoteItems();
  });
  $("own-tem").addEventListener("input", (e) => {
    state.quote.ownTem = Math.max(0, Number(e.target.value) || 0);
    renderQuoteItems();
  });
  $("card-rate6").addEventListener("input", (e) => {
    state.quote.cardRate6 = Math.max(0, Number(e.target.value) || 0);
    renderQuoteItems();
  });
  $("card-rate12").addEventListener("input", (e) => {
    state.quote.cardRate12 = Math.max(0, Number(e.target.value) || 0);
    renderQuoteItems();
  });

  // Items de la cotización (delegación de eventos: la lista se re-renderiza seguido)
  $("quote-items").addEventListener("click", (e) => {
    const plusId = e.target.closest("[data-qty-plus]")?.dataset.qtyPlus;
    const minusId = e.target.closest("[data-qty-minus]")?.dataset.qtyMinus;
    const removeId = e.target.closest("[data-remove]")?.dataset.remove;
    const fintoggleBtn = e.target.closest("[data-fintoggle]");
    const installmentBtn = e.target.closest("[data-installment]");

    if (plusId) return changeQty(plusId, 1);
    if (minusId) return changeQty(minusId, -1);
    if (removeId) return removeQuoteItem(removeId);

    if (fintoggleBtn) {
      const id = fintoggleBtn.dataset.fintoggle;
      const key = fintoggleBtn.dataset.key; // "includeOwn" | "includeCard"
      const item = state.quote.items.find((it) => it.productId === id);
      if (item) {
        item[key] = !item[key];
        renderQuoteItems();
      }
      return;
    }

    if (installmentBtn) {
      const id = installmentBtn.dataset.installment;
      const kind = installmentBtn.dataset.kind;
      const n = Number(installmentBtn.dataset.n);
      const item = state.quote.items.find((it) => it.productId === id);
      if (item) {
        const list = kind === "own" ? item.ownInstallmentsSelected : item.cardInstallmentsSelected;
        const idx = list.indexOf(n);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(n);
        renderQuoteItems();
      }
    }
  });

  // Recargo por línea: se actualiza en vivo (sin perder el foco) y se
  // persiste como nuevo default del producto al salir del campo.
  $("quote-items").addEventListener("input", (e) => {
    const markupId = e.target.dataset.markup;
    if (!markupId) return;
    const item = state.quote.items.find((it) => it.productId === markupId);
    if (!item) return;
    item.markupUsd = Math.max(0, Number(e.target.value) || 0);
    updateItemComputedDisplay(markupId);
  });
  $("quote-items").addEventListener("change", async (e) => {
    const markupId = e.target.dataset.markup;
    if (!markupId) return;
    const updated = await store.updateProductMarkup(markupId, e.target.value);
    if (updated) {
      const p = state.products.find((pp) => pp.id === markupId);
      if (p) p.markupUsd = updated.markupUsd;
    }
  });

  $("btn-generate-quote").addEventListener("click", generateQuote);
  $("btn-copy-quote").addEventListener("click", handleCopyQuote);
  $("btn-new-quote").addEventListener("click", clearQuote);
}

function wireSettings() {
  $("business-name-input").addEventListener("change", async (e) => {
    state.meta = { ...state.meta, businessName: e.target.value.trim() || "iPoint Carcarañá" };
    const dbModule = await import("./db.js");
    await dbModule.setConfig("meta", state.meta);
    renderHome();
  });

  $("settings-dollar-rate").addEventListener("change", async (e) => {
    state.dollar = await store.setDollarRate(e.target.value);
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
    renderOwnSavedChipsGlobal();
    toast("Tasa guardada");
  });
  $("btn-add-card-config").addEventListener("click", async () => {
    const name = await openPrompt("Guardar configuración de tarjeta", "Ej: Tasas promocionales");
    if (!name) return;
    state.cardFinancing = await store.saveCardConfig(name, $("settings-card-rate6").value, $("settings-card-rate12").value);
    renderSavedRatesManage();
    renderCardSavedChipsGlobal();
    toast("Configuración guardada");
  });

  $("settings-own-saved").addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del-own-rate]")?.dataset.delOwnRate;
    if (!id) return;
    state.ownFinancing = await store.deleteOwnRate(id);
    renderSavedRatesManage();
    renderOwnSavedChipsGlobal();
  });
  $("settings-card-saved").addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del-card-config]")?.dataset.delCardConfig;
    if (!id) return;
    state.cardFinancing = await store.deleteCardConfig(id);
    renderSavedRatesManage();
    renderCardSavedChipsGlobal();
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
  clearQuote();
  renderSettings();
  renderOwnSavedChipsGlobal();
  renderCardSavedChipsGlobal();
  updateQuoteShortcut();
}

async function init() {
  const loaded = await store.loadState();
  state.products = loaded.products;
  state.ownFinancing = loaded.ownFinancing;
  state.cardFinancing = loaded.cardFinancing;
  state.dollar = loaded.dollar;
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
