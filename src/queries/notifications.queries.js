const pool = require('../config/db')

const crearNotificacion = async ({ id_usuario, tipo, titulo, mensaje, id_prestamo }) => {
  await pool.query(
    `INSERT INTO notificaciones (id_usuario, tipo, titulo, mensaje, id_prestamo)
     VALUES ($1, $2, $3, $4, $5)`,
    [id_usuario, tipo, titulo, mensaje, id_prestamo || null]
  )
}

const getNotificaciones = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT * FROM notificaciones
     WHERE id_usuario = $1
     ORDER BY fecha DESC
     LIMIT 50`,
    [id_usuario]
  )
  return rows
}

const countNoLeidas = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM notificaciones
     WHERE id_usuario = $1 AND leida = false`,
    [id_usuario]
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