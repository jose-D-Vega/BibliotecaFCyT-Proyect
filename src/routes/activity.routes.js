const { Router } = require('express')
const router = Router()
const { getActividadesHandler } = require('../controllers/activity.controller')
const { verifyToken } = require('../middlewares/auth')
const { isBibliotecario } = require('../middlewares/roles')

// Solo bibliotecario y admin pueden ver el historial — nadie puede modificarlo
router.get('/', verifyToken, isBibliotecario, getActividadesHandler)

module.exports = router