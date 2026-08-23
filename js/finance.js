// finance.js — Lógica de cálculo financiero.
// Separado en dos mundos independientes: financiación PROPIA (TEM + amortización
// francesa de cuota fija) y financiación con TARJETA (porcentaje directo sobre el
// precio de contado). Nunca deben mezclarse.

/* ----------------------------- FINANCIACIÓN PROPIA ----------------------------- */

/**
 * Calcula la cuota fija mensual de la financiación propia.
 * Q = C * i / [1 - (1+i)^-n]
 * Si i = 0 (TEM 0%), cae a reparto lineal: Q = C / n.
 * @param {number} capital  Capital financiado (precio de contado del total).
 * @param {number} temPercent  TEM en porcentaje (ej: 5 significa 5%).
 * @param {number} n  Cantidad de cuotas.
 * @returns {number} Valor de cada cuota.
 */
function calcCuotaPropia(capital, temPercent, n) {
  if (!Number.isFinite(capital) || capital <= 0) return 0;
  if (!Number.isInteger(n) || n <= 0) return 0;
  const i = (temPercent || 0) / 100;

  if (Math.abs(i) < 1e-9) {
    return capital / n;
  }
  const factor = 1 - Math.pow(1 + i, -n);
  if (Math.abs(factor) < 1e-12) return capital / n; // salvaguarda numérica
  return (capital * i) / factor;
}

/**
 * Calcula todas las cuotas de financiación propia para una lista de n's.
 * @param {number} capital
 * @param {number} temPercent
 * @param {number[]} installmentCounts
 * @returns {{n:number, cuota:number, total:number}[]}
 */
function calcPlanPropio(capital, temPercent, installmentCounts) {
  return installmentCounts
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => {
      const cuota = calcCuotaPropia(capital, temPercent, n);
      return { n, cuota, total: cuota * n };
    });
}

/**
 * Resuelve la TEM (i) dado capital, total a cobrar y cantidad de cuotas,
 * usando el sistema de amortización de cuota fija. Método: bisección robusta
 * (la función C(i) = Q*(1-(1+i)^-n)/i es monótona decreciente en i para Q fijo).
 *
 * Q = T / n
 * Buscamos i tal que: Q * [1 - (1+i)^-n] / i = C
 *
 * @param {number} capital  C
 * @param {number} totalACobrar  T
 * @param {number} n  cantidad de cuotas
 * @returns {number|null} TEM en porcentaje, o null si no se pudo resolver.
 */
function resolverTEM(capital, totalACobrar, n) {
  if (!Number.isFinite(capital) || capital <= 0) return null;
  if (!Number.isFinite(totalACobrar) || totalACobrar <= 0) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  if (totalACobrar <= capital) return 0; // sin interés (o caso degenerado)

  const Q = totalACobrar / n;

  const pv = (i) => {
    if (Math.abs(i) < 1e-12) return Q * n;
    return (Q * (1 - Math.pow(1 + i, -n))) / i;
  };

  // f(i) = pv(i) - C. f(0) = T - C > 0. f crece->decrece hacia 0 cuando i->inf.
  let lo = 1e-9;
  let hi = 10; // 1000% TEM como techo inicial
  let fLo = pv(lo) - capital;
  let fHi = pv(hi) - capital;

  // Expandir el techo si hace falta (tasas muy altas)
  let guard = 0;
  while (fHi > 0 && guard < 60) {
    hi *= 2;
    fHi = pv(hi) - capital;
    guard++;
  }
  if (fLo * fHi > 0) return null; // no hay cambio de signo, no se pudo acotar

  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = pv(mid) - capital;
    if (Math.abs(fMid) < 1e-9) {
      return mid * 100;
    }
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/* ----------------------------- FINANCIACIÓN CON TARJETA ----------------------------- */

/**
 * Calcula la financiación con tarjeta: porcentaje directo sobre el precio de
 * contado, dividido en partes iguales. NO usa amortización francesa.
 * Total financiado = C * (1 + tasa)
 * Cuota = Total financiado / n
 * @param {number} capital
 * @param {number} ratePercent  Tasa total del plan (ej: 57 para 6 cuotas, 91 para 12).
 * @param {number} n
 * @returns {{totalFinanciado:number, cuota:number}}
 */
function calcCuotaTarjeta(capital, ratePercent, n) {
  if (!Number.isFinite(capital) || capital <= 0 || !Number.isInteger(n) || n <= 0) {
    return { totalFinanciado: 0, cuota: 0 };
  }
  const rate = Math.max(0, ratePercent || 0) / 100;
  const totalFinanciado = capital * (1 + rate);
  const cuota = totalFinanciado / n;
  return { totalFinanciado, cuota };
}

/* ----------------------------- UTILIDADES ----------------------------- */

/** Redondea a entero de peso (sin decimales) de forma consistente. */
function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** Formatea un número como pesos argentinos: $1.990.000 */
function formatARS(value) {
  const rounded = roundMoney(value);
  return "$" + rounded.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

/** Formatea un porcentaje: 57 -> "57%", 5.5 -> "5,5%" */
function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("es-AR", { maximumFractionDigits: 2 }) + "%";
}

export {
  calcCuotaPropia,
  calcPlanPropio,
  resolverTEM,
  calcCuotaTarjeta,
  roundMoney,
  formatARS,
  formatPercent,
};
