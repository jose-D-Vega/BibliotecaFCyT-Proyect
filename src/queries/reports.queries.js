const pool = require('../config/db')
const { REPORT_ENTITIES } = require('../config/reports.config')

const construirReporte = async ({ entidad, columnas, filtros }) => {
  const config = REPORT_ENTITIES[entidad]
  if (!config) throw new Error(`Entidad de reporte desconocida: ${entidad}`)

  // Whitelist de columnas: si no se especifican, se devuelven todas las disponibles
  const columnasValidas = Object.keys(config.columns)
  const columnasSeleccionadas = (columnas && columnas.length > 0)
    ? columnas.filter(c => columnasValidas.includes(c))
    : columnasValidas

  if (columnasSeleccionadas.length === 0) {
    throw new Error('Ninguna columna válida fue seleccionada para este reporte')
  }

  const selectClause = columnasSeleccionadas
    .map(c => `${config.columns[c].expr} AS ${c}`)
    .join(', ')

  // WHERE dinámico, pero SOLO con filtros que existen en la config (whitelist real, no interpolación libre)
  const values = []
  const conditions = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(filtros || {})) {
    if (value === undefined || value === null || value === '') continue
    const filterConfig = config.filters[key]
    if (!filterConfig) continue // filtro no reconocido para esta entidad: se ignora silenciosamente

    if (filterConfig.op === '<_dia_completo') {
      conditions.push(`${filterConfig.expr} < ($${paramIndex}::date + interval '1 day')`)
    } else {
      conditions.push(`${filterConfig.expr} ${filterConfig.op} $${paramIndex}`)
    }
    values.push(value)
    paramIndex++
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const query = `
    SELECT ${selectClause}
    ${config.baseQuery}
    ${whereClause}
    ORDER BY ${config.defaultOrder}
  `

  const { rows } = await pool.query(query, values)

  return {
    columnas: columnasSeleccionadas.map(c => ({ key: c, label: config.columns[c].label })),
    filas: rows
  }
}

const getEntidadesDisponibles = () => {
  return Object.entries(REPORT_ENTITIES).map(([key, config]) => ({
    key,
    label: config.label,
    columnas: Object.entries(config.columns).map(([ck, cv]) => ({ key: ck, label: cv.label })),
    filtros: Object.keys(config.filters)
  }))
}

module.exports = { construirReporte, getEntidadesDisponibles }