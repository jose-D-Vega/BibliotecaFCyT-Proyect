const { Router } = require('express')
const router = Router()
const { getUsers, getUser, updateOwnProfile, changeUserRol, toggleUserActivo, getTipos } = require('../controllers/users.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin } = require('../middlewares/roles')

// Cualquier usuario autenticado
router.get('/tipos', verifyToken, getTipos)
router.get('/:id', verifyToken, getUser)
router.put('/me', verifyToken, updateOwnProfile)

// Solo bibliotecario
router.get('/', verifyToken, isAdmin, getUsers)
router.patch('/:id/rol', verifyToken, isAdmin, changeUserRol)
router.patch('/:id/activo', verifyToken, isAdmin, toggleUserActivo)

module.exports = router