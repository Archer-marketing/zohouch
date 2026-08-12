(function () {
  function todayISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------- Resultados compartidos por los dos modos (en vivo / CSV) ----------
  const customerCard = document.getElementById("csCustomerCard");
  const customerName = document.getElementById("csCustomerName");
  const purchasesBody = document.querySelector("#csPurchasesTable tbody");
  const recCard = document.getElementById("csRecCard");
  const recBody = document.querySelector("#csRecTable tbody");
  const emptyState = document.getElementById("csEmptyState");

  function renderStatsInto(box, errorsBox, stats, found, docsLabel) {
    if (!stats) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `
      <span>${docsLabel}: <strong>${stats.docsScanned}</strong></span>
      <span>Clientes en el rango de recomendaciones: <strong>${stats.customersInRecRange}</strong></span>
      ${found ? `<span>Clientes similares: <strong>${stats.similarCustomers}</strong></span>` : ""}
    `;
    errorsBox.innerHTML = (stats.errors || [])
      .map((e) => `<div class="error" style="margin-top:8px;">${escapeHtml(e)}</div>`)
      .join("");
  }

  function renderResult(data, notFoundMessage) {
    if (!data.found) {
      customerCard.style.display = "none";
      recCard.style.display = "none";
      emptyState.style.display = "block";
      emptyState.textContent = notFoundMessage;
      return;
    }

    emptyState.style.display = "none";
    customerCard.style.display = "block";
    customerName.textContent = data.customer.name
      ? `${data.customer.name} (${data.customer.docCount} documentos en el rango)`
      : `Cliente ${data.customer.id}`;
    purchasesBody.innerHTML = data.purchases
      .map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sku)}</td><td>${p.quantity}</td></tr>`)
      .join("");

    recCard.style.display = "block";
    if (data.recommendations.length === 0) {
      recBody.innerHTML = `<tr><td colspan="3" class="muted">No se encontraron clientes con productos en común en este rango.</td></tr>`;
    } else {
      recBody.innerHTML = data.recommendations
        .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.sku)}</td><td>${r.coBuyers}</td></tr>`)
        .join("");
    }
  }

  function resetResults() {
    customerCard.style.display = "none";
    recCard.style.display = "none";
    emptyState.style.display = "none";
  }

  // ---------- Toggle de modo ----------
  const modeLive = document.getElementById("csModeLive");
  const modeCsv = document.getElementById("csModeCsv");
  const livePanel = document.getElementById("csLivePanel");
  const csvPanel = document.getElementById("csCsvPanel");

  function applyMode() {
    const isCsv = modeCsv.checked;
    livePanel.style.display = isCsv ? "none" : "";
    csvPanel.style.display = isCsv ? "" : "none";
    resetResults();
  }
  if (modeLive && modeCsv) {
    modeLive.addEventListener("change", applyMode);
    modeCsv.addEventListener("change", applyMode);
  }

  // ==================== MODO EN VIVO (Zoho API) ====================
  (function initLiveMode() {
    const accountSelect = document.getElementById("csAccount");
    if (!accountSelect) return; // no hay cuentas conectadas, no hay formulario que armar

    const docTypeSelect = document.getElementById("csDocType");
    const dateFrom = document.getElementById("csDateFrom");
    const dateTo = document.getElementById("csDateTo");
    const recDateFrom = document.getElementById("csRecDateFrom");
    const recDateTo = document.getElementById("csRecDateTo");
    const customerIdInput = document.getElementById("csCustomerId");
    const btn = document.getElementById("csBtn");
    const spinner = document.getElementById("csSpinner");
    const errorsBox = document.getElementById("csErrors");
    const statsBox = document.getElementById("csStats");

    dateFrom.value = todayISO(-90);
    dateTo.value = todayISO(0);
    recDateFrom.value = todayISO(-30);
    recDateTo.value = todayISO(0);

    async function runCrossSell() {
      const accountId = accountSelect.value;
      const customerId = customerIdInput.value.trim();
      if (!accountId) {
        alert("Selecciona una cuenta conectada.");
        return;
      }
      if (!customerId) {
        alert("Pega el Customer ID de Zoho.");
        return;
      }

      spinner.style.display = "inline";
      btn.disabled = true;
      errorsBox.innerHTML = "";
      statsBox.innerHTML = "";
      resetResults();

      const startedAt = Date.now();
      let lastMessage = "Iniciando…";
      function renderSpinner() {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        spinner.textContent = `${lastMessage} (${secs}s)`;
      }
      renderSpinner();
      const spinnerInterval = setInterval(renderSpinner, 1000);

      try {
        const startRes = await fetch("/api/crosssell/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            docType: docTypeSelect.value,
            dateFrom: dateFrom.value,
            dateTo: dateTo.value,
            recDateFrom: recDateFrom.value,
            recDateTo: recDateTo.value,
            customerId,
          }),
        });
        const startData = await startRes.json();
        if (!startRes.ok) throw new Error(startData.error || "Error desconocido");

        const jobId = startData.jobId;
        let job;
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const statusRes = await fetch(`/api/crosssell/status/${jobId}`);
          job = await statusRes.json();
          if (!statusRes.ok) throw new Error(job.error || "Error consultando el progreso.");
          if (job.message) lastMessage = job.message;
          if (job.done) break;
        }

        if (job.error) throw new Error(job.error);

        const data = job.result;
        renderStatsInto(statsBox, errorsBox, data.stats, data.found, "Documentos revisados");
        renderResult(data, "Ese cliente no tiene compras registradas en ese rango de fechas para esa cuenta.");
      } catch (err) {
        errorsBox.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      } finally {
        clearInterval(spinnerInterval);
        spinner.style.display = "none";
        spinner.textContent = "Consultando Zoho Books…";
        btn.disabled = false;
      }
    }

    btn.addEventListener("click", runCrossSell);
  })();

  // ==================== MODO CSV (sin API) ====================
  (function initCsvMode() {
    const fileInput = document.getElementById("csvFile");
    if (!fileInput) return;

    const fileStatus = document.getElementById("csvFileStatus");
    const mappingCard = document.getElementById("csvMappingCard");
    const colCustomer = document.getElementById("csvColCustomer");
    const colItem = document.getElementById("csvColItem");
    const colSku = document.getElementById("csvColSku");
    const colQuantity = document.getElementById("csvColQuantity");
    const colDate = document.getElementById("csvColDate");
    const loadCustomersBtn = document.getElementById("csvLoadCustomersBtn");
    const mappingStatus = document.getElementById("csvMappingStatus");
    const runCard = document.getElementById("csvRunCard");
    const customerList = document.getElementById("csvCustomerList");
    const customerInput = document.getElementById("csvCustomerInput");
    const dateFrom = document.getElementById("csvDateFrom");
    const dateTo = document.getElementById("csvDateTo");
    const recDateFrom = document.getElementById("csvRecDateFrom");
    const recDateTo = document.getElementById("csvRecDateTo");
    const btn = document.getElementById("csvBtn");
    const spinner = document.getElementById("csvSpinner");
    const errorsBox = document.getElementById("csvErrors");
    const statsBox = document.getElementById("csvStats");

    dateFrom.value = todayISO(-90);
    dateTo.value = todayISO(0);
    recDateFrom.value = todayISO(-30);
    recDateTo.value = todayISO(0);

    let csvText = "";

    function guessColumn(headers, keywords) {
      const lower = headers.map((h) => h.toLowerCase());
      for (const kw of keywords) {
        const idx = lower.findIndex((h) => h.includes(kw));
        if (idx !== -1) return headers[idx];
      }
      return "";
    }

    function fillSelect(select, headers, guess, allowEmpty) {
      select.innerHTML = "";
      if (allowEmpty) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "— Ninguna —";
        select.appendChild(opt);
      }
      headers.forEach((h) => {
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = h;
        if (h === guess) opt.selected = true;
        select.appendChild(opt);
      });
    }

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      mappingCard.style.display = "none";
      runCard.style.display = "none";
      resetResults();
      if (!file) return;

      fileStatus.textContent = "Leyendo archivo…";
      try {
        csvText = await file.text();
        const res = await fetch("/api/crosssell/csv-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csvText }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo leer el CSV.");

        fileStatus.textContent = `${file.name} — ${data.rowCount} filas detectadas.`;

        fillSelect(colCustomer, data.headers, guessColumn(data.headers, ["cliente", "customer", "contact"]), false);
        fillSelect(colItem, data.headers, guessColumn(data.headers, ["item", "producto", "product"]), false);
        fillSelect(colSku, data.headers, guessColumn(data.headers, ["sku"]), true);
        fillSelect(colQuantity, data.headers, guessColumn(data.headers, ["quantity", "cantidad", "qty"]), false);
        fillSelect(colDate, data.headers, guessColumn(data.headers, ["date", "fecha"]), false);

        mappingCard.style.display = "block";
      } catch (err) {
        fileStatus.textContent = `Error: ${err.message}`;
      }
    });

    function currentMapping() {
      return {
        customer: colCustomer.value,
        item: colItem.value,
        sku: colSku.value || undefined,
        quantity: colQuantity.value,
        date: colDate.value,
      };
    }

    loadCustomersBtn.addEventListener("click", async () => {
      mappingStatus.textContent = "Cargando…";
      try {
        const res = await fetch("/api/crosssell/csv-customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csvText, mapping: currentMapping() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo leer el CSV.");

        customerList.innerHTML = data.customers.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
        mappingStatus.textContent = `${data.customers.length} clientes distintos encontrados.`;
        runCard.style.display = "block";
      } catch (err) {
        mappingStatus.textContent = `Error: ${err.message}`;
      }
    });

    async function runCsvCrossSell() {
      const customerNameVal = customerInput.value.trim();
      if (!customerNameVal) {
        alert("Elegí un cliente de la lista.");
        return;
      }

      spinner.style.display = "inline";
      btn.disabled = true;
      errorsBox.innerHTML = "";
      statsBox.innerHTML = "";
      resetResults();

      try {
        const res = await fetch("/api/crosssell/csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csvText,
            mapping: currentMapping(),
            customerName: customerNameVal,
            dateFrom: dateFrom.value,
            dateTo: dateTo.value,
            recDateFrom: recDateFrom.value,
            recDateTo: recDateTo.value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error desconocido");

        renderStatsInto(statsBox, errorsBox, data.stats, data.found, "Filas de CSV analizadas");
        renderResult(data, "Ese cliente no tiene compras registradas en ese rango de fechas dentro del CSV.");
      } catch (err) {
        errorsBox.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      } finally {
        spinner.style.display = "none";
        btn.disabled = false;
      }
    }

    btn.addEventListener("click", runCsvCrossSell);
  })();
})();
