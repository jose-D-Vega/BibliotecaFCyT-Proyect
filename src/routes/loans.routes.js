const { Router } = require('express')
const router = Router()
const {
  createLoanHandler,
  respondLoanDetailHandler,
  activateLoanHandler,
  cancelLoanHandler,
  getLoansHandler,
  getLoanHandler,
  renewLoanHandler
} = require('../controllers/loans.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario } = require('../middlewares/roles')

// Usuario autenticado
router.get('/', verifyToken, getLoansHandler)
router.get('/:id', verifyToken, getLoanHandler)
router.post('/', verifyToken, createLoanHandler)
router.patch('/:id/cancel', verifyToken, cancelLoanHandler)
router.patch('/:id/renew', verifyToken, renewLoanHandler)

// Gestión de préstamos — bibliotecario y admin
router.patch('/:id/detalle/:id_ejemplar', verifyToken, isBibliotecario, respondLoanDetailHandler)
router.patch('/:id/activate', verifyToken, isBibliotecario, activateLoanHandler)

module.exports = router