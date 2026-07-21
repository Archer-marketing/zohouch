# Panel Zoho Books → Kommo

Panel web (Node.js + Express) para cruzar quién compró uno o varios productos
en un periodo de fechas, en una o varias organizaciones de Zoho Books, y
exportar un CSV con teléfonos únicos (sin duplicados) listo para importar
contactos en Kommo.

## Qué hace

1. Te conectas a una o varias cuentas de Zoho Books (multi-organización).
2. Eliges producto(s) y rango de fechas.
3. El panel revisa facturas o pedidos de venta en ese rango, se queda con los
   que incluyen el/los producto(s) elegidos, y saca el teléfono del contacto
   asociado.
4. Deduplica por teléfono (si la misma persona compró varias veces, o en
   varias cuentas, sale una sola vez con el conteo de compras).
5. Descargas un CSV listo para el importador de contactos de Kommo.
6. Cada vez que abres el panel, vuelve a consultar Zoho automáticamente con
   los últimos filtros usados (no queda data vieja mostrada).

## Stack

Node.js + Express + EJS. Sin base de datos externa: las cuentas configuradas
y el cache de sincronización se guardan en archivos JSON dentro de
`DATA_DIR` (cifrados los secretos con AES-256-GCM usando `MASTER_KEY`).

---

## 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Completa:

- `SESSION_SECRET`: cualquier string largo random.
- `MASTER_KEY`: generar con
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  **Si la pierdes, tienes que reconectar todas las cuentas de Zoho de nuevo.**
- `ADMIN_USER` y `ADMIN_PASSWORD_HASH`: corre `npm run hash-password`, te pide
  la contraseña y te da la línea para pegar en el `.env`.
- `PUBLIC_BASE_URL`: la URL pública final del panel (la que le vas a poner en
  EasyPanel), por ejemplo `https://panel.tudominio.com`. Se usa para armar el
  redirect URI del OAuth de Zoho.

## 2. Crear un Self Client en Zoho para cada cuenta de Books

Zoho Books no te deja "solo leer" sin registrar una app OAuth. Por cada
organización de Zoho Books que quieras conectar:

1. Entra a la [Zoho API Console](https://api-console.zoho.com/) **con la
   cuenta dueña de esa organización de Books**.
2. Crea un cliente tipo **Server-based Applications**.
3. En **Authorized Redirect URIs** agrega exactamente:
   `https://TU-DOMINIO/oauth/callback` (el que verás también dentro del panel
   en la pantalla "Cuentas Zoho").
4. Guarda el **Client ID** y **Client Secret** que te da Zoho — los vas a
   pegar en el panel.
5. Anota el **Organization ID** de esa cuenta de Books (Configuración →
   Perfil de la organización, o en la URL cuando entras a Books).

Repite esto por cada organización distinta que quieras poder consultar desde
el panel.

## 3. Correr en local (opcional, para probar antes de subir)

```bash
npm install
npm start
```

Abre `http://localhost:3000`, inicia sesión con tu usuario/contraseña admin,
ve a **Cuentas Zoho**, agrega una cuenta (nombre, región, Organization ID,
Client ID, Client Secret) y dale **Conectar** — te manda a la pantalla de
consentimiento de Zoho. Al aceptar, vuelve automáticamente y queda marcada
como "Conectada".

## 4. Subir a GitHub

```bash
cd zoho-kommo-panel
git init
git add .
git commit -m "Panel inicial Zoho Books -> Kommo"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/zoho-kommo-panel.git
git push -u origin main
```

El `.gitignore` ya excluye `node_modules/`, `data/` (tus cuentas y cache) y
`.env` — nunca subas esos.

## 5. Desplegar en EasyPanel

1. En EasyPanel, crea un nuevo servicio tipo **App** desde tu repo de GitHub
   (o desde Dockerfile — el repo ya incluye uno).
2. Build: usa el `Dockerfile` incluido (no requiere configuración extra,
   corre `npm install` y luego `node src/server.js`).
3. Puerto interno: `3000` (o el que pongas en `PORT`).
4. Variables de entorno: copia todas las de tu `.env` (`SESSION_SECRET`,
   `MASTER_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `PUBLIC_BASE_URL`, y
   además `TRUST_PROXY=1` porque EasyPanel sirve detrás de un proxy).
5. **Volumen persistente**: monta un volumen en `/app/data` (el `DATA_DIR`
   que usa el Dockerfile). Si no, cada redeploy borra las cuentas conectadas.
6. Configura el dominio/subdominio y activa HTTPS (Let's Encrypt) en
   EasyPanel.
7. Una vez desplegado, ve a la Zoho API Console y confirma que el
   **Authorized Redirect URI** de cada Self Client sea exactamente
   `https://tu-dominio-real/oauth/callback` (con HTTPS, sin barra final
   distinta a la registrada).
8. Entra al panel en producción, ve a **Cuentas Zoho** y conecta cada cuenta
   (el flujo OAuth es el mismo que en local, solo que ahora con tu dominio
   real).

## 6. Conectarlo con Claude Code para seguir desarrollándolo

Ya con el repo en GitHub:

```bash
git clone https://github.com/TU-USUARIO/zoho-kommo-panel.git
cd zoho-kommo-panel
claude
```

Dentro de Claude Code puedes pedirle cosas como "agrega un filtro por
vendedor", "cambia el formato del CSV", "agrega Sales Orders con estado
específico", etc. — el código está comentado en español explicando el
porqué de cada decisión (por ejemplo, por qué se usa detalle por documento en
vez de un filtro directo por producto, ya que la API de Zoho Books no lo
soporta en el listado).

## Notas importantes / limitaciones a tener en cuenta

- **Por qué se consulta el detalle de cada factura/pedido**: la API de Zoho
  Books no permite filtrar el listado de facturas o pedidos directamente por
  producto/item, así que el panel trae el listado por fecha y luego pide el
  detalle de cada uno para revisar sus líneas. Para no repetir esto en cada
  sync, se cachea por `last_modified_time`: si un documento no cambió desde
  la última vez, no se vuelve a pedir el detalle completo.
- **Teléfono**: se usa `mobile` si existe, si no `phone`, tomados del
  contacto en Zoho Books (Configuración → Contactos → campo Teléfono/Móvil).
  Si un contacto no tiene ninguno de los dos, no aparece en el CSV (no sirve
  para difusión).
- **Rate limits de Zoho**: en catálogos grandes con muchas facturas en el
  rango de fechas, la primera sincronización puede tardar (se consulta
  detalle uno por uno, con 5 en paralelo). Las siguientes son más rápidas
  gracias al cache.
- **CSV para Kommo**: Kommo te deja mapear columnas al importar, así que basta
  con abrir el importador de contactos, subir el CSV descargado y mapear
  `Telefono` al campo de teléfono.
- Verifica los parámetros exactos de la API de Zoho Books
  (`filter_by=Date.CustomDate`, nombres de campos, etc.) contra la
  [documentación oficial](https://www.zoho.com/books/api/v3/) al momento de
  integrar, por si Zoho cambió algo desde que se escribió este panel.
