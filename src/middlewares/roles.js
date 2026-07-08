const pool = require('../config/db')

const isAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  const userRol = req.user.rol ? req.user.rol.toLowerCase() : ''
  if (userRol === 'admin' || userRol === 'bibliotecario') return next()
  return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de admin o bibliotecario' })
}

const isBibliotecario = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  const userRol = req.user.rol ? req.user.rol.toLowerCase() : ''
  if (!['bibliotecario', 'admin'].includes(userRol)) {
    return res.status(403).json({ error: 'Acceso denegado.' })
  }
  next()
}

const isNormal = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  next()
}

// Verifica en la BD que el usuario autenticado no tenga sanciones activas.
const checkNotSancionado = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT sancionado FROM usuarios WHERE id_usuario = $1`,
      [req.user.id_usuario]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' })
    if (rows[0].sancionado) {
      return res.status(403).json({
        code: 'USUARIO_SANCIONADO',
        error: 'Tu cuenta tiene sanciones activas. No podés realizar solicitudes de préstamo hasta regularizar tu situación.'
      })
    }
    next()
  } catch (error) {
    console.error('Error al verificar estado de sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { isAdmin, isBibliotecario, isNormal, checkNotSancionado }