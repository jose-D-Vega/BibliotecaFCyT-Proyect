const pool = require('../config/db')

const DIAS_POR_VENCER = 2

const getAdminDashboardStats = async () => {
  const [
    totalLibrosResult,
    usuariosActivosResult,
    prestamosActivosResult,
    librosVencidosResult,
    devueltosHoyResult,
    reservasPendientesResult,
    porAreaResult,
    tendenciaResult,
    masPrestadosResult
  ] = await Promise.all([
    // TOTAL LIBROS
    pool.query(`SELECT COUNT(*) FROM libros WHERE activo = true`),

    // USUARIOS ACTIVOS
    pool.query(`SELECT COUNT(*) FROM usuarios WHERE activo = true`),

    // PRESTAMOS ACTIVOS
    pool.query(`SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'activo'`),

    // VENCIDOS
    pool.query(`SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'vencido'`),

    // DEVUELTOS HOY (Opción A: Fuente de verdad directa de la tabla devoluciones)
    pool.query(`
      SELECT COUNT(*)
      FROM devoluciones
      WHERE fecha_devolucion::date = CURRENT_DATE
    `),

    // RESERVAS
    pool.query(
      `SELECT COUNT(*) FROM prestamos WHERE estado_prestamo = 'solicitud_reserva'`
    ),

    // Distribución de préstamos por carrera
    pool.query(
      `SELECT TRIM(carrera_individual) AS carrera, COUNT(*) AS cantidad
       FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       JOIN libros l ON e.id_libro = l.id_libro
       CROSS JOIN LATERAL unnest(string_to_array(l.carrera, ',')) AS carrera_individual
       WHERE l.carrera IS NOT NULL AND l.carrera != ''
       GROUP BY TRIM(carrera_individual)
       ORDER BY cantidad DESC`
    ),

    // TENDENCIA MENSUAL
    pool.query(
      `SELECT EXTRACT(MONTH FROM fecha_solicitud)::int AS mes, COUNT(*) AS cantidad
       FROM prestamos
       WHERE EXTRACT(YEAR FROM fecha_solicitud) = EXTRACT(YEAR FROM CURRENT_DATE)
       GROUP BY mes
       ORDER BY mes`
    ),

    // LIBROS MÁS PRESTADOS
    pool.query(
      `SELECT l.id_libro, l.titulo, l.autor, l.imagen_url, COUNT(*) AS total_prestamos
       FROM detalles_prestamos dp
       JOIN ejemplares e ON dp.id_ejemplar = e.id_ejemplar
       JOIN libros l ON e.id_libro = l.id_libro
       GROUP BY l.id_libro, l.titulo, l.autor, l.imagen_url
       ORDER BY total_prestamos DESC
       LIMIT 6`
    )
  ])

  const porArea = porAreaResult.rows
  const totalPorArea = porArea.reduce((acc, r) => acc + parseInt(r.cantidad), 0)
  const actividadPorArea = porArea.map(r => ({
    area: r.carrera,
    porcentaje: totalPorArea > 0 ? Math.round((parseInt(r.cantidad) / totalPorArea) * 100) : 0
  }))

  const masPrestados = masPrestadosResult.rows
  const maxPrestamos = Math.max(...masPrestados.map(l => parseInt(l.total_prestamos)), 1)
  const librosMasPrestados = masPrestados.map(l => ({
    ...l,
    total_prestamos: parseInt(l.total_prestamos),
    porcentaje_relativo: Math.round((parseInt(l.total_prestamos) / maxPrestamos) * 100)
  }))

  return {
    totalLibros: parseInt(totalLibrosResult.rows[0].count),
    usuariosActivos: parseInt(usuariosActivosResult.rows[0].count),
    prestamosActivos: parseInt(prestamosActivosResult.rows[0].count),
    librosVencidos: parseInt(librosVencidosResult.rows[0].count),
    librosDevueltosHoy: parseInt(devueltosHoyResult.rows[0].count),
    reservasPendientes: parseInt(reservasPendientesResult.rows[0].count),
    actividadPorArea,
    tendenciaMensual: tendenciaResult.rows,
    librosMasPrestados
  }
}

module.exports = { getAdminDashboardStats }