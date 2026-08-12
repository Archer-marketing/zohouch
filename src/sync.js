// Motor de cruce: "quien compro el/los producto(s) X entre fecha A y fecha B,
// en una o varias cuentas de Zoho Books" -> lista de contactos con telefono,
// sin duplicados.
//
// Estrategia (la API de Zoho Books no permite filtrar la lista de facturas /
// pedidos por item directamente):
//   1. Traer todas las facturas o pedidos del rango de fechas (liviano, sin line items).
//   2. Para cada uno, pedir el detalle (line items) SOLO si no esta cacheado
//      o si cambio desde la ultima vez (last_modified_time).
//   3. Quedarnos con los que contienen alguno de los productos elegidos.
//   4. Traer el contacto (telefono) de cada uno, una sola vez por contacto.
//   5. Deduplicar por telefono normalizado.

const zoho = require("./zoho");
const db = require("./db");
const { normalizeDate } = require("./csvImport");

async function asyncPool(concurrency, items, iteratorFn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      try {
        results[current] = await iteratorFn(items[current], current);
      } catch (err) {
        results[current] = { __error: err.message, __item: items[current] };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function normalizePhone(raw) {
  if (!raw) return "";
  let cleaned = String(raw).replace(/[^\d+]/g, "");
  // deja un solo "+" al inicio si existe
  if (cleaned.includes("+")) {
    cleaned = "+" + cleaned.replace(/\+/g, "");
  }
  return cleaned;
}

async function getDetailWithCache(account, docType, doc, cache, onStatus) {
  const cached = cache[doc.id];
  if (cached && cached.lastModifiedTime === doc.lastModifiedTime) {
    return { id: doc.id, contactId: cached.contactId, lineItems: cached.lineItems, date: cached.date };
  }
  const detail = await zoho.getDocumentDetail(account, docType, doc.id, onStatus);
  return detail;
}

// Trae el detalle (line items) de todos los documentos de una cuenta en un
// rango de fechas, usando el cache en disco para no re-pedir los que no
// cambiaron desde la ultima vez. Compartido entre runSync y computeCrossSell.
// onStatus(mensaje) se llama en tiempo real (throttle esperando, reintentos
// por 429, progreso de listado/detalle) para poder mostrarlo en la UI.
async function fetchAccountDocDetails(account, docType, dateFrom, dateTo, onStatus) {
  const docs = await zoho.listDocumentsByDateRange(account, { docType, dateFrom, dateTo }, onStatus);
  const cache = db.getAccountCache(account.id, docType);

  let processed = 0;
  const results = await asyncPool(5, docs, async (doc) => {
    const detail = await getDetailWithCache(account, docType, doc, cache, onStatus);
    processed += 1;
    if (processed % 20 === 0 || processed === docs.length) {
      const msg = `${account.name}: detalle ${processed}/${docs.length} documentos`;
      console.log(`[sync] ${msg}`);
      if (onStatus) onStatus(`Trayendo detalle de documentos: ${processed}/${docs.length}…`);
    }
    return detail;
  });

  const cacheUpdates = {};
  const details = [];
  const errors = [];
  for (const detail of results) {
    if (!detail || detail.__error) {
      if (detail) errors.push(detail.__error);
      continue;
    }
    cacheUpdates[detail.id] = {
      lastModifiedTime: detail.lastModifiedTime,
      contactId: detail.contactId,
      lineItems: detail.lineItems,
      date: detail.date,
    };
    details.push(detail);
  }
  db.saveAccountCacheEntries(account.id, docType, cacheUpdates);
  return { details, docsScanned: docs.length, errors };
}

async function runSync({ accountIds, dateFrom, dateTo, productIds, docType = "invoices" }, { onProgress } = {}) {
  const productIdSet = new Set((productIds || []).filter(Boolean));
  const allAccounts = db.listAccounts({ includeSecrets: true });
  const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

  const stats = { accountsProcessed: 0, docsScanned: 0, docsMatched: 0, contactsMatched: 0, errors: [] };
  const contactsByPhone = new Map(); // phone -> row

  for (const account of accounts) {
    if (onProgress) onProgress({ stage: "account_start", account: account.name });
    let details, docsScanned, detailErrors;
    try {
      ({ details, docsScanned, errors: detailErrors } = await fetchAccountDocDetails(
        account,
        docType,
        dateFrom,
        dateTo
      ));
    } catch (err) {
      stats.errors.push(`[${account.name}] listando documentos: ${err.message}`);
      continue;
    }
    stats.docsScanned += docsScanned;
    detailErrors.forEach((msg) => stats.errors.push(`[${account.name}] detalle doc: ${msg}`));

    const matchedDocs = details.filter((detail) => {
      const itemIds = (detail.lineItems || []).map((li) => li.itemId);
      return productIdSet.size === 0 || itemIds.some((id) => productIdSet.has(id));
    });

    stats.docsMatched += matchedDocs.length;

    // Contactos unicos a resolver en esta cuenta
    const contactIds = [...new Set(matchedDocs.map((d) => d.contactId).filter(Boolean))];
    const contacts = await asyncPool(5, contactIds, (cid) => zoho.getContact(account, cid));

    const contactById = new Map();
    for (const c of contacts) {
      if (c && !c.__error) contactById.set(c.contactId, c);
    }

    for (const detail of matchedDocs) {
      const contact = contactById.get(detail.contactId);
      if (!contact) continue;
      const phone = normalizePhone(contact.bestPhone);
      if (!phone) continue; // sin telefono no sirve para difusion

      const productNames = (detail.lineItems || [])
        .filter((li) => productIdSet.size === 0 || productIdSet.has(li.itemId))
        .map((li) => li.name);

      if (!contactsByPhone.has(phone)) {
        contactsByPhone.set(phone, {
          name: contact.name || "",
          phone,
          email: contact.email || "",
          company: contact.companyName || "",
          accounts: new Set([account.name]),
          products: new Set(productNames),
          purchaseCount: 1,
          lastPurchaseDate: detail.date,
        });
        stats.contactsMatched += 1;
      } else {
        const row = contactsByPhone.get(phone);
        row.accounts.add(account.name);
        productNames.forEach((p) => row.products.add(p));
        row.purchaseCount += 1;
        if (!row.lastPurchaseDate || detail.date > row.lastPurchaseDate) {
          row.lastPurchaseDate = detail.date;
        }
      }
    }

    stats.accountsProcessed += 1;
    if (onProgress) onProgress({ stage: "account_done", account: account.name });
  }

  const rows = [...contactsByPhone.values()]
    .map((r) => ({
      name: r.name,
      phone: r.phone,
      email: r.email,
      company: r.company,
      accounts: [...r.accounts].join(" | "),
      products: [...r.products].join(" | "),
      purchaseCount: r.purchaseCount,
      lastPurchaseDate: r.lastPurchaseDate,
    }))
    .sort((a, b) => (a.lastPurchaseDate < b.lastPurchaseDate ? 1 : -1));

  return { rows, stats };
}

// Agrupa una lista de detalles de documentos por contacto:
// contactId -> { name, docCount, items: Map<itemId, {itemId, name, sku, quantity}> }
function groupByContact(details) {
  const byContact = new Map();
  for (const detail of details) {
    if (!detail.contactId) continue;
    if (!byContact.has(detail.contactId)) {
      byContact.set(detail.contactId, { name: detail.contactName || "", docCount: 0, items: new Map() });
    }
    const entry = byContact.get(detail.contactId);
    if (detail.contactName) entry.name = detail.contactName;
    entry.docCount += 1;
    for (const li of detail.lineItems || []) {
      if (!li.itemId) continue;
      const existing = entry.items.get(li.itemId);
      if (existing) {
        existing.quantity += li.quantity || 0;
      } else {
        entry.items.set(li.itemId, { itemId: li.itemId, name: li.name, sku: li.sku, quantity: li.quantity || 0 });
      }
    }
  }
  return byContact;
}

// Venta cruzada para un cliente puntual: que compro (en el rango del
// cliente), y que compran otros clientes de la misma cuenta que comparten
// al menos un producto con el (candidatos a recomendar, buscados en su
// propio rango de fechas -- puede ser mas corto, ej. "ultimos 30 dias",
// para que las sugerencias reflejen lo que se esta comprando ahora y no
// todo el historial).
//
// Logica pura, compartida entre el modo "en vivo" (Zoho API, computeCrossSell)
// y el modo CSV (crossSellFromCsvRows) -- ambos arman "details" con la misma
// forma ({contactId, contactName, date, lineItems}) y llegan aca.
const MAX_RECOMMENDATIONS = 10;

function computeCrossSellFromDetails({ targetDetails, recDetails, customerId, docsScanned, errors }) {
  const targetEntry = groupByContact(targetDetails).get(customerId);
  const byContactRec = groupByContact(recDetails);

  if (!targetEntry) {
    return {
      found: false,
      customer: null,
      purchases: [],
      recommendations: [],
      stats: { docsScanned, customersInRecRange: byContactRec.size, errors },
    };
  }

  const targetItemIds = new Set(targetEntry.items.keys());
  const purchases = [...targetEntry.items.values()].sort((a, b) => b.quantity - a.quantity);

  const recCounts = new Map(); // itemId -> { itemId, name, sku, coBuyers, totalQuantity }
  let similarCustomers = 0;

  for (const [contactId, entry] of byContactRec) {
    if (contactId === customerId) continue;
    const sharesProduct = [...entry.items.keys()].some((id) => targetItemIds.has(id));
    if (!sharesProduct) continue;
    similarCustomers += 1;
    for (const item of entry.items.values()) {
      if (targetItemIds.has(item.itemId)) continue; // el cliente ya lo compro, no hace falta recomendarlo
      const rec = recCounts.get(item.itemId) || {
        itemId: item.itemId,
        name: item.name,
        sku: item.sku,
        coBuyers: 0,
        totalQuantity: 0,
      };
      rec.coBuyers += 1;
      rec.totalQuantity += item.quantity;
      recCounts.set(item.itemId, rec);
    }
  }

  const recommendations = [...recCounts.values()]
    .sort((a, b) => b.coBuyers - a.coBuyers || b.totalQuantity - a.totalQuantity)
    .slice(0, MAX_RECOMMENDATIONS);

  return {
    found: true,
    customer: { id: customerId, name: targetEntry.name, docCount: targetEntry.docCount },
    purchases,
    recommendations,
    stats: { docsScanned, customersInRecRange: byContactRec.size, similarCustomers, errors },
  };
}

async function computeCrossSell({
  accountId,
  docType = "invoices",
  dateFrom,
  dateTo,
  recDateFrom,
  recDateTo,
  customerId,
  onStatus,
}) {
  const account = db.getAccount(accountId, { includeSecrets: true });
  if (!account) throw new Error("Cuenta no encontrada.");

  if (onStatus) onStatus("Trayendo compras del cliente…");
  const { details: targetDetails, docsScanned: targetDocsScanned, errors: targetErrors } =
    await fetchAccountDocDetails(account, docType, dateFrom, dateTo, onStatus);

  const sameRange = recDateFrom === dateFrom && recDateTo === dateTo;
  // Fechas vienen como "YYYY-MM-DD", comparan bien como strings.
  const recContainedInTarget = recDateFrom >= dateFrom && recDateTo <= dateTo;

  let recDetails, recDocsScanned, recErrors;
  if (sameRange) {
    recDetails = targetDetails;
    recDocsScanned = targetDocsScanned;
    recErrors = targetErrors;
  } else if (recContainedInTarget) {
    // El rango de recomendaciones esta adentro del rango del cliente: ya
    // tenemos esos documentos en targetDetails, no hace falta volver a
    // pedirle a Zoho el mismo listado + detalle de vuelta.
    recDetails = targetDetails.filter((d) => d.date >= recDateFrom && d.date <= recDateTo);
    recDocsScanned = 0;
    recErrors = [];
  } else {
    if (onStatus) onStatus("Trayendo compras de otros clientes para las recomendaciones…");
    ({ details: recDetails, docsScanned: recDocsScanned, errors: recErrors } = await fetchAccountDocDetails(
      account,
      docType,
      recDateFrom,
      recDateTo,
      onStatus
    ));
  }

  const errors = sameRange ? targetErrors : [...targetErrors, ...recErrors];
  const docsScanned = sameRange ? targetDocsScanned : targetDocsScanned + recDocsScanned;

  return computeCrossSellFromDetails({ targetDetails, recDetails, customerId, docsScanned, errors });
}

// ---------- Venta cruzada desde un CSV exportado a mano (cero llamadas a la
// API de Zoho) ----------
// mapping: { customer, item, sku (opcional), quantity, date } -> nombres de
// columna del CSV subido. No hay Customer ID en un export manual, asi que
// identificamos clientes por nombre (tal como viene en la columna elegida).

function csvRowsToDetails(rows, mapping) {
  const details = [];
  for (const row of rows) {
    const customerName = (row[mapping.customer] || "").trim();
    const itemName = (row[mapping.item] || "").trim();
    if (!customerName || !itemName) continue;
    const sku = mapping.sku ? (row[mapping.sku] || "").trim() : "";
    const quantity = Number((row[mapping.quantity] || "").replace(/,/g, "")) || 0;
    const date = normalizeDate(row[mapping.date]);
    // Preferimos el SKU como clave del producto (mas estable que el nombre);
    // si no hay SKU, usamos el nombre.
    const itemId = sku || itemName;
    details.push({
      contactId: customerName,
      contactName: customerName,
      date,
      lineItems: [{ itemId, name: itemName, sku, quantity }],
    });
  }
  return details;
}

function distinctCsvCustomers(rows, mapping) {
  const names = new Set();
  for (const row of rows) {
    const name = (row[mapping.customer] || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "es"));
}

function crossSellFromCsvRows({ rows, mapping, customerName, dateFrom, dateTo, recDateFrom, recDateTo }) {
  const allDetails = csvRowsToDetails(rows, mapping);
  const withDates = allDetails.filter((d) => d.date);
  const invalidDateCount = allDetails.length - withDates.length;

  const targetDetails = withDates.filter((d) => d.date >= dateFrom && d.date <= dateTo);
  const recDetails = withDates.filter((d) => d.date >= recDateFrom && d.date <= recDateTo);

  const errors = [];
  if (invalidDateCount > 0) {
    errors.push(`${invalidDateCount} fila(s) del CSV tenian una fecha que no se pudo interpretar y se ignoraron.`);
  }

  return computeCrossSellFromDetails({
    targetDetails,
    recDetails,
    customerId: customerName,
    docsScanned: withDates.length,
    errors,
  });
}

module.exports = {
  runSync,
  computeCrossSell,
  normalizePhone,
  distinctCsvCustomers,
  crossSellFromCsvRows,
};
