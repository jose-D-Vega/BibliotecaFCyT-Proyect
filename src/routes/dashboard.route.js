const express = require('express')
const router = express.Router()
const { getDashboardStatsHandler } = require('../controllers/dashboard.controller')
const { verifyToken } = require('../middlewares/auth') // ajustá la ruta al archivo real si es distinta

router.get('/mis-estadisticas', verifyToken, getDashboardStatsHandler)

module.exports = router