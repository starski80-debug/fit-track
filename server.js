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
    phone:cleanPhone(body.phone),
    groupId:positiveInteger(body.groupId)
  };
}

function normalizeGroup(body) {
  return {
    name:cleanText(body.name, 100),
    color:/^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#ffcc05",
    notes:cleanText(body.notes, 1_000)
  };
}

function normalizeWorkout(body) {
  return {
    personId:positiveInteger(body.personId),
    date:validDate(body.date),
    duration:finiteNumber(body.duration, 0, 1_440),
    rpe:finiteNumber(body.rpe, 0, 10),
    operator:cleanText(body.operator, 100),
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
    trainer:cleanText(body.trainer, 100),
    notes:cleanText(body.notes, 500),
    status:["scheduled", "confirmed", "cancelled", "done"].includes(body.status) ? body.status : "scheduled"
  };
}

function normalizeEmployee(body) {
  return {
    name:cleanText(body.name, 100),
    color:/^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#ffcc05",
    role:cleanText(body.role, 100)
  };
}

function normalizeTemplate(body) {
  return {
    title:cleanText(body.title, 150),
    personId:positiveInteger(body.personId),
    notes:cleanText(body.notes, 2_000),
    rows:(Array.isArray(body.rows) ? body.rows.slice(0, 80) : []).map((row) => ({
      block:cleanText(row.block, 50),
      exercise:cleanText(row.exercise, 150),
      sets:cleanText(row.sets, 50),
      reps:cleanText(row.reps, 50),
      rest:cleanText(row.rest, 50),
      notes:cleanText(row.notes, 500),
      weeks:cleanText(row.weeks, 500)
    })).filter((row) => row.exercise || row.block || row.notes)
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

function formaeWhatsappSignature() {
  return `\n\nFormae - La tua forza, il tuo potenziale`;
}

function whatsappNumber(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function scheduleStatusLabel(status = "scheduled") {
  return {
    scheduled:"In attesa",
    confirmed:"Confermato",
    cancelled:"Annullato",
    done:"Svolto"
  }[status] || "In attesa";
}

function appointmentHtml(item) {
  const token = escapeHtml(item.response_token);
  const status = escapeHtml(scheduleStatusLabel(item.status));
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Formae - Conferma appuntamento</title>
  <style>
    :root { color-scheme:light; font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body { margin:0; min-height:100vh; background:linear-gradient(145deg,#111827,#20293a); color:#111827; display:grid; place-items:center; padding:18px; }
    main { width:min(430px,100%); }
    .card { background:#fff; border-radius:22px; overflow:hidden; box-shadow:0 24px 70px rgba(0,0,0,.28); }
    header { background:#111827; color:#fff; padding:24px 22px; }
    .logo { color:#ffcc05; font-weight:950; letter-spacing:.02em; font-size:28px; margin-bottom:10px; }
    h1 { margin:0 0 8px; font-size:25px; }
    p { margin:0; line-height:1.45; color:#65708a; }
    header p { color:#d6dcec; }
    .body { padding:22px; display:grid; gap:16px; }
    .detail { background:#f1f5fb; border:1px solid #dbe3ef; border-radius:16px; padding:16px; }
    .detail b { display:block; font-size:20px; margin-bottom:4px; }
    .status { display:inline-flex; width:max-content; border-radius:999px; padding:7px 11px; background:#fff6d1; color:#8c6800; font-weight:900; }
    .actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    button { min-height:52px; border:0; border-radius:14px; font:inherit; font-weight:900; cursor:pointer; }
    .confirm { background:#1f9d63; color:#fff; }
    .cancel { background:#fff0f2; color:#c8435b; }
    button:disabled { opacity:.7; cursor:wait; }
    .result { font-weight:800; color:#1f9d63; min-height:22px; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <header>
        <div class="logo">formae</div>
        <h1>Conferma allenamento</h1>
        <p>${escapeHtml(item.person_name)}, scegli se confermare o annullare l'appuntamento.</p>
      </header>
      <div class="body">
        <div class="detail">
          <b>${escapeHtml(item.scheduled_date)} alle ${escapeHtml(item.scheduled_time)}</b>
          <p>Personal trainer: ${escapeHtml(item.trainer || "Da assegnare")}</p>
        </div>
        <span class="status">Stato attuale: ${status}</span>
        <div class="actions">
          <button class="confirm" type="button" data-status="confirmed">Confermo</button>
          <button class="cancel" type="button" data-status="cancelled">Annulla</button>
        </div>
        <div class="result" id="result"></div>
      </div>
    </section>
  </main>
  <script>
    const result = document.querySelector("#result");
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-status]");
      if (!button) return;
      document.querySelectorAll("button").forEach((item) => item.disabled = true);
      try {
        const response = await fetch("/api/appointment/${token}", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({ status:button.dataset.status })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Errore");
        result.textContent = "Grazie, risposta registrata: " + body.label + ".";
      } catch (error) {
        result.textContent = error.message || "Errore, riprova.";
        document.querySelectorAll("button").forEach((item) => item.disabled = false);
      }
    });
  </script>
</body>
</html>`;
}

function templateSheetHtml(template) {
  const rows = template.rows?.length ? template.rows : [];
  const weekHeaders = ["1° week", "2° week", "3° week", "4° week", "5° week", "6° week", "7° week"];
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Formae - Scheda allenamento</title>
  <style>
    :root { color-scheme:light; font-family:Arial,Helvetica,sans-serif; --yellow:#ffcc05; --dark:#202020; --grid:#111; }
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { margin:0; background:#d9e1ed; color:#050505; }
    .wrap { max-width:1280px; margin:0 auto; padding:20px; }
    .toolbar { display:flex; justify-content:flex-end; gap:10px; margin:0 0 12px; }
    button { border:0; border-radius:12px; padding:12px 16px; background:#111827; color:#fff; font-weight:800; cursor:pointer; }
    .sheet { background:#fff; border:2px solid var(--grid); box-shadow:0 18px 45px rgba(8,23,53,.18); overflow:auto; }
    .brand { background:var(--yellow); text-align:center; padding:15px 12px 22px; border-bottom:2px solid var(--grid); }
    .brand h1 { margin:0; font-size:36px; line-height:1; letter-spacing:.03em; }
    .brand h2 { margin:8px 0 0; font-size:19px; }
    .meta { display:flex; flex-wrap:wrap; gap:10px 24px; padding:10px 14px; border-bottom:2px solid var(--grid); font-weight:800; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; min-width:1050px; }
    th { background:var(--dark); color:var(--yellow); border:2px solid var(--grid); padding:12px 8px; font-size:15px; text-transform:uppercase; }
    td { border:2px solid var(--grid); padding:10px 8px; min-height:42px; font-size:14px; font-weight:800; text-align:center; vertical-align:middle; }
    td.exercise { text-align:center; font-size:15px; }
    td.notes { text-align:center; font-size:13px; line-height:1.25; }
    tbody tr:nth-child(odd) td { background:#d9d9d9; }
    tbody tr:nth-child(even) td { background:#fff; }
    .block { width:44px; font-size:18px; }
    .exercise { width:210px; }
    .sets,.reps,.rest { width:95px; }
    .notes { width:260px; }
    .week { width:78px; }
    .empty { padding:24px; text-align:center; font-weight:800; }
    @media (max-width:720px) {
      .wrap { padding:10px; }
      .brand h1 { font-size:30px; }
      .toolbar { justify-content:stretch; }
      button { width:100%; }
    }
    @media print {
      html,body { width:auto; margin:0; background:#fff; }
      .wrap { width:190mm; max-width:190mm; margin:0 auto; padding:0; }
      .toolbar { display:none; }
      .sheet { width:100%; box-shadow:none; border:2px solid var(--grid); overflow:visible; break-inside:avoid; page-break-inside:avoid; }
      .brand { padding:8px 8px 12px; }
      .brand h1 { font-size:21px; }
      .brand h2 { margin-top:5px; font-size:11px; }
      .meta { padding:5px 6px; gap:5px 10px; font-size:7.4px; }
      table { width:100%; min-width:0; table-layout:fixed; }
      th { padding:3px 1.5px; font-size:5.8px; line-height:1.05; border-width:1px; }
      td { padding:3px 1.5px; min-height:0; font-size:5.8px; line-height:1.08; overflow-wrap:anywhere; word-break:break-word; border-width:1px; }
      td.exercise { font-size:6.2px; }
      td.notes { font-size:5.4px; line-height:1.08; }
      .block { width:3.5%; font-size:6.2px; }
      .exercise { width:15%; }
      .sets { width:5.6%; }
      .reps { width:7%; }
      .rest { width:7%; }
      .notes { width:18%; }
      .week { width:6.27%; }
      @page { size:A4 portrait; margin:8mm; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar"><button type="button" onclick="window.print()">Stampa / salva PDF</button></div>
    <section class="sheet">
      <header class="brand"><h1>FORMAE</h1><h2>PROGRAMMAZIONE</h2></header>
      <div class="meta">
        <span>Scheda: ${escapeHtml(template.title)}</span>
        ${template.person_name ? `<span>Cliente: ${escapeHtml(template.person_name)}</span>` : ""}
        ${template.notes ? `<span>Note: ${escapeHtml(template.notes)}</span>` : ""}
      </div>
      ${rows.length ? `<table>
        <thead>
          <tr>
            <th class="block"></th>
            <th class="exercise">Allenamento A</th>
            <th class="sets">Serie</th>
            <th class="reps">Ripetizioni</th>
            <th class="rest">Recupero</th>
            <th class="notes">Note</th>
            ${weekHeaders.map((week) => `<th class="week">${week}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `<tr>
            <td class="block">${escapeHtml(row.block || String(index + 1))}</td>
            <td class="exercise">${escapeHtml(row.exercise)}</td>
            <td class="sets">${escapeHtml(row.sets)}</td>
            <td class="reps">${escapeHtml(row.reps)}</td>
            <td class="rest">${escapeHtml(row.rest)}</td>
            <td class="notes">${escapeHtml(row.notes)}</td>
            ${weekHeaders.map((_, weekIndex) => `<td class="week">${escapeHtml(String(row.weeks || "").split(/[,;|]/)[weekIndex] || "")}</td>`).join("")}
          </tr>`).join("")}
        </tbody>
      </table>` : `<div class="empty">Scheda senza esercizi.</div>`}
    </section>
  </div>
</body>
</html>`;
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
  const publicAppointmentMatch = url.pathname.match(/^\/api\/appointment\/([a-f0-9]{32,80})$/i);
  if (req.method === "POST" && publicAppointmentMatch) {
    const body = await readBody(req);
    const status = ["confirmed", "cancelled"].includes(body.status) ? body.status : "";
    if (!status) return json(res, 400, { error:"Risposta non valida." });
    if (!await store.setScheduleStatusByToken(publicAppointmentMatch[1], status)) {
      return json(res, 404, { error:"Link appuntamento non valido o scaduto." });
    }
    return json(res, 200, { ok:true, status, label:scheduleStatusLabel(status) });
  }

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

  if (req.method === "POST" && url.pathname === "/api/groups") {
    const body = normalizeGroup(await readBody(req));
    if (!body.name) return json(res, 400, { error:"Inserisci il nome del gruppo." });
    return json(res, 201, { id:await store.addGroup(body) });
  }
  const groupMatch = url.pathname.match(/^\/api\/groups\/(\d+)$/);
  if (req.method === "PUT" && groupMatch) {
    const body = normalizeGroup(await readBody(req));
    if (!body.name) return json(res, 400, { error:"Inserisci il nome del gruppo." });
    if (!await store.updateGroup(Number(groupMatch[1]), body)) {
      return json(res, 404, { error:"Gruppo non trovato." });
    }
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && groupMatch) {
    if (!await store.deleteGroup(Number(groupMatch[1]))) {
      return json(res, 404, { error:"Gruppo non trovato." });
    }
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/employees") {
    const body = normalizeEmployee(await readBody(req));
    if (!body.name) return json(res, 400, { error:"Inserisci il nome del dipendente." });
    return json(res, 201, { id:await store.addEmployee(body) });
  }
  const employeeMatch = url.pathname.match(/^\/api\/employees\/(\d+)$/);
  if (req.method === "PUT" && employeeMatch) {
    const body = normalizeEmployee(await readBody(req));
    if (!body.name) return json(res, 400, { error:"Inserisci il nome del dipendente." });
    if (!await store.updateEmployee(Number(employeeMatch[1]), body)) return json(res, 404, { error:"Dipendente non trovato." });
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && employeeMatch) {
    if (!await store.deleteEmployee(Number(employeeMatch[1]))) return json(res, 404, { error:"Dipendente non trovato." });
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const body = normalizeTemplate(await readBody(req));
    if (!body.title) return json(res, 400, { error:"Inserisci il titolo della scheda." });
    return json(res, 201, { id:await store.addTemplate(body) });
  }
  const templateMatch = url.pathname.match(/^\/api\/templates\/(\d+)$/);
  const templateShareMatch = url.pathname.match(/^\/api\/templates\/(\d+)\/share-link$/);
  if (req.method === "POST" && templateShareMatch) {
    const token = crypto.randomBytes(24).toString("hex");
    const template = await store.prepareTemplateShareLink(Number(templateShareMatch[1]), token);
    if (!template) return json(res, 404, { error:"Scheda non trovata." });
    const phone = whatsappNumber(template.person_phone);
    if (!phone) return json(res, 400, { error:"Associa la scheda a una persona con telefono WhatsApp." });
    const sheetUrl = `${publicBaseUrl(req)}/template/${template.share_token || token}`;
    const message = `Ciao ${template.person_name}, ecco la tua scheda di allenamento Formae: ${sheetUrl}${formaeWhatsappSignature()}`;
    return json(res, 200, {
      ok:true,
      url:sheetUrl,
      whatsappUrl:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    });
  }
  if (req.method === "PUT" && templateMatch) {
    const body = normalizeTemplate(await readBody(req));
    if (!body.title) return json(res, 400, { error:"Inserisci il titolo della scheda." });
    if (!await store.updateTemplate(Number(templateMatch[1]), body)) return json(res, 404, { error:"Scheda non trovata." });
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && templateMatch) {
    if (!await store.deleteTemplate(Number(templateMatch[1]))) return json(res, 404, { error:"Scheda non trovata." });
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
  if (req.method === "PUT" && url.pathname === "/api/body-areas") {
    const body = await readBody(req);
    const oldName = cleanText(body.oldName, 50);
    const name = cleanText(body.name, 50);
    if (!oldName || !name) {
      return json(res, 400, { error:"Inserisci il vecchio e il nuovo nome della macro area." });
    }
    await store.renameBodyArea(oldName, name);
    return json(res, 200, { ok:true });
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
  const scheduleReminderMatch = url.pathname.match(/^\/api\/schedule\/(\d+)\/reminder-link$/);
  if (req.method === "POST" && scheduleReminderMatch) {
    const token = crypto.randomBytes(24).toString("hex");
    const item = await store.prepareScheduleResponseLink(Number(scheduleReminderMatch[1]), token);
    if (!item) return json(res, 404, { error:"Appuntamento non trovato." });
    const phone = whatsappNumber(item.person_phone);
    if (!phone) return json(res, 400, { error:"Inserisci il telefono WhatsApp nella scheda della persona." });
    const appointmentUrl = `${publicBaseUrl(req)}/appointment/${item.response_token || token}`;
    const message = `Ciao ${item.person_name}, ti ricordiamo l'allenamento del ${item.scheduled_date} alle ${item.scheduled_time} con ${item.trainer}. Conferma o annulla qui: ${appointmentUrl}${formaeWhatsappSignature()}`;
    return json(res, 200, {
      ok:true,
      url:appointmentUrl,
      whatsappUrl:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    });
  }
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
    const message = `Ciao ${workout.person_name}, indica il tuo RPE per la sessione di allenamento del ${workout.workout_date}: ${rpeUrl}${formaeWhatsappSignature()}`;
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
    const message = `Ciao ${workout.person_name}, indica il tuo RPE per l'allenamento del ${workout.workout_date}: ${rpeUrl}${formaeWhatsappSignature()}`;
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

async function serveAppointmentPage(res, token) {
  const item = await store.scheduleByResponseToken(token);
  if (!item) {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"no-store" });
    return res.end("Link appuntamento non valido o scaduto.");
  }
  res.writeHead(200, {
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"same-origin",
    "Content-Security-Policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
  });
  res.end(appointmentHtml(item));
}

async function serveTemplateSheet(res, token) {
  const template = await store.templateByShareToken(token);
  if (!template) {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"no-store" });
    return res.end("Scheda non valida o non disponibile.");
  }
  res.writeHead(200, {
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"same-origin",
    "Content-Security-Policy":"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
  });
  res.end(templateSheetHtml(template));
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
    const appointmentPageMatch = url.pathname.match(/^\/appointment\/([a-f0-9]{32,80})$/i);
    if (appointmentPageMatch) {
      if (!ready || shuttingDown) return json(res, 503, { error:"Servizio temporaneamente non disponibile." });
      return serveAppointmentPage(res, appointmentPageMatch[1]);
    }
    const templatePageMatch = url.pathname.match(/^\/template\/([a-f0-9]{32,80})$/i);
    if (templatePageMatch) {
      if (!ready || shuttingDown) return json(res, 503, { error:"Servizio temporaneamente non disponibile." });
      return serveTemplateSheet(res, templatePageMatch[1]);
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
