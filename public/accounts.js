(function () {
  document.querySelectorAll(".test-conn-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const accountId = btn.dataset.accountId;
      const resultBox = btn.closest(".account-row").querySelector(".test-conn-result");
      btn.disabled = true;
      resultBox.textContent = "Probando…";
      resultBox.className = "test-conn-result muted";

      try {
        const res = await fetch(`/accounts/${accountId}/test`, { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          resultBox.textContent = `OK — Zoho respondio bien (${data.elapsedMs}ms).`;
          resultBox.className = "test-conn-result";
          resultBox.style.color = "var(--accent-2)";
        } else {
          resultBox.textContent = `Fallo: ${data.error}`;
          resultBox.className = "test-conn-result";
          resultBox.style.color = "var(--danger)";
        }
      } catch (err) {
        resultBox.textContent = `Error de red probando la conexion: ${err.message}`;
        resultBox.style.color = "var(--danger)";
      } finally {
        btn.disabled = false;
      }
    });
  });
})();
