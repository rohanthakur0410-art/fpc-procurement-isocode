import path from 'node:path';
import { openDatabase, SqliteQ, type Q } from './db.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './seed.js';

// Hosted demo durability: when DATABASE_URL is set (Render environment), the
// server uses Neon Postgres so data survives restarts/redeploys. Locally and
// in tests it stays on the embedded SQLite file.
const port = Number(process.env.PORT || 3000);

let q: Q;
const pgParts =
  process.env.PGHOST && process.env.PGPASSWORD
    ? {
        host: process.env.PGHOST,
        user: process.env.PGUSER || 'neondb_owner',
        database: process.env.PGDATABASE || 'neondb',
        password: process.env.PGPASSWORD,
      }
    : null;
if (process.env.DATABASE_URL || pgParts) {
  const { createNeonQ } = await import('./pg.js');
  q = (await createNeonQ(process.env.DATABASE_URL ?? pgParts!)).q;
  console.log('Using Neon Postgres (durable mode)');
} else {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'server', 'data', 'app.db');
  q = new SqliteQ(openDatabase(dbPath));
  console.log(`Using SQLite at ${dbPath}`);
}
await seedIfEmpty(q);

const app = createApp(q);
app.listen(port, () => {
  console.log(`FPC procurement server on http://localhost:${port}`);
});
