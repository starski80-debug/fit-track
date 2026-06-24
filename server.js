const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { createStore, defaultCatalog } = require("./db");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const publicDir = path.join(__dirname, "public");
const store = createStore();
const appPassword = process.env.APP_PASSWORD || "";
const authSecret = process.env.AUTH_SECRET || crypto.createHash("sha256").update(appPassword || "fittrack-local").digest("hex");
const isProduction = Boolean(process.env.DATABASE_URL);
const loginAttempts = new Map();
const phases = new Set(["warmup", "main", "cooldown"]);
const operators = new Set(["Leonardo", "Michele", "Giulia"]);
let ready = false;
let shuttingDown = false;
const loginCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of loginAttempts) {
    if (value.resetAt <= now) loginAttempts.delete(key);
  }
}, 15 * 60_000);
loginCleanup.unref();

if (isProduction && (!appPassword || appPassword.length < 10)) {
  throw new Error("Su Railway devi configurare APP_PASSWORD con almeno 10 caratteri.");
}

const json = (res, status, body, headers = {}) => {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    ...headers
  });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  let settled = false;
  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    const error = new Error(message);
    error.status = status;
    reject(error);
  };
  req.on("data", (chunk) => {
    if (settled) return;
    raw += chunk;
    if (Buffer.byteLength(raw) > 1_000_000) fail(413, "Richiesta troppo grande.");
  });
  req.on("end", () => {
    if (settled) return;
    settled = true;
    try { resolve(raw ? JSON.parse(raw) : {}); } catch {
      const error = new Error("Dati JSON non validi.");
      error.status = 400;
      reject(error);
    }
  });
  req.on("error", () => fail(400, "Richiesta non valida."));
});

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authToken() {
  return crypto.createHmac("sha256", authSecret).update("fittrack-auth-v1").digest("hex");
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

function isAuthenticated(req) {
  if (!appPassword) return true;
  return secureEqual(cookies(req).fittrack_session || "", authToken());
}

function cookieHeader(value, maxAge) {
  return `fittrack_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProduction ? "; Secure" : ""}`;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanPhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").slice(0, 30);
}

function finiteNumber(value, min, max) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function validDate(value) {
  const date = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizePerson(body) {
  return {
    name:cleanText(body.name, 100),
    color:/^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#6c63ff",
    birthDate:body.birthDate ? validDate(body.birthDate) : "",
    height:finiteNumber(body.height, 0, 300),
    weight:finiteNumber(body.weight, 0, 1_000),
    notes:cleanText(body.notes, 2_000),
    phone:cleanPhone(body.phone)
  };
}

function normalizeWorkout(body) {
  return {
    personId:positiveInteger(body.personId),
    date:validDate(body.date),
    duration:finiteNumber(body.duration, 0, 1_440),
    rpe:finiteNumber(body.rpe, 0, 10),
    operator:operators.has(body.operator) ? body.operator : "",
    notes:cleanText(body.notes, 2_000),
    exercises:(Array.isArray(body.exercises) ? body.exercises.slice(0, 100) : [])
      .map((item) => ({
        phase:phases.has(item.phase) ? item.phase : "main",
        bodyArea:cleanText(item.bodyArea, 50) || "Altro",
        name:cleanText(item.name, 150),
        sets:finiteNumber(item.sets, 0, 1_000),
        reps:finiteNumber(item.reps, 0, 10_000),
        weight:finiteNumber(item.weight, 0, 10_000),
        seconds:finiteNumber(item.seconds, 0, 10_000)
      })).filter((item) => item.name)
  };
}

function normalizeSchedule(body) {
  const time = String(body.time || "").trim();
  return {
    personId:positiveInteger(body.personId),
    date:validDate(body.date),
    time:/^\d{2}:\d{2}$/.test(time) ? time : "",
    trainer:operators.has(body.trainer) ? body.trainer : "",
    notes:cleanText(body.notes, 500),
    status:["scheduled", "done"].includes(body.status) ? body.status : "scheduled"
  };
}

function normalizeWorkoutIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(positiveInteger)
    .filter(Boolean))]
    .slice(0, 20);
}

function clientAddress(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function loginAllowed(req) {
  const key = clientAddress(req);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count:0, resetAt:now + 15 * 60_000 });
    return true;
  }
  return current.count < 10;
}

function registerFailedLogin(req) {
  const key = clientAddress(req);
  const current = loginAttempts.get(key) || { count:0, resetAt:Date.now() + 15 * 60_000 };
  current.count += 1;
  loginAttempts.set(key, current);
}

function clearLoginAttempts(req) {
  loginAttempts.delete(clientAddress(req));
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || (isProduction ? "https" : "http")).split(",")[0];
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

function whatsappNumber(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function rpeHtml(workout) {
  const rows = [
    [10, "Maximum Effort", "#df0900"],
    [9, "Extremely Hard", "#ff5a00"],
    [8, "Really Hard", "#ffa400"],
    [7, "Hard", "#ffc043"],
    [6, "Sort of Hard", "#5b7f1c"],
    [5, "Challenging", "#9bd22d"],
    [4, "Moderate", "#c7e783"],
    [3, "Comfortable", "#0878ff"],
    [2, "Easy", "#63a8f4"],
    [1, "Very Easy", "#99c1f2"],
    [0, "Rest", "#f5f5f5"]
  ];
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FitTrack - RPE</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin:0; background:#f4f6fb; color:#081735; }
    main { max-width:430px; margin:0 auto; padding:18px 10px 28px; }
    .card { background:#fff; border:1px solid #dde3f0; border-radius:14px; overflow:hidden; box-shadow:0 18px 45px rgba(8,23,53,.08); }
    header { padding:22px 20px; background:#081735; color:#fff; }
    h1 { margin:0 0 6px; font-size:26px; }
    p { margin:0; color:#63708d; line-height:1.45; }
    header p { color:#cdd6ea; }
    .table { display:grid; border-top:1px solid rgba(8,23,53,.14); }
    button { width:100%; min-height:48px; border:0; border-bottom:1px solid rgba(8,23,53,.08); padding:11px 24px; text-align:left; font:inherit; font-size:23px; line-height:1.1; cursor:pointer; color:#101820; }
    button:active { transform:scale(.99); }
    button:focus-visible { outline:3px solid #081735; outline-offset:-5px; }
    button:disabled { cursor:wait; opacity:.72; }
    .result { padding:18px 20px 20px; font-weight:700; color:#1b8b5a; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <header>
        <h1>RPE - sforzo percepito</h1>
        <p>${escapeHtml(workout.person_name)} · allenamento del ${escapeHtml(workout.workout_date)}</p>
      </header>
      <div class="table">
        ${rows.map(([value, label, color]) => `<button type="button" data-rpe="${value}" style="background:${color}">${value} - ${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="result" id="result">${workout.rpe ? `RPE gia registrato: ${workout.rpe}` : "Scegli un valore per inviare la risposta."}</div>
    </section>
  </main>
  <script>
    const result = document.querySelector("#result");
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-rpe]");
      if (!button) return;
      document.querySelectorAll("button").forEach((item) => item.disabled = true);
      try {
        const response = await fetch("/api/rpe/${escapeHtml(workout.rpe_token)}", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({ rpe:Number(button.dataset.rpe) })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Errore");
        result.textContent = "Grazie, RPE " + button.dataset.rpe + " registrato.";
      } catch (error) {
        result.textContent = error.message || "Errore, riprova.";
        document.querySelectorAll("button").forEach((item) => item.disabled = false);
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
}

function validateMutationOrigin(req) {
  if (!isProduction || !["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function api(req, res, url) {
  const publicRpeMatch = url.pathname.match(/^\/api\/rpe\/([a-f0-9]{32,80})$/i);
  if (req.method === "POST" && publicRpeMatch) {
    const body = await readBody(req);
    const rpe = Number(body.rpe);
    if (!Number.isInteger(rpe) || rpe < 0 || rpe > 10) {
      return json(res, 400, { error:"Seleziona un valore RPE valido." });
    }
    if (!await store.setRpeByToken(publicRpeMatch[1], rpe)) {
      return json(res, 404, { error:"Link RPE non valido o scaduto." });
    }
    return json(res, 200, { ok:true });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    return json(res, 200, { authenticated:isAuthenticated(req), required:Boolean(appPassword) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!loginAllowed(req)) return json(res, 429, { error:"Troppi tentativi. Riprova tra alcuni minuti." });
    const body = await readBody(req);
    if (!appPassword || secureEqual(body.password || "", appPassword)) {
      clearLoginAttempts(req);
      return json(res, 200, { ok:true }, { "Set-Cookie":cookieHeader(authToken(), 60 * 60 * 24 * 30) });
    }
    registerFailedLogin(req);
    return json(res, 401, { error:"Password non corretta." });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    return json(res, 200, { ok:true }, { "Set-Cookie":cookieHeader("", 0) });
  }
  if (!isAuthenticated(req)) return json(res, 401, { error:"Accesso richiesto." });

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const data = await store.dashboard();
    const totalMinutes = data.workouts.reduce((sum, item) => sum + Number(item.duration), 0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    return json(res, 200, {
      ...data,
      stats:{
        workouts:data.workouts.length, people:data.people.length, minutes:totalMinutes,
        monthWorkouts:data.workouts.filter((item) => item.workout_date.startsWith(thisMonth)).length
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/people") {
    const body = normalizePerson(await readBody(req));
    if (!body.name) return json(res, 400, { error:"Inserisci il nome." });
    return json(res, 201, { id:await store.addPerson(body) });
  }
  const personMatch = url.pathname.match(/^\/api\/people\/(\d+)$/);
  if (req.method === "PUT" && personMatch) {
    const body = normalizePerson(await readBody(req));
    if (!body.name) return json(res, 400, { error:"Inserisci il nome." });
    if (!await store.updatePerson(Number(personMatch[1]), body)) {
      return json(res, 404, { error:"Persona non trovata." });
    }
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && personMatch) {
    if (!await store.deletePerson(Number(personMatch[1]))) {
      return json(res, 404, { error:"Persona non trovata." });
    }
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/catalog") {
    const body = await readBody(req);
    const area = cleanText(body.bodyArea, 50);
    const name = cleanText(body.name, 150);
    if (!area || !name) {
      return json(res, 400, { error:"Seleziona una zona e inserisci il nome dell'esercizio." });
    }
    try {
      return json(res, 201, { id:await store.addCatalog(area, name) });
    } catch (error) {
      if (String(error.message).toLowerCase().includes("unique") || error.code === "23505") {
        return json(res, 409, { error:"Questo esercizio e gia presente nella categoria." });
      }
      throw error;
    }
  }
  const catalogMatch = url.pathname.match(/^\/api\/catalog\/(\d+)$/);
  if (req.method === "DELETE" && catalogMatch) {
    if (!await store.deleteCatalog(Number(catalogMatch[1]))) {
      return json(res, 404, { error:"Esercizio non trovato." });
    }
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/schedule") {
    const body = normalizeSchedule(await readBody(req));
    if (!body.personId || !body.date || !body.time || !body.trainer) {
      return json(res, 400, { error:"Completa persona, data, orario e personal trainer." });
    }
    return json(res, 201, { id:await store.addSchedule(body) });
  }
  const scheduleMatch = url.pathname.match(/^\/api\/schedule\/(\d+)$/);
  if (req.method === "PUT" && scheduleMatch) {
    const body = normalizeSchedule(await readBody(req));
    if (!body.personId || !body.date || !body.time || !body.trainer) {
      return json(res, 400, { error:"Completa persona, data, orario e personal trainer." });
    }
    if (!await store.updateSchedule(Number(scheduleMatch[1]), body)) {
      return json(res, 404, { error:"Appuntamento non trovato." });
    }
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && scheduleMatch) {
    if (!await store.deleteSchedule(Number(scheduleMatch[1]))) {
      return json(res, 404, { error:"Appuntamento non trovato." });
    }
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/workouts") {
    const body = normalizeWorkout(await readBody(req));
    if (!body.personId || !body.date || !body.exercises.length) {
      return json(res, 400, { error:"Completa persona, data e almeno un esercizio." });
    }
    return json(res, 201, { id:await store.addWorkout(body) });
  }
  if (req.method === "PUT" && url.pathname === "/api/workout-groups") {
    const raw = await readBody(req);
    const ids = normalizeWorkoutIds(raw.workoutIds);
    const body = normalizeWorkout(raw);
    if (!ids.length || !body.personId || !body.date || !body.exercises.length) {
      return json(res, 400, { error:"Completa persona, data e almeno un esercizio." });
    }
    if (!await store.updateWorkoutGroup(ids, body)) {
      return json(res, 404, { error:"Allenamento non trovato." });
    }
    return json(res, 200, { ok:true });
  }
  if (req.method === "POST" && url.pathname === "/api/workout-groups/rpe-link") {
    const raw = await readBody(req);
    const ids = normalizeWorkoutIds(raw.workoutIds);
    if (!ids.length) return json(res, 400, { error:"Sessione non trovata." });
    const token = crypto.randomBytes(24).toString("hex");
    const workout = await store.prepareRpeGroupLink(ids, token);
    if (!workout) return json(res, 404, { error:"Sessione non trovata." });
    const phone = whatsappNumber(workout.person_phone);
    if (!phone) return json(res, 400, { error:"Inserisci il telefono WhatsApp nella scheda della persona." });
    const rpeUrl = `${publicBaseUrl(req)}/rpe/${workout.rpe_token || token}`;
    const message = `Ciao ${workout.person_name}, indica il tuo RPE per la sessione di allenamento del ${workout.workout_date}: ${rpeUrl}`;
    return json(res, 200, {
      ok:true,
      url:rpeUrl,
      whatsappUrl:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    });
  }
  const workoutMatch = url.pathname.match(/^\/api\/workouts\/(\d+)$/);
  if (req.method === "POST" && workoutMatch && url.pathname.endsWith("/rpe-link")) {
    return false;
  }
  const rpeLinkMatch = url.pathname.match(/^\/api\/workouts\/(\d+)\/rpe-link$/);
  if (req.method === "POST" && rpeLinkMatch) {
    const token = crypto.randomBytes(24).toString("hex");
    const workout = await store.prepareRpeLink(Number(rpeLinkMatch[1]), token);
    if (!workout) return json(res, 404, { error:"Allenamento non trovato." });
    const phone = whatsappNumber(workout.person_phone);
    if (!phone) return json(res, 400, { error:"Inserisci il telefono WhatsApp nella scheda della persona." });
    const rpeUrl = `${publicBaseUrl(req)}/rpe/${workout.rpe_token || token}`;
    const message = `Ciao ${workout.person_name}, indica il tuo RPE per l'allenamento del ${workout.workout_date}: ${rpeUrl}`;
    return json(res, 200, {
      ok:true,
      url:rpeUrl,
      whatsappUrl:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    });
  }
  if (req.method === "PUT" && workoutMatch) {
    const body = normalizeWorkout(await readBody(req));
    if (!body.personId || !body.date || !body.exercises.length) {
      return json(res, 400, { error:"Completa persona, data e almeno un esercizio." });
    }
    if (!await store.updateWorkout(Number(workoutMatch[1]), body)) {
      return json(res, 404, { error:"Allenamento non trovato." });
    }
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && workoutMatch) {
    if (!await store.deleteWorkout(Number(workoutMatch[1]))) {
      return json(res, 404, { error:"Allenamento non trovato." });
    }
    return json(res, 200, { ok:true });
  }
  return false;
}

async function serveRpePage(res, token) {
  const workout = await store.workoutByRpeToken(token);
  if (!workout) {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"no-store" });
    return res.end("Link RPE non valido o scaduto.");
  }
  res.writeHead(200, {
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"same-origin",
    "Content-Security-Policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
  });
  res.end(rpeHtml(workout));
}

function serveFile(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDir, requested);
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
    res.writeHead(404); return res.end("Pagina non trovata");
  }
  const types = {
    ".html":"text/html", ".css":"text/css", ".js":"text/javascript",
    ".svg":"image/svg+xml", ".png":"image/png", ".webmanifest":"application/manifest+json"
  };
  const cacheControl = pathname === "/sw.js" || pathname === "/" || pathname.endsWith(".html")
    ? "no-cache"
    : "public, max-age=3600";
  res.writeHead(200, {
    "Content-Type":`${types[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
    "Cache-Control":cacheControl,
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"same-origin",
    "Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/health") {
      if (!ready || shuttingDown) return json(res, 503, { ok:false, database:store.type });
      try {
        await Promise.race([
          store.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Database timeout")), 3_000))
        ]);
        return json(res, 200, { ok:true, database:store.type });
      } catch {
        return json(res, 503, { ok:false, database:store.type });
      }
    }
    const rpePageMatch = url.pathname.match(/^\/rpe\/([a-f0-9]{32,80})$/i);
    if (rpePageMatch) {
      if (!ready || shuttingDown) return json(res, 503, { error:"Servizio temporaneamente non disponibile." });
      return serveRpePage(res, rpePageMatch[1]);
    }
    if (url.pathname.startsWith("/api/")) {
      if (!ready || shuttingDown) return json(res, 503, { error:"Servizio temporaneamente non disponibile." });
      if (!validateMutationOrigin(req)) return json(res, 403, { error:"Origine della richiesta non valida." });
      const handled = await api(req, res, url);
      if (handled === false) json(res, 404, { error:"Risorsa non trovata." });
    } else {
      serveFile(res, url.pathname);
    }
  } catch (error) {
    console.error(error);
    json(res, error.status || 500, {
      error:error.status && error.status < 500 ? error.message : "Si e verificato un errore."
    });
  }
});

async function initializeStore() {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await store.init();
      await store.ping();
      return;
    } catch (error) {
      lastError = error;
      const delay = Math.min(500 * (2 ** (attempt - 1)), 5_000);
      console.error(`Database non pronto (tentativo ${attempt}/8): ${error.message}`);
      if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

server.listen(PORT, HOST, () => {
  console.log(`\nFitTrack in avvio su http://localhost:${PORT}`);
  if (!isProduction) {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === "IPv4" && !address.internal) console.log(`Da smartphone: http://${address.address}:${PORT}`);
      }
    }
  }
});

initializeStore().then(() => {
  if (shuttingDown) return;
  ready = true;
  console.log(`FitTrack (${store.type}) e pronto.`);
  if (!isProduction) console.log("Premi Ctrl+C per chiudere.\n");
}).catch((error) => {
  console.error("Avvio non riuscito:", error);
  shuttingDown = true;
  server.close(() => process.exit(1));
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.log(`${signal}: arresto ordinato in corso...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  if (!server.listening) {
    try {
      await store.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
    return;
  }
  server.close(async () => {
    try {
      await store.close();
      process.exit(0);
    } catch (error) {
      console.error("Errore durante la chiusura:", error);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
