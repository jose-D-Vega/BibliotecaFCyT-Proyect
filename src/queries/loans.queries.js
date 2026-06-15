const pool = require('../config/db')

const { crearNotificacion } = require('./notifications.queries')


const _insertLoan = async (client, id_usuario, ejemplares, esReserva) => {
  const estado = esReserva ? 'solicitud_reserva' : 'solicitado'

   // fecha_tope_devolucion es NOT NULL en la BD pero se asigna realmente
  // al activar el préstamo — usamos un placeholder de 30 días
  const fechaPlaceholder = new Date()
  fechaPlaceholder.setDate(fechaPlaceholder.getDate() + 30)

  const { rows: prestamo } = await client.query(
    `INSERT INTO prestamos (fecha_solicitud, fecha_tope_devolucion, estado_prestamo, id_usuario, es_reserva)
     VALUES (NOW(), $1, $2, $3, $4)
     RETURNING *`,
    [fechaPlaceholder, estado, id_usuario, esReserva]
  )

  const id_prestamo = prestamo[0].id_prestamo

  for (const id_ejemplar of ejemplares) {
    await client.query(
      `INSERT INTO detalles_prestamos (id_prestamo, id_ejemplar, observaciones, estado_prestamo_ejemplar, es_reserva)
       VALUES ($1, $2, '', 'solicitado', $3)`,
      [id_prestamo, id_ejemplar, esReserva]
    )
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

// Respuesta del bibliotecario — aprueba o rechaza ejemplar por ejemplar
const respondLoanDetail = async (id_prestamo, id_ejemplar, estado, id_bibliotecario, observaciones) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Actualizar el detalle
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

    // Calcular estado final considerando renovaciones
    let nuevoEstado
    const { rows: prestamoData } = await client.query(
      `SELECT * FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const esReserva = prestamoData[0].es_reserva
    const esRenovacion = prestamoData[0].numero_renovacion > 0 ||
      prestamoData[0].id_prestamo_original !== null

    if (todosAprobados) {
      if (esReserva) nuevoEstado = 'reserva_aprobada'
      else if (esRenovacion) nuevoEstado = 'renovado' // ← directo a renovado
      else nuevoEstado = 'aprobado'
    } else if (todosRechazados) {
      const hoy = new Date()
      const fechaTope = new Date(prestamoData[0].fecha_tope_devolucion)
      const vencido = hoy > fechaTope

      // Si es renovación rechazada y ya venció → pendiente_devolucion directo
      if (esRenovacion && vencido) nuevoEstado = 'pendiente_devolucion'
      else nuevoEstado = 'rechazado'
    } else {
      nuevoEstado = esReserva ? 'reserva_parcialmente_aprobada' : 'parcialmente_aprobado'
    }

    // Un solo UPDATE con el estado final correcto
    const { rows: prestamo_actualizado } = await client.query(
      `UPDATE prestamos
      SET estado_prestamo = $1::varchar,
          fecha_respuesta = NOW(),
          id_bibliotecario = $2,
          fecha_tope_devolucion = CASE
            WHEN $1::varchar = 'pendiente_devolucion' THEN $4
            ELSE fecha_tope_devolucion
          END
      WHERE id_prestamo = $3
      RETURNING *`,
      [nuevoEstado, id_bibliotecario, id_prestamo,
      (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d })()]
    )

    // Activar nuevo préstamo si es renovación aprobada
    if (nuevoEstado === 'renovado') {
      const nuevaFechaTope = new Date()
      nuevaFechaTope.setDate(nuevaFechaTope.getDate() + 5)

      const id_original = prestamoData[0].id_prestamo_original || id_prestamo
      const { rows: nuevoPrestamo } = await client.query(
        `UPDATE prestamos
        SET estado_prestamo = 'activo',
            fecha_activacion = NOW(),
            fecha_tope_devolucion = $1,
            id_bibliotecario = $2,
            fecha_respuesta = NOW()
        WHERE id_prestamo_original = $3
          AND estado_prestamo = 'solicitado'
        RETURNING *`,
        [nuevaFechaTope, id_bibliotecario, id_original]
      )

      if (nuevoPrestamo.length > 0) {
        await client.query(
          `UPDATE detalles_prestamos SET estado_prestamo_ejemplar = 'activo'
          WHERE id_prestamo = $1`,
          [nuevoPrestamo[0].id_prestamo]
        )
        await crearNotificacion({
          id_usuario: prestamoData[0].id_usuario,
          tipo: 'renovacion_aprobada',
          titulo: 'Renovación aprobada',
          mensaje: `Tu solicitud de renovación fue aprobada. Tenés hasta el ${nuevaFechaTope.toLocaleDateString('es-PY')} para devolver los libros.`,
          id_prestamo: nuevoPrestamo[0].id_prestamo
        })
      }
    }

    // Notificar si quedó en pendiente_devolucion
    if (nuevoEstado === 'pendiente_devolucion') {
      const fechaLimiteDev = new Date()
      fechaLimiteDev.setDate(fechaLimiteDev.getDate() + 2)
      await crearNotificacion({
        id_usuario: prestamoData[0].id_usuario,
        tipo: 'renovacion_rechazada',
        titulo: 'Renovación rechazada',
        mensaje: `Tu solicitud de renovación fue rechazada. Tenés hasta el ${fechaLimiteDev.toLocaleDateString('es-PY')} para devolver los libros antes de recibir una sanción.`,
        id_prestamo
      })
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
const activateLoan = async (id_prestamo) => {
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

    // Calcular fecha tope — 5 días desde hoy
    const fechaTope = new Date()
    fechaTope.setDate(fechaTope.getDate() + 5)

    // Actualizar préstamo
    const { rows: actualizado } = await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'activo',
           fecha_activacion = NOW(),
           fecha_tope_devolucion = $1
       WHERE id_prestamo = $2
       RETURNING *`,
      [fechaTope, id_prestamo]
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
      `UPDATE prestamos SET estado_prestamo = 'cancelado'
       WHERE id_prestamo = $1
       RETURNING *`,
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
       WHERE id_prestamo = $1 AND id_usuario = $2`,
      [id_prestamo, id_usuario]
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

const getLoans = async ({ id_usuario, estado, es_reserva, fecha_desde, fecha_hasta, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND p.id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (estado) {
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

await pool.query(`
  UPDATE prestamos
  SET estado_prestamo = 'vencido'
  WHERE estado_prestamo = 'activo'
    AND fecha_tope_devolucion::date < CURRENT_DATE
`)

const { rows: prestamos } = await pool.query(
  `SELECT
     p.*,
     d.fecha_devolucion,
     u.nombre_apellido,
     u.correo,
     COUNT(dp.id_ejemplar) AS total_ejemplares
   FROM prestamos p
   JOIN usuarios u
     ON p.id_usuario = u.id_usuario
   LEFT JOIN detalles_prestamos dp
     ON p.id_prestamo = dp.id_prestamo
   LEFT JOIN (
     SELECT
       id_prestamo,
       MAX(fecha_devolucion) AS fecha_devolucion
     FROM devoluciones
     GROUP BY id_prestamo
   ) d
     ON d.id_prestamo = p.id_prestamo
   ${whereClause}
   GROUP BY
     p.id_prestamo,
     d.fecha_devolucion,
     u.nombre_apellido,
     u.correo
   ORDER BY p.fecha_solicitud DESC
   LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
  values
)

// 🔥 AGREGAR MATERIALS POR CADA PRESTAMO
const enriched = await Promise.all(
  prestamos.map(async (p) => {
    const materiales = await getLoanMaterials(p.id_prestamo)

    return {
      ...p,
      materiales,
      total_materiales: materiales.length
    }
  })
)

return enriched
  return rows
}

const countLoans = async ({ id_usuario, estado, es_reserva, fecha_desde, fecha_hasta }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (id_usuario) {
    whereClause += ` AND id_usuario = $${paramIndex}`
    values.push(id_usuario)
    paramIndex++
  }
  if (estado) {
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
       l.autor
     FROM detalles_prestamos dp
     JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
     JOIN libros l ON e.id_libro = l.id_libro
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

    if (diasRestantes > 1) {
      await client.query('ROLLBACK')
      return { error: `Solo podés solicitar renovación cuando falte 1 día o menos para el vencimiento. Faltan ${diasRestantes} días.` }
    }

    // Determinar préstamo original
    const id_original = prestamo[0].id_prestamo_original || prestamo[0].id_prestamo

    // Contar renovaciones
    const { rows: renovaciones } = await client.query(
      `SELECT COUNT(*) FROM prestamos WHERE id_prestamo_original = $1`,
      [id_original]
    )

    if (parseInt(renovaciones[0].count) >= 3) {
      await client.query('ROLLBACK')
      return { error: 'Este préstamo ya alcanzó el límite de 3 renovaciones' }
    }

    // Verificar ejemplares reservados
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

    // Calcular fecha límite de respuesta = fecha_tope + 2 días
    const fechaLimiteRespuesta = new Date(fechaTope)
    fechaLimiteRespuesta.setDate(fechaLimiteRespuesta.getDate() + 2)

    // Cambiar estado del préstamo actual
    await client.query(
      `UPDATE prestamos
       SET estado_prestamo = 'solicitud_renovacion',
           fecha_limite_respuesta_renovacion = $1
       WHERE id_prestamo = $2`,
      [fechaLimiteRespuesta, id_prestamo]
    )

    // Obtener ejemplares activos
    const { rows: detalles } = await client.query(
      `SELECT id_ejemplar FROM detalles_prestamos
       WHERE id_prestamo = $1 AND estado_prestamo_ejemplar = 'activo'`,
      [id_prestamo]
    )

    await client.query('COMMIT')

    const ejemplares = detalles.map(d => d.id_ejemplar)
    const totalRenovaciones = parseInt(renovaciones[0].count)

    const nuevoPrestamo = await _insertLoan(
      await pool.connect(),
      id_usuario,
      ejemplares,
      false,
      id_original,
      totalRenovaciones + 1
    )

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

const approveRenewal = async (id_prestamo) => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // calcular nueva fecha
    const nuevaFecha = new Date()
    nuevaFecha.setDate(nuevaFecha.getDate() + 5)

    // actualizar SOLO el préstamo existente
    const { rows } = await client.query(
      `
      UPDATE prestamos
      SET fecha_tope_devolucion = $1,
          estado_prestamo = 'activo',
          fecha_respuesta = NOW()
      WHERE id_prestamo = $2
      RETURNING *
      `,
      [nuevaFecha, id_prestamo]
    )

    await client.query('COMMIT')

    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const rejectRenewal = async (id_prestamo) => {
  const { rows } = await pool.query(
    `
    UPDATE prestamos
    SET estado_prestamo = 'activo',
        fecha_respuesta = NOW()
    WHERE id_prestamo = $1
    RETURNING *
    `,
    [id_prestamo]
  )

  return rows[0]
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