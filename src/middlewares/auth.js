const jwt = require('jsonwebtoken')

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded

    // Leer el rol activo que eligió el usuario en el frontend
    const rolActivo = req.headers['x-rol-activo']

    // Validar que el rol activo sea coherente con el rol real
    // Un admin puede actuar como normal, bibliotecario o admin
    // Un bibliotecario puede actuar como normal o bibliotecario
    // Un normal solo puede actuar como normal
    const rolesPermitidos = {
      normal: ['normal'],
      bibliotecario: ['normal', 'bibliotecario'],
      admin: ['normal', 'bibliotecario', 'admin']
    }

    const permitidos = rolesPermitidos[decoded.rol] || ['normal']
    if (rolActivo && permitidos.includes(rolActivo)) {
      req.user.rolActivo = rolActivo
    } else {
      // Si no hay rolActivo o es inválido, usar el rol real
      req.user.rolActivo = decoded.rol
    }

    next()
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

module.exports = { verifyToken }