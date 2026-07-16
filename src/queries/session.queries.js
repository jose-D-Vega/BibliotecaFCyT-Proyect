const pool = require('../config/db')

const registrarSesion = async (id_usuario) => {
  await pool.query(
    `
    INSERT INTO sesiones (
      id_usuario,
      activo
    )
    VALUES ($1, TRUE)
    `,
    [id_usuario]
  )
}

const cerrarSesion = async (id_usuario) => {
  await pool.query(
    `
    UPDATE sesiones
    SET
      activo = FALSE,
      fecha_cierre = NOW()
    WHERE id_sesion = (
      SELECT id_sesion
      FROM sesiones
      WHERE
        id_usuario = $1
        AND activo = TRUE
      ORDER BY fecha_ingreso DESC
      LIMIT 1
    )
    `,
    [id_usuario]
  )
}

const getSesionesActivasUsuario = async (id_usuario) => {
  const { rows } = await pool.query(
    `
    SELECT
      id_sesion,
      fecha_ingreso
    FROM sesiones
    WHERE
      id_usuario = $1
      AND activo = TRUE
    ORDER BY fecha_ingreso DESC
    `,
    [id_usuario]
  )

  return rows
}

const getSesiones = async ({
  usuario,
  fecha_desde,
  fecha_hasta,
  limit,
  offset
}) => {

  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (usuario) {

    whereClause += `
      AND (
        LOWER(u.nombre_apellido) LIKE LOWER($${paramIndex})
        OR LOWER(u.correo) LIKE LOWER($${paramIndex})
        OR u.ci::text LIKE $${paramIndex}
      )
    `

    values.push(`%${usuario}%`)
    paramIndex++

  }

  if (fecha_desde) {

    whereClause += `
      AND s.fecha_ingreso >= $${paramIndex}
    `

    values.push(fecha_desde)
    paramIndex++

  }

  if (fecha_hasta) {

    whereClause += `
      AND s.fecha_ingreso < ($${paramIndex}::date + INTERVAL '1 day')
    `

    values.push(fecha_hasta)
    paramIndex++

  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `
    SELECT
      s.id_sesion,
      s.fecha_ingreso,
      s.activo,
      s.fecha_cierre,
      u.id_usuario,
      u.nombre_apellido AS usuario,
      u.ci,
      u.correo,
      t.nombre_tipo AS rol

    FROM sesiones s

    JOIN usuarios u
      ON s.id_usuario = u.id_usuario

    JOIN tipo_usuarios t
      ON u.id_tipo_usuario = t.id_tipo_usuario

    ${whereClause}

    ORDER BY s.fecha_ingreso DESC

    LIMIT $${paramIndex}
    OFFSET $${paramIndex + 1}
    `,
    values
  )

  return rows
}

const countSesiones = async ({
  usuario,
  fecha_desde,
  fecha_hasta
}) => {

  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (usuario) {

    whereClause += `
      AND (
        LOWER(u.nombre_apellido) LIKE LOWER($${paramIndex})
        OR LOWER(u.correo) LIKE LOWER($${paramIndex})
        OR u.ci::text LIKE $${paramIndex}
      )
    `

    values.push(`%${usuario}%`)
    paramIndex++

  }

  if (fecha_desde) {

    whereClause += `
      AND s.fecha_ingreso >= $${paramIndex}
    `

    values.push(fecha_desde)
    paramIndex++

  }

  if (fecha_hasta) {

    whereClause += `
      AND s.fecha_ingreso < ($${paramIndex}::date + INTERVAL '1 day')
    `

    values.push(fecha_hasta)
    paramIndex++

  }

  const { rows } = await pool.query(
    `
    SELECT COUNT(*)

    FROM sesiones s

    JOIN usuarios u
      ON s.id_usuario = u.id_usuario

    ${whereClause}
    `,
    values
  )

  return parseInt(rows[0].count)
}

module.exports = {
  registrarSesion,
  cerrarSesion,
  getSesionesActivasUsuario,
  getSesiones,
  countSesiones
}