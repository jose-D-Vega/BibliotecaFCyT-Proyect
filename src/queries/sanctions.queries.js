const pool = require('../config/db')

const createSanction = async ({
  id_prestamo, id_ejemplar, id_usuario, id_admin,
  tipo_infraccion, descripcion_sancion, fecha_limite,
  dias_suspension
}) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Calcular fecha_limite para tipos que la requieren
    let fechaLimite = fecha_limite || null
    if (['falta_entrega', 'deterioro', 'perdida'].includes(tipo_infraccion) && !fechaLimite) {
      const f = new Date()
      f.setDate(f.getDate() + 30)
      fechaLimite = f
    }

    // Calcular fecha_fin_suspension
    let fechaFinSuspension = null
    if (tipo_infraccion === 'comportamiento' && dias_suspension) {
      const f = new Date()
      f.setDate(f.getDate() + parseInt(dias_suspension))
      fechaFinSuspension = f
    }
    // devolucion_tardia siempre 10 días
    if (tipo_infraccion === 'devolucion_tardia') {
      const f = new Date()
      f.setDate(f.getDate() + 10)
      fechaFinSuspension = f
      dias_suspension = 10
    }

    const { rows } = await client.query(
      `INSERT INTO sanciones (
         id_prestamo, id_ejemplar, id_usuario, id_admin,
         tipo_infraccion, descripcion_sancion, fecha_sancion,
         estado_sancion, fecha_limite, dias_suspension, fecha_fin_suspension
       )
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, 'activa', $7, $8, $9)
       RETURNING *`,
      [
        id_prestamo || null, id_ejemplar || null, id_usuario, id_admin,
        tipo_infraccion, descripcion_sancion,
        fechaLimite, dias_suspension || null, fechaFinSuspension
      ]
    )

    // Bloquear usuario
    await client.query(
      `UPDATE usuarios SET sancionado = true WHERE id_usuario = $1`,
      [id_usuario]
    )

    await client.query('COMMIT')
    return rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Confirmar sanción pendiente — admin aprueba la falta_entrega
const confirmSanction = async (id_sancion, id_admin) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE sanciones
       SET estado_sancion = 'activa', id_admin = $1
       WHERE id_sancion = $2
         AND estado_sancion = 'pendiente_confirmacion'
       RETURNING *`,
      [id_admin, id_sancion]
    )

    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Rechazar sanción pendiente — admin rechaza, desbloquear usuario
const rejectSanction = async (id_sancion, id_admin) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE sanciones
       SET estado_sancion = 'rechazada', id_admin = $1
       WHERE id_sancion = $2
         AND estado_sancion = 'pendiente_confirmacion'
       RETURNING *`,
      [id_admin, id_sancion]
    )

    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    // Verificar si el usuario tiene otras sanciones activas o pendientes
    const { rows: otrasSanciones } = await client.query(
      `SELECT COUNT(*) FROM sanciones
       WHERE id_usuario = $1
         AND estado_sancion IN ('activa', 'pendiente_confirmacion')`,
      [rows[0].id_usuario]
    )

    if (parseInt(otrasSanciones[0].count) === 0) {
      await client.query(
        `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
        [rows[0].id_usuario]
      )
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const getSanctions = async ({ id_usuario, estado, tipo_infraccion, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND s.id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (estado) {
    // Soporte para múltiples estados separados por coma
    const estados = estado.split(',')
    whereClause += ` AND s.estado_sancion = ANY($${paramIndex}::varchar[])`
    values.push(estados)
    paramIndex++
  }
  if (tipo_infraccion) {
    whereClause += ` AND s.tipo_infraccion = $${paramIndex}`
    values.push(tipo_infraccion)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       s.*,
       u.nombre_apellido AS usuario_nombre,
       u.correo AS usuario_correo,
       u.ci AS usuario_ci,
       a.nombre_apellido AS admin_nombre,
       l.titulo AS libro_titulo,
       l.autor AS libro_autor,
       p.fecha_tope_devolucion,
       p.estado_prestamo
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     LEFT JOIN prestamos p ON s.id_prestamo = p.id_prestamo
     LEFT JOIN ejemplares e ON s.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro
     ${whereClause}
     ORDER BY s.fecha_sancion DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countSanctions = async ({ id_usuario, estado, tipo_infraccion }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (estado) {
    const estados = estado.split(',')
    whereClause += ` AND estado_sancion = ANY($${paramIndex}::varchar[])`
    values.push(estados)
    paramIndex++
  }
  if (tipo_infraccion) {
    whereClause += ` AND tipo_infraccion = $${paramIndex}`
    values.push(tipo_infraccion)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM sanciones ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

const getSanctionById = async (id_sancion) => {
  const { rows } = await pool.query(
    `SELECT
       s.*,
       u.nombre_apellido AS usuario_nombre,
       u.correo AS usuario_correo,
       u.ci AS usuario_ci,
       u.telefono AS usuario_telefono,
       a.nombre_apellido AS admin_nombre,
       l.titulo AS libro_titulo,
       l.autor AS libro_autor,
       l.editorial,
       p.fecha_tope_devolucion,
       p.fecha_activacion,
       p.estado_prestamo
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     LEFT JOIN prestamos p ON s.id_prestamo = p.id_prestamo
     LEFT JOIN ejemplares e ON s.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro
     WHERE s.id_sancion = $1`,
    [id_sancion]
  )
  return rows[0] || null
}

const resolveSanction = async (id_sancion, id_admin) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: sancion } = await client.query(
      `UPDATE sanciones SET estado_sancion = 'resuelta'
       WHERE id_sancion = $1
         AND estado_sancion IN ('activa', 'escalada')
       RETURNING *`,
      [id_sancion]
    )

    if (sancion.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    // Verificar si tiene otras sanciones activas o pendientes
    const { rows: otrasSanciones } = await client.query(
      `SELECT COUNT(*) FROM sanciones
       WHERE id_usuario = $1
         AND estado_sancion IN ('activa', 'pendiente_confirmacion')`,
      [sancion[0].id_usuario]
    )

    if (parseInt(otrasSanciones[0].count) === 0) {
      await client.query(
        `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
        [sancion[0].id_usuario]
      )
    }

    await client.query('COMMIT')
    return sancion[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const escalateSanction = async (id_sancion) => {
  const { rows } = await pool.query(
    `UPDATE sanciones SET estado_sancion = 'escalada'
     WHERE id_sancion = $1 AND estado_sancion = 'activa'
     RETURNING *`,
    [id_sancion]
  )
  return rows[0] || null
}

// Resolver automáticamente falta_entrega cuando se devuelve todo
const autoResolveFaltaEntrega = async (id_prestamo, client) => {
  const { rows: sancion } = await client.query(
    `SELECT * FROM sanciones
     WHERE id_prestamo = $1
       AND tipo_infraccion = 'falta_entrega'
       AND estado_sancion IN ('pendiente_confirmacion', 'activa')`,
    [id_prestamo]
  )

  if (sancion.length === 0) return null

  await client.query(
    `UPDATE sanciones SET estado_sancion = 'resuelta'
     WHERE id_sancion = $1`,
    [sancion[0].id_sancion]
  )

  // Verificar otras sanciones
  const { rows: otras } = await client.query(
    `SELECT COUNT(*) FROM sanciones
     WHERE id_usuario = $1
       AND estado_sancion IN ('activa', 'pendiente_confirmacion')`,
    [sancion[0].id_usuario]
  )

  if (parseInt(otras[0].count) === 0) {
    await client.query(
      `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
      [sancion[0].id_usuario]
    )
  }

  return sancion[0]
}

const getMySanctions = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT
       s.*,
       l.titulo AS libro_titulo,
       l.autor AS libro_autor,
       p.fecha_tope_devolucion
     FROM sanciones s
     LEFT JOIN prestamos p ON s.id_prestamo = p.id_prestamo
     LEFT JOIN ejemplares e ON s.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro
     WHERE s.id_usuario = $1
       AND s.estado_sancion != 'rechazada'
     ORDER BY s.fecha_sancion DESC`,
    [id_usuario]
  )
  return rows
}

module.exports = {
  createSanction, confirmSanction, rejectSanction,
  getSanctions, countSanctions, getSanctionById,
  resolveSanction, escalateSanction,
  autoResolveFaltaEntrega, getMySanctions
}