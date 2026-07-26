const { Router } = require('express')
const router = Router()
const {
  createLoanHandler,
  respondLoanDetailHandler,
  respondLoanDetailsBatchHandler,
  activateLoanHandler,
  cancelLoanHandler,
  cancelLoanSmartHandler,
  getLoansHandler,
  getLoanHandler,
  renewLoanHandler,
  approveRenewalHandler,
  rejectRenewalHandler,
  cancelRenewalHandler
} = require('../controllers/loans.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario, checkNotSancionado } = require('../middlewares/roles')

// Usuario autenticado
router.get('/', verifyToken, getLoansHandler)
router.get('/:id', verifyToken, getLoanHandler)
router.post('/', verifyToken, checkNotSancionado, createLoanHandler)
router.patch('/:id/cancel', verifyToken, cancelLoanHandler)
router.patch('/:id/cancel-smart', verifyToken, cancelLoanSmartHandler)
router.patch('/:id/renew', verifyToken, checkNotSancionado, renewLoanHandler)
router.patch('/:id/renew/cancel', verifyToken, cancelRenewalHandler)
router.patch('/:id/renew/approve', verifyToken, isBibliotecario, approveRenewalHandler)
router.patch('/:id/renew/reject', verifyToken, isBibliotecario, rejectRenewalHandler)

// Gestión de préstamos — bibliotecario y admin
router.patch('/:id/detalle/:id_ejemplar', verifyToken, isBibliotecario, respondLoanDetailHandler)
router.patch('/:id/detalle-batch', verifyToken, isBibliotecario, respondLoanDetailsBatchHandler)
router.patch('/:id/activate', verifyToken, isBibliotecario, activateLoanHandler)

module.exports = router