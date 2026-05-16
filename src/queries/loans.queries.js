const pool = require('../config/db')


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
const respondLoanDetail = async (id_prestamo, id_ejemplar, estado, id_bibliotecario) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Actualizar el detalle
    const { rows: detalle } = await client.query(
      `UPDATE detalles_prestamos
       SET estado_prestamo_ejemplar = $1
       WHERE id_prestamo = $2 AND id_ejemplar = $3
       RETURNING *`,
      [estado, id_prestamo, id_ejemplar]
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
    const { rows: prestamo } = await client.query(
      `SELECT es_reserva FROM prestamos WHERE id_prestamo = $1`,
      [id_prestamo]
    )
    const esReserva = prestamo[0].es_reserva

    let nuevoEstado
    if (todosAprobados) {
      nuevoEstado = esReserva ? 'reserva_aprobada' : 'aprobado'
    } else if (todosRechazados) {
      nuevoEstado = 'rechazado'
    } else {
      nuevoEstado = esReserva ? 'reserva_parcialmente_aprobada' : 'parcialmente_aprobado'
    }

    const { rows: prestamo_actualizado } = await client.query(
      `UPDATE prestamos
      SET estado_prestamo = $1,
          fecha_respuesta = NOW(),
          id_bibliotecario = $2
      WHERE id_prestamo = $3
      RETURNING *`,
      [nuevoEstado, id_bibliotecario, id_prestamo]
    )

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

// Listar préstamos con filtros
const getLoans = async ({ id_usuario, estado, es_reserva, limit, offset }) => {
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

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       p.*,
       u.nombre_apellido,
       u.correo,
       COUNT(dp.id_ejemplar) AS total_ejemplares
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     LEFT JOIN detalles_prestamos dp ON p.id_prestamo = dp.id_prestamo
     ${whereClause}
     GROUP BY p.id_prestamo, u.nombre_apellido, u.correo
     ORDER BY p.fecha_solicitud DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countLoans = async ({ id_usuario, estado, es_reserva }) => {
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

  return { ...prestamo[0], detalles }
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

    // Verificar que ningún ejemplar está reservado por otro usuario
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

    // Marcar el préstamo actual como solicitud_renovacion
    await client.query(
      `UPDATE prestamos SET estado_prestamo = 'solicitud_renovacion'
       WHERE id_prestamo = $1`,
      [id_prestamo]
    )

    // Obtener los ejemplares activos del préstamo original
    const { rows: detalles } = await client.query(
      `SELECT id_ejemplar FROM detalles_prestamos
       WHERE id_prestamo = $1 AND estado_prestamo_ejemplar = 'activo'`,
      [id_prestamo]
    )

    

    // Reutilizar createLoan con los mismos ejemplares — todos siguen disponibles/prestados
    const ejemplares = detalles.map(d => d.id_ejemplar)
    const nuevoPrestamo = await _insertLoan(client, id_usuario, ejemplares, false)
    
    await client.query('COMMIT')

    return { prestamo_original: id_prestamo, nuevo_prestamo: nuevoPrestamo }
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
  getLoans,
  countLoans,
  getLoanById,
  renewLoan
}