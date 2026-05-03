const { Router } = require('express')
const router = Router({ mergeParams: true }) // mergeParams para acceder a id_libro del padre
const { getCopies, getCopy, addCopy, updateStatus, removeCopy } = require('../controllers/copies.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario } = require('../middlewares/roles')

// Públicas — cualquiera puede ver los ejemplares de un libro
router.get('/', getCopies)
router.get('/:id', getCopy)

// Solo bibliotecario
router.post('/', verifyToken, isBibliotecario, addCopy)
router.patch('/:id/estado', verifyToken, isAdmin, updateStatus)
router.delete('/:id', verifyToken, isAdmin, removeCopy)

module.exports = router