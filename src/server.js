require('dotenv').config();
const app = require('./app');
const { sequelize, connectDB } = require('./config/database');
require('./models'); // load models

const PORT = process.env.PORT || 5000;

const codeOf = (err) => err?.original?.code || err?.parent?.code || err?.code;

const isDeadlock = (err) =>
  codeOf(err) === 'ER_LOCK_DEADLOCK' || codeOf(err) === 'ER_LOCK_WAIT_TIMEOUT';

const isTooManyKeys = (err) => codeOf(err) === 'ER_TOO_MANY_KEYS';

/**
 * Drop duplicate indexes that `sync({alter:true})` accumulates across restarts.
 * Sequelize's alter mode re-issues `... UNIQUE` even when nothing changed, so
 * MySQL ends up with `email`, `email_2`, `email_3`, … and eventually trips
 * the 64-keys-per-table limit. We prune them on every startup so this cannot
 * snowball.
 */
const pruneDuplicateIndexes = async () => {
  const [tables] = await sequelize.query('SHOW TABLES');
  if (!tables.length) return 0;
  const dbField = Object.keys(tables[0])[0];

  let totalDropped = 0;
  for (const row of tables) {
    const table = row[dbField];
    let rows;
    try {
      [rows] = await sequelize.query(`SHOW INDEX FROM \`${table}\``);
    } catch {
      continue;
    }
    const byName = new Map();
    for (const r of rows) {
      if (r.Key_name === 'PRIMARY') continue;
      if (!byName.has(r.Key_name)) byName.set(r.Key_name, { unique: r.Non_unique === 0, cols: [] });
      byName.get(r.Key_name).cols.push({ seq: r.Seq_in_index, name: r.Column_name });
    }
    const groups = new Map();
    for (const [name, { unique, cols }] of byName) {
      const sig = cols.sort((a, b) => a.seq - b.seq).map((c) => c.name).join('|') + (unique ? '#U' : '#I');
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(name);
    }
    for (const names of groups.values()) {
      names.sort(); // keep the lowest-named (`email` over `email_2`)
      for (let i = 1; i < names.length; i++) {
        try {
          await sequelize.query(`ALTER TABLE \`${table}\` DROP INDEX \`${names[i]}\``);
          totalDropped += 1;
        } catch {
          /* some indexes back FK constraints — leave them alone */
        }
      }
    }
  }
  return totalDropped;
};

const syncWithRetry = async (opts, attempts = 5) => {
  for (let i = 0; i < attempts; i++) {
    try {
      await sequelize.sync(opts);
      return;
    } catch (err) {
      if (isDeadlock(err) && i < attempts - 1) {
        const wait = 1500 * (i + 1);
        console.warn(`[DB] Sync hit ${codeOf(err)} — retry ${i + 1}/${attempts} after ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (isTooManyKeys(err) && i < attempts - 1) {
        const dropped = await pruneDuplicateIndexes();
        console.warn(`[DB] ER_TOO_MANY_KEYS — pruned ${dropped} duplicate indexes, retrying…`);
        continue;
      }
      throw err;
    }
  }
};

const start = async () => {
  await connectDB();

  const skipSync = process.env.SKIP_SYNC === 'true';
  if (!skipSync) {
    // Always prune duplicate indexes BEFORE syncing — keeps the table-key
    // count under MySQL's 64-key cap regardless of how many times the dev
    // server has been restarted.
    const dropped = await pruneDuplicateIndexes();
    if (dropped > 0) console.log(`[DB] Pruned ${dropped} duplicate indexes`);

    const syncOpts = process.env.NODE_ENV === 'production' ? {} : { alter: true };
    await syncWithRetry(syncOpts);
    console.log('[DB] Models synchronized');
  } else {
    console.log('[DB] Skipping sequelize.sync (SKIP_SYNC=true)');
  }

  app.listen(PORT, () => {
    console.log(`[SERVER] Running on http://localhost:${PORT}`);
    console.log(`[SERVER] API base: http://localhost:${PORT}/api`);
  });
};

start().catch((err) => {
  console.error('[SERVER] Failed to start:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
