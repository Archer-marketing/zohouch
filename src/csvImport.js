// Parser de CSV minimo (sin dependencias externas) para importar exports de
// Zoho Books (u otro sistema) y hacer venta cruzada sin gastar llamadas a la
// API de Zoho. Soporta comillas, comas y saltos de linea dentro de campos
// entre comillas (RFC4180 basico), y quita el BOM si el archivo lo trae.

function parseCsv(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];

    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignorado, \r\n se maneja con el \n de abajo
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const filtered = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (filtered.length === 0) return { headers: [], rows: [] };

  const headers = filtered[0].map((h) => h.trim());
  const dataRows = filtered.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx].trim() : "";
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

// Intenta normalizar una fecha de CSV (formatos comunes de export: ISO,
// DD/MM/YYYY, MM/DD/YYYY) a "YYYY-MM-DD" para poder compararla como string
// contra los rangos elegidos en el panel.
function normalizeDate(raw) {
  if (!raw) return "";
  const str = String(raw).trim();

  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    // Zoho Books exporta en formato DD/MM/YYYY por defecto en la mayoria de
    // regiones. Si el primer numero es > 12, no puede ser mes, asi que es DD/MM.
    let [, a, b, year] = slashMatch;
    let day = a.padStart(2, "0");
    let month = b.padStart(2, "0");
    if (Number(a) > 12) {
      day = a.padStart(2, "0");
      month = b.padStart(2, "0");
    } else if (Number(b) > 12) {
      day = b.padStart(2, "0");
      month = a.padStart(2, "0");
    }
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

module.exports = { parseCsv, normalizeDate };
