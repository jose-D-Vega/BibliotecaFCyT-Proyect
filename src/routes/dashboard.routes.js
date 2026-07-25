const express = require('express')
const router = express.Router()
const { getDashboardStatsHandler, getStaffDashboardStatsHandler } = require('../controllers/dashboard.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario } = require('../middlewares/roles')

// Usuario normal — sus propias estadísticas
router.get('/mis-estadisticas', verifyToken, getDashboardStatsHandler)

// Bibliotecario y admin — estadísticas globales del sistema
// (isBibliotecario permite ambos roles; el handler agrega paneles extra si es admin)
router.get('/staff-estadisticas', verifyToken, isBibliotecario, getStaffDashboardStatsHandler)

module.exports = router