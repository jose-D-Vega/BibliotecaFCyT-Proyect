const express = require('express')
const router = express.Router()
const { getAdminDashboardStatsHandler } = require('../controllers/adminDashboard.controller')
const { verifyToken } = require('../middlewares/auth')

// Middleware simple: solo permite acceso si el rol real del usuario es admin
const requireAdmin = (req, res, next) => {
  if (req.user?.rol?.toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador' })
  }
  next()
}

router.get('/mis-estadisticas', verifyToken, requireAdmin, getAdminDashboardStatsHandler)

module.exports = router