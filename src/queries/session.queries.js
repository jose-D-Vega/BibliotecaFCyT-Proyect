const pool = require('../config/db')

const registrarSesion = async (id_usuario) => {
  await pool.query(
    `INSERT INTO sesiones (id_usuario) VALUES ($1)`,
    [id_usuario]
  )
}

const getSesiones = async ({ id_usuario, fecha_desde, fecha_hasta, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND s.id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND s.fecha_ingreso >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND s.fecha_ingreso <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       s.id_sesion,
       s.fecha_ingreso,
       u.id_usuario,
       u.nombre_apellido AS usuario,
       u.correo,
       t.nombre_tipo AS rol
     FROM sesiones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
     ${whereClause}
     ORDER BY s.fecha_ingreso DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countSesiones = async ({ id_usuario, fecha_desde, fecha_hasta }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND fecha_ingreso >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND fecha_ingreso <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM sesiones ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

module.exports = { registrarSesion, getSesiones, countSesiones }