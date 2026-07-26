const pool = require('../config/db')
const { cacheGet, cacheSet } = require('../utils/simpleCache')

// Tolerable: estas estadísticas no cambian segundo a segundo, así que
// 45s de desactualización no afecta la utilidad del dashboard, pero
// evita repetir las 9-12 queries en cada carga de página.
const STAFF_STATS_TTL_MS = 45 * 1000

// ── Dashboard del usuario normal (parametrizado por id_usuario) ──

const getDashboardStats = async (id_usuario) => {
  const [
    activosResult,
    reservasResult,
    usuarioResult,
    porLibroResult,
    frecuenciaResult,
    ultimosRecursosResult
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FROM prestamos
       WHERE id_usuario = $1 AND estado_prestamo = 'activo'`,
      [id_usuario]
    ),
    pool.query(
      `SELECT COUNT(*) FROM prestamos
       WHERE id_usuario = $1
         AND es_reserva = true
         AND estado_prestamo IN ('solicitud_reserva', 'reserva_aprobada', 'reserva_parcialmente_aprobada')`,
      [id_usuario]
    ),
    pool.query(
      `SELECT sancionado FROM usuarios WHERE id_usuario = $1`,
      [id_usuario]
    ),
    pool.query(
      `SELECT l.titulo, COUNT(*) AS cantidad
       FROM devoluciones d
       JOIN prestamos p ON d.id_prestamo = p.id_prestamo
       JOIN ejemplares e ON d.id_ejemplar = e.id_ejemplar
       JOIN libros l ON e.id_libro = l.id_libro
       WHERE p.id_usuario = $1
       GROUP BY l.titulo
       ORDER BY cantidad DESC
       LIMIT 4`,
      [id_usuario]
    ),
    pool.query(
      `SELECT EXTRACT(MONTH FROM fecha_solicitud)::int AS mes, COUNT(*) AS cantidad
       FROM prestamos
       WHERE id_usuario = $1
         AND EXTRACT(YEAR FROM fecha_solicitud) = EXTRACT(YEAR FROM CURRENT_DATE)
       GROUP BY mes
       ORDER BY mes`,
      [id_usuario]
    ),
    pool.query(
      `SELECT
         l.id_libro, l.titulo, l.autor, l.imagen_url,
         d.fecha_devolucion, d.estado_devuelto
       FROM devoluciones d
       JOIN prestamos p ON d.id_prestamo = p.id_prestamo
       JOIN ejemplares e ON d.id_ejemplar = e.id_ejemplar
       JOIN libros l ON e.id_libro = l.id_libro
       WHERE p.id_usuario = $1
       ORDER BY d.fecha_devolucion DESC
       LIMIT 6`,
      [id_usuario]
    )
  ])

  const porLibro = porLibroResult.rows
  const totalLeidos = porLibro.reduce((acc, r) => acc + parseInt(r.cantidad), 0)
  const interesAcademico = porLibro.map(r => ({
    titulo: r.titulo,
    porcentaje: totalLeidos > 0 ? Math.round((parseInt(r.cantidad) / totalLeidos) * 100) : 0
  }))

  return {
    librosLeidos: totalLeidos,
    prestamosActivos: parseInt(activosResult.rows[0].count),
    reservas: parseInt(reservasResult.rows[0].count),
    sancionado: usuarioResult.rows[0]?.sancionado || false,
    interesAcademico,
    frecuenciaMensual: frecuenciaResult.rows,
    ultimosRecursos: ultimosRecursosResult.rows
  }
}

// ── Dashboard de bibliotecario / admin ──
// Las primeras 9 queries son estadísticas globales que ven tanto
// bibliotecario como admin. Las últimas 3 (usuariosPorRol, sesionesActivas,
// actividadesRecientes) solo se piden si esAdmin=true, para no gastar
// queries de más cuando entra un bibliotecario.

const getStaffDashboardStats = async (esAdmin) => {

  const cacheKey = `staff-dashboard:${esAdmin ? 'admin' : 'biblio'}`
  const cacheado = cacheGet(cacheKey)
  if (cacheado) return cacheado

  const queries = [

    // TOTAL LIBROS
    pool.query(`SELECT COUNT(*) FROM libros WHERE activo = true`),

    // USUARIOS ACTIVOS
    pool.query(`SELECT COUNT(*) FROM usuarios WHERE activo = true`),

    // PRESTAMOS ACTIVOS
    pool.query(`SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'activo'`),

    // VENCIDOS
    pool.query(`SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'vencido'`),

    // DEVUELTOS HOY
    pool.query(`
      SELECT COUNT(*)
      FROM devoluciones
      WHERE fecha_devolucion::date = CURRENT_DATE
    `),

    // RESERVAS
    pool.query(`SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'solicitud_reserva'`),

    // RENOVACIONES PENDIENTES
    pool.query(`SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'solicitud_renovacion'`),

    // PRESTAMOS POR CARRERA
    pool.query(`
      SELECT TRIM(carrera_individual) AS carrera, COUNT(*) AS cantidad
      FROM detalles_prestamos dp
      JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
      JOIN libros l ON e.id_libro = l.id_libro
      CROSS JOIN LATERAL unnest(string_to_array(l.carrera, ',')) AS carrera_individual
      WHERE l.carrera IS NOT NULL AND l.carrera != ''
      GROUP BY TRIM(carrera_individual)
      ORDER BY cantidad DESC
    `),

    // TENDENCIA MENSUAL
    pool.query(`
      SELECT EXTRACT(MONTH FROM fecha_solicitud)::int AS mes, COUNT(*) AS cantidad
      FROM prestamos
      WHERE EXTRACT(YEAR FROM fecha_solicitud) = EXTRACT(YEAR FROM CURRENT_DATE)
      GROUP BY mes
      ORDER BY mes
    `),

    // LIBROS MAS PRESTADOS
    pool.query(`
      SELECT l.id_libro, l.titulo, l.autor, l.imagen_url, COUNT(*) AS total_prestamos
      FROM detalles_prestamos dp
      JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
      JOIN libros l ON e.id_libro = l.id_libro
      GROUP BY l.id_libro, l.titulo, l.autor, l.imagen_url
      ORDER BY total_prestamos DESC
      LIMIT 6
    `)

  ]

  // Solo el admin ve estos 3 paneles extra — se agregan al mismo
  // Promise.all para no pagar un segundo round-trip HTTP.
  if (esAdmin) {
    queries.push(
      // USUARIOS POR ROL
      pool.query(`
        SELECT tu.nombre_tipo AS rol, COUNT(*) AS cantidad
        FROM usuarios u
        JOIN tipo_usuarios tu ON u.id_tipo_usuario = tu.id_tipo_usuario
        WHERE u.activo = true
        GROUP BY tu.nombre_tipo
      `),

      // SESIONES ACTIVAS
      pool.query(`SELECT COUNT(*) FROM sesiones WHERE estado = 'Activo'`),

      // ACTIVIDADES RECIENTES
      pool.query(`
        SELECT ha.id_actividad, ha.tipo_accion, ha.entidad, ha.descripcion, ha.fecha, u.nombre_apellido
        FROM historial_actividades ha
        JOIN usuarios u ON ha.id_usuario = u.id_usuario
        ORDER BY ha.fecha DESC
        LIMIT 10
      `)
    )
  }

  const [
    totalLibrosResult,
    usuariosActivosResult,
    prestamosActivosResult,
    librosVencidosResult,
    devueltosHoyResult,
    reservasPendientesResult,
    renovacionesPendientesResult,
    actividadAreaResult,
    tendenciaResult,
    masPrestadosResult,
    usuariosRolResult,
    sesionesResult,
    actividadesResult
  ] = await Promise.all(queries)

  const actividad = actividadAreaResult.rows
  const totalActividad = actividad.reduce((a, b) => a + Number(b.cantidad), 0)
  const actividadPorArea = actividad.map(item => ({
    area: item.carrera,
    porcentaje: totalActividad > 0 ? Math.round((Number(item.cantidad) / totalActividad) * 100) : 0
  }))

  const libros = masPrestadosResult.rows
  const maxPrestamos = Math.max(...libros.map(x => Number(x.total_prestamos)), 1)
  const librosMasPrestados = libros.map(lib => ({
    ...lib,
    total_prestamos: Number(lib.total_prestamos),
    porcentaje_relativo: Math.round((Number(lib.total_prestamos) / maxPrestamos) * 100)
  }))

  const stats = {
    totalLibros: Number(totalLibrosResult.rows[0].count),
    usuariosActivos: Number(usuariosActivosResult.rows[0].count),
    prestamosActivos: Number(prestamosActivosResult.rows[0].count),
    librosVencidos: Number(librosVencidosResult.rows[0].count),
    librosDevueltosHoy: Number(devueltosHoyResult.rows[0].count),
    reservasPendientes: Number(reservasPendientesResult.rows[0].count),
    renovacionesPendientes: Number(renovacionesPendientesResult.rows[0].count),
    actividadPorArea,
    tendenciaMensual: tendenciaResult.rows.map(x => ({
      mes: Number(x.mes),
      cantidad: Number(x.cantidad)
    })),
    librosMasPrestados
  }

  // Los campos extra solo se agregan (y solo existieron esas 3 queries) si esAdmin
  if (esAdmin) {
    stats.usuariosPorRol = usuariosRolResult.rows.map(x => ({
      rol: x.rol,
      cantidad: Number(x.cantidad)
    }))
    stats.sesionesActivas = Number(sesionesResult.rows[0].count)
    stats.actividadesRecientes = actividadesResult.rows
  }

  cacheSet(cacheKey, stats, STAFF_STATS_TTL_MS)

  return stats
}

module.exports = { getDashboardStats, getStaffDashboardStats }