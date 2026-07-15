const { getActividades, countActividades } = require('../queries/activity.queries')

const getActividadesHandler = async (req, res) => {
  try {
    const { id_usuario, tipo_accion, entidad, fecha_desde, fecha_hasta } = req.query

    const parsedLimit = parseInt(req.query.limit)
    const parsedPage = parseInt(req.query.page)
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
    const offset = (page - 1) * limit

    const filters = { id_usuario, tipo_accion, entidad, fecha_desde, fecha_hasta, limit, offset }

    const [actividades, total] = await Promise.all([
      getActividades(filters),
      countActividades(filters)
    ])

    res.json({
      data: actividades,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error al obtener actividades:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getActividadesHandler }