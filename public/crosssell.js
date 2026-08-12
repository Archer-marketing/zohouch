(function () {
  const accountSelect = document.getElementById("csAccount");
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
  const customerCard = document.getElementById("csCustomerCard");
  const customerName = document.getElementById("csCustomerName");
  const purchasesBody = document.querySelector("#csPurchasesTable tbody");
  const recCard = document.getElementById("csRecCard");
  const recBody = document.querySelector("#csRecTable tbody");
  const emptyState = document.getElementById("csEmptyState");

  if (!accountSelect) return; // no hay cuentas conectadas, no hay formulario que armar

  function todayISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  // Compras del cliente: 90 dias hacia atras por defecto.
  dateFrom.value = todayISO(-90);
  dateTo.value = todayISO(0);

  // Recomendaciones: ventana mas corta (30 dias) por defecto, para que sean
  // sobre lo que se esta vendiendo ahora y no todo el historial. Ademas de
  // mas relevante, es mas rapido (menos documentos que revisar).
  recDateFrom.value = todayISO(-30);
  recDateTo.value = todayISO(0);

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderStats(stats, found) {
    if (!stats) {
      statsBox.innerHTML = "";
      return;
    }
    statsBox.innerHTML = `
      <span>Documentos revisados: <strong>${stats.docsScanned}</strong></span>
      <span>Clientes en el rango de recomendaciones: <strong>${stats.customersInRecRange}</strong></span>
      ${found ? `<span>Clientes similares: <strong>${stats.similarCustomers}</strong></span>` : ""}
    `;
    errorsBox.innerHTML = (stats.errors || [])
      .map((e) => `<div class="error" style="margin-top:8px;">${escapeHtml(e)}</div>`)
      .join("");
  }

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
    customerCard.style.display = "none";
    recCard.style.display = "none";
    emptyState.style.display = "none";

    // En vez de una sola espera larga y ciega, arrancamos el trabajo en el
    // servidor y consultamos su progreso real cada 1.5s (incluye avisos de
    // "Zoho me esta frenando/bloqueando" en tiempo real, no solo un contador
    // de segundos).
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
      renderStats(data.stats, data.found);

      if (!data.found) {
        emptyState.style.display = "block";
        emptyState.textContent = "Ese cliente no tiene compras registradas en ese rango de fechas para esa cuenta.";
        return;
      }

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
