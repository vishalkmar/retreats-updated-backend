const { sequelize } = require('./src/config/database');
const tables = ['available_rooms','packages','events','add_on_activities','event_activities'];
(async () => {
  for (const t of tables) {
    try {
      const [c] = await sequelize.query(`SHOW COLUMNS FROM ${t} LIKE 'gstRate'`);
      if (c.length) { console.log(`${t}: gstRate exists`); continue; }
      await sequelize.query(`ALTER TABLE ${t} ADD COLUMN gstRate INT NOT NULL DEFAULT 0`);
      console.log(`${t}: gstRate added`);
    } catch (e) { console.log(`${t}: ERR ${e.message}`); }
  }
  process.exit(0);
})();
