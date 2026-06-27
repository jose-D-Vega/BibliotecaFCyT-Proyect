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
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN detalles_prestamos dp ON p.id_prestamo = dp.id_prestamo
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

// Obtener detalle de un préstamo con ejemplares pendientes
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
    [id_prestamo]
  )

  return { ...prestamo[0], ejemplares }
}

// Mapear estado_devuelto -> estado_ejemplar
const ESTADO_EJEMPLAR_POR_DEVOLUCION = {
  bueno: 'disponible',
  deteriorado: 'deteriorado',
  danado: 'perdido' // "dañado" grave -> se trata como pérdida (no reutilizable)
}

// Buscar si un ejemplar tenía una reserva aprobada esperándolo, y si hay sustituto disponible
const buscarReservaAfectada = async (client, id_ejemplar) => {
  // ¿Hay una reserva (detalles_prestamos.es_reserva = true) que apunta a este ejemplar
  // y aún está en estado_prestamo_ejemplar = 'aprobado' (esperando que se libere)?
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

  // Buscar un ejemplar sustituto disponible del mismo libro
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

// Si una reserva ya aprobada tiene TODOS sus ejemplares pendientes listos (reservados),
// avisa al admin para que haga la revisión final (la decisión de entrega queda en sus manos)
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
const registerReturn = async (id_prestamo, id_bibliotecario, devoluciones) => {
  // devoluciones = [{ id_ejemplar, estado_devuelto, observaciones }]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: prestamoInfo } = await client.query(
      `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const id_usuario_prestamo = prestamoInfo[0]?.id_usuario

    const reservasAfectadas = []

    for (const dev of devoluciones) {
      // Insertar en devoluciones
      await client.query(
        `INSERT INTO devoluciones
           (id_prestamo, id_ejemplar, id_bibliotecario, estado_devuelto, observaciones)
         VALUES ($1, $2, $3, $4, $5)`,
        [id_prestamo, dev.id_ejemplar, id_bibliotecario, dev.estado_devuelto, dev.observaciones || null]
      )

      // Actualizar detalle del préstamo (sin id_bibliotecario, ahora redundante)
      await client.query(
        `UPDATE detalles_prestamos
         SET estado_prestamo_ejemplar = 'devuelto'
         WHERE id_prestamo = $1 AND id_ejemplar = $2`,
        [id_prestamo, dev.id_ejemplar]
      )

      let nuevoEstadoEjemplar = ESTADO_EJEMPLAR_POR_DEVOLUCION[dev.estado_devuelto] || 'disponible'

      // Si el ejemplar vuelve en buen estado, verificar si tenía una reserva esperándolo.
      // Si vuelve dañado/perdido, igual puede afectar una reserva (no se le puede entregar al reservante).
      const reservaAfectada = await buscarReservaAfectada(client, dev.id_ejemplar)
      if (reservaAfectada) {
        reservasAfectadas.push({ ...reservaAfectada, estado_devuelto: dev.estado_devuelto })

        if (dev.estado_devuelto === 'bueno') {
          // Queda reservado para quien lo reservó, no disponible para cualquiera
          nuevoEstadoEjemplar = 'reservado'
          await verificarReservaLista(client, reservaAfectada.id_prestamo)
        
        }
        // Si volvió dañado/perdido, no se notifica acá — se notifica cuando el bibliotecario
        // confirme la reasignación a un sustituto (reserva_modificada, ver reassignReservation)
      }

      // Actualizar estado del ejemplar
      await client.query(
        `UPDATE ejemplares SET estado_ejemplar = $1 WHERE id_ejemplar = $2`,
        [nuevoEstadoEjemplar, dev.id_ejemplar]
      )
    }

    // Verificar si quedan ejemplares activos en el préstamo
    const { rows: pendientes } = await client.query(
      `SELECT COUNT(*) FROM detalles_prestamos
       WHERE id_prestamo = $1
         AND estado_prestamo_ejemplar = 'activo'`,
      [id_prestamo]
    )

    const quedanPendientes = parseInt(pendientes[0].count) > 0

    // "Si no quedan pendientes, cerrar el préstamo"
    if (!quedanPendientes) {
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'devuelto'
        WHERE id_prestamo = $1`,
        [id_prestamo]
      )
      // Resolver automáticamente falta_entrega si existía
      await autoResolveFaltaEntrega(id_prestamo, client)

      if (id_usuario_prestamo) {
        await crearNotificacion({
          id_usuario: id_usuario_prestamo,
          tipo: 'prestamo_devuelto',
          titulo: 'Devolución registrada',
          mensaje: 'Se registró la devolución completa de tu préstamo. ¡Gracias por devolverlo!',
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

// Reasignar una reserva a un ejemplar sustituto, porque el ejemplar original
// que tenía asignado volvió dañado/perdido y ya no puede entregarse.
const reassignReservation = async (id_prestamo, id_ejemplar_anterior, id_ejemplar_nuevo) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verificar que el sustituto sigue disponible
    const { rows: sustituto } = await client.query(
      `SELECT estado_ejemplar FROM ejemplares WHERE id_ejemplar = $1`,
      [id_ejemplar_nuevo]
    )
    if (sustituto.length === 0 || sustituto[0].estado_ejemplar !== 'disponible') {
      await client.query('ROLLBACK')
      return { error: 'El ejemplar sustituto ya no está disponible' }
    }

    // Cambiar el detalle de la reserva: ahora apunta al ejemplar sustituto
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

    // Reservar el sustituto, y el ejemplar dañado/perdido conserva su estado actual
    await client.query(
      `UPDATE ejemplares SET estado_ejemplar = 'reservado' WHERE id_ejemplar = $1`,
      [id_ejemplar_nuevo]
    )

    const { rows: prestamoInfo } = await client.query(
      `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )

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
  let whereClause = 'WHERE 1=1'

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.ci ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND d.fecha_devolucion >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND d.fecha_devolucion <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       d.id_devolucion,
       d.fecha_devolucion,
       d.estado_devuelto,
       d.observaciones,
       d.id_prestamo,
       d.id_ejemplar,
       e.id_libro,
       l.titulo,
       l.autor,
       u.nombre_apellido,
       u.correo,
       u.ci,
       b.nombre_apellido AS bibliotecario
     FROM devoluciones d
     JOIN prestamos p ON d.id_prestamo = p.id_prestamo
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN ejemplares e ON d.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     JOIN usuarios b ON d.id_bibliotecario = b.id_usuario
     ${whereClause}
     ORDER BY d.fecha_devolucion DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countHistorial = async ({ search, fecha_desde, fecha_hasta }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (search) {
    whereClause += ` AND (u.nombre_apellido ILIKE $${paramIndex} OR u.ci ILIKE $${paramIndex} OR u.correo ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND d.fecha_devolucion >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND d.fecha_devolucion <= $${paramIndex}`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM devoluciones d
     JOIN prestamos p ON d.id_prestamo = p.id_prestamo
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}
const getAllActiveLoans = async () => {
  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.fecha_solicitud,
       p.fecha_tope_devolucion,
       p.fecha_respuesta,
       p.fecha_activacion,
       p.estado_prestamo,
       p.es_reserva,
       p.numero_renovacion,
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     JOIN detalles_prestamos dp ON p.id_prestamo = dp.id_prestamo
     WHERE p.estado_prestamo IN ('activo', 'pendiente_devolucion', 'vencido') -- ← agregar vencido
     GROUP BY p.id_prestamo, u.id_usuario
     HAVING COUNT(dp.id_ejemplar) FILTER (
       WHERE dp.estado_prestamo_ejemplar = 'activo'
     ) > 0
     ORDER BY p.fecha_tope_devolucion ASC`
  )
  return rows
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
    JOIN detalles_prestamos dp ON p.id_prestamo = dp.id_prestamo
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

  // Ejemplares aún no devueltos
  const { rows: pendientes } = await pool.query(
    `SELECT
       dp.id_ejemplar,
       l.titulo,
       l.autor
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     WHERE dp.id_prestamo = $1
       AND dp.estado_prestamo_ejemplar = 'activo'`,
    [id_prestamo]
  )

  return { devueltos: detalles, pendientes }
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
     JOIN detalles_prestamos dp ON p.id_prestamo = dp.id_prestamo
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
     JOIN detalles_prestamos dp ON p.id_prestamo = dp.id_prestamo
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     JOIN devoluciones d ON d.id_prestamo = p.id_prestamo
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

module.exports = {
  searchActiveLoans, getAllActiveLoans, getLoanForReturn, registerReturn,
  getHistorial, countHistorial,
  getPrestamosConDevoluciones, countPrestamosConDevoluciones, getDetalleDevoluciones,
  getDevolucionesUsuario, countDevolucionesUsuario, reassignReservation, verificarReservaLista
}