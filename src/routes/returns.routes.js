const { Router } = require('express')
const router = Router()
const { searchLoansHandler, getAllActiveLoansHandler, getLoanHandler, registerReturnHandler, getHistorialHandler } = require('../controllers/returns.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario } = require('../middlewares/roles')

// Solo bibliotecario y admin

router.get('/activos', verifyToken, isBibliotecario, getAllActiveLoansHandler)
router.get('/search', verifyToken, isBibliotecario, searchLoansHandler)
router.get('/historial', verifyToken, isBibliotecario, getHistorialHandler)
router.get('/:id', verifyToken, isBibliotecario, getLoanHandler)           // ← siempre al final
router.post('/:id/devolver', verifyToken, isBibliotecario, registerReturnHandler)

module.exports = router