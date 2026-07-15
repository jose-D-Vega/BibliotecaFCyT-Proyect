const { Router } = require('express')
const router = Router()
const { getConfigReportesHandler, generarReporteHandler } = require('../controllers/reports.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario } = require('../middlewares/roles')

router.get('/config', verifyToken, isBibliotecario, getConfigReportesHandler)
router.get('/generar', verifyToken, isBibliotecario, generarReporteHandler)

module.exports = router