const { Router } = require('express')
const router = Router()
const { getBooks, getBook, createBookHandler, updateBookHandler, deleteBookHandler } = require('../controllers/books.controller')

// Rutas públicas — cualquiera puede ver el catálogo
router.get('/', getBooks)
router.get('/:id', getBook)

// Rutas protegidas — solo admin
router.post('/', createBookHandler)
router.put('/:id', updateBookHandler)
router.delete('/:id', deleteBookHandler)

module.exports = router