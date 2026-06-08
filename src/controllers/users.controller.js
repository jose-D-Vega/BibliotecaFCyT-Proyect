const {
  getAllUsers, countUsers, getUserById, updateUser,
  updateUserRol, updateUserActivo, getTiposUsuario, updateUserTelefono
} = require('../queries/users.queries')
const { registrarActividad } = require('../queries/activity.queries')

// Admin — ver todos los usuarios
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

// Admin, bibliotecario — solo su propio perfil
// Usuario normal — solo su propio perfil
const getUser = async (req, res) => {
  try {
    const { id } = req.params
    const solicitante = req.user

    if (['normal', 'bibliotecario'].includes(solicitante.rol) &&
        solicitante.id_usuario !== parseInt(id)) {
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

// Usuario normal y bibliotecario — actualizar su propio perfil
const updateOwnProfile = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario
    const { ci, telefono } = req.body

    const current = await getUserById(id_usuario)
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (ci !== undefined && current.ci !== 'pendiente') {
      return res.status(400).json({ error: 'La cédula ya fue registrada. Contactá al administrador para modificarla' })
    }

    const user = await updateUser(id_usuario, { ci, telefono })
    if (!user) return res.status(400).json({ error: 'Sin campos válidos para actualizar' })

    registrarActividad({
      id_usuario,
      tipo_accion: 'editar',
      entidad: 'usuarios',
      id_entidad: id_usuario,
      descripcion: `El usuario actualizó su propio perfil`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Perfil actualizado exitosamente', data: user })
  } catch (error) {
    console.error('Error al actualizar perfil:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Admin — cambiar el rol de un usuario
const changeUserRol = async (req, res) => {
  try {
    const { id } = req.params
    const { id_tipo_usuario } = req.body

    if (!id_tipo_usuario) {
      return res.status(400).json({ error: 'El campo id_tipo_usuario es requerido' })
    }

    const target = await getUserById(id)
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' })

    const user = await updateUserRol(id, id_tipo_usuario)

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'cambio_rol',
      entidad: 'usuarios',
      id_entidad: parseInt(id),
      descripcion: `El admin cambió el rol de "${target.nombre_apellido}" de "${target.rol}" a id_tipo_usuario=${id_tipo_usuario}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Rol actualizado exitosamente', data: user })
  } catch (error) {
    console.error('Error al cambiar rol:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Admin — activar o desactivar una cuenta
const toggleUserActivo = async (req, res) => {
  try {
    const { id } = req.params
    const { activo } = req.body

    if (activo === undefined) {
      return res.status(400).json({ error: 'El campo activo es requerido' })
    }

    const target = await getUserById(id)
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' })

    const user = await updateUserActivo(id, activo)

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: activo ? 'activar' : 'eliminar',
      entidad: 'usuarios',
      id_entidad: parseInt(id),
      descripcion: `El admin ${activo ? 'activó' : 'desactivó'} la cuenta de "${target.nombre_apellido}"`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: `Cuenta ${activo ? 'activada' : 'desactivada'} exitosamente`, data: user })
  } catch (error) {
    console.error('Error al actualizar estado:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Admin — actualizar teléfono de cualquier usuario por ID
const changeUserTelefono = async (req, res) => {
  try {
    const { id } = req.params
    const { telefono } = req.body

    if (!telefono) return res.status(400).json({ error: 'El campo telefono es requerido' })

    const target = await getUserById(id)
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' })

    const user = await updateUserTelefono(id, telefono)

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'editar',
      entidad: 'usuarios',
      id_entidad: parseInt(id),
      descripcion: `El admin actualizó el teléfono de "${target.nombre_apellido}" a: ${telefono}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Teléfono actualizado exitosamente', data: user })
  } catch (error) {
    console.error('Error al actualizar teléfono:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Admin — borrado lógico de un usuario
const deleteUserHandler = async (req, res) => {
  try {
    const { id } = req.params

    const target = await getUserById(id)
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (!target.activo) {
      return res.status(400).json({ error: 'El usuario ya se encuentra inactivo' })
    }

    const user = await updateUserActivo(id, false)

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'eliminar',
      entidad: 'usuarios',
      id_entidad: parseInt(id),
      descripcion: `El admin desactivo la cuenta de "${target.nombre_apellido}"`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Usuario eliminado exitosamente', data: user })
  } catch (error) {
    console.error('Error al eliminar usuario:', error)
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

module.exports = {
  getUsers, getUser, updateOwnProfile, changeUserRol,
  toggleUserActivo, getTipos, changeUserTelefono, deleteUserHandler
}