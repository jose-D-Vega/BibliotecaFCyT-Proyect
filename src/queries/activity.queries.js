const pool = require('../config/db')

const registrarActividad = async ({ id_usuario, tipo_accion, entidad, id_entidad, descripcion }) => {
  await pool.query(
    `INSERT INTO historial_actividades (id_usuario, tipo_accion, entidad, id_entidad, descripcion)
     VALUES ($1, $2, $3, $4, $5)`,
    [id_usuario, tipo_accion, entidad, id_entidad || null, descripcion]
  )
}

const getActividades = async ({ id_usuario, tipo_accion, entidad, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND h.id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (tipo_accion) {
    whereClause += ` AND h.tipo_accion = $${paramIndex}`
    values.push(tipo_accion)
    paramIndex++
  }
  if (entidad) {
    whereClause += ` AND h.entidad = $${paramIndex}`
    values.push(entidad)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       h.id_actividad,
       h.tipo_accion,
       h.entidad,
       h.id_entidad,
       h.descripcion,
       h.fecha,
       u.nombre_apellido AS usuario,
       u.correo
     FROM historial_actividades h
     JOIN usuarios u ON h.id_usuario = u.id_usuario
     ${whereClause}
     ORDER BY h.fecha DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countActividades = async ({ id_usuario, tipo_accion, entidad }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (tipo_accion) {
    whereClause += ` AND tipo_accion = $${paramIndex}`
    values.push(tipo_accion)
    paramIndex++
  }
  if (entidad) {
    whereClause += ` AND entidad = $${paramIndex}`
    values.push(entidad)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM historial_actividades ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

module.exports = { registrarActividad, getActividades, countActividades }