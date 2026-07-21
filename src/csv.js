// Genera el CSV para importar contactos en Kommo.
// Kommo deja mapear columnas manualmente al importar, asi que usamos
// encabezados claros en español. La columna "Phone" es la que vas a mapear
// al campo de telefono del contacto/lead en el importador de Kommo.

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows) {
  const headers = [
    "Nombre",
    "Telefono",
    "Email",
    "Empresa",
    "Productos",
    "N_Compras",
    "Ultima_Compra",
    "Cuenta_Zoho",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.phone,
        r.email,
        r.company,
        r.products,
        r.purchaseCount,
        r.lastPurchaseDate,
        r.accounts,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  // BOM para que Excel/Kommo detecten UTF-8 correctamente (acentos, ñ).
  return "﻿" + lines.join("\r\n");
}

module.exports = { rowsToCsv };
