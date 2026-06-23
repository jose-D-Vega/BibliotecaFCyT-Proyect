const pool = require('../config/db')

/**
 * 1. LISTAR LAS SANCIONES DE UN USUARIO ESPECÍFICO
 * El usuario solo puede ver sus propias sanciones.
 * Se incluye info básica del préstamo y del ejemplar relacionado (si existen).
 */
const getSancionesByUsuario = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT
      s.id_sancion,
      s.id_prestamo,
      s.id_ejemplar,
      s.tipo_infraccion,
      s.descripcion_sancion,
      s.fecha_sancion,
      s.estado_sancion,
      s.fecha_limite,
      s.dias_suspension,
      s.fecha_fin_suspension
     FROM sanciones s
     WHERE s.id_usuario = $1
     ORDER BY s.fecha_sancion DESC`,
    [id_usuario]
  )
  return rows
}

/**
 * 2. OBTENER UNA SANCIÓN PUNTUAL POR ID
 * Sirve para validar que la sanción pertenezca al usuario que la solicita.
 */
const getSancionById = async (id_sancion) => {
  const { rows } = await pool.query(
    `SELECT
      s.id_sancion,
      s.id_usuario,
      s.id_prestamo,
      s.id_ejemplar,
      s.tipo_infraccion,
      s.descripcion_sancion,
      s.fecha_sancion,
      s.estado_sancion,
      s.fecha_limite,
      s.dias_suspension,
      s.fecha_fin_suspension
     FROM sanciones s
     WHERE s.id_sancion = $1`,
    [id_sancion]
  )
  return rows[0] || null
}

module.exports = {
  getSancionesByUsuario,
  getSancionById
}