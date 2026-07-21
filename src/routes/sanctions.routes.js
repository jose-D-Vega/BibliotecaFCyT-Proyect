const { Router } = require('express')
const router = Router()
const {
  createSanctionHandler, confirmSanctionHandler, rejectSanctionHandler,
  getSanctionsHandler, getSanctionHandler, desescalateSanctionHandler,
  resolveSanctionHandler, escalateSanctionHandler, getMySanctionsHandler,
  getSanctionsGroupedHandler, getSanctionsByLoanHandler,
  searchSanctionableLoansHandler, getLoanForSanctionHandler,
  getSancionesComportamientoAgrupadasHandler, getSancionesComportamientoByUsuarioHandler,
  getAllSanctionsByLoanHandler, getAllSancionesComportamientoByUsuarioHandler,
  editSanctionHandler,
} = require('../controllers/sanctions.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario } = require('../middlewares/roles')

// Usuario — sus propias sanciones
router.get('/mis-sanciones', verifyToken, getMySanctionsHandler)

// Admin — buscar préstamos sancionables y ver sus ejemplares (IMPORTANTE: antes de /:id)
router.get('/buscar-prestamo', verifyToken, isBibliotecario, searchSanctionableLoansHandler)
router.get('/prestamo/:id_prestamo/ejemplares', verifyToken, isBibliotecario, getLoanForSanctionHandler)
router.get('/prestamo/:id_prestamo/todas', verifyToken, isBibliotecario, getAllSanctionsByLoanHandler)
router.get('/comportamiento/usuario/:id_usuario/todas', verifyToken, isBibliotecario, getAllSancionesComportamientoByUsuarioHandler)

// Admin y bibliotecario — consultar
router.get('/agrupadas', verifyToken, isBibliotecario, getSanctionsGroupedHandler)
router.get('/comportamiento', verifyToken, isBibliotecario, getSancionesComportamientoAgrupadasHandler)
router.get('/comportamiento/usuario/:id_usuario', verifyToken, isBibliotecario, getSancionesComportamientoByUsuarioHandler)
router.get('/prestamo/:id_prestamo', verifyToken, isBibliotecario, getSanctionsByLoanHandler)
router.get('/', verifyToken, isBibliotecario, getSanctionsHandler)
router.get('/:id', verifyToken, isBibliotecario, getSanctionHandler)

// Solo admin — registrar y gestionar
router.post('/', verifyToken, isBibliotecario, createSanctionHandler)
router.patch('/:id/resolver', verifyToken, isBibliotecario, resolveSanctionHandler)
router.patch('/:id/escalar', verifyToken, isBibliotecario, escalateSanctionHandler)
router.patch('/:id/desescalar', verifyToken, isBibliotecario, desescalateSanctionHandler)
router.patch('/:id/confirmar', verifyToken, isBibliotecario, confirmSanctionHandler)
router.patch('/:id/rechazar', verifyToken, isBibliotecario, rejectSanctionHandler)
router.patch('/:id/editar', verifyToken, isBibliotecario, editSanctionHandler)

module.exports = router