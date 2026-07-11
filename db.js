const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for connecting to Supabase from local/external servers
  }
});

pool.on('connect', () => {
  console.log('✅ Connected to MegaPlay PostgreSQL Database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error', err);
  process.exit(-1);
});

module.exports = pool;