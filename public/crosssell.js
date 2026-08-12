(function () {
  const accountSelect = document.getElementById("csAccount");
  const docTypeSelect = document.getElementById("csDocType");
  const dateFrom = document.getElementById("csDateFrom");
  const dateTo = document.getElementById("csDateTo");
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

  // Por defecto, 90 dias hacia atras: suficiente historial para detectar
  // clientes similares sin tardar demasiado. Rangos mas largos = mas
  // documentos = mas lento (ver throttle de Zoho en src/zoho.js).
  dateFrom.value = todayISO(-90);
  dateTo.value = todayISO(0);

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
      <span>Clientes en el rango: <strong>${stats.customersInRange}</strong></span>
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

    // Contador visible: con rangos grandes puede tardar varios minutos
    // (Zoho limita a 100 requests/minuto), y sin esto la pantalla parece
    // colgada aunque siga trabajando.
    const startedAt = Date.now();
    function updateSpinnerText() {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      spinner.textContent = `Consultando Zoho Books… (${secs}s — con muchos documentos puede tardar varios minutos, no cierres esta pestaña)`;
    }
    updateSpinnerText();
    const spinnerInterval = setInterval(updateSpinnerText, 1000);

    try {
      const res = await fetch("/api/crosssell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          docType: docTypeSelect.value,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value,
          customerId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");

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
