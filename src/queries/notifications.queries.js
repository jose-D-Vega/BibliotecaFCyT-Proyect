const pool = require('../config/db')

const crearNotificacion = async ({ id_usuario, tipo, titulo, mensaje, id_prestamo, id_sancion, rol_destino = 'normal', unica = false }, client = null) => {
  const executor = client || pool

  if (unica && (id_sancion || id_prestamo)) {
    const { rows } = await executor.query(
      id_sancion
        ? `SELECT id_notificacion FROM notificaciones
           WHERE id_usuario = $1 AND tipo = $2 AND id_sancion = $3 AND fecha::date = CURRENT_DATE`
        : `SELECT id_notificacion FROM notificaciones
           WHERE id_usuario = $1 AND tipo = $2 AND id_prestamo = $3 AND fecha::date = CURRENT_DATE`,
      [id_usuario, tipo, id_sancion || id_prestamo]
    )
    if (rows.length > 0) return
  }

  await executor.query(
    `INSERT INTO notificaciones (id_usuario, tipo, titulo, mensaje, id_prestamo, id_sancion, rol_destino)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id_usuario, tipo, titulo, mensaje, id_prestamo || null, id_sancion || null, rol_destino]
  )
}

const getNotificaciones = async (id_usuario, rolActivo, { tipo, leida, fecha_desde, fecha_hasta, limit, offset } = {}) => {
  const values = [id_usuario, rolActivo || 'normal']
  let paramIndex = 3
  let whereClause = 'WHERE id_usuario = $1 AND rol_destino = $2'

  if (tipo) {
    whereClause += ` AND tipo = $${paramIndex}`
    values.push(tipo)
    paramIndex++
  }
  if (leida === 'true' || leida === true) {
    whereClause += ' AND leida = true'
  } else if (leida === 'false' || leida === false) {
    whereClause += ' AND leida = false'
  }
  if (fecha_desde) {
    whereClause += ` AND fecha::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND fecha::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  values.push(limit ?? 50)
  values.push(offset ?? 0)

  const { rows } = await pool.query(
    `SELECT * FROM notificaciones
     ${whereClause}
     ORDER BY leida ASC, fecha DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countNotificaciones = async (id_usuario, rolActivo, { tipo, leida, fecha_desde, fecha_hasta } = {}) => {
  const values = [id_usuario, rolActivo || 'normal']
  let paramIndex = 3
  let whereClause = 'WHERE id_usuario = $1 AND rol_destino = $2'

  if (tipo) {
    whereClause += ` AND tipo = $${paramIndex}`
    values.push(tipo)
    paramIndex++
  }
  if (leida === 'true' || leida === true) {
    whereClause += ' AND leida = true'
  } else if (leida === 'false' || leida === false) {
    whereClause += ' AND leida = false'
  }
  if (fecha_desde) {
    whereClause += ` AND fecha::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND fecha::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM notificaciones ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

const countNoLeidas = async (id_usuario, rolActivo) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM notificaciones
     WHERE id_usuario = $1
       AND leida = false
       AND rol_destino = $2`,
    [id_usuario, rolActivo || 'normal']
  )
  return parseInt(rows[0].count)
}

const marcarLeida = async (id_notificacion, id_usuario) => {
  const { rows } = await pool.query(
    `UPDATE notificaciones SET leida = true
     WHERE id_notificacion = $1 AND id_usuario = $2
     RETURNING *`,
    [id_notificacion, id_usuario]
  )
  return rows[0] || null
}

const marcarTodasLeidas = async (id_usuario, rolActivo) => {
  await pool.query(
    `UPDATE notificaciones SET leida = true
     WHERE id_usuario = $1 AND rol_destino = $2`,
    [id_usuario, rolActivo || 'normal']
  )
}

module.exports = {
  crearNotificacion,
  getNotificaciones,
  countNotificaciones,
  countNoLeidas,
  marcarLeida,
  marcarTodasLeidas
}