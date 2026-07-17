const { construirReporte, getEntidadesDisponibles, buscarUsuariosParaFiltro } = require('../queries/reports.queries')

const getConfigReportesHandler = (req, res) => {
  res.json({ entidades: getEntidadesDisponibles() })
}

const generarReporteHandler = async (req, res) => {
  try {
    const { entidad, columnas, extensiones, orden_por, orden_dir, ...filtros } = req.query
    if (!entidad) return res.status(400).json({ error: 'Debe especificar una entidad' })

    const columnasArray = columnas ? columnas.split(',') : []
    const extensionesArray = extensiones ? extensiones.split(',') : []

    const reporte = await construirReporte({
      entidad,
      columnas: columnasArray,
      filtros,
      extensiones: extensionesArray,
      orden_por,
      orden_dir
    })

    res.json({
      data: reporte,
      metadata: {
        entidad,
        extensiones_aplicadas: extensionesArray,
        filtros_aplicados: filtros,
        orden: orden_por ? { columna: orden_por, direccion: orden_dir === 'DESC' ? 'DESC' : 'ASC' } : null,
        fecha_generado: new Date().toISOString(),
        generado_por: req.user.id_usuario
      }
    })
  } catch (error) {
    console.error('Error al generar reporte:', error)
    res.status(400).json({ error: error.message || 'Error al generar el reporte' })
  }
}

const buscarUsuarioHandler = async (req, res) => {
  try {
    const { q } = req.query
    const usuarios = await buscarUsuariosParaFiltro(q)
    res.json({ data: usuarios })
  } catch (error) {
    console.error('Error al buscar usuarios:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getConfigReportesHandler, generarReporteHandler, buscarUsuarioHandler }