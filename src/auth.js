// Login simple de un solo usuario admin, con sesion via cookie (express-session).
// El password nunca se guarda en texto plano: se guarda un hash scrypt en
// ADMIN_PASSWORD_HASH (variable de entorno), generado con `npm run hash-password`.

const crypto = require("crypto");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect("/login");
}

function login(req, res) {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || "";
  const adminHash = process.env.ADMIN_PASSWORD_HASH || "";

  if (!adminUser || !adminHash) {
    return res.render("login", {
      error:
        "El panel no tiene ADMIN_USER / ADMIN_PASSWORD_HASH configurados en el .env todavia.",
    });
  }

  if (username === adminUser && verifyPassword(password || "", adminHash)) {
    req.session.loggedIn = true;
    req.session.username = username;
    return res.redirect("/dashboard");
  }
  return res.render("login", { error: "Usuario o contraseña incorrectos." });
}

function logout(req, res) {
  req.session.destroy(() => res.redirect("/login"));
}

module.exports = { hashPassword, verifyPassword, requireLogin, login, logout };
