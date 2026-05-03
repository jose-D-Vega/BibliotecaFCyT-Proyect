const { getActividades, countActividades } = require('../queries/activity.queries')

const getActividadesHandler = async (req, res) => {
  try {
    const { id_usuario, tipo_accion, entidad, page = 1, limit = 50 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const filters = { id_usuario, tipo_accion, entidad, limit: parsedLimit, offset }

    const [actividades, total] = await Promise.all([
      getActividades(filters),
      countActividades(filters)
    ])

    res.json({
      data: actividades,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Error al obtener actividades:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getActividadesHandler }