// Cliente minimo para la API de Zoho Books (v3), pensado para el flujo de
// este panel: refrescar token, listar facturas/pedidos por rango de fechas,
// traer el detalle (line items) y traer telefono del contacto.
//
// Docs de referencia (verifica siempre contra la version vigente al integrar):
// https://www.zoho.com/books/api/v3/

const REGIONS = {
  com: { accounts: "accounts.zoho.com", api: "www.zohoapis.com", label: "Global (.com)" },
  eu: { accounts: "accounts.zoho.eu", api: "www.zohoapis.eu", label: "Europa (.eu)" },
  in: { accounts: "accounts.zoho.in", api: "www.zohoapis.in", label: "India (.in)" },
  "com.au": { accounts: "accounts.zoho.com.au", api: "www.zohoapis.com.au", label: "Australia" },
  jp: { accounts: "accounts.zoho.jp", api: "www.zohoapis.jp", label: "Japon" },
  ca: { accounts: "accounts.zohocloud.ca", api: "www.zohoapis.ca", label: "Canada" },
  sa: { accounts: "accounts.zoho.sa", api: "www.zohoapis.sa", label: "Arabia Saudita" },
};

// Cache de access_token en memoria (se pierde al reiniciar el proceso, no pasa nada,
// se vuelve a pedir con el refresh_token que si esta persistido y cifrado).
const tokenCache = new Map(); // accountId -> { accessToken, expiresAt }

function regionInfo(region) {
  return REGIONS[region] || REGIONS.com;
}

async function zohoFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Respuesta no-JSON de Zoho (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(
      `Zoho API error ${res.status}: ${json.message || JSON.stringify(json)}`
    );
  }
  return json;
}

// ---------- OAuth ----------

function buildAuthUrl({ region, clientId, redirectUri, scope, state }) {
  const { accounts } = regionInfo(region);
  const params = new URLSearchParams({
    scope: scope || "ZohoBooks.fullaccess.all",
    client_id: clientId,
    response_type: "code",
    access_type: "offline",
    redirect_uri: redirectUri,
    prompt: "consent",
    state: state || "",
  });
  return `https://${accounts}/oauth/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens({ region, clientId, clientSecret, code, redirectUri }) {
  const { accounts } = regionInfo(region);
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const json = await zohoFetch(`https://${accounts}/oauth/v2/token?${params.toString()}`, {
    method: "POST",
  });
  if (!json.refresh_token) {
    throw new Error(
      `Zoho no devolvio refresh_token (respuesta: ${JSON.stringify(json)}). ` +
        "Asegurate de mandar prompt=consent y access_type=offline, y de no haber " +
        "autorizado ya antes esta misma app sin revocar el acceso previo."
    );
  }
  return json; // { access_token, refresh_token, expires_in, ... }
}

async function getAccessToken(account) {
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }
  const { accounts } = regionInfo(account.region);
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: account.clientId,
    client_secret: account.clientSecret,
    refresh_token: account.refreshToken,
  });
  const json = await zohoFetch(`https://${accounts}/oauth/v2/token?${params.toString()}`, {
    method: "POST",
  });
  if (!json.access_token) {
    throw new Error(
      `No se pudo refrescar el access_token de la cuenta "${account.name}": ${JSON.stringify(json)}`
    );
  }
  const expiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  tokenCache.set(account.id, { accessToken: json.access_token, expiresAt });
  return json.access_token;
}

async function authedFetch(account, path, { method = "GET", query = {} } = {}) {
  const token = await getAccessToken(account);
  const { api } = regionInfo(account.region);
  const params = new URLSearchParams({ organization_id: account.organizationId, ...query });
  const url = `https://${api}/books/v3${path}?${params.toString()}`;
  return zohoFetch(url, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
}

// ---------- Endpoints usados por el panel ----------

const DOC_CONFIG = {
  invoices: { listPath: "/invoices", listKey: "invoices", detailPath: (id) => `/invoices/${id}`, idField: "invoice_id" },
  salesorders: { listPath: "/salesorders", listKey: "salesorders", detailPath: (id) => `/salesorders/${id}`, idField: "salesorder_id" },
};

// Trae TODOS los documentos (facturas o pedidos) creados/modificados dentro
// del rango de fechas, paginando. Devuelve resumenes livianos (sin line items).
async function listDocumentsByDateRange(account, { docType, dateFrom, dateTo }) {
  const cfg = DOC_CONFIG[docType];
  if (!cfg) throw new Error(`docType invalido: ${docType}`);

  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const json = await authedFetch(account, cfg.listPath, {
      query: {
        filter_by: "Date.CustomDate",
        date_start: dateFrom,
        date_end: dateTo,
        page,
        per_page: 200,
        sort_column: "date",
      },
    });
    const items = json[cfg.listKey] || [];
    for (const it of items) {
      results.push({
        id: it[cfg.idField],
        contactId: it.customer_id || it.contact_id,
        contactName: it.customer_name || it.contact_name,
        date: it.date,
        lastModifiedTime: it.last_modified_time,
        status: it.status,
        total: it.total,
      });
    }
    hasMore = Boolean(json.page_context && json.page_context.has_more_page);
    page += 1;
    if (page > 100) break; // limite de seguridad (20k docs)
  }
  return results;
}

// Detalle de un documento puntual, incluyendo line_items (para filtrar por producto).
async function getDocumentDetail(account, docType, id) {
  const cfg = DOC_CONFIG[docType];
  const json = await authedFetch(account, cfg.detailPath(id));
  const doc = json[docType === "invoices" ? "invoice" : "salesorder"];
  return {
    id: doc[cfg.idField],
    contactId: doc.customer_id,
    contactName: doc.customer_name,
    date: doc.date,
    lastModifiedTime: doc.last_modified_time,
    lineItems: (doc.line_items || []).map((li) => ({
      itemId: li.item_id,
      name: li.name,
      sku: li.sku,
      quantity: li.quantity,
      itemTotal: li.item_total,
    })),
  };
}

async function getContact(account, contactId) {
  const json = await authedFetch(account, `/contacts/${contactId}`);
  const c = json.contact || {};
  const phone = c.phone || "";
  const mobile = c.mobile || "";
  return {
    contactId: c.contact_id,
    name: c.contact_name || c.company_name,
    companyName: c.company_name,
    email: c.email,
    phone,
    mobile,
    bestPhone: mobile || phone || "",
  };
}

async function listItems(account) {
  const results = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const json = await authedFetch(account, "/items", { query: { page, per_page: 200 } });
    const items = json.items || [];
    for (const it of items) {
      results.push({ id: it.item_id, name: it.name, sku: it.sku });
    }
    hasMore = Boolean(json.page_context && json.page_context.has_more_page);
    page += 1;
    if (page > 50) break;
  }
  return results;
}

module.exports = {
  REGIONS,
  regionInfo,
  buildAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  listDocumentsByDateRange,
  getDocumentDetail,
  getContact,
  listItems,
};
