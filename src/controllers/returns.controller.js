const { searchActiveLoans, getAllActiveLoans, getLoanForReturn, registerReturn, getHistorial, countHistorial } = require('../queries/returns.queries')

const getAllActiveLoansHandler = async (req, res) => {
  try {
    const loans = await getAllActiveLoans()
    res.json({ data: loans })
  } catch (error) {
    console.error('Error al obtener préstamos activos:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const searchLoansHandler = async (req, res) => {
  try {
    const { search } = req.query
    if (!search || !search.trim()) {
      return res.status(400).json({ error: 'Ingresá un término de búsqueda' })
    }
    const loans = await searchActiveLoans(search.trim())
    res.json({ data: loans })
  } catch (error) {
    console.error('Error al buscar préstamos:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const loan = await getLoanForReturn(id)
    if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado o no está activo' })
    res.json({ data: loan })
  } catch (error) {
    console.error('Error al obtener préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const registerReturnHandler = async (req, res) => {
  try {
    const { id } = req.params
    const { devoluciones } = req.body
    const id_bibliotecario = req.user.id_usuario

    if (!devoluciones || devoluciones.length === 0) {
      return res.status(400).json({ error: 'Seleccioná al menos un ejemplar para devolver' })
    }

    // Validar que cada devolución tenga los campos necesarios
    const estadosValidos = ['bueno', 'deteriorado', 'danado']
    for (const dev of devoluciones) {
      if (!dev.id_ejemplar) {
        return res.status(400).json({ error: 'Cada devolución debe tener id_ejemplar' })
      }
      if (!estadosValidos.includes(dev.estado_devuelto)) {
        return res.status(400).json({
          error: `Estado inválido: ${dev.estado_devuelto}. Debe ser bueno, deteriorado o danado`
        })
      }
    }

    const result = await registerReturn(id, id_bibliotecario, devoluciones)
    res.json({
      message: result.prestamo_cerrado
        ? 'Todos los ejemplares fueron devueltos. Préstamo cerrado.'
        : `${result.devueltos} ejemplar${result.devueltos > 1 ? 'es' : ''} registrado${result.devueltos > 1 ? 's' : ''}. Quedan ${result.ejemplares_pendientes} pendiente${result.ejemplares_pendientes > 1 ? 's' : ''}.`,
      data: result
    })
  } catch (error) {
    console.error('Error al registrar devolución:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getHistorialHandler = async (req, res) => {
  try {
    const { search, fecha_desde, fecha_hasta, page = 1, limit = 20 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const filters = { search, fecha_desde, fecha_hasta, limit: parsedLimit, offset }

    const [historial, total] = await Promise.all([
      getHistorial(filters),
      countHistorial(filters)
    ])

    res.json({
      data: historial,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener historial:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { searchLoansHandler, getAllActiveLoansHandler, getLoanHandler, registerReturnHandler, getHistorialHandler }
