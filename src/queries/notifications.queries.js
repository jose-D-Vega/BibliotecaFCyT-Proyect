const pool = require('../config/db')

const crearNotificacion = async ({ id_usuario, tipo, titulo, mensaje, id_prestamo, rol_destino = 'normal', unica = false }) => {
  // Si unica=true verificar que no exista ya una igual hoy
  if (unica && id_prestamo) {
    const { rows } = await pool.query(
      `SELECT id_notificacion FROM notificaciones
       WHERE id_ususario = $1
         AND tipo = $2
         AND id_prestamo = $3
         AND fecha::date = CURRENT_DATE`,
      [id_usuario, tipo, id_prestamo]
    )
    if (rows.length > 0) return // ya existe, no duplicar
  }

  await pool.query(
    `INSERT INTO notificaciones (id_usuario, tipo, titulo, mensaje, id_prestamo, rol_destino)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id_usuario, tipo, titulo, mensaje, id_prestamo || null, rol_destino]
  )
}

const getNotificaciones = async (id_usuario, rolActivo) => {
  const { rows } = await pool.query(
    `SELECT * FROM notificaciones
     WHERE id_usuario = $1
       AND rol_destino = $2
     ORDER BY fecha DESC
     LIMIT 50`,
    [id_usuario, rolActivo || 'normal']
  )
  return rows
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

const marcarTodasLeidas = async (id_usuario) => {
  await pool.query(
    `UPDATE notificaciones SET leida = true
     WHERE id_usuario = $1`,
    [id_usuario]
  )
}

module.exports = { crearNotificacion, getNotificaciones, countNoLeidas, marcarLeida, marcarTodasLeidas }