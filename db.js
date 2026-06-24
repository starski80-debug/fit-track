const fs = require("node:fs");
const path = require("node:path");

const defaultCatalog = {
  Petto: ["Panca piana con bilanciere", "Panca inclinata con bilanciere", "Panca piana con manubri", "Panca inclinata con manubri", "Chest press", "Croci con manubri", "Croci ai cavi", "Dip per il petto", "Piegamenti"],
  Dorso: ["Trazioni alla sbarra", "Lat machine", "Pulley basso", "Rematore con bilanciere", "Rematore con manubrio", "Rematore alla macchina", "Stacco da terra", "Pullover ai cavi", "Iperestensioni"],
  Spalle: ["Military press", "Shoulder press", "Arnold press", "Lento avanti", "Alzate laterali", "Alzate frontali", "Alzate posteriori", "Face pull", "Tirate al mento"],
  Braccia: ["Curl con bilanciere", "Curl con manubri", "Curl a martello", "Curl alla panca Scott", "Curl ai cavi", "French press", "Push down ai cavi", "Estensioni sopra la testa", "Dip per tricipiti", "Panca presa stretta"],
  Gambe: ["Squat", "Front squat", "Pressa", "Affondi", "Bulgarian split squat", "Leg extension", "Leg curl", "Stacco rumeno", "Hip thrust", "Calf raise"],
  Addome: ["Crunch", "Crunch inverso", "Plank", "Plank laterale", "Sit-up", "Leg raise", "Mountain climber", "Russian twist", "Ab wheel"],
  Cardio: ["Corsa", "Camminata veloce", "Cyclette", "Ellittica", "Vogatore", "Salto con la corda", "Stepper", "Circuito HIIT"],
  Altro: ["Mobilita", "Stretching", "Riscaldamento"]
};

function createSqliteStore() {
  const { DatabaseSync } = require("node:sqlite");
  const dataDir = path.join(__dirname, "data");
  fs.mkdirSync(dataDir, { recursive:true });
  const db = new DatabaseSync(path.join(dataDir, "fittrack.db"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6c63ff', phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      workout_date TEXT NOT NULL, duration INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '', rpe INTEGER NOT NULL DEFAULT 0,
      trainer TEXT NOT NULL DEFAULT '', rpe_token TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      body_area TEXT NOT NULL, name TEXT NOT NULL, sets INTEGER NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0, weight REAL NOT NULL DEFAULT 0,
      seconds INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'main'
    );
    CREATE TABLE IF NOT EXISTS exercise_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT, body_area TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(body_area, name)
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_person_date ON workouts(person_id, workout_date DESC);
    CREATE INDEX IF NOT EXISTS idx_exercises_workout ON exercises(workout_id);
    CREATE INDEX IF NOT EXISTS idx_catalog_area_name ON exercise_catalog(body_area, name);
  `);
  const columns = db.prepare("PRAGMA table_info(people)").all().map((item) => item.name);
  for (const [name, definition] of [
    ["birth_date", "TEXT NOT NULL DEFAULT ''"], ["height", "REAL NOT NULL DEFAULT 0"],
    ["weight", "REAL NOT NULL DEFAULT 0"], ["notes", "TEXT NOT NULL DEFAULT ''"],
    ["phone", "TEXT NOT NULL DEFAULT ''"]
  ]) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE people ADD COLUMN ${name} ${definition}`);
  }
  const workoutColumns = db.prepare("PRAGMA table_info(workouts)").all().map((item) => item.name);
  for (const [name, definition] of [
    ["rpe", "INTEGER NOT NULL DEFAULT 0"], ["trainer", "TEXT NOT NULL DEFAULT ''"],
    ["rpe_token", "TEXT NOT NULL DEFAULT ''"]
  ]) {
    if (!workoutColumns.includes(name)) db.exec(`ALTER TABLE workouts ADD COLUMN ${name} ${definition}`);
  }
  const exerciseColumns = db.prepare("PRAGMA table_info(exercises)").all().map((item) => item.name);
  for (const [name, definition] of [
    ["seconds", "INTEGER NOT NULL DEFAULT 0"], ["phase", "TEXT NOT NULL DEFAULT 'main'"]
  ]) {
    if (!exerciseColumns.includes(name)) db.exec(`ALTER TABLE exercises ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`
    UPDATE exercises SET body_area = 'Dorso' WHERE body_area = 'Schiena';
    UPDATE exercise_catalog SET body_area = 'Dorso' WHERE body_area = 'Schiena';
  `);
  if (workoutColumns.includes("operator") && !workoutColumns.includes("trainer")) {
    db.exec("UPDATE workouts SET trainer = operator WHERE trainer = '' AND operator <> ''");
  }

  return {
    type:"sqlite",
    async ping() { db.prepare("SELECT 1 AS ok").get(); return true; },
    async close() { db.close(); },
    async init() {
      const insert = db.prepare("INSERT OR IGNORE INTO exercise_catalog (body_area, name) VALUES (?, ?)");
      for (const [area, names] of Object.entries(defaultCatalog)) {
        for (const name of names) insert.run(area, name);
      }
    },
    async dashboard() {
      const people = db.prepare("SELECT * FROM people ORDER BY name").all();
      const catalog = db.prepare("SELECT * FROM exercise_catalog ORDER BY body_area, name COLLATE NOCASE").all();
      const workouts = db.prepare(`
        SELECT w.*, p.name AS person_name, p.color AS person_color, p.phone AS person_phone
        FROM workouts w JOIN people p ON p.id = w.person_id
        ORDER BY w.workout_date DESC, w.id DESC
      `).all();
      const exercises = db.prepare("SELECT * FROM exercises WHERE workout_id = ? ORDER BY id");
      return { people, catalog, workouts:workouts.map((item) => ({ ...item, exercises:exercises.all(item.id) })) };
    },
    async addPerson(body) {
      return Number(db.prepare(`
        INSERT INTO people (name, color, birth_date, height, weight, notes, phone) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(body.name, body.color, body.birthDate, body.height, body.weight, body.notes, body.phone).lastInsertRowid);
    },
    async updatePerson(id, body) {
      return db.prepare(`UPDATE people SET name=?, color=?, birth_date=?, height=?, weight=?, notes=?, phone=? WHERE id=?`)
        .run(body.name, body.color, body.birthDate, body.height, body.weight, body.notes, body.phone, id).changes > 0;
    },
    async deletePerson(id) { return db.prepare("DELETE FROM people WHERE id=?").run(id).changes > 0; },
    async addCatalog(area, name) {
      return Number(db.prepare("INSERT INTO exercise_catalog (body_area, name) VALUES (?, ?)").run(area, name).lastInsertRowid);
    },
    async deleteCatalog(id) { return db.prepare("DELETE FROM exercise_catalog WHERE id=?").run(id).changes > 0; },
    async addWorkout(body) {
      db.exec("BEGIN");
      try {
        const id = Number(db.prepare(`
          INSERT INTO workouts (person_id, workout_date, duration, notes, rpe, trainer) VALUES (?, ?, ?, ?, ?, ?)
        `).run(body.personId, body.date, body.duration, body.notes, body.rpe, body.operator).lastInsertRowid);
        const insert = db.prepare(`
          INSERT INTO exercises (workout_id, body_area, name, sets, reps, weight, seconds, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of body.exercises) insert.run(id, item.bodyArea, item.name, item.sets, item.reps, item.weight, item.seconds, item.phase);
        db.exec("COMMIT");
        return id;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async updateWorkout(id, body) {
      db.exec("BEGIN");
      try {
        const changes = db.prepare(`
          UPDATE workouts SET person_id=?, workout_date=?, duration=?, notes=?, rpe=?, trainer=? WHERE id=?
        `).run(body.personId, body.date, body.duration, body.notes, body.rpe, body.operator, id).changes;
        if (!changes) {
          db.exec("ROLLBACK");
          return false;
        }
        db.prepare("DELETE FROM exercises WHERE workout_id=?").run(id);
        const insert = db.prepare(`
          INSERT INTO exercises (workout_id, body_area, name, sets, reps, weight, seconds, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of body.exercises) insert.run(id, item.bodyArea, item.name, item.sets, item.reps, item.weight, item.seconds, item.phase);
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async updateWorkoutGroup(ids, body) {
      const targetId = Number(ids[0]);
      db.exec("BEGIN");
      try {
        const placeholders = ids.map(() => "?").join(",");
        const existing = db.prepare(`SELECT id FROM workouts WHERE id IN (${placeholders}) ORDER BY id`).all(...ids);
        if (!existing.length) {
          db.exec("ROLLBACK");
          return false;
        }
        db.prepare(`
          UPDATE workouts SET person_id=?, workout_date=?, duration=?, notes=?, rpe=?, trainer=? WHERE id=?
        `).run(body.personId, body.date, body.duration, body.notes, body.rpe, body.operator, targetId);
        db.prepare("DELETE FROM exercises WHERE workout_id=?").run(targetId);
        const insert = db.prepare(`
          INSERT INTO exercises (workout_id, body_area, name, sets, reps, weight, seconds, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of body.exercises) insert.run(targetId, item.bodyArea, item.name, item.sets, item.reps, item.weight, item.seconds, item.phase);
        const extraIds = ids.filter((id) => Number(id) !== targetId);
        if (extraIds.length) {
          db.prepare(`DELETE FROM workouts WHERE id IN (${extraIds.map(() => "?").join(",")})`).run(...extraIds);
        }
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async prepareRpeLink(id, token) {
      db.prepare("UPDATE workouts SET rpe_token=CASE WHEN rpe_token = '' THEN ? ELSE rpe_token END WHERE id=?").run(token, id);
      return db.prepare(`
        SELECT w.id, w.workout_date, w.rpe_token, p.name AS person_name, p.phone AS person_phone
        FROM workouts w JOIN people p ON p.id = w.person_id
        WHERE w.id = ?
      `).get(id) || null;
    },
    async prepareRpeGroupLink(ids, token) {
      const placeholders = ids.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT w.id, w.workout_date, w.rpe_token, p.name AS person_name, p.phone AS person_phone
        FROM workouts w JOIN people p ON p.id = w.person_id
        WHERE w.id IN (${placeholders})
        ORDER BY w.workout_date DESC, w.id
      `).all(...ids);
      if (!rows.length) return null;
      const sharedToken = rows.find((item) => item.rpe_token)?.rpe_token || token;
      db.prepare(`UPDATE workouts SET rpe_token=? WHERE id IN (${placeholders})`).run(sharedToken, ...ids);
      return { ...rows[0], rpe_token:sharedToken };
    },
    async workoutByRpeToken(token) {
      return db.prepare(`
        SELECT w.id, w.workout_date, w.rpe, w.rpe_token, p.name AS person_name
        FROM workouts w JOIN people p ON p.id = w.person_id
        WHERE w.rpe_token = ?
      `).get(token) || null;
    },
    async setRpeByToken(token, rpe) {
      return db.prepare("UPDATE workouts SET rpe=? WHERE rpe_token=?").run(rpe, token).changes > 0;
    },
    async deleteWorkout(id) { return db.prepare("DELETE FROM workouts WHERE id=?").run(id).changes > 0; }
  };
}

function createPostgresStore() {
  const { Pool } = require("pg");
  const sslEnabled = ["require", "verify-ca", "verify-full"].includes(process.env.PGSSLMODE) ||
    /[?&]sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:sslEnabled ? { rejectUnauthorized:false } : false,
    max:Number(process.env.PG_POOL_MAX || 8),
    idleTimeoutMillis:30_000,
    connectionTimeoutMillis:10_000,
    statement_timeout:15_000,
    query_timeout:20_000,
    allowExitOnIdle:false
  });
  pool.on("error", (error) => console.error("Errore PostgreSQL inatteso:", error.message));
  const query = (text, params = []) => pool.query(text, params);

  return {
    type:"postgres",
    async ping() {
      const result = await query("SELECT 1 AS ok");
      return result.rows[0]?.ok === 1;
    },
    async close() { await pool.end(); },
    async init() {
      await query(`
        CREATE TABLE IF NOT EXISTS people (
          id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6c63ff',
          birth_date TEXT NOT NULL DEFAULT '', height DOUBLE PRECISION NOT NULL DEFAULT 0,
          weight DOUBLE PRECISION NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS workouts (
          id BIGSERIAL PRIMARY KEY, person_id BIGINT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          workout_date TEXT NOT NULL, duration INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
          rpe INTEGER NOT NULL DEFAULT 0, trainer TEXT NOT NULL DEFAULT '',
          rpe_token TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS exercises (
          id BIGSERIAL PRIMARY KEY, workout_id BIGINT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
          body_area TEXT NOT NULL, name TEXT NOT NULL, sets INTEGER NOT NULL DEFAULT 0,
          reps INTEGER NOT NULL DEFAULT 0, weight DOUBLE PRECISION NOT NULL DEFAULT 0,
          seconds INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'main'
        );
        CREATE TABLE IF NOT EXISTS exercise_catalog (
          id BIGSERIAL PRIMARY KEY, body_area TEXT NOT NULL, name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(body_area, name)
        );
        ALTER TABLE people ADD COLUMN IF NOT EXISTS birth_date TEXT NOT NULL DEFAULT '';
        ALTER TABLE people ADD COLUMN IF NOT EXISTS height DOUBLE PRECISION NOT NULL DEFAULT 0;
        ALTER TABLE people ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION NOT NULL DEFAULT 0;
        ALTER TABLE people ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
        ALTER TABLE people ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
        ALTER TABLE workouts ADD COLUMN IF NOT EXISTS rpe INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE workouts ADD COLUMN IF NOT EXISTS trainer TEXT NOT NULL DEFAULT '';
        ALTER TABLE workouts ADD COLUMN IF NOT EXISTS rpe_token TEXT NOT NULL DEFAULT '';
        ALTER TABLE exercises ADD COLUMN IF NOT EXISTS seconds INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE exercises ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'main';
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'workouts' AND column_name = 'operator'
          ) THEN
            EXECUTE 'UPDATE workouts SET trainer = "operator" WHERE trainer = '''' AND "operator" <> ''''';
          END IF;
        END $$;
        UPDATE exercises SET body_area = 'Dorso' WHERE body_area = 'Schiena';
        UPDATE exercise_catalog SET body_area = 'Dorso' WHERE body_area = 'Schiena';
        CREATE INDEX IF NOT EXISTS idx_workouts_person_date ON workouts(person_id, workout_date DESC);
        CREATE INDEX IF NOT EXISTS idx_exercises_workout ON exercises(workout_id);
        CREATE INDEX IF NOT EXISTS idx_catalog_area_name ON exercise_catalog(body_area, name);
      `);
      for (const [area, names] of Object.entries(defaultCatalog)) {
        for (const name of names) {
          await query(
            "INSERT INTO exercise_catalog (body_area, name) VALUES ($1,$2) ON CONFLICT (body_area, name) DO NOTHING",
            [area, name]
          );
        }
      }
    },
    async dashboard() {
      const [people, catalog, workouts, exercises] = await Promise.all([
        query("SELECT * FROM people ORDER BY name"),
        query("SELECT * FROM exercise_catalog ORDER BY body_area, LOWER(name)"),
        query(`SELECT w.*, p.name AS person_name, p.color AS person_color, p.phone AS person_phone
          FROM workouts w JOIN people p ON p.id=w.person_id
          ORDER BY w.workout_date DESC, w.id DESC`),
        query("SELECT * FROM exercises ORDER BY id")
      ]);
      const byWorkout = new Map();
      for (const exercise of exercises.rows) {
        const key = String(exercise.workout_id);
        if (!byWorkout.has(key)) byWorkout.set(key, []);
        byWorkout.get(key).push(exercise);
      }
      return {
        people:people.rows.map((item) => ({ ...item, id:Number(item.id) })),
        catalog:catalog.rows.map((item) => ({ ...item, id:Number(item.id) })),
        workouts:workouts.rows.map((item) => ({
          ...item,
          id:Number(item.id),
          person_id:Number(item.person_id),
          exercises:(byWorkout.get(String(item.id)) || []).map((exercise) => ({
            ...exercise,
            id:Number(exercise.id),
            workout_id:Number(exercise.workout_id)
          }))
        }))
      };
    },
    async addPerson(body) {
      const result = await query(`
        INSERT INTO people (name,color,birth_date,height,weight,notes,phone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
      `, [body.name, body.color, body.birthDate, body.height, body.weight, body.notes, body.phone]);
      return Number(result.rows[0].id);
    },
    async updatePerson(id, body) {
      const result = await query(`UPDATE people SET name=$1,color=$2,birth_date=$3,height=$4,weight=$5,notes=$6,phone=$7 WHERE id=$8`,
        [body.name, body.color, body.birthDate, body.height, body.weight, body.notes, body.phone, id]);
      return result.rowCount > 0;
    },
    async deletePerson(id) {
      const result = await query("DELETE FROM people WHERE id=$1", [id]);
      return result.rowCount > 0;
    },
    async addCatalog(area, name) {
      const result = await query("INSERT INTO exercise_catalog (body_area,name) VALUES ($1,$2) RETURNING id", [area, name]);
      return Number(result.rows[0].id);
    },
    async deleteCatalog(id) {
      const result = await query("DELETE FROM exercise_catalog WHERE id=$1", [id]);
      return result.rowCount > 0;
    },
    async addWorkout(body) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(`
          INSERT INTO workouts (person_id,workout_date,duration,notes,rpe,trainer) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
        `, [body.personId, body.date, body.duration, body.notes, body.rpe, body.operator]);
        const id = Number(result.rows[0].id);
        for (const item of body.exercises) {
          await client.query(`
            INSERT INTO exercises (workout_id,body_area,name,sets,reps,weight,seconds,phase) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `, [id, item.bodyArea, item.name, item.sets, item.reps, item.weight, item.seconds, item.phase]);
        }
        await client.query("COMMIT");
        return id;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async updateWorkout(id, body) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(`
          UPDATE workouts SET person_id=$1,workout_date=$2,duration=$3,notes=$4,rpe=$5,trainer=$6 WHERE id=$7
        `, [body.personId, body.date, body.duration, body.notes, body.rpe, body.operator, id]);
        if (!result.rowCount) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query("DELETE FROM exercises WHERE workout_id=$1", [id]);
        for (const item of body.exercises) {
          await client.query(`
            INSERT INTO exercises (workout_id,body_area,name,sets,reps,weight,seconds,phase) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `, [id, item.bodyArea, item.name, item.sets, item.reps, item.weight, item.seconds, item.phase]);
        }
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async updateWorkoutGroup(ids, body) {
      const targetId = Number(ids[0]);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query("SELECT id FROM workouts WHERE id = ANY($1::bigint[]) ORDER BY id", [ids]);
        if (!existing.rowCount) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(`
          UPDATE workouts SET person_id=$1,workout_date=$2,duration=$3,notes=$4,rpe=$5,trainer=$6 WHERE id=$7
        `, [body.personId, body.date, body.duration, body.notes, body.rpe, body.operator, targetId]);
        await client.query("DELETE FROM exercises WHERE workout_id=$1", [targetId]);
        for (const item of body.exercises) {
          await client.query(`
            INSERT INTO exercises (workout_id,body_area,name,sets,reps,weight,seconds,phase) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `, [targetId, item.bodyArea, item.name, item.sets, item.reps, item.weight, item.seconds, item.phase]);
        }
        const extraIds = ids.filter((id) => Number(id) !== targetId);
        if (extraIds.length) await client.query("DELETE FROM workouts WHERE id = ANY($1::bigint[])", [extraIds]);
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async prepareRpeLink(id, token) {
      await query("UPDATE workouts SET rpe_token=CASE WHEN rpe_token = '' THEN $1 ELSE rpe_token END WHERE id=$2", [token, id]);
      const result = await query(`
        SELECT w.id, w.workout_date, w.rpe_token, p.name AS person_name, p.phone AS person_phone
        FROM workouts w JOIN people p ON p.id = w.person_id
        WHERE w.id=$1
      `, [id]);
      return result.rows[0] ? { ...result.rows[0], id:Number(result.rows[0].id) } : null;
    },
    async prepareRpeGroupLink(ids, token) {
      const current = await query(`
        SELECT w.id, w.workout_date, w.rpe_token, p.name AS person_name, p.phone AS person_phone
        FROM workouts w JOIN people p ON p.id = w.person_id
        WHERE w.id = ANY($1::bigint[])
        ORDER BY w.workout_date DESC, w.id
      `, [ids]);
      if (!current.rowCount) return null;
      const sharedToken = current.rows.find((item) => item.rpe_token)?.rpe_token || token;
      await query("UPDATE workouts SET rpe_token=$1 WHERE id = ANY($2::bigint[])", [sharedToken, ids]);
      return { ...current.rows[0], id:Number(current.rows[0].id), rpe_token:sharedToken };
    },
    async workoutByRpeToken(token) {
      const result = await query(`
        SELECT w.id, w.workout_date, w.rpe, w.rpe_token, p.name AS person_name
        FROM workouts w JOIN people p ON p.id = w.person_id
        WHERE w.rpe_token=$1
      `, [token]);
      return result.rows[0] ? { ...result.rows[0], id:Number(result.rows[0].id) } : null;
    },
    async setRpeByToken(token, rpe) {
      const result = await query("UPDATE workouts SET rpe=$1 WHERE rpe_token=$2", [rpe, token]);
      return result.rowCount > 0;
    },
    async deleteWorkout(id) {
      const result = await query("DELETE FROM workouts WHERE id=$1", [id]);
      return result.rowCount > 0;
    }
  };
}

module.exports = {
  defaultCatalog,
  createStore:() => process.env.DATABASE_URL ? createPostgresStore() : createSqliteStore()
};
