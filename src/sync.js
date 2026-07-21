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

async function getDetailWithCache(account, docType, doc, cache) {
  const cached = cache[doc.id];
  if (cached && cached.lastModifiedTime === doc.lastModifiedTime) {
    return { id: doc.id, contactId: cached.contactId, lineItems: cached.lineItems, date: cached.date };
  }
  const detail = await zoho.getDocumentDetail(account, docType, doc.id);
  return detail;
}

async function runSync({ accountIds, dateFrom, dateTo, productIds, docType = "invoices" }, { onProgress } = {}) {
  const productIdSet = new Set((productIds || []).filter(Boolean));
  const allAccounts = db.listAccounts({ includeSecrets: true });
  const accounts = allAccounts.filter((a) => accountIds.includes(a.id));

  const stats = { accountsProcessed: 0, docsScanned: 0, docsMatched: 0, contactsMatched: 0, errors: [] };
  const contactsByPhone = new Map(); // phone -> row

  for (const account of accounts) {
    if (onProgress) onProgress({ stage: "account_start", account: account.name });
    let docs;
    try {
      docs = await zoho.listDocumentsByDateRange(account, { docType, dateFrom, dateTo });
    } catch (err) {
      stats.errors.push(`[${account.name}] listando documentos: ${err.message}`);
      continue;
    }
    stats.docsScanned += docs.length;

    const cache = db.getAccountCache(account.id, docType);

    // Trae detalle (line items) de cada doc, con cache y concurrencia limitada.
    const details = await asyncPool(5, docs, (doc) => getDetailWithCache(account, docType, doc, cache));

    const cacheUpdates = {};
    const matchedDocs = [];

    for (const detail of details) {
      if (!detail || detail.__error) {
        if (detail) stats.errors.push(`[${account.name}] detalle doc: ${detail.__error}`);
        continue;
      }
      cacheUpdates[detail.id] = {
        lastModifiedTime: detail.lastModifiedTime,
        contactId: detail.contactId,
        lineItems: detail.lineItems,
        date: detail.date,
      };

      const itemIds = (detail.lineItems || []).map((li) => li.itemId);
      const matches = productIdSet.size === 0 || itemIds.some((id) => productIdSet.has(id));
      if (matches) {
        matchedDocs.push(detail);
      }
    }

    db.saveAccountCacheEntries(account.id, docType, cacheUpdates);
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

module.exports = { runSync, normalizePhone };
