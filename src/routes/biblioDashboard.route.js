const express = require('express')
const router = express.Router()

const { getAdminDashboardStatsHandler } = require('../controllers/biblioDashboard.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario } = require('../middlewares/roles')

router.get(
  '/mis-estadisticas',
  verifyToken,
  isBibliotecario,
  getAdminDashboardStatsHandler
)

module.exports = router