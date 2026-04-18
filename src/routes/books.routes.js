const { Router } = require('express')
const router = Router()
const { getBooks, getBook, createBookHandler, updateBookHandler, deleteBookHandler } = require('../controllers/books.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin } = require('../middlewares/roles')

// Rutas públicas — cualquiera puede ver el catálogo
router.get('/', getBooks)
router.get('/:id', getBook)

// Rutas protegidas — solo admin
router.post('/', verifyToken, isAdmin, createBookHandler)
router.put('/:id', verifyToken, isAdmin, updateBookHandler)
router.delete('/:id', verifyToken, isAdmin, deleteBookHandler)

module.exports = router