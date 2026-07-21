const pool = require('../config/db')

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

module.exports = { getDashboardStats }