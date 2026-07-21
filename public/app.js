(function () {
  const accountsList = document.getElementById("accountsList");
  const productSelect = document.getElementById("productIds");
  const docTypeSelect = document.getElementById("docType");
  const dateFrom = document.getElementById("dateFrom");
  const dateTo = document.getElementById("dateTo");
  const btnSync = document.getElementById("btnSync");
  const btnCsv = document.getElementById("btnCsv");
  const spinner = document.getElementById("spinner");
  const statsBox = document.getElementById("statsBox");
  const errorsBox = document.getElementById("errorsBox");
  const tbody = document.querySelector("#resultsTable tbody");
  const emptyState = document.getElementById("emptyState");

  if (!accountsList) return; // no hay cuentas conectadas, no hay dashboard que armar

  const STORAGE_KEY = "zoho-kommo-panel:lastFilters";
  let currentRunId = null;

  function getCheckedAccounts() {
    return [...document.querySelectorAll(".acc-check:checked")].map((el) => el.value);
  }

  function todayISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function loadSavedFilters() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveFilters(filters) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }

  function applyInitialFilters() {
    const saved = loadSavedFilters();
    dateFrom.value = (saved && saved.dateFrom) || todayISO(-30);
    dateTo.value = (saved && saved.dateTo) || todayISO(0);
    docTypeSelect.value = (saved && saved.docType) || "invoices";

    if (saved && Array.isArray(saved.accountIds) && saved.accountIds.length) {
      document.querySelectorAll(".acc-check").forEach((el) => {
        el.checked = saved.accountIds.includes(el.value) && !el.disabled;
      });
    }
  }

  async function loadProducts() {
    const accountIds = getCheckedAccounts();
    productSelect.innerHTML = "";
    if (accountIds.length === 0) return;

    const res = await fetch(`/api/products?accounts=${accountIds.join(",")}`);
    const data = await res.json();
    (data.items || []).forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.sku ? `${item.name} (${item.sku})` : item.name;
      productSelect.appendChild(opt);
    });

    const saved = loadSavedFilters();
    if (saved && Array.isArray(saved.productIds)) {
      [...productSelect.options].forEach((opt) => {
        opt.selected = saved.productIds.includes(opt.value);
      });
    }
  }

  function renderResults(rows) {
    tbody.innerHTML = "";
    if (!rows || rows.length === 0) {
      emptyState.style.display = "block";
      emptyState.textContent = "Sin resultados para esos filtros.";
      return;
    }
    emptyState.style.display = "none";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.company)}</td>
        <td>${escapeHtml(r.products)}</td>
        <td>${r.purchaseCount}</td>
        <td>${escapeHtml(r.lastPurchaseDate)}</td>
        <td>${escapeHtml(r.accounts)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderStats(stats) {
    if (!stats) {
      statsBox.innerHTML = "";
      return;
    }
    statsBox.innerHTML = `
      <span>Cuentas revisadas: <strong>${stats.accountsProcessed}</strong></span>
      <span>Documentos revisados: <strong>${stats.docsScanned}</strong></span>
      <span>Documentos con el producto: <strong>${stats.docsMatched}</strong></span>
      <span>Contactos únicos con teléfono: <strong>${stats.contactsMatched}</strong></span>
    `;
    errorsBox.innerHTML = (stats.errors || [])
      .map((e) => `<div class="error" style="margin-top:8px;">${escapeHtml(e)}</div>`)
      .join("");
  }

  async function runSync() {
    const accountIds = getCheckedAccounts();
    if (accountIds.length === 0) {
      alert("Selecciona al menos una cuenta conectada.");
      return;
    }
    const filters = {
      accountIds,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      productIds: [...productSelect.selectedOptions].map((o) => o.value),
      docType: docTypeSelect.value,
    };
    saveFilters(filters);

    spinner.style.display = "inline";
    btnSync.disabled = true;
    btnCsv.disabled = true;

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");

      currentRunId = data.runId;
      renderResults(data.rows);
      renderStats(data.stats);
      btnCsv.disabled = data.rows.length === 0;
    } catch (err) {
      errorsBox.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
    } finally {
      spinner.style.display = "none";
      btnSync.disabled = false;
    }
  }

  btnSync.addEventListener("click", runSync);
  btnCsv.addEventListener("click", () => {
    if (!currentRunId) return;
    window.location.href = `/api/export/${currentRunId}.csv`;
  });
  accountsList.addEventListener("change", loadProducts);

  // Al entrar al panel: aplica los ultimos filtros usados y dispara un sync
  // automatico, para que siempre veas datos frescos de Zoho sin tener que
  // configurar todo de nuevo cada vez.
  applyInitialFilters();
  loadProducts().then(() => {
    if (getCheckedAccounts().length > 0) runSync();
  });
})();
