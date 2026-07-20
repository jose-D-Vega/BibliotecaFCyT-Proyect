const { Router } = require('express')
const router = Router()
const { getConfigReportesHandler, generarReporteHandler, 
    buscarUsuarioHandler, buscarLibroHandler } = require('../controllers/reports.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario } = require('../middlewares/roles')

router.get('/config', verifyToken, isBibliotecario, getConfigReportesHandler)
router.get('/generar', verifyToken, isBibliotecario, generarReporteHandler)
router.get('/buscar-usuario', verifyToken, isBibliotecario, buscarUsuarioHandler)
router.get('/buscar-libro', verifyToken, isBibliotecario, buscarLibroHandler)

module.exports = router