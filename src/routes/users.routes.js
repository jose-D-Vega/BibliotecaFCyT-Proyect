const { Router } = require('express')
const router = Router()
const {
  getUsers, getUser, updateOwnProfile, changeUserRol,
  toggleUserActivo, getTipos, updateCiHandler, deleteUserHandler
} = require('../controllers/users.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin } = require('../middlewares/roles')

// IMPORTANTÍSIMO: /tipos debe ir ANTES de cualquier ruta con /:id
// Cualquier usuario autenticado puede ver los tipos de roles
router.get('/tipos', verifyToken, getTipos)

// Rutas de perfil propio o individual
router.get('/:id', verifyToken, getUser)
router.put('/me', verifyToken, updateOwnProfile)

// Solo admin puede listar usuarios, cambiar roles, activar/desactivar cuentas, actualizar cédula y eliminar usuarios
router.get('/', verifyToken, isAdmin, getUsers)
router.patch('/:id/rol', verifyToken, isAdmin, changeUserRol)
router.patch('/:id/activo', verifyToken, isAdmin, toggleUserActivo)
router.patch('/:id/ci', verifyToken, isAdmin, updateCiHandler)
router.delete('/:id', verifyToken, isAdmin, deleteUserHandler)

module.exports = router