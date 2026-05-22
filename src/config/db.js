const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // requerido por Supabase
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})

pool.query('SELECT NOW()')
  .then(() => console.log('Conectado a la base de datos'))
  .catch((err) => console.error('Error al conectar:', err))

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de conexiones:', err)
})

module.exports = pool