const pool = require('../config/db')

const getAllUsers = async ({ search, rol, activo, limit, offset }) => {
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

  values.push(limit)
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
      t.nombre_tipo AS rol,
      t.id_tipo_usuario
    FROM usuarios u
    JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
    ${whereClause}
    ORDER BY u.nombre_apellido ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `

  const { rows } = await pool.query(query, values)
  return rows
}

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
    JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
    ${whereClause}
  `
  const { rows } = await pool.query(query, values)
  return parseInt(rows[0].count)
}

const getUserById = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT
      u.id_usuario,
      u.nombre_apellido,
      u.ci,
      u.telefono,
      u.correo,
      u.sancionado,
      u.activo,
      t.nombre_tipo AS rol,
      t.id_tipo_usuario
     FROM usuarios u
     JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
     WHERE u.id_usuario = $1`,
    [id_usuario]
  )
  return rows[0] || null
}

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
// Solo el admin puede cambiar el rol de un usuario
const updateUserRol = async (id_usuario, id_tipo_usuario) => {
  const { rows } = await pool.query(
    `UPDATE usuarios SET id_tipo_usuario = $1
     WHERE id_usuario = $2
     RETURNING *`,
    [id_tipo_usuario, id_usuario]
  )
  return rows[0] || null
}

const updateUserCi = async (id_usuario, ci) => {
  const { rows } = await pool.query(
    `UPDATE usuarios SET ci = $1
     WHERE id_usuario = $2
     RETURNING *`,
    [ci, id_usuario]
  )
  return rows[0] || null
}

// Solo el admin puede activar o desactivar una cuenta
const updateUserActivo = async (id_usuario, activo) => {
  const { rows } = await pool.query(
    `UPDATE usuarios SET activo = $1
     WHERE id_usuario = $2
     RETURNING *`,
    [activo, id_usuario]
  )
  return rows[0] || null
}


const getTiposUsuario = async () => {
  const { rows } = await pool.query('SELECT * FROM tipo_usuarios ORDER BY id_tipo_usuario ASC')
  return rows
}

module.exports = { getAllUsers, countUsers, getUserById, updateUser, updateUserRol, updateUserActivo, getTiposUsuario, updateUserCi }