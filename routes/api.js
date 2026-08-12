const express = require("express");
const crypto = require("crypto");
const db = require("../src/db");
const zoho = require("../src/zoho");
const { runSync, computeCrossSell } = require("../src/sync");
const { rowsToCsv } = require("../src/csv");
const runStore = require("../src/runStore");

const router = express.Router();

// Lista de productos (items) combinados de las cuentas seleccionadas, para
// poblar el filtro del dashboard. Se pide "al vuelo" (no se cachea a disco).
router.get("/api/products", async (req, res) => {
  const accountIds = String(req.query.accounts || "")
    .split(",")
    .filter(Boolean);
  if (accountIds.length === 0) return res.json({ items: [] });

  const accounts = db.listAccounts({ includeSecrets: true }).filter((a) => accountIds.includes(a.id));
  const merged = new Map();
  const errors = [];

  await Promise.all(
    accounts.map(async (acc) => {
      try {
        const items = await zoho.listItems(acc);
        for (const it of items) {
          const key = `${it.name}`.toLowerCase();
          if (!merged.has(key)) merged.set(key, { id: it.id, name: it.name, sku: it.sku, accountIds: [acc.id] });
          else merged.get(key).accountIds.push(acc.id);
        }
      } catch (err) {
        errors.push(`[${acc.name}] ${err.message}`);
      }
    })
  );

  res.json({ items: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)), errors });
});

router.post("/api/sync", async (req, res) => {
  const { accountIds, dateFrom, dateTo, productIds, docType } = req.body;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: "Selecciona al menos una cuenta de Zoho Books." });
  }
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: "Falta el rango de fechas." });
  }

  try {
    const { rows, stats } = await runSync({
      accountIds,
      dateFrom,
      dateTo,
      productIds: productIds || [],
      docType: docType || "invoices",
    });

    const runId = crypto.randomUUID();
    runStore.save(runId, { rows, username: req.session.username });

    res.json({ runId, rows, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/crosssell", async (req, res) => {
  const { accountId, docType, dateFrom, dateTo, customerId } = req.body;

  if (!accountId) return res.status(400).json({ error: "Selecciona una cuenta de Zoho Books." });
  if (!dateFrom || !dateTo) return res.status(400).json({ error: "Falta el rango de fechas." });
  if (!customerId || !String(customerId).trim()) {
    return res.status(400).json({ error: "Falta el Customer ID de Zoho." });
  }

  try {
    const result = await computeCrossSell({
      accountId,
      docType: docType || "invoices",
      dateFrom,
      dateTo,
      customerId: String(customerId).trim(),
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/export/:runId.csv", (req, res) => {
  const entry = runStore.get(req.params.runId);
  if (!entry) {
    return res.status(404).send("Ese resultado ya expiro, vuelve a correr la busqueda.");
  }
  const csv = rowsToCsv(entry.rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="contactos_kommo_${req.params.runId.slice(0, 8)}.csv"`);
  res.send(csv);
});

module.exports = router;
