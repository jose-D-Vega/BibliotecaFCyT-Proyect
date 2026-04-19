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
const { isAdmin } = require('../middlewares/roles')

// Usuario autenticado
router.get('/', verifyToken, getLoansHandler)
router.get('/:id', verifyToken, getLoanHandler)
router.post('/', verifyToken, createLoanHandler)
router.patch('/:id/cancel', verifyToken, cancelLoanHandler)
router.patch('/:id/renew', verifyToken, renewLoanHandler)

// Solo bibliotecario
router.patch('/:id/detalle/:id_ejemplar', verifyToken, isAdmin, respondLoanDetailHandler)
router.patch('/:id/activate', verifyToken, isAdmin, activateLoanHandler)

module.exports = router