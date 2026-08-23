// whatsapp.js — Construye el texto listo para copiar y pegar en WhatsApp.
// Solo incluye las modalidades y cuotas que el usuario tenga seleccionadas
// en ese momento para la cotización.

import { calcPlanPropio, calcCuotaTarjeta, formatARS, formatPercent } from "./finance.js";

/**
 * @param {object} quote
 * @param {{name:string, price:number, qty:number}[]} quote.items
 * @param {number} quote.total
 * @param {boolean} quote.includeOwn
 * @param {boolean} quote.includeCard
 * @param {number} quote.ownTem
 * @param {number[]} quote.ownInstallments
 * @param {number} quote.cardRate6
 * @param {number} quote.cardRate12
 * @param {number[]} quote.cardInstallments
 * @param {string} [businessName]
 * @returns {string}
 */
function buildWhatsAppMessage(quote, businessName = "iPoint Carcarañá") {
  const {
    items = [],
    total = 0,
    includeOwn = false,
    includeCard = false,
    ownTem = 0,
    ownInstallments = [],
    cardRate6 = 0,
    cardRate12 = 0,
    cardInstallments = [],
  } = quote;

  const lines = [];

  lines.push(`✨ *${businessName}*`);
  lines.push("");

  if (items.length === 1 && items[0].qty === 1) {
    lines.push(`📱 ${items[0].name}`);
  } else {
    for (const item of items) {
      const qtyPrefix = item.qty > 1 ? `${item.qty}x ` : "";
      lines.push(`📱 ${qtyPrefix}${item.name} — ${formatARS(item.price * item.qty)}`);
    }
  }

  lines.push(`💰 Contado: ${formatARS(total)}`);

  if (includeOwn && ownInstallments.length) {
    lines.push("");
    lines.push("*Financiación propia:*");
    const plan = calcPlanPropio(total, ownTem, ownInstallments).sort((a, b) => a.n - b.n);
    for (const { n, cuota } of plan) {
      lines.push(`${n} cuotas de ${formatARS(cuota)}`);
    }
  }

  if (includeCard && cardInstallments.length) {
    lines.push("");
    lines.push("*Financiación con tarjeta:*");
    const sorted = [...cardInstallments].sort((a, b) => a - b);
    for (const n of sorted) {
      const rate = n === 6 ? cardRate6 : n === 12 ? cardRate12 : 0;
      const { cuota } = calcCuotaTarjeta(total, rate, n);
      lines.push(`${n} cuotas de ${formatARS(cuota)} — tasa ${formatPercent(rate)}`);
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
