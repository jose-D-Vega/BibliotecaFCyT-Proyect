const pool = require('../config/db')
const { autoResolveFaltaEntrega } = require('./sanctions.queries')
const { crearNotificacion } = require('./notifications.queries')

// Obtener todos los préstamos activos sin filtro de búsqueda
const getAllActiveLoans = async () => {
  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.id_prestamo_original,
       p.numero_renovacion,
       p.estado_prestamo,
       p.es_reserva,
       p.fecha_tope_devolucion,
       p.fecha_limite_respuesta_renovacion,
       -- Fechas del préstamo raíz para renovaciones
       COALESCE(orig.fecha_solicitud, p.fecha_solicitud)   AS fecha_solicitud,
       COALESCE(orig.fecha_respuesta, p.fecha_respuesta)   AS fecha_respuesta,
       COALESCE(orig.fecha_activacion, p.fecha_activacion) AS fecha_activacion,
       CASE WHEN p.id_prestamo_original IS NOT NULL
         THEN p.fecha_activacion ELSE NULL
       END AS fecha_renovacion,
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     LEFT JOIN prestamos orig ON p.id_prestamo_original = orig.id_prestamo
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     WHERE p.estado_prestamo IN ('activo', 'pendiente_devolucion', 'vencido')
     GROUP BY p.id_prestamo, u.id_usuario,
       orig.fecha_solicitud, orig.fecha_respuesta, orig.fecha_activacion
     HAVING COUNT(dp.id_ejemplar) FILTER (
       WHERE dp.estado_prestamo_ejemplar = 'activo'
     ) > 0
     ORDER BY p.fecha_tope_devolucion ASC`
  )
  return rows
}

// Buscar préstamos activos por datos del usuario
const searchActiveLoans = async (search) => {
  const { rows } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.id_prestamo_original,
       p.numero_renovacion,
       p.estado_prestamo,
       p.es_reserva,
       p.fecha_tope_devolucion,
       p.fecha_limite_respuesta_renovacion,
       COALESCE(orig.fecha_solicitud, p.fecha_solicitud)   AS fecha_solicitud,
       COALESCE(orig.fecha_respuesta, p.fecha_respuesta)   AS fecha_respuesta,
       COALESCE(orig.fecha_activacion, p.fecha_activacion) AS fecha_activacion,
       CASE WHEN p.id_prestamo_original IS NOT NULL
         THEN p.fecha_activacion ELSE NULL
       END AS fecha_renovacion,
       u.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COUNT(dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar = 'activo'
       ) AS ejemplares_pendientes
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     LEFT JOIN prestamos orig ON p.id_prestamo_original = orig.id_prestamo
     JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     WHERE p.estado_prestamo IN ('activo', 'pendiente_devolucion')
       AND (
         u.nombre_apellido ILIKE $1 OR
         u.correo ILIKE $1 OR
         u.ci ILIKE $1
       )
     GROUP BY p.id_prestamo, u.id_usuario,
       orig.fecha_solicitud, orig.fecha_respuesta, orig.fecha_activacion
     HAVING COUNT(dp.id_ejemplar) FILTER (
       WHERE dp.estado_prestamo_ejemplar = 'activo'
     ) > 0
     ORDER BY p.fecha_tope_devolucion ASC`,
    [`%${search}%`]
  )
  return rows
}

// Obtener detalle de un préstamo con ejemplares pendientes de devolver
const getLoanForReturn = async (id_prestamo) => {
  const { rows: prestamo } = await pool.query(
    `SELECT
       p.id_prestamo,
       p.id_prestamo_original,
       p.numero_renovacion,
       p.estado_prestamo,
       p.es_reserva,
       p.fecha_tope_devolucion,
       p.id_usuario,
       u.nombre_apellido,
       u.correo,
       u.ci,
       COALESCE(orig.fecha_solicitud, p.fecha_solicitud)   AS fecha_solicitud,
       COALESCE(orig.fecha_respuesta, p.fecha_respuesta)   AS fecha_respuesta,
       COALESCE(orig.fecha_activacion, p.fecha_activacion) AS fecha_activacion,
       CASE WHEN p.id_prestamo_original IS NOT NULL
         THEN p.fecha_activacion ELSE NULL
       END AS fecha_renovacion
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     LEFT JOIN prestamos orig ON p.id_prestamo_original = orig.id_prestamo
     WHERE p.id_prestamo = $1
       AND p.estado_prestamo IN ('activo', 'pendiente_devolucion', 'vencido')`,
    [id_prestamo]
  )

  if (prestamo.length === 0) return null

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
       AND p.estado_prestamo IN ('reserva_aprobada', 'reserva_parcialmente_aprobada')
     ORDER BY p.fecha_solicitud ASC
     LIMIT 1`,
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
        }
        // Si volvió dañado/perdido: se resuelve al confirmar reasignación (reassignReservation)
      }

      // Actualizar el ejemplar PRIMERO, para que verificarReservaLista vea el estado real y actualizado
      await client.query(
        `UPDATE ejemplares SET estado_ejemplar = $1 WHERE id_ejemplar = $2`,
        [nuevoEstadoEjemplar, dev.id_ejemplar]
      )

      // Ahora sí: si quedó reservado, recién acá chequear si la reserva ya está completa
      if (reservaAfectada && dev.estado_devuelto === 'bueno') {
        await verificarReservaLista(client, reservaAfectada.id_prestamo)
      }
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
      const { rows: perdidos } = await client.query(
        `SELECT COUNT(*) FROM detalles_prestamos
         WHERE id_prestamo = $1
           AND estado_prestamo_ejemplar = 'perdido'`,
        [id_detalles] 
      )

      const hayPerdidos = parseInt(perdidos[0].count) > 0
      const esRenovacion = prestamoInfo[0].id_prestamo_original !== null

      if (esRenovacion) {
        // La renovación activa cierra como 'renovacion_finalizada'
        await client.query(
          `UPDATE prestamos SET estado_prestamo = 'renovacion_finalizada'
           WHERE id_prestamo = $1`,
          [id_prestamo]
        )
        // El original pasa a 'devuelto' (o 'cerrado_con_perdida' si quedan perdidos sin resolver)
        await client.query(
          `UPDATE prestamos SET estado_prestamo = $1
           WHERE id_prestamo = $2`,
          [hayPerdidos ? 'cerrado_con_perdida' : 'devuelto', prestamoInfo[0].id_prestamo_original]
        )
      } else {
        await client.query(
          `UPDATE prestamos SET estado_prestamo = $1
           WHERE id_prestamo = $2`,
          [hayPerdidos ? 'cerrado_con_perdida' : 'devuelto', id_prestamo]
        )
      }

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
  let whereClause = `WHERE p.estado_prestamo IN ('devuelto', 'vencido', 'renovacion_finalizada', 'cerrado_con_perdida')`

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
      COUNT(DISTINCT dp.id_ejemplar) FILTER (
        WHERE dp.estado_prestamo_ejemplar NOT IN ('solicitado', 'rechazado', 'cancelado')
      ) AS total_ejemplares,
      COUNT(DISTINCT l.id_libro) FILTER (
        WHERE dp.estado_prestamo_ejemplar NOT IN ('solicitado', 'rechazado', 'cancelado')
      ) AS total_libros,
      COUNT(DISTINCT d.id_ejemplar) AS ejemplares_devueltos,
      BOOL_OR(d.estado_devuelto != 'bueno') AS tiene_problemas,
      (
        BOOL_OR(dp.estado_prestamo_ejemplar IN ('perdido', 'reemplazado'))
        OR BOOL_OR(p.estado_prestamo = 'cerrado_con_perdida')
      ) AS tiene_perdida,
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
  const { rows: prestamoInfo } = await pool.query(
    `SELECT COALESCE(id_prestamo_original, id_prestamo) AS id_detalles
     FROM prestamos WHERE id_prestamo = $1`,
    [id_prestamo]
  )
  const id_detalles = prestamoInfo[0]?.id_detalles || id_prestamo

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
    WHERE d.id_prestamo IN (
      SELECT id_prestamo FROM prestamos
      WHERE id_prestamo = $1 OR id_prestamo_original = $1
    )
    ORDER BY d.fecha_devolucion ASC`,
    [id_detalles]
  )

  const { rows: pendientes } = await pool.query(
    `SELECT dp.id_ejemplar, dp.estado_prestamo_ejemplar, l.titulo, l.autor
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     WHERE dp.id_prestamo = $1
       AND dp.estado_prestamo_ejemplar = 'activo'`,
    [id_detalles]
  )

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
    [id_detalles]
  )

  return { devueltos: detalles, pendientes, perdidos }
}

const getDevolucionesUsuario = async ({ id_usuario, search, fecha_desde, fecha_hasta, limit, offset }) => {
  const values = [id_usuario]
  let paramIndex = 2
  // Estos filtros deciden QUÉ préstamos mostrar, pero no deben recortar las
  // filas usadas para calcular los totales agregados del préstamo (eso fue
  // lo que causaba el "2/1" al buscar por un libro específico dentro de un
  // préstamo con varios materiales distintos).
  let filtroExtra = ''

  if (search) {
    filtroExtra += ` AND EXISTS (
      SELECT 1 FROM detalles_prestamos dpf
      JOIN ejemplares ef ON dpf.id_ejemplar = ef.id_ejemplar
      JOIN libros lf ON ef.id_libro = lf.id_libro
      WHERE dpf.id_prestamo = c.id_raiz AND lf.titulo ILIKE $${paramIndex}
    )`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    filtroExtra += ` AND EXISTS (
      SELECT 1 FROM devoluciones df
      WHERE df.id_prestamo = c.id_prestamo AND df.fecha_devolucion::date >= $${paramIndex}
    )`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    filtroExtra += ` AND EXISTS (
      SELECT 1 FROM devoluciones df
      WHERE df.id_prestamo = c.id_prestamo AND df.fecha_devolucion::date <= $${paramIndex}
    )`
    values.push(fecha_hasta)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `WITH cadena AS (
       SELECT
         p.id_prestamo,
         COALESCE(p.id_prestamo_original, p.id_prestamo) AS id_raiz,
         p.numero_renovacion,
         p.fecha_activacion,
         p.fecha_tope_devolucion,
         p.estado_prestamo,
         p.es_reserva
       FROM prestamos p
       WHERE p.id_usuario = $1
     )
     SELECT
       c.id_raiz AS id_prestamo,
       MAX(c.numero_renovacion) AS numero_renovacion,
       MAX(c.fecha_activacion) AS fecha_activacion,
       MAX(c.fecha_tope_devolucion) AS fecha_tope_devolucion,
       (ARRAY_AGG(c.estado_prestamo ORDER BY c.numero_renovacion DESC))[1] AS estado_prestamo,
       BOOL_OR(c.es_reserva) AS es_reserva,
       -- Solo contamos ejemplares que realmente formaron parte del préstamo
       -- (excluye ítems rechazados/cancelados en aprobaciones parciales, que
       -- nunca llegaron a prestarse y por lo tanto nunca hay que devolver)
       COUNT(DISTINCT dp.id_ejemplar) FILTER (
         WHERE dp.estado_prestamo_ejemplar NOT IN ('solicitado', 'rechazado', 'cancelado')
       ) AS total_ejemplares,
       COUNT(DISTINCT l.id_libro) FILTER (
         WHERE dp.estado_prestamo_ejemplar NOT IN ('solicitado', 'rechazado', 'cancelado')
       ) AS total_libros,
       COUNT(DISTINCT d.id_ejemplar) AS ejemplares_devueltos,
       BOOL_OR(d.estado_devuelto != 'bueno') AS tiene_problemas,
       -- Detecta pérdidas aunque ya se hayan resuelto (recuperado/reemplazado)
       -- o sigan pendientes de resolver
       (
         BOOL_OR(dp.estado_prestamo_ejemplar IN ('perdido', 'reemplazado'))
         OR BOOL_OR(c.estado_prestamo = 'cerrado_con_perdida')
       ) AS tiene_perdida,
       MAX(d.fecha_devolucion) AS ultima_devolucion
     FROM cadena c
     JOIN detalles_prestamos dp ON dp.id_prestamo = c.id_raiz
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     -- Clave del fix: el join también debe matchear por ejemplar, no solo
     -- por préstamo. Antes, cada ejemplar del préstamo se cruzaba con TODAS
     -- las devoluciones del préstamo (producto cruzado), lo que arrastraba
     -- devoluciones de otros materiales al filtrar por título.
     LEFT JOIN devoluciones d
       ON d.id_prestamo = c.id_prestamo AND d.id_ejemplar = dp.id_ejemplar
     WHERE 1=1 ${filtroExtra}
     GROUP BY c.id_raiz
     HAVING COUNT(d.id_ejemplar) > 0
     ORDER BY MAX(d.fecha_devolucion) DESC NULLS LAST
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countDevolucionesUsuario = async ({ id_usuario, search, fecha_desde, fecha_hasta }) => {
  const values = [id_usuario]
  let paramIndex = 2
  let filtroExtra = ''

  if (search) {
    filtroExtra += ` AND EXISTS (
      SELECT 1 FROM detalles_prestamos dpf
      JOIN ejemplares ef ON dpf.id_ejemplar = ef.id_ejemplar
      JOIN libros lf ON ef.id_libro = lf.id_libro
      WHERE dpf.id_prestamo = c.id_raiz AND lf.titulo ILIKE $${paramIndex}
    )`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (fecha_desde) {
    filtroExtra += ` AND EXISTS (
      SELECT 1 FROM devoluciones df
      WHERE df.id_prestamo = c.id_prestamo AND df.fecha_devolucion::date >= $${paramIndex}
    )`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    filtroExtra += ` AND EXISTS (
      SELECT 1 FROM devoluciones df
      WHERE df.id_prestamo = c.id_prestamo AND df.fecha_devolucion::date <= $${paramIndex}
    )`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `WITH cadena AS (
       SELECT p.id_prestamo, COALESCE(p.id_prestamo_original, p.id_prestamo) AS id_raiz
       FROM prestamos p
       WHERE p.id_usuario = $1
     )
     SELECT COUNT(DISTINCT c.id_raiz) AS count
     FROM cadena c
     WHERE EXISTS (
       SELECT 1 FROM devoluciones df WHERE df.id_prestamo = c.id_prestamo
     ) ${filtroExtra}`,
    values
  )
  return parseInt(rows[0].count)
}

const recuperarEjemplarPerdido = async (id_prestamo, id_ejemplar, id_bibliotecario, { estado_devuelto, observaciones }) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Resolver id_detalles para renovaciones
    const { rows: prestamoMeta } = await client.query(
      `SELECT id_usuario, id_prestamo_original FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const id_detalles = prestamoMeta[0]?.id_prestamo_original || id_prestamo
    const esRenovacion = prestamoMeta[0]?.id_prestamo_original !== null

    // Verificar que el ejemplar realmente está perdido en este préstamo
    const { rows: detalle } = await client.query(
      `SELECT dp.*, e.id_libro FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       WHERE dp.id_prestamo = $1
         AND dp.id_ejemplar = $2
         AND dp.estado_prestamo_ejemplar = 'perdido'`,
      [id_detalles, id_ejemplar]
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
      [id_detalles, id_ejemplar]
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
      [id_detalles]
    )
    const quedanPendientes = parseInt(pendientes[0].count) > 0
    let prestamoCerrado = false

    if (!quedanPendientes) {
      if (esRenovacion) {
        await client.query(
          `UPDATE prestamos SET estado_prestamo = 'renovacion_finalizada' WHERE id_prestamo = $1`,
          [id_prestamo]
        )
        await client.query(
          `UPDATE prestamos SET estado_prestamo = 'devuelto' WHERE id_prestamo = $1`,
          [prestamoMeta[0].id_prestamo_original]
        )
      } else {
        await client.query(
          `UPDATE prestamos SET estado_prestamo = 'devuelto' WHERE id_prestamo = $1`,
          [id_prestamo]
        )
      }
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

// Rechaza definitivamente UN ítem de una reserva ya aprobada (Ronda 1) que
// no se puede resolver: volvió dañado/perdido y no hay sustituto disponible.
// A diferencia de respondLoanDetail (que solo decide sobre ítems 'solicitado'),
// esta actúa sobre un ítem que YA estaba 'aprobado' y lo pasa a 'rechazado' —
// sin tocar el resto de los ítems de la misma reserva (que pueden seguir
// esperando devolución, o ya estar 'reservado' por otro sustituto).
const rejectReservaItemSinSustituto = async (id_prestamo, id_ejemplar, id_bibliotecario, motivo) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: detalle } = await client.query(
      `UPDATE detalles_prestamos
       SET estado_prestamo_ejemplar = 'rechazado', observaciones = $1
       WHERE id_prestamo = $2 AND id_ejemplar = $3
         AND es_reserva = true AND estado_prestamo_ejemplar = 'aprobado'
       RETURNING *`,
      [motivo || 'Ejemplar perdido/dañado sin sustituto disponible', id_prestamo, id_ejemplar]
    )

    if (detalle.length === 0) {
      await client.query('ROLLBACK')
      return { error: 'El ítem no está en un estado válido para rechazar (¿ya fue resuelto?)' }
    }

    const { rows: detalles } = await client.query(
      `SELECT estado_prestamo_ejemplar FROM detalles_prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const todosRechazados = detalles.every(d => d.estado_prestamo_ejemplar === 'rechazado')
    const nuevoEstado = todosRechazados ? 'reserva_rechazada' : 'reserva_parcialmente_aprobada'

    const { rows: prestamoData } = await client.query(
      `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`, [id_prestamo]
    )

    await client.query(
      `UPDATE prestamos SET estado_prestamo = $1, id_bibliotecario = $2 WHERE id_prestamo = $3`,
      [nuevoEstado, id_bibliotecario, id_prestamo]
    )

    // Con este ítem fuera del camino, puede que el resto de la reserva
    // (ya 'reservado' por devoluciones o sustitutos previos) esté ahora
    // completa y lista para gestionar.
    if (!todosRechazados) {
      await verificarReservaLista(client, id_prestamo)
    }

    await client.query('COMMIT')

    await crearNotificacion({
      id_usuario: prestamoData[0].id_usuario,
      tipo: 'reserva_modificada',
      titulo: 'Un ejemplar de tu reserva ya no está disponible',
      mensaje: `El ejemplar #${id_ejemplar} que esperabas fue reportado como dañado/perdido y no había otra copia disponible para reemplazarlo. Fue retirado de tu reserva${todosRechazados ? '.' : '; el resto sigue en curso.'}`,
      id_prestamo
    })

    return { rechazado: true, prestamo_estado: nuevoEstado }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Verifica que el préstamo pertenezca al usuario (o sea una renovación de uno suyo)
const getPrestamoOwner = async (id_prestamo) => {
  const { rows } = await pool.query(
    `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
    [id_prestamo]
  )
  return rows[0]?.id_usuario ?? null
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
  reemplazarEjemplarPerdido,
  verificarReservaLista,
  rejectReservaItemSinSustituto,
  getPrestamoOwner
}