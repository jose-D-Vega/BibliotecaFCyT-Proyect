const { Router } = require('express')
const router = Router()
const { getSesionesHandler } = require('../controllers/session.controller')
const { verifyToken } = require('../middlewares/auth')
const { isAdmin } = require('../middlewares/roles')

// Solo admin puede ver el historial de sesiones
router.get('/', verifyToken, isAdmin, getSesionesHandler)

module.exports = router