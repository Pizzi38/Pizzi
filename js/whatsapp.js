// whatsapp.js — Construye el texto listo para copiar y pegar en WhatsApp.
// Cada producto de la cotización es un bloque INDEPENDIENTE: su propio
// contado (USD y ARS) y su propia financiación (sin / propia / tarjeta).
// Nunca se suma un total combinado entre productos.

import { calcCuotaPropia, calcCuotaTarjeta, formatARS, formatUSD, formatARSRate, formatPercent } from "./finance.js";

/**
 * @param {object[]} items  Bloques de la cotización.
 * @param {string} items[].name
 * @param {number} items[].qty
 * @param {number} items[].contadoUsdTotal   (costo+recargo) por unidad, ya x qty
 * @param {number} items[].contadoArsTotal   contadoUsdTotal * dólar, ya redondeado
 * @param {'none'|'own'|'card'} items[].financingType
 * @param {number} [items[].ownTem]
 * @param {number[]} [items[].ownInstallments]
 * @param {number} [items[].cardRate6]
 * @param {number} [items[].cardRate12]
 * @param {number[]} [items[].cardInstallments]
 * @param {number} dollarRate
 * @param {string} [businessName]
 * @returns {string}
 */
function buildWhatsAppMessage(items, dollarRate, businessName = "iPoint Carcarañá") {
  const lines = [];

  lines.push(`✨ *${businessName}*`);
  lines.push(`💵 Dólar: ${formatARSRate(dollarRate)}`);

  for (const item of items) {
    lines.push("");
    const qtyPrefix = item.qty > 1 ? `${item.qty}x ` : "";
    lines.push(`📱 ${qtyPrefix}${item.name}`);
    lines.push(`💰 Contado: ${formatUSD(item.contadoUsdTotal)} · ${formatARS(item.contadoArsTotal)}`);

    if (item.financingType === "own" && item.ownInstallments?.length) {
      lines.push("*Financiación propia:*");
      const sorted = [...item.ownInstallments].sort((a, b) => a - b);
      for (const n of sorted) {
        const cuota = calcCuotaPropia(item.contadoArsTotal, item.ownTem, n);
        lines.push(`${n} cuotas de ${formatARS(cuota)}`);
      }
    } else if (item.financingType === "card" && item.cardInstallments?.length) {
      lines.push("*Financiación con tarjeta:*");
      const sorted = [...item.cardInstallments].sort((a, b) => a - b);
      for (const n of sorted) {
        const rate = n === 6 ? item.cardRate6 : n === 12 ? item.cardRate12 : 0;
        const { cuota } = calcCuotaTarjeta(item.contadoArsTotal, rate, n);
        lines.push(`${n} cuotas de ${formatARS(cuota)} — tasa ${formatPercent(rate)}`);
      }
    }
  }

  return lines.join("\n");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback para navegadores/contextos sin permiso de Clipboard API
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (err2) {
      return false;
    }
  }
}

export { buildWhatsAppMessage, copyToClipboard };
