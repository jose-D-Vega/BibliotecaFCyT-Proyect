const pool = require('../config/db')

const registrarActividad = async ({ id_usuario, tipo_accion, entidad, id_entidad, descripcion }) => {
  await pool.query(
    `INSERT INTO historial_actividades (id_usuario, tipo_accion, entidad, id_entidad, descripcion)
     VALUES ($1, $2, $3, $4, $5)`,
    [id_usuario, tipo_accion, entidad, id_entidad || null, descripcion]
  )
}

// Builder único de filtros, reutilizado por getActividades y countActividades.
// prefix permite usar "h." cuando la query tiene JOIN, o "" cuando no.
const buildActividadesWhere = ({ id_usuario, tipo_accion, entidad, fecha_desde, fecha_hasta }, prefix = '') => {
  const values = []
  const conditions = []
  let paramIndex = 1

  if (id_usuario) {
    conditions.push(`${prefix}id_usuario = $${paramIndex}`)
    values.push(id_usuario)
    paramIndex++
  }
  if (tipo_accion) {
    conditions.push(`${prefix}tipo_accion = $${paramIndex}`)
    values.push(tipo_accion)
    paramIndex++
  }
  if (entidad) {
    conditions.push(`${prefix}entidad = $${paramIndex}`)
    values.push(entidad)
    paramIndex++
  }
  if (fecha_desde) {
    conditions.push(`${prefix}fecha >= $${paramIndex}`)
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    // Se suma 1 día para incluir todo el día "hasta" sin exigir hora exacta
    conditions.push(`${prefix}fecha < ($${paramIndex}::date + interval '1 day')`)
    values.push(fecha_hasta)
    paramIndex++
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { whereClause, values, nextParamIndex: paramIndex }
}

const getActividades = async (filters) => {
  const { limit, offset } = filters
  const { whereClause, values, nextParamIndex } = buildActividadesWhere(filters, 'h.')

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
     LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`,
    values
  )
  return rows
}

const countActividades = async (filters) => {
  const { whereClause, values } = buildActividadesWhere(filters, '')

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM historial_actividades ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

module.exports = { registrarActividad, getActividades, countActividades }