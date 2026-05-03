const isAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de admin' })
  }
  next()
}

const isBibliotecario = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  if (!['bibliotecario', 'admin'].includes(req.user.rol)) {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de bibliotecario o admin' })
  }
  next()
}

const isNormal = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  next()
}

module.exports = { isAdmin, isBibliotecario, isNormal }