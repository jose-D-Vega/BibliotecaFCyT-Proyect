const isAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  
  // Convertimos a minúsculas para evitar problemas de escritura
  const userRol = req.user.rol ? req.user.rol.toLowerCase() : ''
  
  // ¡AQUÍ ESTÁ EL CAMBIO! Permitimos el paso si es 'admin' O si es 'bibliotecario'
  if (userRol === 'admin' || userRol === 'bibliotecario') {
    return next() // Deja pasar a la query
  }
  
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

module.exports = { isAdmin, isBibliotecario, isNormal }