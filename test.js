const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
  for (const area of ["Petto", "Schiena", "Spalle", "Braccia", "Gambe", "Addome", "Cardio", "Altro"]) {
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
  assert.match(app, /function exerciseVolume/);
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
