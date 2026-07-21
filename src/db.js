// Almacenamiento simple basado en archivos JSON (sin base de datos externa).
// Para el volumen de datos de este panel (cuentas de Zoho Books configuradas
// a mano + un cache de facturas/pedidos ya revisados) un JSON en disco es
// suficiente y evita depender de un motor nativo (sqlite, etc.) que complique
// el build de Docker en EasyPanel.
//
// IMPORTANTE: monta un volumen persistente en DATA_DIR en EasyPanel, si no
// las cuentas conectadas se pierden en cada redeploy.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { encrypt, decrypt } = require("./crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const CACHE_FILE = path.join(DATA_DIR, "cache.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJSON(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error leyendo ${file}:`, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  ensureDataDir();
  // Escritura atomica: primero a un temp file, luego rename.
  const tmp = `${file}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// ---------- Cuentas de Zoho Books ----------

function getAccountsRaw() {
  return readJSON(ACCOUNTS_FILE, []);
}

function listAccounts({ includeSecrets = false } = {}) {
  const accounts = getAccountsRaw();
  return accounts.map((acc) => {
    if (includeSecrets) {
      return {
        ...acc,
        clientSecret: decrypt(acc.clientSecretEnc),
        refreshToken: decrypt(acc.refreshTokenEnc),
      };
    }
    // Vista segura para la UI: nunca mandamos los secretos cifrados/planos al frontend.
    const { clientSecretEnc, refreshTokenEnc, ...safe } = acc;
    return { ...safe, hasRefreshToken: Boolean(acc.refreshTokenEnc) };
  });
}

function getAccount(id, { includeSecrets = false } = {}) {
  const acc = getAccountsRaw().find((a) => a.id === id);
  if (!acc) return null;
  if (includeSecrets) {
    return {
      ...acc,
      clientSecret: decrypt(acc.clientSecretEnc),
      refreshToken: decrypt(acc.refreshTokenEnc),
    };
  }
  const { clientSecretEnc, refreshTokenEnc, ...safe } = acc;
  return safe;
}

function upsertAccount(input) {
  const accounts = getAccountsRaw();
  const id = input.id || crypto.randomUUID();
  const idx = accounts.findIndex((a) => a.id === id);

  const existing = idx >= 0 ? accounts[idx] : {};

  const record = {
    id,
    name: input.name ?? existing.name,
    region: input.region ?? existing.region ?? "com",
    organizationId: input.organizationId ?? existing.organizationId,
    clientId: input.clientId ?? existing.clientId,
    clientSecretEnc:
      input.clientSecret !== undefined
        ? encrypt(input.clientSecret)
        : existing.clientSecretEnc,
    refreshTokenEnc:
      input.refreshToken !== undefined
        ? encrypt(input.refreshToken)
        : existing.refreshTokenEnc,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    accounts[idx] = record;
  } else {
    accounts.push(record);
  }
  writeJSON(ACCOUNTS_FILE, accounts);
  return record.id;
}

function deleteAccount(id) {
  const accounts = getAccountsRaw().filter((a) => a.id !== id);
  writeJSON(ACCOUNTS_FILE, accounts);
  // Tambien limpiamos su cache de sync.
  const cache = readJSON(CACHE_FILE, {});
  delete cache[id];
  writeJSON(CACHE_FILE, cache);
}

// ---------- Cache de documentos ya vistos (para no re-consultar detalle) ----------
// Estructura: { [accountId]: { [docType]: { [docId]: { last_modified_time, contact_id, item_ids, date, total } } } }

function getAccountCache(accountId, docType) {
  const cache = readJSON(CACHE_FILE, {});
  return (cache[accountId] && cache[accountId][docType]) || {};
}

function saveAccountCacheEntries(accountId, docType, entries) {
  const cache = readJSON(CACHE_FILE, {});
  if (!cache[accountId]) cache[accountId] = {};
  if (!cache[accountId][docType]) cache[accountId][docType] = {};
  Object.assign(cache[accountId][docType], entries);
  writeJSON(CACHE_FILE, cache);
}

module.exports = {
  DATA_DIR,
  listAccounts,
  getAccount,
  upsertAccount,
  deleteAccount,
  getAccountCache,
  saveAccountCacheEntries,
};
