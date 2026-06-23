const pool = require('../config/db')

/**
 * 1. LISTAR TODOS LOS USUARIOS (Con soporte para paginación y filtros)
 * Si desde el frontend no mandas filtros, actúa como un "Listar Todo" puro.
 */
const getAllUsers = async ({ search, rol, activo, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  // Filtro de búsqueda por texto (nombre o correo)
  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  // Filtro por rol ('normal', 'bibliotecario', 'admin')
  if (rol) {
    whereClause += ` AND t.nombre_tipo = $${paramIndex}`
    values.push(rol)
    paramIndex++
  }
  // Filtro por estado activo (TRUE / FALSE)
  if (activo !== undefined) {
    whereClause += ` AND u.activo = $${paramIndex}`
    values.push(activo)
    paramIndex++
  }

  // Índices dinámicos obligatorios para la paginación en PostgreSQL
  const limitIndex = paramIndex
  values.push(limit)
  paramIndex++

  const offsetIndex = paramIndex
  values.push(offset)

  const query = `
    SELECT
      u.id_usuario,
      u.nombre_apellido,
      u.ci,
      u.telefono,
      u.correo,
      u.sancionado,
      u.activo,
      COALESCE(t.nombre_tipo, 'sin rol') AS rol,
      u.id_tipo_usuario
    FROM usuarios u
    LEFT JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
    ${whereClause}
    ORDER BY u.nombre_apellido ASC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `

  const { rows } = await pool.query(query, values)
  return rows
}

/**
 * 2. CONTAR USUARIOS TOTALES (Para calcular páginas en el frontend)
 */
const countUsers = async ({ search, rol, activo }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (rol) {
    whereClause += ` AND t.nombre_tipo = $${paramIndex}`
    values.push(rol)
    paramIndex++
  }
  if (activo !== undefined) {
    whereClause += ` AND u.activo = $${paramIndex}`
    values.push(activo)
    paramIndex++
  }

  const query = `
    SELECT COUNT(*)
    FROM usuarios u
    LEFT JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
    ${whereClause}
  `
  const { rows } = await pool.query(query, values)
  return parseInt(rows[0].count || 0, 10)
}

/**
 * 3. OBTENER UN USUARIO POR ID
 */
const getUserById = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT
      u.id_usuario,
      u.nombre_apellido as nombre,
      u.ci,
      u.telefono,
      u.correo,
      u.sancionado,
      u.activo,
      t.nombre_tipo AS rol,
      u.id_tipo_usuario
     FROM usuarios u
     LEFT JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
     WHERE u.id_usuario = $1`,
    [id_usuario]
  )
  return rows[0] || null
}

/**
 * 4. MODIFICAR USUARIO (CI, Teléfono, etc.)
 */
const updateUser = async (id_usuario, fields) => {
  const allowed = ['ci', 'telefono'] 
  const updates = []
  const values = []
  let paramIndex = 1

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${paramIndex}`)
      values.push(fields[key])
      paramIndex++
    }
  }

  if (updates.length === 0) return null

  values.push(id_usuario)
  const { rows } = await pool.query(
    `UPDATE usuarios SET ${updates.join(', ')}
     WHERE id_usuario = $${paramIndex}
     RETURNING *`,
    values
  )
  return rows[0] || null
}

/**
 * 5. MODIFICAR ROL DE UN USUARIO (Admin asigna nuevo rol)
 */
const updateUserRol = async (id_usuario, id_tipo_usuario) => {
  const { rows } = await pool.query(
    `UPDATE usuarios SET id_tipo_usuario = $1
     WHERE id_usuario = $2
     RETURNING *`,
    [id_tipo_usuario, id_usuario]
  )
  return rows[0] || null
}

/**
 * 6. MODIFICAR NUMERO DE TELEFONO ESPECÍFICAMENTE
 */
const updateUserTelefono = async (id_usuario, telefono) => {
  const { rows } = await pool.query(
    `UPDATE usuarios SET telefono = $1
     WHERE id_usuario = $2
     RETURNING *`,
    [telefono, id_usuario]
  )
  return rows[0] || null
}

/**
 * 7. ACCIÓN DE ELIMINAR / ACTIVAR (BORRADO LÓGICO)
 * ¡Justo lo que querías! No borra con DELETE, hace un UPDATE al booleano 'activo'
 * Cuando elimines, desde el controlador le envías 'activo = false'.
 */
const updateUserActivo = async (id_usuario, activo) => {
  const { rows } = await pool.query(
    `UPDATE usuarios SET activo = $1
     WHERE id_usuario = $2
     RETURNING *`,
    [activo, id_usuario]
  )
  return rows[0] || null
}

/**
 * 8. TRAER TODOS LOS ROLES EXISTENTES
 */
const getTiposUsuario = async () => {
  const { rows } = await pool.query('SELECT * FROM tipo_usuarios ORDER BY id_tipo_usuario ASC')
  return rows
}

module.exports = { 
  getAllUsers, countUsers, getUserById, updateUser, 
  updateUserRol, updateUserActivo, getTiposUsuario, updateUserTelefono
}