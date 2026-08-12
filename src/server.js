require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");

const auth = require("./auth");
const db = require("./db");
const accountsRouter = require("../routes/accounts");
const apiRouter = require("../routes/api");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 12, // 12 horas
      secure: process.env.NODE_ENV === "production" && process.env.TRUST_PROXY === "1",
    },
  })
);

if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

// ---------- Rutas publicas ----------

app.get("/login", (req, res) => res.render("login", { error: null }));
app.post("/login", auth.login);
app.post("/logout", auth.logout);

app.get("/", (req, res) => res.redirect("/dashboard"));

// Nota: /oauth/callback vive dentro de accountsRouter (mas abajo, protegido por
// requireLogin). Zoho redirige aqui en la MISMA pestaña donde el admin ya
// inicio sesion y le dio "Conectar", asi que la cookie de sesion sigue viva.

// ---------- A partir de aqui, todo requiere login ----------
app.use(auth.requireLogin);

app.get("/dashboard", (req, res) => {
  res.render("dashboard", { accounts: db.listAccounts(), username: req.session.username });
});

app.get("/crosssell", (req, res) => {
  res.render("crosssell", { accounts: db.listAccounts(), username: req.session.username });
});

app.use("/", accountsRouter);
app.use("/", apiRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Panel corriendo en http://localhost:${PORT}`);
  if (!process.env.MASTER_KEY) {
    console.warn(
      "AVISO: MASTER_KEY no esta configurada. Las cuentas de Zoho no se podran guardar hasta que la definas en el .env."
    );
  }
  if (!process.env.ADMIN_PASSWORD_HASH) {
    console.warn(
      "AVISO: ADMIN_PASSWORD_HASH no esta configurada. Corre `npm run hash-password` y ponla en el .env."
    );
  }
});
