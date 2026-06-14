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

if (isProduction && (!appPassword || appPassword.length < 10)) {
  throw new Error("Su Railway devi configurare APP_PASSWORD con almeno 10 caratteri.");
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
  });
  req.on("error", reject);
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

function normalizePerson(body) {
  return {
    name:String(body.name || "").trim(), color:String(body.color || "#6c63ff"),
    birthDate:String(body.birthDate || ""), height:Number(body.height || 0),
    weight:Number(body.weight || 0), notes:String(body.notes || "")
  };
}

function normalizeWorkout(body) {
  return {
    personId:Number(body.personId), date:String(body.date || ""), duration:Number(body.duration || 0),
    notes:String(body.notes || ""), exercises:(Array.isArray(body.exercises) ? body.exercises : [])
      .map((item) => ({
        bodyArea:String(item.bodyArea || "Altro"), name:String(item.name || "").trim(),
        sets:Number(item.sets || 0), reps:Number(item.reps || 0), weight:Number(item.weight || 0)
      })).filter((item) => item.name)
  };
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    return json(res, 200, { authenticated:isAuthenticated(req), required:Boolean(appPassword) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    if (!appPassword || secureEqual(body.password || "", appPassword)) {
      return json(res, 200, { ok:true }, { "Set-Cookie":cookieHeader(authToken(), 60 * 60 * 24 * 30) });
    }
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
    await store.updatePerson(Number(personMatch[1]), body);
    return json(res, 200, { ok:true });
  }
  if (req.method === "DELETE" && personMatch) {
    await store.deletePerson(Number(personMatch[1]));
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/catalog") {
    const body = await readBody(req);
    const area = String(body.bodyArea || "").trim();
    const name = String(body.name || "").trim();
    if (!Object.keys(defaultCatalog).includes(area) || !name) {
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
    await store.deleteCatalog(Number(catalogMatch[1]));
    return json(res, 200, { ok:true });
  }

  if (req.method === "POST" && url.pathname === "/api/workouts") {
    const body = normalizeWorkout(await readBody(req));
    if (!body.personId || !body.date || !body.exercises.length) {
      return json(res, 400, { error:"Completa persona, data e almeno un esercizio." });
    }
    return json(res, 201, { id:await store.addWorkout(body) });
  }
  const workoutMatch = url.pathname.match(/^\/api\/workouts\/(\d+)$/);
  if (req.method === "DELETE" && workoutMatch) {
    await store.deleteWorkout(Number(workoutMatch[1]));
    return json(res, 200, { ok:true });
  }
  return false;
}

function serveFile(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDir, requested);
  if (!filePath.startsWith(path.resolve(publicDir)) || !fs.existsSync(filePath)) {
    res.writeHead(404); return res.end("Pagina non trovata");
  }
  const types = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".svg":"image/svg+xml", ".png":"image/png" };
  res.writeHead(200, {
    "Content-Type":`${types[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"same-origin",
    "Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/health") return json(res, 200, { ok:true, database:store.type });
    if (url.pathname.startsWith("/api/")) {
      const handled = await api(req, res, url);
      if (handled === false) json(res, 404, { error:"Risorsa non trovata." });
    } else {
      serveFile(res, url.pathname);
    }
  } catch (error) {
    console.error(error);
    json(res, 500, { error:"Si e verificato un errore." });
  }
});

store.init().then(() => server.listen(PORT, HOST, () => {
  console.log(`\nFitTrack (${store.type}) e pronto: http://localhost:${PORT}`);
  if (!isProduction) {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === "IPv4" && !address.internal) console.log(`Da smartphone: http://${address.address}:${PORT}`);
      }
    }
  }
  console.log("Premi Ctrl+C per chiudere.\n");
})).catch((error) => {
  console.error("Avvio non riuscito:", error);
  process.exitCode = 1;
});
