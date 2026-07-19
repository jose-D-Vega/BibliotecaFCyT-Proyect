const pool = require('../config/db')

const { crearNotificacion } = require('./notifications.queries')
const {
  DIAS_PRESTAMO_ACTIVO,
  DIAS_RENOVACION,
  DIAS_ANTICIPACION_SOLICITUD_RENOVACION,
  MAX_RENOVACIONES,
  DIAS_LIMITE_RESPUESTA_RENOVACION,
  DIAS_MARGEN_DEVOLUCION_TRAS_RECHAZO_RENOVACION,
  DIAS_PLACEHOLDER_SOLICITUD
} = require('../config/loans.config')


const _insertLoan = async (client, id_usuario, ejemplares, esReserva, idPrestamoOriginal = null, numeroRenovacion = 0, fechaLimiteRespuesta = null) => {
  const esRenovacion = idPrestamoOriginal !== null
  const estado = esRenovacion ? 'solicitud_renovacion' : (esReserva ? 'solicitud_reserva' : 'solicitado')

  const fechaPlaceholder = new Date()
  fechaPlaceholder.setDate(fechaPlaceholder.getDate() + DIAS_PLACEHOLDER_SOLICITUD)

  const { rows: prestamo } = await client.query(
    `INSERT INTO prestamos (fecha_solicitud, fecha_tope_devolucion, estado_prestamo, id_usuario, es_reserva, id_prestamo_original, numero_renovacion, fecha_limite_respuesta_renovacion)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [fechaPlaceholder, estado, id_usuario, esReserva, idPrestamoOriginal, numeroRenovacion, fechaLimiteRespuesta]
  )

  const id_prestamo = prestamo[0].id_prestamo

  // Una renovación no tiene detalles_prestamos propios: se heredan del id_prestamo_original
  if (!esRenovacion) {
    for (const id_ejemplar of ejemplares) {
      await client.query(
        `INSERT INTO detalles_prestamos (id_prestamo, id_ejemplar, observaciones, estado_prestamo_ejemplar, es_reserva)
         VALUES ($1, $2, '', 'solicitado', $3)`,
        [id_prestamo, id_ejemplar, esReserva]
      )
    }
  }

  return prestamo[0]
}


const createLoan = async (id_usuario, itemsCarrito) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const ejemplaresParaPrestamo = []
    const ejemplaresParaReserva = []
    const advertencias = []

    for (const item of itemsCarrito) {
      const { id_libro, cantidad } = item

      // Obtener ejemplares disponibles del libro
      const { rows: disponibles } = await client.query(
        `SELECT id_ejemplar FROM ejemplares
         WHERE id_libro = $1 AND estado_ejemplar = 'disponible'
         ORDER BY id_ejemplar ASC
         LIMIT $2`,
        [id_libro, cantidad]
      )

      const cantidadDisponible = disponibles.length

      if (cantidadDisponible >= cantidad) {
        // Todos van como préstamo
        ejemplaresParaPrestamo.push(...disponibles.map(e => e.id_ejemplar))
      } else {
        // Los disponibles van como préstamo, el resto como reserva
        ejemplaresParaPrestamo.push(...disponibles.map(e => e.id_ejemplar))

        const faltantes = cantidad - cantidadDisponible

        const { rows: reservables } = await client.query(
          `SELECT id_ejemplar FROM ejemplares
           WHERE id_libro = $1 AND estado_ejemplar IN ('prestado', 'reservado')
           ORDER BY id_ejemplar ASC
           LIMIT $2`,
          [id_libro, faltantes]
        )

        if (reservables.length === 0 && cantidadDisponible === 0) {
          await client.query('ROLLBACK')
          return {
            error: `No hay ejemplares disponibles ni reservables para el libro con id ${id_libro}`
          }
        }

        ejemplaresParaReserva.push(...reservables.map(e => e.id_ejemplar))

        if (reservables.length < faltantes) {
          advertencias.push(
            `Solo se pudieron asignar ${cantidadDisponible + reservables.length} de ${cantidad} ejemplares solicitados para el libro con id ${id_libro}`
          )
        }
      }
    }

    const resultados = {}

    if (ejemplaresParaPrestamo.length > 0) {
      const prestamo = await _insertLoan(client, id_usuario, ejemplaresParaPrestamo, false)
      resultados.prestamo = prestamo
    }

    if (ejemplaresParaReserva.length > 0) {
      const reserva = await _insertLoan(client, id_usuario, ejemplaresParaReserva, true)
      resultados.reserva = reserva
    }

    if (advertencias.length > 0) {
      resultados.advertencias = advertencias
    }

    await client.query('COMMIT')
    return resultados
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Respuesta del bibliotecario — aprueba o rechaza ejemplar por ejemplar.
// Esta función solo maneja préstamos y reservas comunes.
// Las renovaciones se responden con approveRenewal / rejectRenewal.
const respondLoanDetail = async (id_prestamo, id_ejemplar, estado, id_bibliotecario, observaciones) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Actualizar el detalle del ejemplar respondido
    const { rows: detalle } = await client.query(
      `UPDATE detalles_prestamos
       SET estado_prestamo_ejemplar = $1,
           observaciones = $4
       WHERE id_prestamo = $2 AND id_ejemplar = $3
       RETURNING *`,
      [estado, id_prestamo, id_ejemplar, observaciones || '']
    )

    if (detalle.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    // Recalcular estado del préstamo según todos sus detalles
    const { rows: detalles } = await client.query(
      `SELECT estado_prestamo_ejemplar FROM detalles_prestamos
       WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    const estados = detalles.map(d => d.estado_prestamo_ejemplar)
    const todosAprobados = estados.every(e => e === 'aprobado')
    const todosRechazados = estados.every(e => e === 'rechazado')

    const { rows: prestamoData } = await client.query(
      `SELECT * FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    const esReserva = prestamoData[0].es_reserva
    const estadoActual = prestamoData[0].estado_prestamo

    // Si se está aprobando, verificar que el usuario del préstamo no esté sancionado
    if (estado === 'aprobado') {
      const { rows: usuarioData } = await client.query(
        `SELECT sancionado FROM usuarios WHERE id_usuario = $1`,
        [prestamoData[0].id_usuario]
      )
      if (usuarioData[0]?.sancionado) {
        await client.query('ROLLBACK')
        return { error: 'El usuario tiene sanciones activas. No se puede aprobar el préstamo hasta que regularice su situación.' }
      }
    }

    // Una reserva pasa por dos rondas:
    // Ronda 1 — admin decide si aprueba la solicitud (solicitud_reserva → reserva_aprobada/parcial/rechazada)
    // Ronda 2 — cuando ya están todos los materiales disponibles, admin decide la entrega final
    //           (reserva_aprobada/parcial → aprobado/parcialmente_aprobado/rechazado → ciclo normal)
    const reservaEnRondaFinal = esReserva &&
      ['reserva_aprobada', 'reserva_parcialmente_aprobada'].includes(estadoActual)

    let nuevoEstado
    if (todosAprobados) {
      if (esReserva && !reservaEnRondaFinal) nuevoEstado = 'reserva_aprobada'
      else nuevoEstado = 'aprobado'
    } else if (todosRechazados) {
      if (esReserva && !reservaEnRondaFinal) nuevoEstado = 'reserva_rechazada'
      else nuevoEstado = 'rechazado'
    } else {
      nuevoEstado = (esReserva && !reservaEnRondaFinal) ? 'reserva_parcialmente_aprobada' : 'parcialmente_aprobado'
    }

    const { rows: prestamo_actualizado } = await client.query(
      `UPDATE prestamos
       SET estado_prestamo = $1::varchar,
           fecha_respuesta = NOW(),
           id_bibliotecario = $2
       WHERE id_prestamo = $3
       RETURNING *`,
      [nuevoEstado, id_bibliotecario, id_prestamo]
    )

    // --- Notificaciones ---
    if (esReserva && !reservaEnRondaFinal) {
      // Ronda 1: respuesta a solicitud de reserva
      if (nuevoEstado === 'reserva_aprobada') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'reserva_aprobada',
          titulo: 'Reserva aprobada',
          mensaje: 'Tu solicitud de reserva fue aprobada. Te avisaremos cuando el material esté disponible para retirar.',
          id_prestamo
        })
      } else if (nuevoEstado === 'reserva_parcialmente_aprobada') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'reserva_parcial',
          titulo: 'Reserva parcialmente aprobada',
          mensaje: 'Parte de tu solicitud de reserva fue aprobada. Te avisaremos cuando los materiales aceptados estén disponibles para retirar.',
          id_prestamo
        })
      } else if (nuevoEstado === 'reserva_rechazada') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'reserva_rechazada',
          titulo: 'Reserva rechazada',
          mensaje: 'Tu solicitud de reserva fue rechazada.',
          id_prestamo
        })
      }
    } else if (esReserva && reservaEnRondaFinal) {
      // Ronda 2: admin confirma la entrega de la reserva ya lista
      if (nuevoEstado === 'aprobado') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'reserva_disponible',
          titulo: 'Tu reserva está disponible',
          mensaje: 'Los materiales de tu reserva ya están listos para retirar. Acercate a la biblioteca.',
          id_prestamo
        })
      } else if (nuevoEstado === 'parcialmente_aprobado') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'reserva_disponible',
          titulo: 'Parte de tu reserva está disponible',
          mensaje: 'Parte de los materiales de tu reserva ya están listos para retirar. Revisá el detalle.',
          id_prestamo
        })
      } else if (nuevoEstado === 'rechazado') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'reserva_rechazada',
          titulo: 'Reserva rechazada',
          mensaje: 'Tu reserva fue rechazada en la instancia final.',
          id_prestamo
        })
      }
    } else {
      // Préstamo común (no reserva)
      if (nuevoEstado === 'aprobado') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'prestamo_aprobado',
          titulo: 'Préstamo aprobado',
          mensaje: 'Tu solicitud de préstamo fue aprobada. Acercate a la biblioteca a retirar los materiales.',
          id_prestamo
        })
      } else if (nuevoEstado === 'parcialmente_aprobado') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'prestamo_parcial',
          titulo: 'Préstamo parcialmente aprobado',
          mensaje: 'Parte de tu solicitud de préstamo fue aprobada. Revisá el detalle para ver qué materiales fueron aceptados.',
          id_prestamo
        })
      } else if (nuevoEstado === 'rechazado') {
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'prestamo_rechazado',
          titulo: 'Préstamo rechazado',
          mensaje: 'Tu solicitud de préstamo fue rechazada.',
          id_prestamo
        })
      }
    }

    await client.query('COMMIT')
    return { prestamo: prestamo_actualizado[0], detalle: detalle[0] }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Activar préstamo — usuario retira todos los ejemplares aprobados
const activateLoan = async (id_prestamo, id_bibliotecario_activacion) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verificar que el préstamo está en estado válido para activar
    const { rows: prestamo } = await client.query(
      `SELECT * FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    if (prestamo.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const estadosValidos = ['aprobado', 'parcialmente_aprobado']
    if (!estadosValidos.includes(prestamo[0].estado_prestamo)) {
      await client.query('ROLLBACK')
      return { error: `El préstamo no puede activarse desde el estado: ${prestamo[0].estado_prestamo}` }
    }

    // Verificar que el usuario no esté sancionado al momento de activar
    const { rows: usuarioData } = await client.query(
      `SELECT sancionado FROM usuarios WHERE id_usuario = $1`,
      [prestamo[0].id_usuario]
    )
    if (usuarioData[0]?.sancionado) {
      await client.query('ROLLBACK')
      return { error: 'El usuario tiene sanciones activas. No se puede activar el préstamo hasta que regularice su situación.' }
    }

    // Calcular fecha tope según la política vigente de días de préstamo
    const fechaTope = new Date()
    fechaTope.setDate(fechaTope.getDate() + DIAS_PRESTAMO_ACTIVO)

    // Actualizar préstamo
    const { rows: actualizado } = await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'activo',
           fecha_activacion = NOW(),
           fecha_tope_devolucion = $1,
           id_bibliotecario_activacion = $2
       WHERE id_prestamo = $3
       RETURNING *`,
      [fechaTope, id_bibliotecario_activacion, id_prestamo]
    )

    // Actualizar detalles aprobados a activo
    await client.query(
      `UPDATE detalles_prestamos
       SET estado_prestamo_ejemplar = 'activo'
       WHERE id_prestamo = $1 AND estado_prestamo_ejemplar = 'aprobado'`,
      [id_prestamo]
    )

    // Marcar ejemplares como prestados
    await client.query(
      `UPDATE ejemplares SET estado_ejemplar = 'prestado'
       WHERE id_ejemplar IN (
         SELECT id_ejemplar FROM detalles_prestamos
         WHERE id_prestamo = $1 AND estado_prestamo_ejemplar = 'activo'
       )`,
      [id_prestamo]
    )

    await crearNotificacion({
      id_usuario: prestamo[0].id_usuario,
      tipo: 'prestamo_activado',
      titulo: 'Préstamo activado',
      mensaje: 'Confirmamos el retiro de tus materiales. Recordá la fecha de devolución.',
      id_prestamo
    })

    await client.query('COMMIT')
    return actualizado[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Cancelar préstamo — solo en estados solicitado, aprobado, parcialmente_aprobado
const cancelLoan = async (id_prestamo, id_usuario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: prestamo } = await client.query(
      `SELECT * FROM prestamos WHERE id_prestamo = $1 AND id_usuario = $2`,
      [id_prestamo, id_usuario]
    )

    if (prestamo.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const estadosCancelables = ['solicitado', 'aprobado', 'parcialmente_aprobado', 'solicitud_reserva', 'reserva_aprobada', 'reserva_parcialmente_aprobada']
    if (!estadosCancelables.includes(prestamo[0].estado_prestamo)) {
      await client.query('ROLLBACK')
      return { error: `No se puede cancelar un préstamo en estado: ${prestamo[0].estado_prestamo}` }
    }

    // Si era reserva, liberar los ejemplares reservados
    if (prestamo[0].es_reserva) {
      await client.query(
        `UPDATE ejemplares SET estado_ejemplar = 'disponible'
         WHERE id_ejemplar IN (
           SELECT id_ejemplar FROM detalles_prestamos
           WHERE id_prestamo = $1 AND estado_prestamo_ejemplar != 'rechazado'
         )`,
        [id_prestamo]
      )
    }

    const { rows: cancelado } = await client.query(
      `UPDATE prestamos
      SET estado_prestamo = 'cancelado',
          fecha_cancelacion = NOW()
      WHERE id_prestamo = $1
      RETURNING *`,
      [id_prestamo]
    )

    await client.query(
      `UPDATE detalles_prestamos
      SET estado_prestamo_ejemplar = 'cancelado'
      WHERE id_prestamo = $1
        AND estado_prestamo_ejemplar IN ('solicitado', 'aprobado')`,
      [id_prestamo]
    )

    await client.query('COMMIT')
    return cancelado[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const cancelLoanSmart = async (id_prestamo, id_usuario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: prestamo } = await client.query(
      `SELECT * FROM prestamos 
      WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    if (prestamo.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const actual = prestamo[0].estado_prestamo

    const estadosPréstamo = ['aprobado', 'parcialmente_aprobado']
    const estadosReserva = ['reserva_aprobada', 'reserva_parcialmente_aprobada']

    let nuevoEstado = null

    if (estadosPréstamo.includes(actual)) {
      nuevoEstado = 'solicitado'
    }

    if (estadosReserva.includes(actual)) {
      nuevoEstado = 'solicitud_reserva'
    }

    if (!nuevoEstado) {
      await client.query('ROLLBACK')
      return { error: `No se puede cancelar desde estado: ${actual}` }
    }

    // liberar ejemplares si era reserva
    if (prestamo[0].es_reserva) {
      await client.query(
        `UPDATE ejemplares SET estado_ejemplar = 'disponible'
         WHERE id_ejemplar IN (
           SELECT id_ejemplar FROM detalles_prestamos
           WHERE id_prestamo = $1 AND estado_prestamo_ejemplar != 'rechazado'
         )`,
        [id_prestamo]
      )
    }

    const { rows: updated } = await client.query(
      `UPDATE prestamos 
       SET estado_prestamo = $1
       WHERE id_prestamo = $2
       RETURNING *`,
      [nuevoEstado, id_prestamo]
    )

    await client.query('COMMIT')
    return updated[0]

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}


const getLoanMaterials = async (id_prestamo) => {
  const { rows } = await pool.query(
    `SELECT
       l.id_libro,
       l.titulo,
       l.autor,
       e.id_ejemplar
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
     WHERE dp.id_prestamo = $1
     ORDER BY l.id_libro`,
    [id_prestamo]
  )

  const grouped = {}

  for (const row of rows) {
    if (!grouped[row.id_libro]) {
      grouped[row.id_libro] = {
        id: row.id_libro,
        titulo: row.titulo,
        autor: row.autor,
        ejemplares: []
      }
    }

    grouped[row.id_libro].ejemplares.push(row.id_ejemplar)
  }

  return Object.values(grouped)
}

// Listar préstamos con filtros


const getLoans = async ({ id_usuario, estado, estados, es_reserva, fecha_desde, fecha_hasta, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  // Excluir préstamos en estado 'renovado' — son reemplazados visualmente
  // por el registro de la renovación que los sucedió
  whereClause += ` AND p.estado_prestamo NOT IN ('renovado', 'renovacion_finalizada')`

  if (id_usuario) {
    whereClause += ` AND p.id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  // `estados` (array) tiene prioridad sobre `estado` (single) cuando ambos vienen definidos,
  // ya que es el filtro más específico. Se usa `= ANY(...)` para aceptar varios valores a la vez.
  if (estados && estados.length > 0) {
    whereClause += ` AND p.estado_prestamo = ANY($${paramIndex}::text[])`
    values.push(estados)
    paramIndex++
  } else if (estado) {
    whereClause += ` AND p.estado_prestamo = $${paramIndex}`
    values.push(estado)
    paramIndex++
  }
  if (es_reserva !== undefined) {
    whereClause += ` AND p.es_reserva = $${paramIndex}`
    values.push(es_reserva)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND p.fecha_solicitud >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND p.fecha_solicitud <= $${paramIndex}::date + INTERVAL '1 day'`
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
       p.estado_prestamo,
       p.es_reserva,
       p.id_usuario,
       p.id_bibliotecario,
       p.id_bibliotecario_activacion,
       p.fecha_cancelacion,
       p.fecha_limite_respuesta_renovacion,

       -- Fechas del préstamo original cuando existe (solicitud, aprobación y activación
       -- siempre corresponden al préstamo raíz; la renovación agrega su propia fecha)
       COALESCE(orig.fecha_solicitud, p.fecha_solicitud)   AS fecha_solicitud,
       COALESCE(orig.fecha_respuesta, p.fecha_respuesta)   AS fecha_respuesta,
       COALESCE(orig.fecha_activacion, p.fecha_activacion) AS fecha_activacion,

       -- Fecha tope siempre del registro actual (es la vigente)
       p.fecha_tope_devolucion,

       -- Fecha en que SE APROBÓ esta renovación (null si no es renovación o aún no aprobada)
       CASE WHEN p.id_prestamo_original IS NOT NULL
         THEN p.fecha_activacion
         ELSE NULL
       END AS fecha_renovacion,

       u.nombre_apellido,
       u.correo,

       COALESCE(
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'id_ejemplar', dp.id_ejemplar,
             'estado_prestamo_ejemplar', dp.estado_prestamo_ejemplar,
             'observaciones', dp.observaciones,
             'es_reserva', dp.es_reserva,
             'estado_ejemplar', e.estado_ejemplar,
             'id_libro', l.id_libro,
             'titulo', l.titulo,
             'autor', l.autor
           ) ORDER BY dp.id_ejemplar
         ) FILTER (WHERE dp.id_ejemplar IS NOT NULL),
         '[]'
       ) AS detalles,
       COUNT(dp.id_ejemplar) AS total_ejemplares

     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario

     -- Para renovaciones: obtener las fechas del préstamo raíz
     LEFT JOIN prestamos orig ON p.id_prestamo_original = orig.id_prestamo

     -- Para detalles: las renovaciones no tienen propios, heredan del original
     LEFT JOIN detalles_prestamos dp
       ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
     LEFT JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro

     ${whereClause}
     GROUP BY
       p.id_prestamo, p.id_prestamo_original, p.numero_renovacion,
       p.estado_prestamo, p.es_reserva, p.id_usuario,
       p.id_bibliotecario, p.id_bibliotecario_activacion,
       p.fecha_cancelacion, p.fecha_limite_respuesta_renovacion,
       p.fecha_solicitud, p.fecha_respuesta, p.fecha_activacion,
       p.fecha_tope_devolucion,
       orig.fecha_solicitud, orig.fecha_respuesta, orig.fecha_activacion,
       u.nombre_apellido, u.correo
     ORDER BY p.fecha_solicitud DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countLoans = async ({ id_usuario, estado, estados, es_reserva, fecha_desde, fecha_hasta }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE estado_prestamo NOT IN ('renovado', 'renovacion_finalizada')`

  if (id_usuario) {
    whereClause += ` AND id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  // Debe coincidir exactamente con el mismo criterio de estado(s) que getLoans(),
  // o el total/totalPages que ve el frontend quedaría desincronizado con los resultados reales.
  if (estados && estados.length > 0) {
    whereClause += ` AND estado_prestamo = ANY($${paramIndex}::text[])`
    values.push(estados)
    paramIndex++
  } else if (estado) {
    whereClause += ` AND estado_prestamo = $${paramIndex}`
    values.push(estado)
    paramIndex++
  }
  if (es_reserva !== undefined) {
    whereClause += ` AND es_reserva = $${paramIndex}`
    values.push(es_reserva)
    paramIndex++
  }
  if (fecha_desde) {
    whereClause += ` AND fecha_solicitud >= $${paramIndex}`
    values.push(fecha_desde)
    paramIndex++
  }
  if (fecha_hasta) {
    whereClause += ` AND fecha_solicitud <= $${paramIndex}::date + INTERVAL '1 day'`
    values.push(fecha_hasta)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM prestamos ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

// Detalle completo de un préstamo con sus ejemplares
const getLoanById = async (id_prestamo) => {
  const { rows: prestamo } = await pool.query(
    `SELECT
       p.*,
       u.nombre_apellido,
       u.correo
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     WHERE p.id_prestamo = $1`,
    [id_prestamo]
  )

  if (prestamo.length === 0) return null

  const { rows: detalles } = await pool.query(
  `SELECT
     dp.id_ejemplar,
     dp.estado_prestamo_ejemplar,
     dp.observaciones,
     dp.es_reserva,
     e.estado_ejemplar,
     l.titulo,
     l.autor,
     d.fecha_devolucion

   FROM detalles_prestamos dp

   JOIN ejemplares e 
   ON dp.id_ejemplar = e.id_ejemplar

   JOIN libros l 
   ON e.id_libro = l.id_libro

   LEFT JOIN devoluciones d
   ON d.id_prestamo = dp.id_prestamo
   AND d.id_ejemplar = dp.id_ejemplar

   WHERE dp.id_prestamo = $1`,
  [id_prestamo]
)

const materiales = await getLoanMaterials(id_prestamo)

return {
  ...prestamo[0],
  detalles,
  materiales,
  total_materiales: materiales.length,
  total_ejemplares: detalles.length
}
}

// Solicitud de renovación

const renewLoan = async (id_prestamo, id_usuario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: prestamo } = await client.query(
      `SELECT * FROM prestamos WHERE id_prestamo = $1 AND id_usuario = $2`,
      [id_prestamo, id_usuario]
    )

    if (prestamo.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    if (prestamo[0].estado_prestamo !== 'activo') {
      await client.query('ROLLBACK')
      return { error: 'Solo se pueden renovar préstamos activos' }
    }

    // Validar que falte 1 día o menos para el vencimiento
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const fechaTope = new Date(prestamo[0].fecha_tope_devolucion)
    fechaTope.setHours(0, 0, 0, 0)
    const diasRestantes = Math.ceil((fechaTope - hoy) / (1000 * 60 * 60 * 24))

    if (diasRestantes > DIAS_ANTICIPACION_SOLICITUD_RENOVACION) {
      await client.query('ROLLBACK')
      return { error: `Solo podés solicitar renovación cuando falte ${DIAS_ANTICIPACION_SOLICITUD_RENOVACION} día o menos para el vencimiento. Faltan ${diasRestantes} días.` }
    }

    // Determinar préstamo original (si esto ya es una renovación activa, el original es el suyo;
    // si es la primera renovación, el original es él mismo)
    const id_original =  prestamo[0].id_prestamo_original || prestamo[0].id_prestamo

    // Contar renovaciones ya hechas sobre ese original
    const { rows: renovaciones } = await client.query(
      `SELECT COUNT(*) FROM prestamos WHERE id_prestamo_original = $1`,
      [id_original]
    )

    const totalRenovaciones = parseInt(renovaciones[0].count)

    if (totalRenovaciones >= MAX_RENOVACIONES) {
      await client.query('ROLLBACK')
      return { error: `Este préstamo ya alcanzó el límite de ${MAX_RENOVACIONES} renovaciones` }
    }

    // Verificar que ningún ejemplar del préstamo tenga una reserva esperándolo
    const { rows: reservados } = await client.query(
      `SELECT e.id_ejemplar FROM ejemplares e
       JOIN detalles_prestamos dp ON e.id_ejemplar = dp.id_ejemplar
       WHERE dp.id_prestamo = $1 AND e.estado_ejemplar = 'reservado'`,
      [id_prestamo]
    )

    if (reservados.length > 0) {
      await client.query('ROLLBACK')
      return {
        error: `No se puede renovar. Los siguientes ejemplares están reservados: ${reservados.map(e => e.id_ejemplar).join(', ')}`
      }
    }

    // Calcular fecha límite de respuesta = fecha_tope + margen de días configurado
    const fechaLimiteRespuesta = new Date(fechaTope)
    fechaLimiteRespuesta.setDate(fechaLimiteRespuesta.getDate() + DIAS_LIMITE_RESPUESTA_RENOVACION)

    // El préstamo original PERMANECE en 'activo' — no cambia de estado.
    // La existencia de un registro de renovación con estado 'solicitud_renovacion'
    // y fecha_limite_respuesta_renovacion es suficiente para saber que hay una
    // solicitud pendiente. No hace falta (ni es correcto) cambiar el original.

    // Crear el registro de la renovación — sin detalles_prestamos propios,
    // se heredan del id_prestamo_original. Todo dentro de la misma transacción.
    const nuevoPrestamo = await _insertLoan(
      client,
      id_usuario,
      [],
      false,
      id_original,
      totalRenovaciones + 1,
      fechaLimiteRespuesta
    )

    await client.query('COMMIT')

    // Avisar a los admins — fuera de la transacción, ya confirmada
    const { rows: admins } = await pool.query(
      `SELECT u.id_usuario FROM usuarios u
       JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
       WHERE t.nombre_tipo = 'admin' AND u.activo = true`
    )
    for (const admin of admins) {
      await crearNotificacion({
        id_usuario: admin.id_usuario,
        tipo: 'admin_renovacion_pendiente',
        titulo: 'Nueva solicitud de renovación',
        mensaje: `Hay una solicitud de renovación esperando revisión (préstamo #${id_prestamo}).`,
        id_prestamo,
        rol_destino: 'admin',
        unica: true
      })
    }

    return {
      prestamo_original: id_prestamo,
      nuevo_prestamo: nuevoPrestamo,
      renovaciones_restantes: 3 - (totalRenovaciones + 1),
      fecha_limite_respuesta: fechaLimiteRespuesta
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const approveRenewal = async (id_renovacion, id_bibliotecario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: renovacion } = await client.query(
      `SELECT * FROM prestamos
       WHERE id_prestamo = $1
         AND estado_prestamo = 'solicitud_renovacion'
         AND id_prestamo_original IS NOT NULL`,
      [id_renovacion]
    )

    if (renovacion.length === 0) {
      await client.query('ROLLBACK')
      return { error: 'Renovación no encontrada o ya procesada' }
    }

    const id_original = renovacion[0].id_prestamo_original
    const id_usuario = renovacion[0].id_usuario

    const { rows: usuarioData } = await client.query(
      `SELECT sancionado FROM usuarios WHERE id_usuario = $1`,
      [id_usuario]
    )
    if (usuarioData[0]?.sancionado) {
      await client.query('ROLLBACK')
      return { error: 'El usuario tiene sanciones activas. No se puede aprobar la renovación.' }
    }

    // Encontrar el préstamo activo anterior en esta cadena
    // (puede ser el original mismo si es la 1ra renovación, o una renovación previa si es la 2da+)
    // y marcarlo según corresponda:
    // - el original pasa a 'renovado'
    // - una renovación previa pasa a 'renovacion_finalizada'
    await client.query(
      `UPDATE prestamos
       SET estado_prestamo = CASE
         WHEN id_prestamo = $1 THEN 'renovado'
         ELSE 'renovacion_finalizada'
       END,
       id_bibliotecario = $2
       WHERE estado_prestamo = 'activo'
         AND (id_prestamo = $1 OR id_prestamo_original = $1)
         AND id_prestamo != $3`,
      [id_original, id_bibliotecario, id_renovacion]
    )

    const nuevaFechaTope = new Date()
    nuevaFechaTope.setDate(nuevaFechaTope.getDate() + DIAS_RENOVACION)

    const { rows: renovacionActiva } = await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'activo',
           fecha_respuesta = NOW(),
           fecha_activacion = NOW(),
           fecha_tope_devolucion = $1,
           id_bibliotecario = $2,
           id_bibliotecario_activacion = $2
       WHERE id_prestamo = $3
       RETURNING *`,
      [nuevaFechaTope, id_bibliotecario, id_renovacion]
    )

    await client.query('COMMIT')

    await crearNotificacion({
      id_usuario,
      tipo: 'renovacion_aprobada',
      titulo: 'Renovación aprobada',
      mensaje: `Tu solicitud de renovación fue aprobada. Tenés hasta el ${nuevaFechaTope.toLocaleDateString('es-PY')} para devolver los libros.`,
      id_prestamo: id_renovacion
    })

    return renovacionActiva[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const rejectRenewal = async (id_renovacion, id_bibliotecario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: renovacion } = await client.query(
      `SELECT * FROM prestamos
       WHERE id_prestamo = $1
         AND estado_prestamo = 'solicitud_renovacion'
         AND id_prestamo_original IS NOT NULL`,
      [id_renovacion]
    )

    if (renovacion.length === 0) {
      await client.query('ROLLBACK')
      return { error: 'Renovación no encontrada o ya procesada' }
    }

    const id_original = renovacion[0].id_prestamo_original
    const id_usuario = renovacion[0].id_usuario

    await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'rechazado',
           fecha_respuesta = NOW(),
           id_bibliotecario = $1
       WHERE id_prestamo = $2`,
      [id_bibliotecario, id_renovacion]
    )

    const fechaLimiteDev = new Date()
    fechaLimiteDev.setDate(fechaLimiteDev.getDate() + DIAS_MARGEN_DEVOLUCION_TRAS_RECHAZO_RENOVACION)

    // Encontrar el préstamo activo anterior y ponerlo en pendiente_devolucion
    // (puede ser el original o una renovación previa)
    const { rows: activoActualizado } = await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'pendiente_devolucion',
           fecha_tope_devolucion = $1,
           id_bibliotecario = $2
       WHERE estado_prestamo = 'activo'
         AND (id_prestamo = $3 OR id_prestamo_original = $3)
         AND id_prestamo != $4
       RETURNING *`,
      [fechaLimiteDev, id_bibliotecario, id_original, id_renovacion]
    )

    await client.query('COMMIT')

    await crearNotificacion({
      id_usuario,
      tipo: 'renovacion_rechazada',
      titulo: 'Renovación rechazada',
      mensaje: `Tu solicitud de renovación fue rechazada. Tenés hasta el ${fechaLimiteDev.toLocaleDateString('es-PY')} para devolver los libros.`,
      id_prestamo: activoActualizado[0]?.id_prestamo || id_original
    })

    return activoActualizado[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  createLoan,
  respondLoanDetail,
  activateLoan,
  cancelLoan,
  cancelLoanSmart,
  getLoans,
  countLoans,
  getLoanById,
  renewLoan,
  approveRenewal,
  rejectRenewal
}