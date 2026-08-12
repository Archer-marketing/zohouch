// Store de sesiones para express-session basado en un archivo JSON dentro de
// DATA_DIR (mismo patron que accounts.json/cache.json en db.js). Evita el
// warning de MemoryStore ("no scale past a single process") sin depender de
// Redis/Postgres, y de paso las sesiones sobreviven a redeploys si DATA_DIR
// esta montado en un volumen persistente.

const fs = require("fs");
const path = require("path");
const session = require("express-session");

class FileStore extends session.Store {
  constructor({ dataDir }) {
    super();
    this.file = path.join(dataDir, "sessions.json");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, "{}", "utf8");
  }

  _readAll() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      return raw.trim() ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  _writeAll(data) {
    const tmp = `${this.file}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, this.file);
  }

  get(sid, cb) {
    const entry = this._readAll()[sid];
    if (!entry) return cb(null, null);
    if (entry.expires && entry.expires < Date.now()) {
      this.destroy(sid, () => cb(null, null));
      return;
    }
    cb(null, entry.data);
  }

  set(sid, sessionData, cb) {
    const all = this._readAll();
    const maxAge = sessionData.cookie && sessionData.cookie.maxAge;
    all[sid] = { data: sessionData, expires: maxAge ? Date.now() + maxAge : null };
    this._writeAll(all);
    if (cb) cb();
  }

  destroy(sid, cb) {
    const all = this._readAll();
    delete all[sid];
    this._writeAll(all);
    if (cb) cb();
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }

  pruneExpired() {
    const all = this._readAll();
    const now = Date.now();
    let changed = false;
    for (const [sid, entry] of Object.entries(all)) {
      if (entry.expires && entry.expires < now) {
        delete all[sid];
        changed = true;
      }
    }
    if (changed) this._writeAll(all);
  }
}

module.exports = { FileStore };
