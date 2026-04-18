const { Router } = require('express')
const router = Router()
const pool = require('../config/db')

router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1') // consulta mínima para verificar la DB
    res.json({
      status: 'ok',
      message: 'Servidor funcionando',
      database: 'conectada'
    })
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Fallo la conexión a la base de datos',
      error: error.message
    })
  }
})

module.exports = router