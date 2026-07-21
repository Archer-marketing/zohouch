const express = require("express");
const crypto = require("crypto");
const db = require("../src/db");
const zoho = require("../src/zoho");

const router = express.Router();

function redirectUri(req) {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/oauth/callback`;
}

router.get("/accounts", (req, res) => {
  res.render("accounts", {
    accounts: db.listAccounts(),
    regions: zoho.REGIONS,
    redirectUriPreview: redirectUri(req),
    flash: req.query.flash || null,
    error: req.query.error || null,
  });
});

// Crea o actualiza los datos base de una cuenta (sin el refresh_token todavia).
router.post("/accounts", (req, res) => {
  const { id, name, region, organizationId, clientId, clientSecret } = req.body;
  if (!name || !organizationId || !clientId) {
    return res.redirect("/accounts?error=" + encodeURIComponent("Faltan campos obligatorios."));
  }
  const payload = { id: id || undefined, name, region, organizationId, clientId };
  // Solo actualiza el secret si mandaron uno nuevo (para no borrarlo al editar otros campos).
  if (clientSecret) payload.clientSecret = clientSecret;

  const accountId = db.upsertAccount(payload);
  res.redirect(`/accounts?flash=${encodeURIComponent("Cuenta guardada: " + name)}#account-${accountId}`);
});

router.post("/accounts/:id/delete", (req, res) => {
  db.deleteAccount(req.params.id);
  res.redirect("/accounts?flash=" + encodeURIComponent("Cuenta eliminada."));
});

// Paso 1 del OAuth: manda al usuario a la pantalla de consentimiento de Zoho.
router.get("/accounts/:id/connect", (req, res) => {
  const account = db.getAccount(req.params.id, { includeSecrets: true });
  if (!account) return res.redirect("/accounts?error=" + encodeURIComponent("Cuenta no encontrada."));
  if (!account.clientId || !account.clientSecret) {
    return res.redirect(
      "/accounts?error=" + encodeURIComponent("Primero guarda Client ID y Client Secret de esa cuenta.")
    );
  }
  const state = `${account.id}.${crypto.randomBytes(8).toString("hex")}`;
  req.session.oauthState = state;
  const url = zoho.buildAuthUrl({
    region: account.region,
    clientId: account.clientId,
    redirectUri: redirectUri(req),
    state,
  });
  res.redirect(url);
});

// Paso 2 del OAuth: Zoho redirige aqui con ?code=...&state=...
router.get("/oauth/callback", async (req, res) => {
  const { code, state, error: zohoError } = req.query;
  if (zohoError) {
    return res.redirect("/accounts?error=" + encodeURIComponent(`Zoho devolvio error: ${zohoError}`));
  }
  if (!code || !state || !state.includes(".")) {
    return res.redirect("/accounts?error=" + encodeURIComponent("Callback invalido (falta code/state)."));
  }
  const accountId = state.split(".")[0];
  const account = db.getAccount(accountId, { includeSecrets: true });
  if (!account) return res.redirect("/accounts?error=" + encodeURIComponent("Cuenta no encontrada."));

  try {
    const tokens = await zoho.exchangeCodeForTokens({
      region: account.region,
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      code,
      redirectUri: redirectUri(req),
    });
    db.upsertAccount({ id: account.id, refreshToken: tokens.refresh_token });
    res.redirect("/accounts?flash=" + encodeURIComponent(`Cuenta "${account.name}" conectada correctamente.`));
  } catch (err) {
    res.redirect("/accounts?error=" + encodeURIComponent(err.message));
  }
});

module.exports = router;
