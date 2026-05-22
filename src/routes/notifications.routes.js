const { Router } = require('express')
const router = Router()
const { getNotificacionesHandler, marcarLeidaHandler, marcarTodasLeidasHandler } = require('../controllers/notifications.controller')
const { verifyToken } = require('../middlewares/auth')

router.get('/', verifyToken, getNotificacionesHandler)
router.patch('/:id/leida', verifyToken, marcarLeidaHandler)
router.patch('/leidas', verifyToken, marcarTodasLeidasHandler)

module.exports = router