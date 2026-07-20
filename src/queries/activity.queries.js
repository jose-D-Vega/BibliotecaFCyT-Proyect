const pool = require('../config/db')

const registrarActividad = async ({ id_usuario, tipo_accion, entidad, id_entidad, descripcion }) => {
  await pool.query(
    `INSERT INTO historial_actividades (id_usuario, tipo_accion, entidad, id_entidad, descripcion)
     VALUES ($1, $2, $3, $4, $5)`,
    [id_usuario, tipo_accion, entidad, id_entidad || null, descripcion]
  )
}

// Combinaciones que representan autogestión del usuario:
// - solicitar/cancelar préstamos y renovaciones (entidad prestamos)
// - editar el propio perfil o darse de alta por primer login (entidad usuarios,
//   donde el actor y el objetivo de la acción son la misma persona: id_entidad = id_usuario)
// Todo lo demás (aprobar, rechazar, activar, devolver, sancionar, cambio_rol, y las
// acciones de un admin sobre OTRO usuario) es acción de funcionario. No se puede distinguir
// por el rol actual del actor porque un bibliotecario también puede actuar como usuario
// normal (pedir sus propios préstamos, editar su propio perfil), por eso se distingue
// por el tipo de acción y, en el caso de "usuarios", por si el actor es el propio objetivo.
const accionesUsuarioSQL = (prefix = '') => `(
  (${prefix}entidad = 'prestamos' AND ${prefix}tipo_accion IN ('crear', 'cancelar'))
  OR (${prefix}entidad = 'usuarios' AND ${prefix}tipo_accion IN ('crear', 'editar') AND ${prefix}id_entidad = ${prefix}id_usuario)
)`

// Builder único de filtros, reutilizado por getActividades y countActividades.
// prefix permite usar "h." cuando la query tiene JOIN, o "" cuando no.
const buildActividadesWhere = ({ id_usuario, tipo_accion, entidad, fecha_desde, fecha_hasta, vista }, prefix = '') => {
  const values = []
  const conditions = []
  let paramIndex = 1

  if (vista === 'usuarios') {
    conditions.push(accionesUsuarioSQL(prefix))
  } else if (vista === 'funcionarios') {
    conditions.push(`NOT ${accionesUsuarioSQL(prefix)}`)
  }

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