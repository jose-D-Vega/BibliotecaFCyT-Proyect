const { Router } = require('express')
const router = Router()
const passport = require('../config/passport')
const { verifyToken } = require('../middlewares/auth')
const jwt = require('jsonwebtoken')
const pool = require('../config/db')

// Iniciar login con Google — el frontend redirige al usuario a esta URL
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false
}))

// Callback de Google — Google redirige aquí después del login
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=dominio_invalido` }),
  (req, res) => {
    const user = req.user

    // Determinar el rol: si es bibliotecario en la tabla bibliotecarios, es admin
    // Por ahora usamos tipo_usuario de la tabla usuarios
    const payload = {
      id_usuario: user.id_usuario,
      correo: user.correo,
      nombre: user.nombre_apellido,
      rol: user.rol, // rol real en la base de datos
    }

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' })

    // Redirigir al frontend con el token como query param
    // El frontend lo lee, lo guarda y elimina el param de la URL
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`)
  }
)

// Obtener datos del usuario autenticado (para que el frontend verifique el token)
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id_usuario, u.nombre_apellido as nombre, u.correo, u.ci, u.telefono,
              u.sancionado, u.activo, t.nombre_tipo AS rol
       FROM usuarios u
       JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
       WHERE u.id_usuario = $1`,
      [req.user.id_usuario]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' })
    res.json({ data: rows[0] })
  } catch (error) {
    console.error('Error en /me:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

module.exports = router