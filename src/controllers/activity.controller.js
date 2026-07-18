const { getActividades, countActividades } = require('../queries/activity.queries')

const getActividadesHandler = async (req, res) => {
  try {
    const { id_usuario, tipo_accion, entidad, fecha_desde, fecha_hasta, vista } = req.query

    // vista: 'funcionarios' (acciones de staff sobre el sistema) | 'usuarios' (autogestión:
    // solicitar/cancelar préstamos y renovaciones). Cualquier otro valor no filtra por vista.
    const VISTAS_VALIDAS = ['funcionarios', 'usuarios']
    const vistaFiltro = VISTAS_VALIDAS.includes(vista) ? vista : undefined

    const parsedLimit = parseInt(req.query.limit)
    const parsedPage = parseInt(req.query.page)
    const LIMITE_MAXIMO = 200
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, LIMITE_MAXIMO)
      : 50
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
    const offset = (page - 1) * limit

    const filters = { id_usuario, tipo_accion, entidad, fecha_desde, fecha_hasta, vista: vistaFiltro, limit, offset }

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