const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' })
  }
  if (req.user.rol !== 'bibliotecario') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de bibliotecario' })
  }
  next()
}

const isNormal = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' })
  }
  next() // cualquier usuario autenticado pasa
}

module.exports = { isAdmin, isNormal }