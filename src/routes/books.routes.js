const { Router } = require('express')
const router = Router()
const { getBooks, getBook, createBookHandler, updateBookHandler, deleteBookHandler } = require('../controllers/books.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario, isAdmin } = require('../middlewares/roles')
const upload = require('../middlewares/upload')


// Rutas públicas — cualquiera puede ver el catálogo
router.get('/', getBooks)
router.get('/:id', getBook)

// Rutas protegidas — solo bibliotecario o admin
// Ocultar libro — bibliotecario y admin
// router.patch('/:id/visibilidad', verifyToken, isBibliotecario, toggleVisibilidadHandler)

// Eliminar libro — solo admin
router.delete('/:id', verifyToken, isAdmin, deleteBookHandler)

// Crear y editar — bibliotecario y admin
router.post('/', verifyToken, isBibliotecario, upload.single('imagen'), createBookHandler)
router.put('/:id', verifyToken, isBibliotecario, upload.single('imagen'), updateBookHandler)

module.exports = router