const { getSesiones, countSesiones } = require('../queries/session.queries')

const getSesionesHandler = async (req, res) => {
  try {
    const { id_usuario, fecha_desde, fecha_hasta, page = 1, limit = 50 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const filters = { id_usuario, fecha_desde, fecha_hasta, limit: parsedLimit, offset }

    const [sesiones, total] = await Promise.all([
      getSesiones(filters),
      countSesiones(filters)
    ])

    res.json({
      data: sesiones,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Error al obtener sesiones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getSesionesHandler }