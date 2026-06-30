const { Router } = require('express')
const router = Router()
const {
  createSanctionHandler, confirmSanctionHandler, rejectSanctionHandler,
  getSanctionsHandler, getSanctionHandler, desescalateSanctionHandler,
  resolveSanctionHandler, escalateSanctionHandler, getMySanctionsHandler,
  getSanctionsGroupedHandler, getSanctionsByLoanHandler,
  searchSanctionableLoansHandler, getLoanForSanctionHandler,
  getSancionesComportamientoAgrupadasHandler, getSancionesComportamientoByUsuarioHandler
} = require('../controllers/sanctions.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario } = require('../middlewares/roles')

// Usuario — sus propias sanciones
router.get('/mis-sanciones', verifyToken, getMySanctionsHandler)

// Admin — buscar préstamos sancionables y ver sus ejemplares (IMPORTANTE: antes de /:id)
router.get('/buscar-prestamo', verifyToken, isAdmin, searchSanctionableLoansHandler)
router.get('/prestamo/:id_prestamo/ejemplares', verifyToken, isAdmin, getLoanForSanctionHandler)

// Admin y bibliotecario — consultar
router.get('/agrupadas', verifyToken, isAdmin, getSanctionsGroupedHandler)
router.get('/comportamiento', verifyToken, isAdmin, getSancionesComportamientoAgrupadasHandler)
router.get('/comportamiento/usuario/:id_usuario', verifyToken, isAdmin, getSancionesComportamientoByUsuarioHandler)
router.get('/prestamo/:id_prestamo', verifyToken, isAdmin, getSanctionsByLoanHandler)
router.get('/', verifyToken, isBibliotecario, getSanctionsHandler)
router.get('/:id', verifyToken, isBibliotecario, getSanctionHandler)

// Solo admin — registrar y gestionar
router.post('/', verifyToken, isAdmin, createSanctionHandler)
router.patch('/:id/resolver', verifyToken, isAdmin, resolveSanctionHandler)
router.patch('/:id/escalar', verifyToken, isAdmin, escalateSanctionHandler)
router.patch('/:id/desescalar', verifyToken, isAdmin, desescalateSanctionHandler)
router.patch('/:id/confirmar', verifyToken, isAdmin, confirmSanctionHandler)
router.patch('/:id/rechazar', verifyToken, isAdmin, rejectSanctionHandler)

module.exports = router