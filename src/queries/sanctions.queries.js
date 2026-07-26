const pool = require('../config/db')

const createSanction = async ({
  id_prestamo, id_ejemplar, id_usuario, id_admin,
  tipo_infraccion, descripcion_sancion, fecha_limite,
  dias_suspension
}) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── Validaciones de duplicado ──────────────────────────────────

    // Para tipos vinculados a ejemplar: verificar que no exista ya
    // una sanción activa del mismo tipo para ese prestamo+ejemplar.
    // Se chequea contra TODA la cadena de renovaciones (raíz + renovaciones),
    // porque el mismo préstamo físico puede haber quedado identificado con
    // distinto id_prestamo según en qué eslabón se creó cada sanción.
    if (id_ejemplar && id_prestamo) {
      const { rows: dupEjemplar } = await client.query(
        `WITH raiz AS (
           SELECT COALESCE(id_prestamo_original, id_prestamo) AS id_raiz
           FROM prestamos WHERE id_prestamo = $1
         )
         SELECT 1 FROM sanciones s
         WHERE s.id_prestamo IN (
             SELECT p.id_prestamo FROM prestamos p, raiz
             WHERE p.id_prestamo = raiz.id_raiz
                OR p.id_prestamo_original = raiz.id_raiz
           )
           AND s.id_ejemplar  = $2
           AND s.tipo_infraccion = $3
           AND s.estado_sancion NOT IN ('rechazada', 'resuelta')
         LIMIT 1`,
        [id_prestamo, id_ejemplar, tipo_infraccion]
      )
      if (dupEjemplar.length > 0) {
        await client.query('ROLLBACK')
        const error = new Error('Este ejemplar ya tiene una sanción activa de este tipo para el mismo préstamo')
        error.code = 'SANCION_DUPLICADA'
        throw error
      }
    }

    // Para falta_entrega: verificar que no exista ya para ese prestamo
    // (misma cadena completa: raíz + cualquier renovación)
    if (tipo_infraccion === 'falta_entrega' && id_prestamo) {
      const { rows: dupPrestamo } = await client.query(
        `WITH raiz AS (
           SELECT COALESCE(id_prestamo_original, id_prestamo) AS id_raiz
           FROM prestamos WHERE id_prestamo = $1
         )
         SELECT 1 FROM sanciones s
         WHERE s.id_prestamo IN (
             SELECT p.id_prestamo FROM prestamos p, raiz
             WHERE p.id_prestamo = raiz.id_raiz
                OR p.id_prestamo_original = raiz.id_raiz
           )
           AND s.tipo_infraccion = 'falta_entrega'
           AND s.estado_sancion NOT IN ('rechazada', 'resuelta')
         LIMIT 1`,
        [id_prestamo]
      )
      if (dupPrestamo.length > 0) {
        await client.query('ROLLBACK')
        const error = new Error('Este préstamo ya tiene una sanción por falta de entrega activa')
        error.code = 'SANCION_DUPLICADA'
        throw error
      }
    }

    // Para comportamiento: verificar que el usuario no tenga ya una activa
    if (tipo_infraccion === 'comportamiento') {
      const { rows: dupComportam } = await client.query(
        `SELECT 1 FROM sanciones
         WHERE id_usuario      = $1
           AND tipo_infraccion = 'comportamiento'
           AND estado_sancion NOT IN ('rechazada', 'resuelta')
         LIMIT 1`,
        [id_usuario]
      )
      if (dupComportam.length > 0) {
        await client.query('ROLLBACK')
        const error = new Error('Este usuario ya tiene una sanción por comportamiento activa')
        error.code = 'SANCION_DUPLICADA'
        throw error
      }
    }

    // ── Cálculo de fechas ──────────────────────────────────────────

    let fechaLimite = fecha_limite || null
    if (['falta_entrega', 'deterioro', 'perdida'].includes(tipo_infraccion) && !fechaLimite) {
      const f = new Date()
      f.setDate(f.getDate() + 30)
      fechaLimite = f
    }

    let fechaFinSuspension = null
    if (tipo_infraccion === 'comportamiento' && dias_suspension) {
      const f = new Date()
      f.setDate(f.getDate() + parseInt(dias_suspension))
      fechaFinSuspension = f
    }
    if (tipo_infraccion === 'devolucion_tardia') {
      const f = new Date()
      f.setDate(f.getDate() + 10)
      fechaFinSuspension = f
      dias_suspension = 10
    }

    // ── INSERT ────────────────────────────────────────────────────

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

    // Si es pérdida, actualizar el estado del ejemplar y descontar del libro
    if (tipo_infraccion === 'perdida' && id_ejemplar) {
      // Obtener id_libro del ejemplar
      const { rows: ejemplarRows } = await client.query(
        `UPDATE ejemplares
        SET estado_ejemplar = 'perdido'
        WHERE id_ejemplar = $1
        RETURNING id_libro`,
        [id_ejemplar]
      )

      if (ejemplarRows.length > 0) {
        // Actualizar estado en detalles_prestamos
        await client.query(
          `UPDATE detalles_prestamos
          SET estado_prestamo_ejemplar = 'perdido'
          WHERE id_prestamo = $1 AND id_ejemplar = $2`,
          [id_prestamo, id_ejemplar]
        )

        // Descontar cantidad_ejemplar del libro
        await client.query(
          `UPDATE libros
          SET cantidad_ejemplar = GREATEST(cantidad_ejemplar - 1, 0)
          WHERE id_libro = $1`,
          [ejemplarRows[0].id_libro]
        )
      }
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

    const cuentaHabilitada = parseInt(otrasSanciones[0].count) === 0

    if (cuentaHabilitada) {
      await client.query(
        `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
        [rows[0].id_usuario]
      )
    }

    await client.query('COMMIT')
    return { ...rows[0], cuenta_habilitada: cuentaHabilitada }
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

    const { rows: current } = await client.query(
      `SELECT * FROM sanciones WHERE id_sancion = $1`,
      [id_sancion]
    )
    if (current.length === 0) return null
    const sanction = current[0]

    // Validación especial para pérdida: el ejemplar debe haber sido devuelto o reemplazado
    if (sanction.tipo_infraccion === 'perdida' && sanction.id_ejemplar && sanction.id_prestamo) {
      const { rows: detalle } = await client.query(
        `SELECT estado_prestamo_ejemplar FROM detalles_prestamos
         WHERE id_prestamo = $1 AND id_ejemplar = $2`,
        [sanction.id_prestamo, sanction.id_ejemplar]
      )
      if (detalle.length > 0 && detalle[0].estado_prestamo_ejemplar === 'perdido') {
        await client.query('ROLLBACK')
        const error = new Error(
          'No se puede resolver esta sanción manualmente. El ejemplar aún figura como perdido. ' +
          'Primero registrá la devolución o el reemplazo del material desde el historial de préstamos.'
        )
        error.code = 'EJEMPLAR_AUN_PERDIDO'
        throw error
      }
    }

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

    const cuentaHabilitada = parseInt(otrasSanciones[0].count) === 0

    if (cuentaHabilitada) {
      await client.query(
        `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
        [sancion[0].id_usuario]
      )
    }

    await client.query('COMMIT')
    return { ...sancion[0], cuenta_habilitada: cuentaHabilitada }
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

const desescalateSanction = async (id_sancion) => {
  const { rows } = await pool.query(
    `UPDATE sanciones SET estado_sancion = 'activa'
     WHERE id_sancion = $1 AND estado_sancion = 'escalada'
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
       l.titulo AS titulo_material,
       l.autor AS autor_material,
       l.editorial AS editorial_material,
       e.id_ejemplar,
       e.estado_ejemplar,
       p.fecha_tope_devolucion,
       p.estado_prestamo,
       a.nombre_apellido AS admin_nombre
     FROM sanciones s
     LEFT JOIN prestamos p ON s.id_prestamo = p.id_prestamo
     LEFT JOIN ejemplares e ON s.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     WHERE s.id_usuario = $1
       AND s.estado_sancion != 'rechazada'
     ORDER BY s.fecha_sancion DESC`,
    [id_usuario]
  )
  return rows
}

const getSanctionsGroupedByLoan = async ({ estado, limit, offset }) => {
  const values = []
  let paramIndex = 1
  
  let whereClause = `WHERE s.tipo_infraccion != 'comportamiento'`

  if (estado) {
    const estados = estado.split(',')
    whereClause += ` AND s.estado_sancion = ANY($${paramIndex}::varchar[])`
    values.push(estados)
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
         p.fecha_tope_devolucion,
         p.estado_prestamo
       FROM prestamos p
     )
     SELECT
       c.id_raiz AS id_prestamo,
       MAX(c.fecha_tope_devolucion) AS fecha_tope_devolucion,
       -- Estado del último eslabón de la cadena (el que realmente aplica hoy)
       (ARRAY_AGG(c.estado_prestamo ORDER BY c.numero_renovacion DESC))[1] AS estado_prestamo,
       u.id_usuario,
       u.nombre_apellido AS usuario_nombre,
       u.correo AS usuario_correo,
       u.ci AS usuario_ci,
       COUNT(s.id_sancion) AS total_sanciones,
       -- Si alguna está activa el grupo está activo
       BOOL_OR(s.estado_sancion = 'activa') AS tiene_activas,
       BOOL_OR(s.estado_sancion = 'escalada') AS tiene_escaladas,
       MIN(s.fecha_sancion) AS fecha_primera_sancion,
       MAX(s.fecha_limite) AS fecha_limite_maxima,
       -- Agrupar tipos únicos
       ARRAY_AGG(DISTINCT s.tipo_infraccion) AS tipos,
       -- ID del admin si hay uno
       MAX(a.nombre_apellido) AS admin_nombre
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     -- Clave del fix: resolver por la raíz de la cadena de renovaciones.
     -- Antes se agrupaba por s.id_prestamo tal cual, así que dos sanciones
     -- del mismo préstamo físico registradas contra distintos eslabones
     -- (raíz vs. renovación) terminaban mostrándose como dos cards separadas.
     LEFT JOIN cadena c ON s.id_prestamo = c.id_prestamo
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     ${whereClause}
     GROUP BY c.id_raiz, u.id_usuario, u.nombre_apellido, u.correo, u.ci
     ORDER BY MIN(s.fecha_sancion) DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countSanctionsGrouped = async ({ estado }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE s.tipo_infraccion != 'comportamiento'`

  if (estado) {
    const estados = estado.split(',')
    whereClause += ` AND s.estado_sancion = ANY($${paramIndex}::varchar[])`
    values.push(estados)
    paramIndex++
  }

  const { rows } = await pool.query(
    `WITH cadena AS (
       SELECT p.id_prestamo, COALESCE(p.id_prestamo_original, p.id_prestamo) AS id_raiz
       FROM prestamos p
     )
     SELECT COUNT(DISTINCT COALESCE(c.id_raiz::text, s.id_usuario::text || '-' || s.id_sancion::text))
     FROM sanciones s
     LEFT JOIN cadena c ON s.id_prestamo = c.id_prestamo
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

// Detalle de todas las sanciones de un préstamo
const getSanctionsByLoan = async (id_prestamo, estado) => {
  // Construir el filtro de estado según la tab activa
  let estadoFilter = ''
  const params = [id_prestamo]

  if (estado === 'activa') {
    estadoFilter = `AND s.estado_sancion = 'activa'`
  } else if (estado === 'escalada') {
    estadoFilter = `AND s.estado_sancion = 'escalada'`
  } else if (estado === 'resuelta,rechazada') {
    estadoFilter = `AND s.estado_sancion IN ('resuelta', 'rechazada')`
  }

  const { rows } = await pool.query(
    `SELECT
       s.*,
       u.nombre_apellido AS usuario_nombre,
       u.correo         AS usuario_correo,
       u.ci             AS usuario_ci,
       a.nombre_apellido AS admin_nombre,
       l.titulo         AS libro_titulo,
       l.autor          AS libro_autor,
       e.id_ejemplar
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     LEFT JOIN ejemplares e ON s.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro
     -- El id_prestamo recibido es la raíz de la cadena (así lo devuelve
     -- ahora getSanctionsGroupedByLoan). Traemos sanciones registradas
     -- contra CUALQUIER eslabón: la raíz o alguna de sus renovaciones.
     WHERE s.id_prestamo IN (
         SELECT id_prestamo FROM prestamos
         WHERE id_prestamo = $1 OR id_prestamo_original = $1
       )
       ${estadoFilter}
     ORDER BY s.fecha_sancion ASC`,
    params
  )
  return rows
}


// Buscar préstamos a sancionar.
// tipo = 'falta_entrega' -> solo préstamos 'vencido' sin sanción falta_entrega
//        activa/pendiente_confirmacion ya registrada.
// tipo = otro            -> préstamos activo, pendiente_devolucion, vencido o
//        devuelto que coincidan con la búsqueda, con al menos un ejemplar.
const searchSanctionableLoans = async (search, tipo) => {
  // Estados de préstamo permitidos según el tipo de infracción
  const estadosPorTipo = {
    falta_entrega:    ['vencido'],
    devolucion_tardia: ['vencido', 'devuelto'],
    deterioro:        ['activo', 'vencido', 'devuelto'],
    perdida:          ['activo', 'vencido'],
  }

  if (tipo === 'falta_entrega') {
    const { rows } = await pool.query(
      `SELECT
         -- Devolvemos la raíz de la cadena: es el id que usan el resto de
         -- las consultas de sanciones (dup-check, detalle agrupado, etc.)
         -- para identificar "el mismo préstamo físico" sin importar en
         -- qué renovación esté parado hoy.
         COALESCE(p.id_prestamo_original, p.id_prestamo) AS id_prestamo,
         p.fecha_solicitud,
         p.fecha_tope_devolucion,
         p.fecha_activacion,
         p.estado_prestamo,
         u.id_usuario,
         u.nombre_apellido,
         u.correo,
         u.ci
       FROM prestamos p
       JOIN usuarios u ON p.id_usuario = u.id_usuario
       WHERE p.estado_prestamo = 'vencido'
         -- Evita traer préstamos activados hace mucho: si ya pasó más de
         -- un mes desde la activación, no tiene sentido ofrecerlo como
         -- "sancionable reciente" en el buscador.
         AND p.fecha_activacion >= CURRENT_DATE - INTERVAL '1 month'
         AND (
           u.nombre_apellido ILIKE $1 OR
           u.correo ILIKE $1 OR
           u.ci ILIKE $1
         )
         AND NOT EXISTS (
           SELECT 1 FROM sanciones s
           WHERE s.id_prestamo = p.id_prestamo
             AND s.tipo_infraccion = 'falta_entrega'
             AND s.estado_sancion IN ('activa', 'pendiente_confirmacion')
         )
       ORDER BY p.fecha_tope_devolucion ASC`,
      [`%${search}%`]
    )
    return rows
  }

  const estados = estadosPorTipo[tipo]
  if (!estados) return []

  const placeholders = estados.map((_, i) => `$${i + 2}`).join(', ')

  const { rows } = await pool.query(
    `SELECT
      -- Devolvemos la raíz de la cadena por el mismo motivo que en la rama
      -- de falta_entrega: es el id que usa el resto del módulo de sanciones
      -- para identificar el préstamo físico sin importar la renovación actual.
      COALESCE(p.id_prestamo_original, p.id_prestamo) AS id_prestamo,
      p.fecha_solicitud,
      p.fecha_tope_devolucion,
      p.fecha_activacion,
      p.estado_prestamo,
      u.id_usuario,
      u.nombre_apellido,
      u.correo,
      u.ci,
      COUNT(dp.id_ejemplar) AS total_ejemplares
    FROM prestamos p
    JOIN usuarios u ON p.id_usuario = u.id_usuario
    -- Clave del fix: los ejemplares de una renovación cuelgan del préstamo
    -- RAÍZ (id_prestamo_original), nunca del id propio de la renovación.
    -- Sin el COALESCE, un préstamo renovado nunca matcheaba nada acá.
    JOIN detalles_prestamos dp
      ON COALESCE(p.id_prestamo_original, p.id_prestamo) = dp.id_prestamo
    WHERE p.estado_prestamo IN (${placeholders})
      -- Evita traer todo el historial de devueltos de un usuario: solo
      -- préstamos activados dentro del último mes aparecen en el buscador.
      AND p.fecha_activacion >= CURRENT_DATE - INTERVAL '1 month'
      AND (
        u.nombre_apellido ILIKE $1 OR
        u.correo ILIKE $1 OR
        u.ci ILIKE $1
      )
      AND EXISTS (
        SELECT 1 FROM detalles_prestamos dp2
        WHERE dp2.id_prestamo = COALESCE(p.id_prestamo_original, p.id_prestamo)
          AND NOT EXISTS (
            -- La sanción puede haber quedado registrada contra CUALQUIER
            -- eslabón de la cadena (raíz o alguna renovación), no solo
            -- contra el id_prestamo de esta fila puntual.
            SELECT 1 FROM sanciones s
            WHERE s.id_prestamo IN (
                SELECT id_prestamo FROM prestamos
                WHERE id_prestamo = COALESCE(p.id_prestamo_original, p.id_prestamo)
                   OR id_prestamo_original = COALESCE(p.id_prestamo_original, p.id_prestamo)
              )
              AND s.id_ejemplar = dp2.id_ejemplar
              AND s.tipo_infraccion = $${estados.length + 2}
              AND s.estado_sancion NOT IN ('rechazada', 'resuelta')
          )
      )
    GROUP BY p.id_prestamo, u.id_usuario
    HAVING COUNT(dp.id_ejemplar) > 0
    ORDER BY p.fecha_tope_devolucion DESC`,
    [`%${search}%`, ...estados, tipo]
  )
  return rows
}

// Préstamo con todos sus ejemplares — para elegir cuáles sancionar
// (incluye estado_prestamo_ejemplar para mostrar contexto al admin)
const getLoanWithEjemplaresForSanction = async (id_prestamo, tipo_infraccion) => {
  const { rows: prestamo } = await pool.query(
    `SELECT
       p.*,
       u.nombre_apellido,
       u.correo,
       u.ci
     FROM prestamos p
     JOIN usuarios u ON p.id_usuario = u.id_usuario
     WHERE p.id_prestamo = $1`,
    [id_prestamo]
  )

  if (prestamo.length === 0) return null

  // Clave del fix: los ejemplares siempre cuelgan de la raíz de la cadena
  // (id_prestamo_original), nunca del id propio de una renovación.
  const id_raiz = prestamo[0].id_prestamo_original || id_prestamo

  // Si hay tipo_infraccion, filtrar ejemplares ya sancionados de ese tipo
  // (la sanción puede estar registrada contra cualquier eslabón de la cadena)
  const ejemplaresQuery = tipo_infraccion
    ? `SELECT
         dp.id_ejemplar,
         dp.estado_prestamo_ejemplar,
         e.estado_ejemplar,
         l.id_libro,
         l.titulo,
         l.autor
       FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       JOIN libros l ON e.id_libro = l.id_libro
       WHERE dp.id_prestamo = $1
         AND NOT EXISTS (
           SELECT 1 FROM sanciones s
           WHERE s.id_prestamo IN (
               SELECT id_prestamo FROM prestamos
               WHERE id_prestamo = $1 OR id_prestamo_original = $1
             )
             AND s.id_ejemplar = dp.id_ejemplar
             AND s.tipo_infraccion = $2
             AND s.estado_sancion NOT IN ('rechazada', 'resuelta')
         )
       ORDER BY dp.id_ejemplar ASC`
    : `SELECT
         dp.id_ejemplar,
         dp.estado_prestamo_ejemplar,
         e.estado_ejemplar,
         l.id_libro,
         l.titulo,
         l.autor
       FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       JOIN libros l ON e.id_libro = l.id_libro
       WHERE dp.id_prestamo = $1
       ORDER BY dp.id_ejemplar ASC`

  const params = tipo_infraccion ? [id_raiz, tipo_infraccion] : [id_raiz]
  const { rows: ejemplares } = await pool.query(ejemplaresQuery, params)

  return { ...prestamo[0], ejemplares }
}

// Sanciones de comportamiento agrupadas por usuario.
// Son las sanciones sin id_prestamo (o con id_prestamo pero de tipo comportamiento),
// y se muestran en una sección separada de la vista de sanciones activas/escaladas.
const getSancionesComportamientoAgrupadas = async ({ estado, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE s.tipo_infraccion = 'comportamiento'`

  if (estado) {
    const estados = estado.split(',')
    whereClause += ` AND s.estado_sancion = ANY($${paramIndex}::varchar[])`
    values.push(estados)
    paramIndex++
  }

  values.push(limit)
  values.push(offset)

  const { rows } = await pool.query(
    `SELECT
       u.id_usuario,
       u.nombre_apellido AS usuario_nombre,
       u.correo AS usuario_correo,
       u.ci AS usuario_ci,
       COUNT(s.id_sancion) AS total_sanciones,
       BOOL_OR(s.estado_sancion = 'activa')   AS tiene_activas,
       BOOL_OR(s.estado_sancion = 'escalada') AS tiene_escaladas,
       MIN(s.fecha_sancion)  AS fecha_primera_sancion,
       MAX(s.fecha_sancion)  AS fecha_ultima_sancion,
       MAX(s.fecha_fin_suspension) AS fecha_fin_suspension_maxima,
       MAX(a.nombre_apellido) AS admin_nombre,
       -- Incluir si alguna tiene suspensión indefinida (sin fecha_fin_suspension)
       BOOL_OR(s.dias_suspension IS NULL AND s.fecha_fin_suspension IS NULL) AS tiene_suspension_indefinida
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     ${whereClause}
     GROUP BY u.id_usuario, u.nombre_apellido, u.correo, u.ci
     ORDER BY MAX(s.fecha_sancion) DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )
  return rows
}

const countSancionesComportamientoAgrupadas = async ({ estado }) => {
  const values = []
  let paramIndex = 1
  let whereClause = `WHERE s.tipo_infraccion = 'comportamiento'`

  if (estado) {
    const estados = estado.split(',')
    whereClause += ` AND s.estado_sancion = ANY($${paramIndex}::varchar[])`
    values.push(estados)
    paramIndex++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT s.id_usuario)
     FROM sanciones s
     ${whereClause}`,
    values
  )
  return parseInt(rows[0].count)
}

// Todas las sanciones de comportamiento de un usuario — para el modal de detalle
const getSancionesComportamientoByUsuario = async (id_usuario, estado) => {
  let estadoFilter = ''

  if (estado === 'activa') {
    estadoFilter = `AND s.estado_sancion = 'activa'`
  } else if (estado === 'resuelta,rechazada') {
    estadoFilter = `AND s.estado_sancion IN ('resuelta', 'rechazada')`
  }

  const { rows } = await pool.query(
    `SELECT
       s.*,
       u.nombre_apellido AS usuario_nombre,
       u.correo         AS usuario_correo,
       u.ci             AS usuario_ci,
       a.nombre_apellido AS admin_nombre
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     WHERE s.id_usuario = $1
       AND s.tipo_infraccion = 'comportamiento'
       ${estadoFilter}
     ORDER BY s.fecha_sancion DESC`,
    [id_usuario]
  )
  return rows
}

// Todas las sanciones de un préstamo sin filtro de estado — para la página de detalle
const getAllSanctionsByLoan = async (id_prestamo) => {
  const { rows } = await pool.query(
    `SELECT
       s.*,
       u.nombre_apellido AS usuario_nombre,
       u.correo         AS usuario_correo,
       u.ci             AS usuario_ci,
       a.nombre_apellido AS admin_nombre,
       l.titulo         AS libro_titulo,
       l.autor          AS libro_autor,
       e.id_ejemplar
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     LEFT JOIN ejemplares e ON s.id_ejemplar = e.id_ejemplar
     LEFT JOIN libros l ON e.id_libro = l.id_libro
     -- Mismo criterio que getSanctionsByLoan: el id recibido es la raíz
     -- de la cadena, traer sanciones de cualquier eslabón.
     WHERE s.id_prestamo IN (
         SELECT id_prestamo FROM prestamos
         WHERE id_prestamo = $1 OR id_prestamo_original = $1
       )
     ORDER BY s.fecha_sancion ASC`,
    [id_prestamo]
  )
  return rows
}

// Todas las sanciones de comportamiento de un usuario sin filtro — para la página de detalle
const getAllSancionesComportamientoByUsuario = async (id_usuario) => {
  const { rows } = await pool.query(
    `SELECT
       s.*,
       u.nombre_apellido AS usuario_nombre,
       u.correo         AS usuario_correo,
       u.ci             AS usuario_ci,
       a.nombre_apellido AS admin_nombre
     FROM sanciones s
     JOIN usuarios u ON s.id_usuario = u.id_usuario
     LEFT JOIN usuarios a ON s.id_admin = a.id_usuario
     WHERE s.id_usuario = $1
       AND s.tipo_infraccion = 'comportamiento'
     ORDER BY s.fecha_sancion DESC`,
    [id_usuario]
  )
  return rows
}

const editSanction = async (id_sancion, { descripcion_sancion, dias_suspension }) => {
  // Traer la sanción actual para validar estado y recalcular fechas
  const { rows: current } = await pool.query(
    `SELECT * FROM sanciones WHERE id_sancion = $1`,
    [id_sancion]
  )
  if (current.length === 0) return null

  const sancion = current[0]

  // Solo se pueden editar sanciones activas o escaladas
  if (!['activa', 'escalada'].includes(sancion.estado_sancion)) {
    const error = new Error('Solo se pueden editar sanciones activas o escaladas')
    error.code = 'SANCION_NO_EDITABLE'
    throw error
  }

  const updates = []
  const params  = []
  let paramIdx  = 1

  if (descripcion_sancion !== undefined) {
    updates.push(`descripcion_sancion = $${paramIdx++}`)
    params.push(descripcion_sancion)
  }

  if (dias_suspension !== undefined) {
    // Recalcular fecha_fin_suspension desde fecha_sancion original
    let fechaFinSuspension = null
    if (dias_suspension !== null) {
      const base = new Date(sancion.fecha_sancion)
      base.setDate(base.getDate() + parseInt(dias_suspension))
      fechaFinSuspension = base
    }
    updates.push(`dias_suspension = $${paramIdx++}`)
    updates.push(`fecha_fin_suspension = $${paramIdx++}`)
    params.push(dias_suspension)
    params.push(fechaFinSuspension)
  }

  if (updates.length === 0) return sancion

  params.push(id_sancion)
  const { rows } = await pool.query(
    `UPDATE sanciones SET ${updates.join(', ')}
     WHERE id_sancion = $${paramIdx}
     RETURNING *`,
    params
  )
  return rows[0]
}

module.exports = {
  createSanction, confirmSanction, rejectSanction,
  getSanctions, countSanctions, getSanctionById,
  getSanctionsGroupedByLoan, countSanctionsGrouped, getSanctionsByLoan,
  getAllSanctionsByLoan, 
  resolveSanction, escalateSanction, desescalateSanction,
  autoResolveFaltaEntrega, getMySanctions,
  searchSanctionableLoans, getLoanWithEjemplaresForSanction,
  getSancionesComportamientoAgrupadas, countSancionesComportamientoAgrupadas,
  getSancionesComportamientoByUsuario,
  getAllSancionesComportamientoByUsuario, editSanction
}