// Cifrado simetrico (AES-256-GCM) para no guardar client_secret / refresh_token
// en texto plano dentro de data/accounts.json.
//
// La MASTER_KEY vive solo en la variable de entorno del VPS (.env), nunca en
// el repo. Si se pierde la MASTER_KEY, hay que reconectar las cuentas de Zoho
// de nuevo (no hay forma de recuperar los secretos cifrados).

const crypto = require("crypto");

const ALGO = "aes-256-gcm";

function getKey() {
  const raw = (process.env.MASTER_KEY || "").trim();
  if (!raw || raw.length < 32) {
    throw new Error(
      "MASTER_KEY no esta configurada (o es muy corta). Genera una con: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  // Acepta una clave hex de 64 chars (32 bytes) o cualquier string >=32 chars
  // (en ese caso se deriva con sha256 para llegar a 32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(plainText) {
  if (plainText === null || plainText === undefined) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // formato: iv:tag:ciphertext (todo en base64)
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

function decrypt(payload) {
  if (!payload) return null;
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Payload cifrado con formato invalido");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
