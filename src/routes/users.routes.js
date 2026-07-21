const { Router } = require('express')
const router = Router()
const {
  getUsers, getUser, updateOwnProfile, changeUserRol,
  toggleUserActivo, getTipos, changeUserTelefono, deleteUserHandler
} = require('../controllers/users.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin, isBibliotecario } = require('../middlewares/roles')

// IMPORTANTÍSIMO: /tipos debe ir ANTES de cualquier ruta con /:id
router.get('/tipos', verifyToken, getTipos)

// Rutas de perfil propio o individual
router.get('/:id', verifyToken, getUser)
router.put('/me', verifyToken, updateOwnProfile)

// Solo admin puede listar usuarios, cambiar roles, activar/desactivar cuentas, actualizar teléfono y eliminar usuarios
router.get('/', verifyToken, isBibliotecario, getUsers)
router.patch('/:id/rol', verifyToken, isAdmin, changeUserRol)
router.patch('/:id/activo', verifyToken, isAdmin, toggleUserActivo)
router.patch('/:id/telefono', verifyToken, isAdmin, changeUserTelefono)
router.delete('/:id', verifyToken, isAdmin, deleteUserHandler)

module.exports = router