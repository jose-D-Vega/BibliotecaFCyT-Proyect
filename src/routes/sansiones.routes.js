const { Router } = require('express')
const router = Router()
const { getMisSanciones, getMiSancionById } = require('../controllers/sanciones.controller')
const { verifyToken } = require('../middlewares/auth')

// Bloquea el acceso a admin y bibliotecario.
// Solo usuarios con rol "normal" pueden ver "sus" sanciones.
const soloUsuarios = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })

  const userRol = req.user.rol ? req.user.rol.toLowerCase() : ''

  if (['admin', 'bibliotecario'].includes(userRol)) {
    return res.status(403).json({ error: 'Este apartado no está disponible para administradores ni bibliotecarios' })
  }

  next()
}

// Usuario normal — ver sus propias sanciones
router.get('/mis-sanciones', verifyToken, soloUsuarios, getMisSanciones)

// Usuario normal — ver el detalle de una sanción propia
router.get('/mis-sanciones/:id', verifyToken, soloUsuarios, getMiSancionById)

module.exports = router