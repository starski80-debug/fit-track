const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

test("i file essenziali dell'app sono presenti", () => {
  for (const file of ["server.js", "public/index.html", "public/style.css", "public/app.js"]) {
    assert.equal(fs.existsSync(path.join(__dirname, file)), true, `${file} mancante`);
  }
});

test("la pagina contiene le sezioni principali", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  assert.match(html, /Panoramica/);
  assert.match(html, /Storico/);
  assert.match(html, /Persone/);
  assert.match(html, /home-tabs/);
  assert.match(html, /Anagrafica iscritti/);
  assert.match(html, /data-go="workouts"/);
  assert.match(html, /id="new-workout"/);
  assert.match(html, /Registra allenamento/);
  assert.doesNotMatch(html, /ATTIVITA RECENTI/);
  assert.doesNotMatch(html, /recent-workouts/);
});

test("il catalogo contiene esercizi per tutte le zone", () => {
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  for (const area of ["Petto", "Dorso", "Spalle", "Braccia", "Gambe", "Addome", "Cardio", "Altro"]) {
    assert.match(app, new RegExp(`${area}: \\[`), `Catalogo ${area} mancante`);
  }
  assert.match(app, /Altro \/ personalizzato/);
});

test("la gestione del catalogo e presente", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  assert.match(html, /Catalogo esercizi/);
  assert.match(html, /data-go="catalog"/);
  assert.match(html, /catalog-form/);
  assert.match(html, /area-form/);
  assert.match(app, /data-edit-area/);
  assert.match(app, /function openAreaEdit/);
  assert.match(app, /function fillCatalogAreaSelect/);
  assert.match(app, /function recoveryBodyAreaName/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS exercise_catalog/);
  assert.match(database, /async renameBodyArea/);
  assert.match(server, /POST" && url\.pathname === "\/api\/catalog"/);
  assert.match(server, /PUT" && url\.pathname === "\/api\/body-areas"/);
});

test("le persone possono essere modificate", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(html, /person-dialog-title/);
  assert.match(html, /Data di nascita/);
  assert.match(html, /Telefono WhatsApp/);
  assert.match(html, /people-search/);
  assert.match(app, /data-open-person-history/);
  assert.match(app, /person-link/);
  assert.match(app, /state\.peopleSearch/);
  assert.match(app, /function openPerson/);
  assert.match(server, /req\.method === "PUT" && personMatch/);
});

test("RPE puo essere inviato con link WhatsApp pubblico", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  assert.match(html, /Telefono WhatsApp/);
  assert.match(app, /data-rpe-whatsapp/);
  assert.match(app, /data-rpe-whatsapp-group/);
  assert.match(app, /\/api\/workout-groups\/rpe-link/);
  assert.match(app, /whatsappUrl/);
  assert.match(app, /function formaeWhatsappSignature/);
  assert.match(server, /rpeLinkMatch/);
  assert.match(server, /rpe-link/);
  assert.match(server, /\/api\/workout-groups\/rpe-link/);
  assert.match(server, /function formaeWhatsappSignature/);
  assert.doesNotMatch(server, /function formaeLogoUrl/);
  assert.match(server, /\/api\/rpe\//);
  assert.match(server, /prepareRpeGroupLink/);
  assert.match(server, /https:\/\/wa\.me/);
  assert.match(server, /function rpeHtml/);
  assert.match(server, /workout\.rpe_token \|\| token/);
  assert.match(server, /Maximum Effort/);
  assert.match(server, /0, "Rest"/);
  assert.match(database, /phone TEXT NOT NULL DEFAULT ''/);
  assert.match(database, /rpe_token TEXT NOT NULL DEFAULT ''/);
  assert.match(database, /async prepareRpeGroupLink/);
});

test("la home include agenda calendario per gli appuntamenti", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/style.css"), "utf8");
  assert.match(html, /Calendario allenamenti/);
  assert.match(html, /id="calendar-view"/);
  assert.match(html, /calendar-grid/);
  assert.match(html, /day-dialog/);
  assert.match(html, /data-view="calendar"/);
  assert.match(html, /schedule-form/);
  assert.match(html, /schedule-person/);
  assert.match(html, /Leonardo/);
  assert.match(app, /function renderSchedule/);
  assert.match(app, /function renderCalendarGrid/);
  assert.match(app, /function openDayDialog/);
  assert.match(app, /data-calendar-day/);
  assert.match(app, /Promemoria di domani/);
  assert.match(app, /data-schedule-reminder/);
  assert.match(app, /function whatsappReminderUrl/);
  assert.match(app, /function scheduleReminderText/);
  assert.match(app, /function scheduleStatusLabel/);
  assert.match(app, /function scheduleStatusSummary/);
  assert.match(app, /schedule-status/);
  assert.match(app, /\/api\/schedule\/\$\{scheduleReminderButton\.dataset\.scheduleReminder\}\/reminder-link/);
  assert.doesNotMatch(app, /formaeLogoUrl/);
  assert.match(app, /wa\.me/);
  assert.match(app, /function openScheduleEdit/);
  assert.match(app, /function trainerColor/);
  assert.match(app, /data-edit-schedule/);
  assert.match(app, /data-delete-schedule/);
  assert.match(app, /method:id \? "PUT" : "POST"/);
  assert.match(app, /\/api\/schedule/);
  assert.match(server, /function normalizeSchedule/);
  assert.match(server, /function appointmentHtml/);
  assert.match(server, /function scheduleStatusLabel/);
  assert.match(server, /POST" && url\.pathname === "\/api\/schedule"/);
  assert.match(server, /reminder-link/);
  assert.match(server, /\/api\/appointment\//);
  assert.match(server, /serveAppointmentPage/);
  assert.match(server, /req\.method === "PUT" && scheduleMatch/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS scheduled_sessions/);
  assert.match(database, /response_token TEXT NOT NULL DEFAULT ''/);
  assert.match(database, /async addSchedule/);
  assert.match(database, /async updateSchedule/);
  assert.match(database, /async prepareScheduleResponseLink/);
  assert.match(database, /async setScheduleStatusByToken/);
  assert.match(css, /schedule-panel/);
  assert.match(css, /calendar-days/);
  assert.match(css, /has-items/);
  assert.match(css, /trainer-color/);
  assert.match(css, /schedule-status/);
  assert.match(css, /schedule-reminders/);
});

test("lo storico raggruppa per giorno e mostra il grafico", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  assert.match(html, /progress-chart/);
  assert.match(html, /rpe-progress-chart/);
  assert.match(html, /Sforzo percepito nel tempo/);
  assert.match(html, /history-days/);
  assert.match(html, /brand\/formae-banner\.png/);
  assert.match(html, /brand\/formae-mark\.png/);
  assert.match(app, /function groupWorkoutsByDay/);
  assert.match(app, /function progressChart/);
  assert.match(app, /function rpeTrendChart/);
  assert.match(app, /function dayRpeValue/);
  assert.match(app, /function exerciseUnits/);
  assert.match(app, /function rpeSummary/);
  assert.match(app, /class="day-meta"/);
  assert.match(app, /rpe-chip/);
});

test("gli allenamenti supportano modifica, RPE, operatore, fasi e secondi", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  assert.match(html, /RPE - sforzo percepito/);
  assert.match(html, /Leonardo/);
  assert.match(html, /Warm up/);
  assert.match(html, /id="workouts-view"/);
  assert.match(app, /function renderWorkoutsView/);
  assert.match(app, /data-workout-person/);
  assert.match(html, /data-phase-section="warmup"/);
  assert.match(html, /data-add-phase="cooldown"/);
  assert.match(html, /class="seconds"/);
  assert.match(app, /data-edit-workout/);
  assert.match(app, /data-edit-workout-group/);
  assert.match(app, /function phaseList/);
  assert.match(app, /function bodyAreasForPhase/);
  assert.match(app, /data-add-phase/);
  assert.match(server, /\/api\/workout-groups/);
  assert.match(app, /const method = groupIds\.length \|\| id \? "PUT" : "POST"/);
  assert.match(server, /req\.method === "PUT" && workoutMatch/);
  assert.match(database, /ALTER TABLE workouts ADD COLUMN/);
  assert.match(database, /seconds INTEGER NOT NULL DEFAULT 0/);
});

test("i gruppi sono gestibili e collegati alle persone", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/style.css"), "utf8");
  assert.match(html, /id="groups-view"/);
  assert.match(html, /id="group-form"/);
  assert.match(html, /person-group-select/);
  assert.match(app, /function renderGroups/);
  assert.match(app, /groupDetailId/);
  assert.match(app, /data-open-group/);
  assert.match(app, /data-edit-group/);
  assert.match(app, /\/api\/groups/);
  assert.match(server, /function normalizeGroup/);
  assert.match(server, /\/api\/groups/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS groups/);
  assert.match(database, /group_id/);
  assert.match(css, /groups-grid/);
});

test("dipendenti e schede di allenamento sono gestibili", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/style.css"), "utf8");
  assert.match(html, /employees-view/);
  assert.match(html, /templates-view/);
  assert.match(html, /Schede di allenamento/);
  assert.match(app, /function renderEmployees/);
  assert.match(app, /function renderTemplates/);
  assert.match(app, /function templateWhatsappUrl/);
  assert.match(app, /data-template-whatsapp/);
  assert.match(app, /\/api\/templates\/\$\{templateWhatsappButton\.dataset\.templateWhatsapp\}\/share-link/);
  assert.match(app, /employeeOptionHtml/);
  assert.match(server, /function normalizeEmployee/);
  assert.match(server, /function normalizeTemplate/);
  assert.match(server, /function templateSheetHtml/);
  assert.match(server, /print-color-adjust:exact/);
  assert.match(server, /size:A4 portrait/);
  assert.match(server, /width:190mm/);
  assert.match(server, /overflow:visible/);
  assert.match(server, /share-link/);
  assert.match(server, /serveTemplateSheet/);
  assert.match(server, /\/template\//);
  assert.match(database, /CREATE TABLE IF NOT EXISTS employees/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS training_templates/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS template_rows/);
  assert.match(database, /share_token TEXT NOT NULL DEFAULT ''/);
  assert.match(database, /async prepareTemplateShareLink/);
  assert.match(database, /async templateByShareToken/);
  assert.match(css, /template-table/);
});

test("il nuovo design include tema scuro e colori per zone", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/style.css"), "utf8");
  assert.match(html, /theme-toggle/);
  assert.match(app, /fittrack-theme/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /linear-gradient\(145deg,#e2e8f1 0%,#c9d4e2 100%\)/);
  assert.match(css, /area-edit/);
  assert.match(css, /data-area="Petto"/);
  assert.match(css, /@media \(max-width:570px\)/);
});

test("la versione Railway include PostgreSQL, login e health check", () => {
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  const railway = fs.readFileSync(path.join(__dirname, "railway.json"), "utf8");
  assert.match(database, /createPostgresStore/);
  assert.match(database, /person_id:Number/);
  assert.match(server, /APP_PASSWORD/);
  assert.match(server, /fittrack_session/);
  assert.match(server, /url\.pathname === "\/health"/);
  assert.match(railway, /healthcheckPath/);
});

test("i moduli asincroni conservano il riferimento prima degli await", () => {
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  assert.doesNotMatch(app, /event\.currentTarget\.reset\(\)/);
  assert.match(app, /const formElement = event\.currentTarget/);
  assert.match(app, /formElement\.reset\(\)/);
});

test("il layout mobile usa controlli touch e modali a schermo", () => {
  const css = fs.readFileSync(path.join(__dirname, "public/style.css"), "utf8");
  assert.match(css, /Mobile-first usability refinements/);
  assert.match(css, /max-height:94dvh/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /input,select,button \{ font-size:16px; \}/);
  assert.match(css, /@media \(max-width:370px\)/);
});

test("la PWA include manifest, icone e cache senza dati API", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const manifest = fs.readFileSync(path.join(__dirname, "public/manifest.webmanifest"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "public/sw.js"), "utf8");
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/rpe\/"\)/);
  assert.doesNotMatch(worker, /\/api\/dashboard/);
});

test("il backend protegge le API e risponde al controllo reale", { timeout:20_000 }, async (context) => {
  const port = 32_000 + Math.floor(Math.random() * 1_000);
  const password = "PasswordIntegrazioneSicura";
  const child = spawn(process.execPath, ["server.js"], {
    cwd:__dirname,
    env:{
      ...process.env,
      PORT:String(port),
      APP_PASSWORD:password,
      AUTH_SECRET:"test-secret-stabile-lungo-piu-di-trentadue-caratteri"
    },
    stdio:["ignore", "pipe", "pipe"]
  });
  context.after(() => {
    if (!child.killed) child.kill();
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      health = await fetch(`${base}/health`);
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(health?.status, 200, "Il server non e diventato pronto");
  assert.equal((await health.json()).database, "sqlite");

  const blocked = await fetch(`${base}/api/dashboard`);
  assert.equal(blocked.status, 401);

  const malformed = await fetch(`${base}/api/auth/login`, {
    method:"POST", headers:{ "Content-Type":"application/json" }, body:"{"
  });
  assert.equal(malformed.status, 400);

  const login = await fetch(`${base}/api/auth/login`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ password })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const dashboard = await fetch(`${base}/api/dashboard`, { headers:{ Cookie:cookie } });
  assert.equal(dashboard.status, 200);
  const body = await dashboard.json();
  assert.ok(Array.isArray(body.people));
  assert.ok(Array.isArray(body.catalog));
  assert.ok(Array.isArray(body.schedule));

  const missing = await fetch(`${base}/api/workouts/999999999`, {
    method:"DELETE", headers:{ Cookie:cookie }
  });
  assert.equal(missing.status, 404);

  const invalidWorkout = await fetch(`${base}/api/workouts`, {
    method:"POST",
    headers:{ Cookie:cookie, "Content-Type":"application/json" },
    body:JSON.stringify({
      personId:0, date:"2026-06-15", duration:30,
      exercises:[{ bodyArea:"Petto", name:"Test", sets:3, reps:10, weight:20 }]
    })
  });
  assert.equal(invalidWorkout.status, 400);
});

test("la configurazione di stabilita include retry, timeout e shutdown", () => {
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "public/sw.js"), "utf8");
  assert.match(server, /initializeStore/);
  assert.match(server, /server\.requestTimeout/);
  assert.match(server, /process\.on\("SIGTERM"/);
  assert.match(database, /connectionTimeoutMillis/);
  assert.match(database, /journal_mode = WAL/);
  assert.match(database, /ON CONFLICT \(body_area, name\) DO NOTHING/);
  assert.match(server, /function positiveInteger/);
  assert.match(worker, /fittrack-shell-v33/);
  assert.match(worker, /url\.pathname\.startsWith\("\/appointment\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/template\/"\)/);
  assert.match(worker, /brand\/formae-banner\.png/);
  assert.match(worker, /brand\/formae-mark\.png/);
});
