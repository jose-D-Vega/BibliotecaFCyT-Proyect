const pool = require('../config/db')
const { autoResolveFaltaEntrega } = require('./sanctions.queries')
const { crearNotificacion } = require('./notifications.queries')

// Buscar préstamos activos por datos del usuario
const searchActiveLoans = async (search) => {
  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.fecha_solicitud,
       p.fecha_tope_devolucion,
       p.estado_prestamo,
       p.es_reserva,
       p.numero_renovacion,
       p.id_prestamo_original,
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     -- Para renovaciones los detalles están bajo id_prestamo_original
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     WHERE p.estado_prestamo IN ('activo', 'pendiente_devolucion')
       AND (
         u.nombre_apellido ILIKE $1 OR
         u.correo ILIKE $1 OR
         u.ci ILIKE $1
       )
     GROUP BY p.id_prestamo, u.id_usuario
     HAVING COUNT(dp.id_ejemplar) FILTER (
       WHERE dp.estado_prestamo_ejemplar = 'activo'
     ) > 0
     ORDER BY p.fecha_tope_devolucion ASC`,
    [`%${search}%`]
  )
  return rows
}

// Obtener todos los préstamos activos sin filtro de búsqueda
const getAllActiveLoans = async () => {
  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.fecha_solicitud,
       p.fecha_tope_devolucion,
       p.estado_prestamo,
       p.es_reserva,
       p.numero_renovacion,
       p.id_prestamo_original,
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     WHERE p.estado_prestamo IN ('activo', 'pendiente_devolucion', 'vencido')
     GROUP BY p.id_prestamo, u.id_usuario
     HAVING COUNT(dp.id_ejemplar) FILTER (
       WHERE dp.estado_prestamo_ejemplar = 'activo'
     ) > 0
     ORDER BY p.fecha_tope_devolucion ASC`
  )
  return rows
}

// Obtener detalle de un préstamo con ejemplares pendientes de devolver
const getLoanForReturn = async (id_prestamo) => {
  const { rows: prestamo } = await pool.query(
    `SELECT
       p.*,
       u.nombre_apellido,
       u.correo,
       u.ci
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     WHERE p.id_prestamo = $1
       AND p.estado_prestamo IN ('activo', 'pendiente_devolucion', 'vencido')`,
    [id_prestamo]
  )

  if (prestamo.length === 0) return null

  // Para renovaciones, los detalles están bajo el id_prestamo_original
  const id_detalles = prestamo[0].id_prestamo_original || id_prestamo

  const { rows: ejemplares } = await pool.query(
    `SELECT
       dp.id_ejemplar,
       dp.estado_prestamo_ejemplar,
       dp.observaciones,
       e.estado_ejemplar,
       l.id_libro,
       l.titulo,
       l.autor
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     WHERE dp.id_prestamo = $1
       AND dp.estado_prestamo_ejemplar = 'activo'`,
    [id_detalles]
  )

  return { ...prestamo[0], ejemplares }
}

// Mapear estado_devuelto -> estado_ejemplar
const ESTADO_EJEMPLAR_POR_DEVOLUCION = {
  bueno: 'disponible',
  deteriorado: 'deteriorado',
  danado: 'perdido' // "dañado" grave -> se trata como pérdida (no reutilizable)
}

// Buscar si un ejemplar tenía una reserva aprobada esperándolo
const buscarReservaAfectada = async (client, id_ejemplar) => {
  const { rows: reservas } = await client.query(
    `SELECT
       dp.id_prestamo, dp.id_ejemplar, p.id_usuario, p.estado_prestamo,
       e.id_libro
     FROM detalles_prestamos dp
     JOIN prestamos p ON dp.id_prestamo = p.id_prestamo
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     WHERE dp.id_ejemplar = $1
       AND dp.es_reserva = true
       AND dp.estado_prestamo_ejemplar = 'aprobado'
       AND p.estado_prestamo IN ('reserva_aprobada', 'reserva_parcialmente_aprobada')`,
    [id_ejemplar]
  )

  if (reservas.length === 0) return null

  const reserva = reservas[0]

  const { rows: sustitutos } = await client.query(
    `SELECT id_ejemplar FROM ejemplares
     WHERE id_libro = $1 AND estado_ejemplar = 'disponible'
     ORDER BY id_ejemplar ASC
     LIMIT 1`,
    [reserva.id_libro]
  )

  return {
    id_prestamo: reserva.id_prestamo,
    id_ejemplar_afectado: id_ejemplar,
    id_usuario: reserva.id_usuario,
    id_libro: reserva.id_libro,
    sustituto_disponible: sustitutos.length > 0 ? sustitutos[0].id_ejemplar : null
  }
}

// Si una reserva aprobada tiene TODOS sus materiales listos (estado_ejemplar = 'reservado'),
// notifica al admin para que gestione la entrega final
const verificarReservaLista = async (client, id_prestamo_reserva) => {
  const { rows } = await client.query(
    `SELECT e.estado_ejemplar
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     WHERE dp.id_prestamo = $1
       AND dp.es_reserva = true
       AND dp.estado_prestamo_ejemplar = 'aprobado'`,
    [id_prestamo_reserva]
  )

  const todosListos = rows.length > 0 && rows.every(r => r.estado_ejemplar === 'reservado')
  if (!todosListos) return

  const { rows: admins } = await client.query(
    `SELECT u.id_usuario FROM usuarios u
     JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
     WHERE t.nombre_tipo = 'admin' AND u.activo = true`
  )

  for (const admin of admins) {
    await crearNotificacion({
      id_usuario: admin.id_usuario,
      tipo: 'admin_reserva_lista',
      titulo: 'Reserva lista para gestionar',
      mensaje: `Todos los materiales de la reserva #${id_prestamo_reserva} ya están disponibles. Revisala para confirmar la entrega.`,
      id_prestamo: id_prestamo_reserva,
      rol_destino: 'admin',
      unica: true
    })
  }
}

// Registrar devolución de ejemplares
// devoluciones = [{ id_ejemplar, estado_devuelto, observaciones }]
const registerReturn = async (id_prestamo, id_bibliotecario, devoluciones) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Obtener el préstamo para resolver el id correcto de detalles
    const { rows: prestamoInfo } = await client.query(
      `SELECT id_usuario, id_prestamo_original FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    if (prestamoInfo.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const id_usuario_prestamo = prestamoInfo[0].id_usuario
    // Para renovaciones los detalles están bajo id_prestamo_original
    const id_detalles = prestamoInfo[0].id_prestamo_original || id_prestamo

    const reservasAfectadas = []

    for (const dev of devoluciones) {
      // Insertar en devoluciones — siempre con el id del préstamo activo
      await client.query(
        `INSERT INTO devoluciones
           (id_prestamo, id_ejemplar, id_bibliotecario, estado_devuelto, observaciones)
         VALUES ($1, $2, $3, $4, $5)`,
        [id_prestamo, dev.id_ejemplar, id_bibliotecario, dev.estado_devuelto, dev.observaciones || null]
      )

      // Actualizar el detalle bajo el id correcto (original para renovaciones)
      await client.query(
        `UPDATE detalles_prestamos
         SET estado_prestamo_ejemplar = 'devuelto'
         WHERE id_prestamo = $1 AND id_ejemplar = $2`,
        [id_detalles, dev.id_ejemplar]
      )

      let nuevoEstadoEjemplar = ESTADO_EJEMPLAR_POR_DEVOLUCION[dev.estado_devuelto] || 'disponible'

      // Verificar si había una reserva esperando este ejemplar
      const reservaAfectada = await buscarReservaAfectada(client, dev.id_ejemplar)
      if (reservaAfectada) {
        reservasAfectadas.push({ ...reservaAfectada, estado_devuelto: dev.estado_devuelto })

        if (dev.estado_devuelto === 'bueno') {
          // Queda reservado para quien lo reservó, no disponible para cualquiera
          nuevoEstadoEjemplar = 'reservado'
          await verificarReservaLista(client, reservaAfectada.id_prestamo)
        }
        // Si volvió dañado/perdido: se resuelve al confirmar reasignación (reassignReservation)
      }

      await client.query(
        `UPDATE ejemplares SET estado_ejemplar = $1 WHERE id_ejemplar = $2`,
        [nuevoEstadoEjemplar, dev.id_ejemplar]
      )
    }

    // Verificar si quedan ejemplares activos (buscar bajo el id correcto)
    const { rows: pendientes } = await client.query(
      `SELECT COUNT(*) FROM detalles_prestamos
       WHERE id_prestamo = $1
         AND estado_prestamo_ejemplar IN ('activo', 'perdido')`,
      [id_detalles]
    )

    const quedanPendientes = parseInt(pendientes[0].count) > 0

    if (!quedanPendientes) {
      // Verificar si quedaron ejemplares perdidos sin resolver
      const { rows: perdidos } = await client.query(
        `SELECT COUNT(*) FROM detalles_prestamos
        WHERE id_prestamo = $1
          AND estado_prestamo_ejemplar = 'perdido'`,
        [id_prestamo]
      )

      const hayPerdidos = parseInt(perdidos[0].count) > 0
      const nuevoEstadoPrestamo = hayPerdidos ? 'cerrado_con_perdida' : 'devuelto'

      await client.query(
        `UPDATE prestamos SET estado_prestamo = $1 WHERE id_prestamo = $2`,
        [nuevoEstadoPrestamo, id_prestamo]
      )

      await autoResolveFaltaEntrega(id_prestamo, client)

      if (id_usuario_prestamo) {
        await crearNotificacion({
          id_usuario: id_usuario_prestamo,
          tipo: 'prestamo_devuelto',
          titulo: hayPerdidos ? 'Devolución registrada con pendientes' : 'Devolución registrada',
          mensaje: hayPerdidos
            ? 'Se registró la devolución de tu préstamo. Quedan ejemplares pendientes por pérdida declarada.'
            : 'Se registró la devolución completa de tu préstamo. ¡Gracias por devolverlo!',
          id_prestamo
        })
      }
    }

    await client.query('COMMIT')

    return {
      devueltos: devoluciones.length,
      prestamo_cerrado: !quedanPendientes,
      ejemplares_pendientes: parseInt(pendientes[0].count),
      reservas_afectadas: reservasAfectadas
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Reasignar una reserva a un ejemplar sustituto (cuando el original volvió dañado/perdido)
const reassignReservation = async (id_prestamo, id_ejemplar_anterior, id_ejemplar_nuevo) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: sustituto } = await client.query(
      `SELECT estado_ejemplar FROM ejemplares WHERE id_ejemplar = $1`,
      [id_ejemplar_nuevo]
    )
    if (sustituto.length === 0 || sustituto[0].estado_ejemplar !== 'disponible') {
      await client.query('ROLLBACK')
      return { error: 'El ejemplar sustituto ya no está disponible' }
    }

    const { rows: detalle } = await client.query(
      `UPDATE detalles_prestamos
       SET id_ejemplar = $1
       WHERE id_prestamo = $2 AND id_ejemplar = $3
       RETURNING *`,
      [id_ejemplar_nuevo, id_prestamo, id_ejemplar_anterior]
    )

    if (detalle.length === 0) {
      await client.query('ROLLBACK')
      return { error: 'No se encontró el detalle de la reserva a reasignar' }
    }

    await client.query(
      `UPDATE ejemplares SET estado_ejemplar = 'reservado' WHERE id_ejemplar = $1`,
      [id_ejemplar_nuevo]
    )

    const { rows: prestamoInfo } = await client.query(
      `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    // Verificar si la reserva ya quedó completa con el sustituto
    await verificarReservaLista(client, id_prestamo)

    await client.query('COMMIT')

    if (prestamoInfo[0]) {
      await crearNotificacion({
        id_usuario: prestamoInfo[0].id_usuario,
        tipo: 'reserva_modificada',
        titulo: 'Tu reserva tuvo cambios',
        mensaje: 'El material que tenías reservado ya no está disponible y fue reemplazado por otro ejemplar del mismo libro.',
        id_prestamo
      })
    }

    return { reasignado: true, detalle: detalle[0] }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const getHistorial = async ({ search, fecha_desde, fecha_hasta, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE p.estado_prestamo IN ('devuelto', 'vencido')`

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.ci ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND p.fecha_activacion::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND p.fecha_activacion::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.id_prestamo_original,
       p.numero_renovacion,
       p.fecha_solicitud,
       p.fecha_activacion,
       p.fecha_tope_devolucion,
       p.estado_prestamo,
       p.es_reserva,
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     ${whereClause}
     GROUP BY p.id_prestamo, u.id_usuario
     ORDER BY p.fecha_tope_devolucion ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countHistorial = async ({ search, fecha_desde, fecha_hasta }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE p.estado_prestamo IN ('devuelto', 'vencido')`

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.ci ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND p.fecha_activacion::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND p.fecha_activacion::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT p.id_prestamo)
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

const getPrestamosConDevoluciones = async ({ search, fecha_desde, fecha_hasta, id_bibliotecario, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.ci ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND d.fecha_devolucion::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND d.fecha_devolucion::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }
  if (id_bibliotecario) {
    whereClause += ` AND d.id_bibliotecario = $${paramIndex}`
    values.push(id_bibliotecario)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
      p.id_prestamo,
      p.id_prestamo_original,
      p.numero_renovacion,
      p.fecha_activacion,
      p.fecha_tope_devolucion,
      p.fecha_respuesta,
      p.estado_prestamo,
      p.es_reserva,
      u.id_usuario,
      u.nombre_apellido,
      u.correo,
      u.ci,
      ba.nombre_apellido AS bibliotecario_activacion,
      COUNT(DISTINCT dp.id_ejemplar) AS total_ejemplares,
      COUNT(DISTINCT l.id_libro) AS total_libros,
      COUNT(DISTINCT d.id_ejemplar) AS ejemplares_devueltos,
      BOOL_OR(d.estado_devuelto != 'bueno') AS tiene_problemas,
      MAX(d.fecha_devolucion) AS ultima_devolucion
    FROM prestamos p
    JOIN usuarios u ON p.id_usuario = u.id_usuario
    JOIN detalles_prestamos dp
      ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
    JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
    JOIN libros l ON e.id_libro = l.id_libro
    JOIN devoluciones d ON d.id_prestamo = p.id_prestamo
    LEFT JOIN usuarios ba ON p.id_bibliotecario = ba.id_usuario
    ${whereClause}
    GROUP BY p.id_prestamo, u.id_usuario, ba.nombre_apellido
    ORDER BY MAX(d.fecha_devolucion) DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countPrestamosConDevoluciones = async ({ search, fecha_desde, fecha_hasta, id_bibliotecario }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.ci ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND d.fecha_devolucion::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND d.fecha_devolucion::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }
  if (id_bibliotecario) {
    whereClause += ` AND d.id_bibliotecario = $${paramIndex}`
    values.push(id_bibliotecario)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT p.id_prestamo)
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN devoluciones d ON d.id_prestamo = p.id_prestamo
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

const getDetalleDevoluciones = async (id_prestamo) => {
  const { rows: detalles } = await pool.query(
    `SELECT
       d.id_devolucion,
       d.id_ejemplar,
       d.fecha_devolucion,
       d.estado_devuelto,
       d.observaciones,
       l.titulo,
       l.autor,
       b.nombre_apellido AS bibliotecario
     FROM devoluciones d
     JOIN ejemplares e ON d.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     JOIN usuarios b ON d.id_bibliotecario = b.id_usuario
     WHERE d.id_prestamo = $1
     ORDER BY d.fecha_devolucion ASC`,
    [id_prestamo]
  )

  // Ejemplares activos aún pendientes
  const { rows: pendientes } = await pool.query(
    `SELECT dp.id_ejemplar, dp.estado_prestamo_ejemplar, l.titulo, l.autor
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     WHERE dp.id_prestamo = $1
       AND dp.estado_prestamo_ejemplar = 'activo'`,
    [id_prestamo]
  )

  // Ejemplares perdidos pendientes de recuperación o reemplazo
  const { rows: perdidos } = await pool.query(
    `SELECT
       dp.id_ejemplar,
       dp.estado_prestamo_ejemplar,
       l.titulo,
       l.autor,
       s.id_sancion,
       s.estado_sancion AS estado_sancion_perdida
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     LEFT JOIN sanciones s ON s.id_ejemplar = dp.id_ejemplar
       AND s.id_prestamo = dp.id_prestamo
       AND s.tipo_infraccion = 'perdida'
     WHERE dp.id_prestamo = $1
       AND dp.estado_prestamo_ejemplar = 'perdido'`,
    [id_prestamo]
  )

  return { devueltos: detalles, pendientes, perdidos }
}

const getDevolucionesUsuario = async ({ id_usuario, search, fecha_desde, fecha_hasta, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE p.id_usuario = $${paramIndex}`
  values.push(id_usuario)
  paramIndex++

  if (search) {
    whereClause += ` AND l.titulo ILIKE $${paramIndex}`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND d.fecha_devolucion::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND d.fecha_devolucion::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.id_prestamo_original,
       p.numero_renovacion,
       p.fecha_activacion,
       p.fecha_tope_devolucion,
       p.estado_prestamo,
       p.es_reserva,
       COUNT(DISTINCT dp.id_ejemplar) AS total_ejemplares,
       COUNT(DISTINCT l.id_libro) AS total_libros,
       COUNT(DISTINCT d.id_ejemplar) AS ejemplares_devueltos,
       BOOL_OR(d.estado_devuelto != 'bueno') AS tiene_problemas,
       MAX(d.fecha_devolucion) AS ultima_devolucion
     FROM prestamos p
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     JOIN devoluciones d ON d.id_prestamo = p.id_prestamo
     ${whereClause}
     GROUP BY p.id_prestamo
     ORDER BY MAX(d.fecha_devolucion) DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countDevolucionesUsuario = async ({ id_usuario, search, fecha_desde, fecha_hasta }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE p.id_usuario = $${paramIndex}`
  values.push(id_usuario)
  paramIndex++

  if (search) {
    whereClause += ` AND l.titulo ILIKE $${paramIndex}`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND d.fecha_devolucion::date >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND d.fecha_devolucion::date <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT p.id_prestamo)
     FROM prestamos p
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     JOIN devoluciones d ON d.id_prestamo = p.id_prestamo
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

const recuperarEjemplarPerdido = async (id_prestamo, id_ejemplar, id_bibliotecario, { estado_devuelto, observaciones }) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verificar que el ejemplar realmente está perdido en este préstamo
    const { rows: detalle } = await client.query(
      `SELECT dp.*, e.id_libro FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       WHERE dp.id_prestamo = $1
         AND dp.id_ejemplar = $2
         AND dp.estado_prestamo_ejemplar = 'perdido'`,
      [id_prestamo, id_ejemplar]
    )
    if (detalle.length === 0) {
      throw Object.assign(new Error('El ejemplar no está en estado perdido para este préstamo'), { code: 'EJEMPLAR_NO_PERDIDO' })
    }
    const id_libro = detalle[0].id_libro

    // Registrar en devoluciones
    await client.query(
      `INSERT INTO devoluciones
         (id_prestamo, id_ejemplar, id_bibliotecario, estado_devuelto, observaciones)
       VALUES ($1, $2, $3, $4, $5)`,
      [id_prestamo, id_ejemplar, id_bibliotecario, estado_devuelto, observaciones || null]
    )

    // Actualizar detalles_prestamos
    await client.query(
      `UPDATE detalles_prestamos
       SET estado_prestamo_ejemplar = 'devuelto'
       WHERE id_prestamo = $1 AND id_ejemplar = $2`,
      [id_prestamo, id_ejemplar]
    )

    // Actualizar estado del ejemplar según cómo fue devuelto
    const ESTADO_EJEMPLAR = {
      bueno:       'disponible',
      deteriorado: 'deteriorado',
      danado:      'perdido',   // dañado grave → sigue fuera del inventario
    }
    const nuevoEstadoEjemplar = ESTADO_EJEMPLAR[estado_devuelto] || 'disponible'

    await client.query(
      `UPDATE ejemplares SET estado_ejemplar = $1 WHERE id_ejemplar = $2`,
      [nuevoEstadoEjemplar, id_ejemplar]
    )

    // Si vuelve en condiciones usables, sumar a cantidad_ejemplar
    if (estado_devuelto === 'bueno' || estado_devuelto === 'deteriorado') {
      await client.query(
        `UPDATE libros SET cantidad_ejemplar = cantidad_ejemplar + 1 WHERE id_libro = $1`,
        [id_libro]
      )
    }

    // Resolver automáticamente la sanción por pérdida de este ejemplar
    const { rows: sancion } = await client.query(
      `UPDATE sanciones SET estado_sancion = 'resuelta'
       WHERE id_prestamo = $1
         AND id_ejemplar = $2
         AND tipo_infraccion = 'perdida'
         AND estado_sancion NOT IN ('resuelta', 'rechazada')
       RETURNING *`,
      [id_prestamo, id_ejemplar]
    )

    let cuentaHabilitada = false
    if (sancion.length > 0) {
      const id_usuario = sancion[0].id_usuario
      const { rows: otrasSanciones } = await client.query(
        `SELECT COUNT(*) FROM sanciones
         WHERE id_usuario = $1
           AND estado_sancion IN ('activa', 'pendiente_confirmacion')
           AND id_sancion != $2`,
        [id_usuario, sancion[0].id_sancion]
      )
      cuentaHabilitada = parseInt(otrasSanciones[0].count) === 0
      if (cuentaHabilitada) {
        await client.query(
          `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
          [id_usuario]
        )
      }
    }

    // Reevaluar estado del préstamo
    const { rows: pendientes } = await client.query(
      `SELECT COUNT(*) FROM detalles_prestamos
       WHERE id_prestamo = $1
         AND estado_prestamo_ejemplar IN ('activo', 'perdido')`,
      [id_prestamo]
    )
    const quedanPendientes = parseInt(pendientes[0].count) > 0

    let prestamoCerrado = false
    if (!quedanPendientes) {
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'devuelto'
         WHERE id_prestamo = $1`,
        [id_prestamo]
      )
      prestamoCerrado = true
    }

    const { rows: prestamoInfo } = await client.query(
      `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const id_usuario_prestamo = prestamoInfo[0]?.id_usuario

    // Notificar al usuario
    if (id_usuario_prestamo) {
      await crearNotificacion({
        id_usuario: id_usuario_prestamo,
        tipo: 'prestamo_devuelto',
        titulo: 'Material recuperado registrado',
        mensaje: prestamoCerrado
          ? 'El material recuperado fue registrado y tu préstamo quedó completamente cerrado.'
          : 'El material recuperado fue registrado.',
        id_prestamo
      })

      if (cuentaHabilitada) {
        await crearNotificacion({
          id_usuario: id_usuario_prestamo,
          tipo: 'cuenta_habilitada',
          titulo: 'Ya podés volver a usar la biblioteca',
          mensaje: 'No tenés más sanciones activas. Tus servicios de biblioteca fueron restaurados.',
          id_prestamo,
          id_sancion: sancion[0]?.id_sancion || null
        })
      }
    }

    await client.query('COMMIT')
    return { prestamo_cerrado: prestamoCerrado, cuenta_habilitada: cuentaHabilitada }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const reemplazarEjemplarPerdido = async (id_prestamo, id_ejemplar, id_bibliotecario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: detalle } = await client.query(
      `SELECT dp.*, e.id_libro FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       WHERE dp.id_prestamo = $1
         AND dp.id_ejemplar = $2
         AND dp.estado_prestamo_ejemplar = 'perdido'`,
      [id_prestamo, id_ejemplar]
    )
    if (detalle.length === 0) {
      throw Object.assign(new Error('El ejemplar no está en estado perdido para este préstamo'), { code: 'EJEMPLAR_NO_PERDIDO' })
    }
    const id_libro = detalle[0].id_libro

    // Registrar en devoluciones con estado 'reemplazado'
    await client.query(
      `INSERT INTO devoluciones
         (id_prestamo, id_ejemplar, id_bibliotecario, estado_devuelto, observaciones)
       VALUES ($1, $2, $3, 'reemplazado', 'El usuario entregó un ejemplar de reemplazo')`,
      [id_prestamo, id_ejemplar, id_bibliotecario]
    )

    // El ejemplar original sigue perdido — actualizar solo el detalle del préstamo
    await client.query(
      `UPDATE detalles_prestamos
       SET estado_prestamo_ejemplar = 'reemplazado'
       WHERE id_prestamo = $1 AND id_ejemplar = $2`,
      [id_prestamo, id_ejemplar]
    )

    // El reemplazo suma al inventario del libro (el nuevo ejemplar físico)
    await client.query(
      `UPDATE libros SET cantidad_ejemplar = cantidad_ejemplar + 1 WHERE id_libro = $1`,
      [id_libro]
    )

    // Resolver la sanción por pérdida automáticamente
    const { rows: sancion } = await client.query(
      `UPDATE sanciones SET estado_sancion = 'resuelta'
       WHERE id_prestamo = $1
         AND id_ejemplar = $2
         AND tipo_infraccion = 'perdida'
         AND estado_sancion NOT IN ('resuelta', 'rechazada')
       RETURNING *`,
      [id_prestamo, id_ejemplar]
    )

    let cuentaHabilitada = false
    if (sancion.length > 0) {
      const id_usuario = sancion[0].id_usuario
      const { rows: otras } = await client.query(
        `SELECT COUNT(*) FROM sanciones
         WHERE id_usuario = $1
           AND estado_sancion IN ('activa', 'pendiente_confirmacion')
           AND id_sancion != $2`,
        [id_usuario, sancion[0].id_sancion]
      )
      cuentaHabilitada = parseInt(otras[0].count) === 0
      if (cuentaHabilitada) {
        await client.query(
          `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
          [id_usuario]
        )
      }
    }

    // Reevaluar estado del préstamo
    const { rows: pendientes } = await client.query(
      `SELECT COUNT(*) FROM detalles_prestamos
       WHERE id_prestamo = $1
         AND estado_prestamo_ejemplar IN ('activo', 'perdido')`,
      [id_prestamo]
    )
    const quedanPendientes = parseInt(pendientes[0].count) > 0

    if (!quedanPendientes) {
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'devuelto'
         WHERE id_prestamo = $1`,
        [id_prestamo]
      )
    }

    const { rows: prestamoInfo } = await client.query(
      `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const id_usuario_prestamo = prestamoInfo[0]?.id_usuario

    if (id_usuario_prestamo) {
      await crearNotificacion({
        id_usuario: id_usuario_prestamo,
        tipo: 'prestamo_devuelto',
        titulo: 'Reemplazo de material registrado',
        mensaje: 'El reemplazo del material perdido fue registrado correctamente.',
        id_prestamo
      })
      if (cuentaHabilitada) {
        await crearNotificacion({
          id_usuario: id_usuario_prestamo,
          tipo: 'cuenta_habilitada',
          titulo: 'Ya podés volver a usar la biblioteca',
          mensaje: 'No tenés más sanciones activas. Tus servicios de biblioteca fueron restaurados.',
          id_prestamo,
          id_sancion: sancion[0]?.id_sancion || null
        })
      }
    }

    await client.query('COMMIT')
    return { prestamo_cerrado: !quedanPendientes, cuenta_habilitada: cuentaHabilitada }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  searchActiveLoans,
  getAllActiveLoans,
  getLoanForReturn,
  registerReturn,
  getHistorial,
  countHistorial,
  getPrestamosConDevoluciones,
  countPrestamosConDevoluciones,
  getDetalleDevoluciones,
  getDevolucionesUsuario,
  countDevolucionesUsuario,
  reassignReservation,
  recuperarEjemplarPerdido, 
  reemplazarEjemplarPerdido
}