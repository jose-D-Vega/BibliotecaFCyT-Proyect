const { Router } = require('express')
const router = Router()
const passport = require('../config/passport')
const { verifyToken } = require('../middlewares/auth')
const { handleGoogleCallback, getMeHandler } = require('../controllers/auth.controller')


// Iniciar login con Google — el frontend redirige al usuario a esta URL
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false
}))

// Callback de Google — Google redirige aquí después del login
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=dominio_invalido` }),
  handleGoogleCallback
)

// Obtener datos del usuario autenticado (para que el frontend verifique el token)
router.get('/me', verifyToken, getMeHandler)

module.exports = router