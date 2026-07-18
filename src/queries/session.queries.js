const pool = require('../config/db')


const registrarSesion = async ({
  id_usuario,
  sid,
  ip,
  user_agent
}) => {

  await pool.query(
    `
    INSERT INTO sesiones (
      sid,
      id_usuario,
      fecha_ingreso,
      ultima_actividad,
      fecha_expiracion,
      estado,
      ip,
      user_agent
    )
    VALUES (
      $1,
      $2,
      NOW(),
      NOW(),
      NOW() + INTERVAL '8 hours',
      'Activo',
      $3,
      $4
    )
    `,
    [
      sid,
      id_usuario,
      ip,
      user_agent
    ]
  )

}




const cerrarSesion = async (sid) => {

  await pool.query(
    `
    UPDATE sesiones
    SET
      estado = 'Cerrada',
      fecha_cierre = NOW()
    WHERE sid = $1
      AND estado = 'Activo'
    `,
    [
      sid
    ]
  )

}

const actualizarSesionesExpiradas = async () => {

  const { rowCount } = await pool.query(
    `
    UPDATE sesiones
    SET
      estado = 'Expirada',
      fecha_cierre = NOW()
    WHERE
      estado = 'Activo'
      AND fecha_expiracion < NOW()
    `
  )


  return rowCount

}


const getSesionesActivasUsuario = async (id_usuario,sid_actual) => {

  const { rows } = await pool.query(
    `
    SELECT
      id_sesion,
      sid,
      fecha_ingreso,
      ultima_actividad,
      estado,
      ip,
      user_agent,
      CASE
        WHEN sid = $2 THEN true
        ELSE false
      END AS es_actual
    FROM sesiones
    WHERE
      id_usuario = $1
      AND estado = 'Activo'
    ORDER BY fecha_ingreso DESC
    `,
    [
      id_usuario,
      sid_actual
    ]
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
      s.sid,
      s.fecha_ingreso,
      s.ultima_actividad,
      s.fecha_expiracion,
      s.fecha_cierre,
      s.estado,
      s.ip,
      s.user_agent,

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
  actualizarSesionesExpiradas,
  getSesionesActivasUsuario,
  getSesiones,
  countSesiones
}