import path from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './seed.js';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'server', 'data', 'app.db');
const port = Number(process.env.PORT || 3000);

const db = openDatabase(dbPath);
await seedIfEmpty(db);

const app = createApp(db);
app.listen(port, () => {
  console.log(`FPC procurement server on http://localhost:${port}`);
});
