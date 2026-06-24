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
  assert.match(html, /Registra allenamento/);
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
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  assert.match(html, /Catalogo esercizi/);
  assert.match(html, /catalog-form/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS exercise_catalog/);
  assert.match(server, /POST" && url\.pathname === "\/api\/catalog"/);
});

test("le persone possono essere modificate", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(html, /person-dialog-title/);
  assert.match(html, /Data di nascita/);
  assert.match(app, /function openPerson/);
  assert.match(server, /req\.method === "PUT" && personMatch/);
});

test("lo storico raggruppa per giorno e mostra il grafico", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  assert.match(html, /progress-chart/);
  assert.match(html, /history-days/);
  assert.match(app, /function groupWorkoutsByDay/);
  assert.match(app, /function progressChart/);
  assert.match(app, /function exerciseUnits/);
});

test("gli allenamenti supportano modifica, RPE, operatore, fasi e secondi", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  assert.match(html, /RPE - sforzo percepito/);
  assert.match(html, /Leonardo/);
  assert.match(html, /Warm up/);
  assert.match(html, /class="seconds"/);
  assert.match(app, /data-edit-workout/);
  assert.match(app, /method:id \? "PUT" : "POST"/);
  assert.match(server, /req\.method === "PUT" && workoutMatch/);
  assert.match(database, /ALTER TABLE workouts ADD COLUMN/);
  assert.match(database, /seconds INTEGER NOT NULL DEFAULT 0/);
});

test("il nuovo design include tema scuro e colori per zone", () => {
  const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/style.css"), "utf8");
  assert.match(html, /theme-toggle/);
  assert.match(app, /fittrack-theme/);
  assert.match(css, /\[data-theme="dark"\]/);
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
  assert.match(worker, /fittrack-shell-v7/);
});
