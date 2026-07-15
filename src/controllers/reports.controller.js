const { construirReporte, getEntidadesDisponibles } = require('../queries/reports.queries')

// Le dice al frontend qué entidades, columnas y filtros existen, para armar los botones dinámicamente
const getConfigReportesHandler = (req, res) => {
  res.json({ entidades: getEntidadesDisponibles() })
}

const generarReporteHandler = async (req, res) => {
  try {
    const { entidad, columnas, ...filtros } = req.query
    if (!entidad) return res.status(400).json({ error: 'Debe especificar una entidad' })

    const columnasArray = columnas ? columnas.split(',') : []
    const reporte = await construirReporte({ entidad, columnas: columnasArray, filtros })

    res.json({
      data: reporte,
      metadata: {
        entidad,
        filtros_aplicados: filtros,
        fecha_generado: new Date().toISOString(),
        generado_por: req.user.id_usuario
      }
    })
  } catch (error) {
    console.error('Error al generar reporte:', error)
    res.status(400).json({ error: error.message || 'Error al generar el reporte' })
  }
}

module.exports = { getConfigReportesHandler, generarReporteHandler }