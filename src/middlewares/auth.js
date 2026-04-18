const jwt = require('jsonwebtoken')

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // formato: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded // { id_usuario, correo, tipo_usuario, rol }
    next()
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido o expirado' })
  }
}

module.exports = { verifyToken }