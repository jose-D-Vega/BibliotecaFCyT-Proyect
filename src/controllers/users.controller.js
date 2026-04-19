const { getAllUsers, countUsers, getUserById, updateUser, updateUserRol, updateUserActivo, getTiposUsuario } = require('../queries/users.queries')

// Bibliotecario — ver todos los usuarios
const getUsers = async (req, res) => {
  try {
    const { search, rol, activo, page = 1, limit = 20 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const activoFilter = activo !== undefined ? activo === 'true' : undefined
    const filters = { search, rol, activo: activoFilter, limit: parsedLimit, offset }

    const [users, total] = await Promise.all([
      getAllUsers(filters),
      countUsers(filters)
    ])

    res.json({
      data: users,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Error al obtener usuarios:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Bibliotecario — ver un usuario por ID
// Usuario normal — solo puede ver su propio perfil
const getUser = async (req, res) => {
  try {
    const { id } = req.params

    // Un usuario normal solo puede ver su propio perfil
    if (req.user.rol === 'normal' && req.user.id_usuario !== parseInt(id)) {
      return res.status(403).json({ error: 'No tenés permiso para ver este perfil' })
    }

    const user = await getUserById(id)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    res.json({ data: user })
  } catch (error) {
    console.error('Error al obtener usuario:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Usuario normal — actualizar sus propios datos (ci, telefono)
const updateOwnProfile = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario
    const user = await updateUser(id_usuario, req.body)
    if (!user) return res.status(400).json({ error: 'Sin campos válidos para actualizar' })
    res.json({ message: 'Perfil actualizado exitosamente', data: user })
  } catch (error) {
    console.error('Error al actualizar perfil:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Bibliotecario — cambiar el rol de un usuario
const changeUserRol = async (req, res) => {
  try {
    const { id } = req.params
    const { id_tipo_usuario } = req.body

    if (!id_tipo_usuario) {
      return res.status(400).json({ error: 'El campo id_tipo_usuario es requerido' })
    }

    const user = await updateUserRol(id, id_tipo_usuario)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    res.json({ message: 'Rol actualizado exitosamente', data: user })
  } catch (error) {
    console.error('Error al cambiar rol:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Bibliotecario — activar o desactivar una cuenta
const toggleUserActivo = async (req, res) => {
  try {
    const { id } = req.params
    const { activo } = req.body

    if (activo === undefined) {
      return res.status(400).json({ error: 'El campo activo es requerido' })
    }

    const user = await updateUserActivo(id, activo)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    res.json({ message: `Cuenta ${activo ? 'activada' : 'desactivada'} exitosamente`, data: user })
  } catch (error) {
    console.error('Error al actualizar estado:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Cualquier usuario autenticado — obtener los tipos de usuario disponibles
const getTipos = async (req, res) => {
  try {
    const tipos = await getTiposUsuario()
    res.json({ data: tipos })
  } catch (error) {
    console.error('Error al obtener tipos de usuario:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getUsers, getUser, updateOwnProfile, changeUserRol, toggleUserActivo, getTipos }