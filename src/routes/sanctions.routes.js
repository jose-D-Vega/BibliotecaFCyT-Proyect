const { Router } = require('express')
const router = Router()
const {
  createSanctionHandler, confirmSanctionHandler, rejectSanctionHandler,
  getSanctionsHandler, getSanctionHandler,
  resolveSanctionHandler, escalateSanctionHandler, getMySanctionsHandler
} = require('../controllers/sanctions.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario } = require('../middlewares/roles')

// Usuario — sus propias sanciones
router.get('/mis-sanciones', verifyToken, getMySanctionsHandler)

// Admin y bibliotecario — consultar
router.get('/', verifyToken, isBibliotecario, getSanctionsHandler)
router.get('/:id', verifyToken, isBibliotecario, getSanctionHandler)

// Solo admin — registrar y gestionar
router.post('/', verifyToken, isAdmin, createSanctionHandler)
router.patch('/:id/resolver', verifyToken, isAdmin, resolveSanctionHandler)
router.patch('/:id/escalar', verifyToken, isAdmin, escalateSanctionHandler)
router.patch('/:id/confirmar', verifyToken, isAdmin, confirmSanctionHandler)
router.patch('/:id/rechazar', verifyToken, isAdmin, rejectSanctionHandler)

module.exports = router

