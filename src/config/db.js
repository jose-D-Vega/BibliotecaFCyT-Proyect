const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // requerido por Supabase
})

pool.connect()
  .then(() => console.log('Conectado a la base de datos'))
  .catch((err) => console.error('Error al conectar a la base de datos:', err))

module.exports = pool