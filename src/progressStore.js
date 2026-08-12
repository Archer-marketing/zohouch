// Guarda en memoria el progreso de trabajos largos (venta cruzada) para que
// el frontend pueda consultarlo mientras corre, en vez de quedarse a ciegas
// esperando una sola respuesta al final. No se persiste a disco: es un
// estado de corta duracion, se limpia solo despues de un rato.

const jobs = new Map(); // jobId -> { message, done, error, result, updatedAt }

function create(jobId) {
  jobs.set(jobId, {
    message: "Iniciando…",
    done: false,
    error: null,
    result: null,
    updatedAt: Date.now(),
  });
}

function update(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.message = message;
  job.updatedAt = Date.now();
}

function finish(jobId, result) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  job.result = result;
  job.updatedAt = Date.now();
}

function fail(jobId, error) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  job.error = error;
  job.updatedAt = Date.now();
}

function get(jobId) {
  return jobs.get(jobId);
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 min
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

module.exports = { create, update, finish, fail, get };
