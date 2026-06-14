const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const { createStore } = require("../db");

if (!process.env.DATABASE_URL) {
  throw new Error("Imposta DATABASE_URL con l'indirizzo PostgreSQL di Railway.");
}
if (process.env.CONFIRM_MIGRATION !== "yes") {
  throw new Error("Per confermare la migrazione imposta CONFIRM_MIGRATION=yes.");
}

async function main() {
  const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "fittrack.db");
  const sqlite = new DatabaseSync(sqlitePath, { readOnly:true });
  const sslEnabled = ["require", "verify-ca", "verify-full"].includes(process.env.PGSSLMODE) ||
    /[?&]sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:sslEnabled ? { rejectUnauthorized:false } : false
  });

  const store = createStore();
  await store.init();
  await store.close();

  const people = sqlite.prepare("SELECT * FROM people ORDER BY id").all();
  const workouts = sqlite.prepare("SELECT * FROM workouts ORDER BY id").all();
  const exercises = sqlite.prepare("SELECT * FROM exercises ORDER BY id").all();
  const catalog = sqlite.prepare("SELECT * FROM exercise_catalog ORDER BY id").all();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE exercises, workouts, people, exercise_catalog RESTART IDENTITY CASCADE");

    for (const item of people) {
      await client.query(`
        INSERT INTO people (id,name,color,birth_date,height,weight,notes,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        item.id, item.name, item.color, item.birth_date || "", item.height || 0,
        item.weight || 0, item.notes || "", item.created_at
      ]);
    }
    for (const item of workouts) {
      await client.query(`
        INSERT INTO workouts (id,person_id,workout_date,duration,notes,created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [item.id, item.person_id, item.workout_date, item.duration, item.notes, item.created_at]);
    }
    for (const item of exercises) {
      await client.query(`
        INSERT INTO exercises (id,workout_id,body_area,name,sets,reps,weight)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [item.id, item.workout_id, item.body_area, item.name, item.sets, item.reps, item.weight]);
    }
    for (const item of catalog) {
      await client.query(`
        INSERT INTO exercise_catalog (id,body_area,name,created_at) VALUES ($1,$2,$3,$4)
      `, [item.id, item.body_area, item.name, item.created_at]);
    }

    for (const table of ["people", "workouts", "exercises", "exercise_catalog"]) {
      await client.query(`
        SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)
      `, [table]);
    }
    await client.query("COMMIT");
    console.log(`Migrazione completata: ${people.length} persone, ${workouts.length} allenamenti, ${exercises.length} esercizi.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migrazione non riuscita:", error.message);
  process.exitCode = 1;
});
