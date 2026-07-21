// Guarda temporalmente (en memoria) el resultado del ultimo sync para poder
// exportarlo a CSV sin tener que volver a pedirle todo el dataset al frontend.
// No se persiste a disco: es un cache de corta duracion (limpieza cada hora).

const runs = new Map(); // runId -> { rows, createdAt, username }

function save(runId, data) {
  runs.set(runId, { ...data, createdAt: Date.now() });
}

function get(runId) {
  return runs.get(runId);
}

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hora
  for (const [id, entry] of runs.entries()) {
    if (entry.createdAt < cutoff) runs.delete(id);
  }
}, 10 * 60 * 1000).unref();

module.exports = { save, get };
