#!/usr/bin/env node
// Genera el hash para meter en ADMIN_PASSWORD_HASH del .env
// Uso: npm run hash-password  (te pregunta la contraseña)
//   o: node scripts/hash-password.js "miPasswordSecreto"

const readline = require("readline");
const { hashPassword } = require("../src/auth");

async function main() {
  const argPassword = process.argv[2];
  let password = argPassword;

  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await new Promise((resolve) =>
      rl.question("Contraseña admin del panel: ", (answer) => {
        rl.close();
        resolve(answer);
      })
    );
  }

  if (!password) {
    console.error("No se recibio ninguna contraseña.");
    process.exit(1);
  }

  const hash = hashPassword(password);
  console.log("\nCopia esta linea a tu .env:\n");
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
}

main();
