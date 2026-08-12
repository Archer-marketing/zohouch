const express = require("express");
const crypto = require("crypto");
const db = require("../src/db");
const zoho = require("../src/zoho");
const { runSync, computeCrossSell } = require("../src/sync");
const { rowsToCsv } = require("../src/csv");
const runStore = require("../src/runStore");
const progressStore = require("../src/progressStore");

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

// Venta cruzada corre como "trabajo en segundo plano": este endpoint solo
// arranca el trabajo y devuelve un jobId al toque. El frontend consulta
// /api/crosssell/status/:jobId cada 1-2s para ver progreso en tiempo real
// (incluyendo si Zoho esta frenando/bloqueando las consultas) en vez de
// quedarse una sola espera larga y ciega hasta que termine todo.
router.post("/api/crosssell/start", (req, res) => {
  const { accountId, docType, dateFrom, dateTo, recDateFrom, recDateTo, customerId } = req.body;

  if (!accountId) return res.status(400).json({ error: "Selecciona una cuenta de Zoho Books." });
  if (!dateFrom || !dateTo) return res.status(400).json({ error: "Falta el rango de fechas del cliente." });
  if (!customerId || !String(customerId).trim()) {
    return res.status(400).json({ error: "Falta el Customer ID de Zoho." });
  }

  const jobId = crypto.randomUUID();
  progressStore.create(jobId);

  computeCrossSell({
    accountId,
    docType: docType || "invoices",
    dateFrom,
    dateTo,
    recDateFrom: recDateFrom || dateFrom,
    recDateTo: recDateTo || dateTo,
    customerId: String(customerId).trim(),
    onStatus: (message) => progressStore.update(jobId, message),
  })
    .then((result) => progressStore.finish(jobId, result))
    .catch((err) => {
      console.error(err);
      progressStore.fail(jobId, err.message);
    });

  res.json({ jobId });
});

router.get("/api/crosssell/status/:jobId", (req, res) => {
  const job = progressStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Ese trabajo ya no existe (expiro o el servidor se reinicio)." });
  res.json(job);
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
