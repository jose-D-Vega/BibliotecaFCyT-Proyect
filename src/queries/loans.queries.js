const pool = require('../config/db')

const { crearNotificacion } = require('./notifications.queries')
const {
  DIAS_PRESTAMO_ACTIVO,
  DIAS_RENOVACION,
  DIAS_ANTICIPACION_SOLICITUD_RENOVACION,
  MAX_RENOVACIONES,
  DIAS_LIMITE_RESPUESTA_RENOVACION,
  DIAS_MARGEN_DEVOLUCION_TRAS_RECHAZO_RENOVACION,
  DIAS_PLACEHOLDER_SOLICITUD,
  MAX_PRESTAMOS_SIMULTANEOS
} = require('../config/loans.config')

const { verificarReservaLista } = require('./returns.queries')

// Libera (o reasigna a la siguiente reserva en cola) una lista puntual de
// ejemplares que estaban 'reservado' para id_prestamo_origen y ya no lo estarán más
// (porque se canceló la reserva completa, o porque se rechazó ese ítem puntual).
const _liberarOReasignarEjemplares = async (client, id_prestamo_origen, ejemplaresIds) => {
  for (const id_ejemplar of ejemplaresIds) {
    const { rows: ejRows } = await client.query(
      `SELECT id_libro FROM ejemplares
       WHERE id_ejemplar = $1 AND estado_ejemplar = 'reservado'`,
      [id_ejemplar]
    )
    if (ejRows.length === 0) continue // ya no estaba 'reservado', nada que hacer

    const id_libro = ejRows[0].id_libro

    const { rows: siguientes } = await client.query(
      `SELECT dp.id_prestamo, dp.id_ejemplar AS id_ejemplar_placeholder, p.id_usuario
       FROM detalles_prestamos dp
       JOIN prestamos p ON dp.id_prestamo = p.id_prestamo
       JOIN ejemplares e2 ON dp.id_ejemplar = e2.id_ejemplar
       WHERE e2.id_libro = $1
         AND dp.es_reserva = true
         AND dp.estado_prestamo_ejemplar = 'aprobado'
         AND p.estado_prestamo IN ('reserva_aprobada', 'reserva_parcialmente_aprobada')
         AND p.id_prestamo != $2
         AND e2.estado_ejemplar = 'prestado'
       ORDER BY p.fecha_solicitud ASC
       LIMIT 1`,
      [id_libro, id_prestamo_origen]
    )

    if (siguientes.length === 0) {
      await client.query(
        `UPDATE ejemplares SET estado_ejemplar = 'disponible' WHERE id_ejemplar = $1`,
        [id_ejemplar]
      )
      continue
    }

    const siguiente = siguientes[0]

    await client.query(
      `UPDATE detalles_prestamos
       SET id_ejemplar = $1
       WHERE id_prestamo = $2 AND id_ejemplar = $3`,
      [id_ejemplar, siguiente.id_prestamo, siguiente.id_ejemplar_placeholder]
    )

    await crearNotificacion({
      id_usuario: siguiente.id_usuario,
      tipo: 'reserva_modificada',
      titulo: 'Tu reserva avanzó de lugar',
      mensaje: 'Se liberó antes de tiempo el material que esperabas: ya está apartado para vos.',
      id_prestamo: siguiente.id_prestamo
    })

    await verificarReservaLista(client, siguiente.id_prestamo)
  }
}

// Wrapper para cancelLoan/cancelLoanSmart: junta todos los reservado del préstamo
const _liberarOReasignarReservados = async (client, id_prestamo_cancelado) => {
  const { rows: ejemplaresReservados } = await client.query(
    `SELECT dp.id_ejemplar
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     WHERE dp.id_prestamo = $1
       AND dp.estado_prestamo_ejemplar != 'rechazado'
       AND e.estado_ejemplar = 'reservado'`,
    [id_prestamo_cancelado]
  )
  await _liberarOReasignarEjemplares(client, id_prestamo_cancelado, ejemplaresReservados.map(e => e.id_ejemplar))
}


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

    // Los TFG son solo de consulta: se pueden ver en el catálogo, pero no
    // se pueden solicitar como préstamo ni reservar.
    const idsLibros = itemsCarrito.map(item => item.id_libro)
    const { rows: tfgSolicitados } = await client.query(
      `SELECT id_libro, titulo FROM libros WHERE id_libro = ANY($1) AND tipo_material = 'tfg'`,
      [idsLibros]
    )

    if (tfgSolicitados.length > 0) {
      await client.query('ROLLBACK')
      return {
        error: `Los siguientes materiales son Trabajos Finales de Grado y solo están disponibles para consulta, no para préstamo: ${tfgSolicitados.map(l => l.titulo).join(', ')}`
      }
    }

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
          `SELECT e.id_ejemplar FROM ejemplares e
          WHERE e.id_libro = $1
            AND e.estado_ejemplar = 'prestado'
            AND NOT EXISTS (
              SELECT 1 FROM detalles_prestamos dp
              JOIN prestamos p ON dp.id_prestamo = p.id_prestamo
              WHERE dp.id_ejemplar = e.id_ejemplar
                AND dp.es_reserva = true
                AND dp.estado_prestamo_ejemplar IN ('solicitado', 'aprobado')
                AND p.estado_prestamo IN ('solicitud_reserva', 'reserva_aprobada', 'reserva_parcialmente_aprobada')
            )
          ORDER BY e.id_ejemplar ASC
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

    // Cuántas filas nuevas va a insertar esta solicitud (préstamo directo, reserva, o ambos)
    const nuevosRegistros =
      (ejemplaresParaPrestamo.length > 0 ? 1 : 0) +
      (ejemplaresParaReserva.length > 0 ? 1 : 0)

    if (nuevosRegistros > 0) {
      // Cuenta cada cadena de préstamo una sola vez (COALESCE con
      // id_prestamo_original), para que un préstamo renovado —que tiene
      // varias filas en `prestamos`— no cuente doble. Las reservas cuentan
      // igual que los préstamos activos.
      const { rows: activosRows } = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(id_prestamo_original, id_prestamo)) AS count
         FROM prestamos
         WHERE id_usuario = $1
           AND estado_prestamo NOT IN (
             'rechazado', 'cancelado', 'devuelto', 'renovado',
             'renovacion_finalizada', 'cerrado_con_perdida', 'reserva_rechazada'
           )`,
        [id_usuario]
      )

      const prestamosActuales = parseInt(activosRows[0].count)

      if (prestamosActuales + nuevosRegistros > MAX_PRESTAMOS_SIMULTANEOS) {
        await client.query('ROLLBACK')
        return {
          error: `Ya tenés ${prestamosActuales} préstamo(s)/reserva(s) activos de un máximo de ${MAX_PRESTAMOS_SIMULTANEOS}. Esta solicitud generaría ${nuevosRegistros} más, superando el límite.`
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

// Respuesta en LOTE — aprueba/rechaza todos los ejemplares de una solicitud
// en una única transacción y una única conexión al pool. Reemplaza el patrón
// de llamar a respondLoanDetail() una vez por ejemplar desde el frontend, que
// bajo concurrencia (varias solicitudes con muchos ejemplares a la vez) podía
// agotar el pool de conexiones (cada llamada individual usaba hasta 3 conexiones
// propias: la transacción + la notificación + el registro de actividad).
// `respuestas` = [{ id_ejemplar, estado, observaciones }]
const respondLoanDetailsBatch = async (id_prestamo, respuestas, id_bibliotecario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Antes de tocar nada: si se va a aprobar algún ejemplar, verificar sanciones
    // primero — así, si el usuario está sancionado, no se aplica ningún cambio
    // (atomicidad real: todo o nada, en vez de quedar en un estado mezclado).
    const seApruebaAlgo = respuestas.some(r => r.estado === 'aprobado')
    if (seApruebaAlgo) {
      const { rows: prestamoPrevio } = await client.query(
        `SELECT id_usuario FROM prestamos WHERE id_prestamo = $1`,
        [id_prestamo]
      )
      if (prestamoPrevio.length === 0) {
        await client.query('ROLLBACK')
        return null
      }
      const { rows: usuarioData } = await client.query(
        `SELECT sancionado FROM usuarios WHERE id_usuario = $1`,
        [prestamoPrevio[0].id_usuario]
      )
      if (usuarioData[0]?.sancionado) {
        await client.query('ROLLBACK')
        return { error: 'El usuario tiene sanciones activas. No se puede aprobar el préstamo hasta que regularice su situación.' }
      }
    }

    // Aplicar todas las respuestas, reutilizando la MISMA conexión para cada UPDATE
    // (nada de pool.connect() por ejemplar)
    for (const r of respuestas) {
      const { rows } = await client.query(
        `UPDATE detalles_prestamos
         SET estado_prestamo_ejemplar = $1,
             observaciones = $4
         WHERE id_prestamo = $2 AND id_ejemplar = $3
         AND estado_prestamo_ejemplar != 'rechazado'
         RETURNING id_ejemplar, es_reserva`,
        [r.estado, id_prestamo, r.id_ejemplar, r.observaciones || '']
      )
      if (rows.length === 0) {
        continue
      }

      if (r.estado === 'rechazado' && rows[0].es_reserva) {
        await _liberarOReasignarEjemplares(client, id_prestamo, [r.id_ejemplar])
      }
    }

    // Recalcular estado del préstamo según todos sus detalles (una sola vez, al final)
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

    // Una sola notificación resumiendo el resultado final (no una por ejemplar)
    const notifPorEstado = {
      aprobado: { tipo: 'prestamo_aprobado', titulo: 'Préstamo aprobado', mensaje: 'Tu solicitud de préstamo fue aprobada. Acercate a la biblioteca a retirar los materiales.' },
      parcialmente_aprobado: { tipo: 'prestamo_parcial', titulo: 'Préstamo parcialmente aprobado', mensaje: 'Parte de tu solicitud de préstamo fue aprobada. Revisá el detalle para ver qué materiales fueron aceptados.' },
      rechazado: { tipo: 'prestamo_rechazado', titulo: 'Préstamo rechazado', mensaje: 'Tu solicitud de préstamo fue rechazada.' },
      reserva_aprobada: { tipo: 'reserva_aprobada', titulo: 'Reserva aprobada', mensaje: 'Tu solicitud de reserva fue aprobada. Te avisaremos cuando el material esté disponible para retirar.' },
      reserva_parcialmente_aprobada: { tipo: 'reserva_parcial', titulo: 'Reserva parcialmente aprobada', mensaje: 'Parte de tu solicitud de reserva fue aprobada. Te avisaremos cuando los materiales aceptados estén disponibles para retirar.' },
      reserva_rechazada: { tipo: 'reserva_rechazada', titulo: 'Reserva rechazada', mensaje: 'Tu solicitud de reserva fue rechazada.' }
    }

    // Ronda 2 de reserva (entrega final) tiene sus propios mensajes, distintos
    // a los de un préstamo común aunque el nuevoEstado tenga el mismo nombre
    const notif = reservaEnRondaFinal
      ? {
          aprobado: { tipo: 'reserva_disponible', titulo: 'Tu reserva está disponible', mensaje: 'Los materiales de tu reserva ya están listos para retirar. Acercate a la biblioteca.' },
          parcialmente_aprobado: { tipo: 'reserva_disponible', titulo: 'Parte de tu reserva está disponible', mensaje: 'Parte de los materiales de tu reserva ya están listos para retirar. Revisá el detalle.' },
          rechazado: { tipo: 'reserva_rechazada', titulo: 'Reserva rechazada', mensaje: 'Tu reserva fue rechazada en la instancia final.' }
        }[nuevoEstado]
      : notifPorEstado[nuevoEstado]

    if (notif) {
      await crearNotificacion({
        id_usuario: prestamoData[0].id_usuario,
        tipo: notif.tipo,
        titulo: notif.titulo,
        mensaje: notif.mensaje,
        id_prestamo
      })
    }

    await client.query('COMMIT')
    return { prestamo: prestamo_actualizado[0] }
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
    // Si era reserva, liberar (o reasignar a quien siga en cola) los ejemplares reservados
    if (prestamo[0].es_reserva) {
      await _liberarOReasignarReservados(client, id_prestamo)
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
      `SELECT * FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    if (prestamo.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    const actual = prestamo[0].estado_prestamo
    const esReserva = prestamo[0].es_reserva

    let nuevoEstado = null
    let esUndoRondaDos = false

    if (['aprobado', 'parcialmente_aprobado'].includes(actual)) {
      if (esReserva) {
        esUndoRondaDos = true

        // Solo se revierte lo que SIGUE siendo nuestro: ítems 'aprobado' cuyo
        // ejemplar sigue 'reservado' esperando a este usuario. Los 'rechazado'
        // NO se tocan — si alguno ya fue reasignado a otra reserva en cola, eso
        // ya es un hecho consumado e independiente; el admin solo puede volver
        // a decidir sobre lo que todavía pertenece a esta reserva.
        await client.query(
          `UPDATE detalles_prestamos
          SET estado_prestamo_ejemplar = 'solicitado', observaciones = ''
          WHERE id_prestamo = $1 AND es_reserva = true AND estado_prestamo_ejemplar = 'aprobado'`,
          [id_prestamo]
        )

        const { rows: hayRechazados } = await client.query(
          `SELECT COUNT(*) FROM detalles_prestamos
          WHERE id_prestamo = $1 AND es_reserva = true AND estado_prestamo_ejemplar = 'rechazado'`,
          [id_prestamo]
        )

        // Si ya hay rechazos definitivos, queda "parcial" (mezcla de firme +
        // pendiente); si no hay ninguno, es como si nunca se hubiera decidido nada
        nuevoEstado = parseInt(hayRechazados[0].count) > 0
          ? 'reserva_parcialmente_aprobada'
          : 'reserva_aprobada'
      } else {
        nuevoEstado = 'solicitado'
      }
    } else if (['reserva_aprobada', 'reserva_parcialmente_aprobada'].includes(actual)) {
      nuevoEstado = 'solicitud_reserva'
    }

    if (!nuevoEstado) {
      await client.query('ROLLBACK')
      return { error: `No se puede cancelar desde estado: ${actual}` }
    }

    if (esReserva && !esUndoRondaDos) {
      await _liberarOReasignarReservados(client, id_prestamo)
    }

    if (!esUndoRondaDos) {
      await client.query(
        `UPDATE detalles_prestamos
         SET estado_prestamo_ejemplar = 'solicitado',
             observaciones = ''
         WHERE id_prestamo = $1
           AND estado_prestamo_ejemplar IN ('aprobado', 'rechazado')`,
        [id_prestamo]
      )
    }

    const { rows: updated } = await client.query(
      `UPDATE prestamos 
       SET estado_prestamo = $1,
           fecha_respuesta = NULL,
           id_bibliotecario = NULL
       WHERE id_prestamo = $2
       RETURNING *`,
      [nuevoEstado, id_prestamo]
    )

    await client.query('COMMIT')

    // Avisar al usuario que la aprobación fue revertida — se había prometido
    // el préstamo/entrega y ahora vuelve a estar pendiente
    await crearNotificacion({
      id_usuario: updated[0].id_usuario,
      tipo: esUndoRondaDos ? 'reserva_disponible' : (esReserva ? 'reserva_aprobada' : 'prestamo_aprobado'),
      titulo: 'Se revirtió una aprobación',
      mensaje: esUndoRondaDos
        ? 'La confirmación de entrega de tu reserva fue revertida. Seguimos gestionando tu solicitud.'
        : 'La aprobación de tu solicitud fue revertida. La estamos revisando de nuevo.',
      id_prestamo
    })

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


const getLoans = async ({ id_usuario, estado, estados, es_reserva, fecha_desde, fecha_hasta, solo_reservas_listas, excluir_pendientes_solicitud, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  whereClause += ` AND p.estado_prestamo NOT IN ('renovado', 'renovacion_finalizada')`

   if (excluir_pendientes_solicitud) {
    whereClause += ` AND p.estado_prestamo NOT IN ('solicitado', 'solicitud_reserva', 'solicitud_renovacion')`
  }

  if (id_usuario) {
    whereClause += ` AND p.id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
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

  // NUEVO — Solo tiene efecto sobre préstamos en reserva_aprobada/parcial:
  // los deja pasar únicamente si TODOS sus ejemplares de reserva aprobados
  // ya están físicamente devueltos (estado_ejemplar = 'reservado'). Se usa
  // exclusivamente desde el tab "Solicitudes" — el tab "Préstamos" sigue
  // pudiendo listar reservas aprobadas aunque todavía estén esperando
  // devolución, para que el admin pueda hacer seguimiento.
  if (solo_reservas_listas) {
    whereClause += `
      AND (
        p.estado_prestamo NOT IN ('reserva_aprobada', 'reserva_parcialmente_aprobada')
        OR NOT EXISTS (
          SELECT 1 FROM detalles_prestamos dpr
          JOIN ejemplares er ON dpr.id_ejemplar = er.id_ejemplar
          WHERE dpr.id_prestamo = p.id_prestamo
            AND dpr.es_reserva = true
            AND dpr.estado_prestamo_ejemplar = 'aprobado'
            AND er.estado_ejemplar != 'reservado'
        )
      )`
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
       COALESCE(orig.fecha_solicitud, p.fecha_solicitud)   AS fecha_solicitud,
       COALESCE(orig.fecha_respuesta, p.fecha_respuesta)   AS fecha_respuesta,
       COALESCE(orig.fecha_activacion, p.fecha_activacion) AS fecha_activacion,
       p.fecha_tope_devolucion,
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
     LEFT JOIN prestamos orig ON p.id_prestamo_original = orig.id_prestamo
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

const countLoans = async ({ id_usuario, estado, estados, es_reserva, fecha_desde, fecha_hasta, solo_reservas_listas, excluir_pendientes_solicitud }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE estado_prestamo NOT IN ('renovado', 'renovacion_finalizada')`

  if (excluir_pendientes_solicitud) {
    whereClause += ` AND estado_prestamo NOT IN ('solicitado', 'solicitud_reserva', 'solicitud_renovacion')`
  }

  if (id_usuario) {
    whereClause += ` AND id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
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

  // Mismo criterio que getLoans — debe coincidir exactamente o el total
  // de páginas queda desincronizado con los resultados reales.
  if (solo_reservas_listas) {
    whereClause += `
      AND (
        estado_prestamo NOT IN ('reserva_aprobada', 'reserva_parcialmente_aprobada')
        OR NOT EXISTS (
          SELECT 1 FROM detalles_prestamos dpr
          JOIN ejemplares er ON dpr.id_ejemplar = er.id_ejemplar
          WHERE dpr.id_prestamo = prestamos.id_prestamo
            AND dpr.es_reserva = true
            AND dpr.estado_prestamo_ejemplar = 'aprobado'
            AND er.estado_ejemplar != 'reservado'
        )
      )`
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

    // Verificar que no haya ya una renovación pendiente de respuesta para esta cadena.
    // Sin este chequeo, como el préstamo activo nunca cambia de estado al solicitar
    // una renovación, se podían crear múltiples solicitudes duplicadas.
    const { rows: renovacionPendiente } = await client.query(
      `SELECT id_prestamo FROM prestamos
       WHERE id_prestamo_original = $1 AND estado_prestamo = 'solicitud_renovacion'`,
      [id_original]
    )

    if (renovacionPendiente.length > 0) {
      await client.query('ROLLBACK')
      return { error: 'Ya existe una solicitud de renovación pendiente de aprobación para este préstamo' }
    }


    // Contar renovaciones ya hechas sobre ese original. Se excluyen las
    // canceladas por el propio usuario ('cancelado'): al no haber sido nunca
    // gestionadas por un bibliotecario, es como si no hubieran existido — no
    // deben ocupar un número de renovación ni consumir el límite.
    const { rows: renovaciones } = await client.query(
      `SELECT COUNT(*) FROM prestamos
       WHERE id_prestamo_original = $1 AND estado_prestamo != 'cancelado'`,
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

    // Avisar a admins y bibliotecarios — fuera de la transacción, ya confirmada.
    // Antes solo se avisaba a 'admin', pero quien normalmente gestiona estas
    // solicitudes es el bibliotecario (la ruta de aprobar/rechazar usa
    // isBibliotecario, que permite ambos roles). Se trae también nombre_tipo
    // porque rol_destino tiene que coincidir con el rol activo de cada
    // destinatario o el filtro de notificaciones no se la va a mostrar.
    const { rows: staff } = await pool.query(
      `SELECT u.id_usuario, t.nombre_tipo FROM usuarios u
       JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
       WHERE t.nombre_tipo IN ('admin', 'bibliotecario') AND u.activo = true`
    )
    for (const persona of staff) {
      await crearNotificacion({
        id_usuario: persona.id_usuario,
        tipo: 'admin_renovacion_pendiente',
        titulo: 'Nueva solicitud de renovación',
        mensaje: `Hay una solicitud de renovación esperando revisión (préstamo #${id_prestamo}).`,
        id_prestamo,
        rol_destino: persona.nombre_tipo,
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

// El usuario cancela su propia solicitud de renovación antes de que el
// bibliotecario la responda. A diferencia de rejectRenewal, acá el préstamo
// activo del cual se pidió la renovación nunca cambió de estado (sigue
// 'activo' desde que se creó la solicitud), así que no hay nada que revertir
// más que la fila de la solicitud misma.
const cancelRenewal = async (id_renovacion, id_usuario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: renovacion } = await client.query(
      `SELECT * FROM prestamos
       WHERE id_prestamo = $1
         AND id_usuario = $2
         AND estado_prestamo = 'solicitud_renovacion'
         AND id_prestamo_original IS NOT NULL`,
      [id_renovacion, id_usuario]
    )

    if (renovacion.length === 0) {
      await client.query('ROLLBACK')
      return { error: 'Renovación no encontrada o ya fue procesada' }
    }

    const { rows: cancelada } = await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'cancelado',
           fecha_cancelacion = NOW()
       WHERE id_prestamo = $1
       RETURNING *`,
      [id_renovacion]
    )

    await client.query('COMMIT')
    return cancelada[0]
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
  respondLoanDetailsBatch,
  activateLoan,
  cancelLoan,
  cancelLoanSmart,
  getLoans,
  countLoans,
  getLoanById,
  renewLoan,
  approveRenewal,
  rejectRenewal,
  cancelRenewal
}