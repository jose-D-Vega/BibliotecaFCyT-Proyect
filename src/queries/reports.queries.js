const pool = require('../config/db')
const { REPORT_ENTITIES } = require('../config/reports.config')

// Búsqueda liviana de usuarios para los filtros de tipo "buscar usuario" del frontend.
// Query propia (no reutiliza getAllUsers) porque acá también necesitamos buscar por CI,
const buscarUsuariosParaFiltro = async (search) => {
  if (!search || search.trim().length < 2) return []

  const { rows } = await pool.query(
    `SELECT id_usuario, nombre_apellido, correo, ci
     FROM usuarios
     WHERE nombre_apellido ILIKE $1 OR correo ILIKE $1 OR ci ILIKE $1
     ORDER BY nombre_apellido ASC
     LIMIT 10`,
    [`%${search}%`]
  )
  return rows
}

// Búsqueda liviana de libros para el filtro "buscar libro" (título o autor),
// usado en el reporte de ejemplares en vez de tener que conocer el id_libro de memoria.
const buscarLibrosParaFiltro = async (search) => {
  if (!search || search.trim().length < 2) return []
 
  const { rows } = await pool.query(
    `SELECT id_libro, titulo, autor, tipo_material
     FROM libros
     WHERE titulo ILIKE $1 OR autor ILIKE $1
     ORDER BY titulo ASC
     LIMIT 10`,
    [`%${search}%`]
  )
  return rows
}

const construirReporte = async ({ entidad, columnas, filtros, extensiones, orden_por, orden_dir }) => {
  const config = REPORT_ENTITIES[entidad]
  if (!config) throw new Error(`Entidad de reporte desconocida: ${entidad}`)

  // Extensiones válidas para esta entidad (whitelist): agregan joins + columnas + filtros extra
  const extensionesValidas = (extensiones || []).filter(e => config.extensiones?.[e])

  let joinsExtra = ''
  let columnsDisponibles = { ...config.columns }
  let filtersDisponibles = { ...config.filters }

  for (const extKey of extensionesValidas) {
    const ext = config.extensiones[extKey]
    joinsExtra += ` ${ext.joinClause}`
    columnsDisponibles = { ...columnsDisponibles, ...ext.columns }
    filtersDisponibles = { ...filtersDisponibles, ...(ext.filters || {}) }
  }

  // Whitelist de columnas (incluyendo las de extensiones activas)
  const columnasValidas = Object.keys(columnsDisponibles)
  const columnasSeleccionadas = (columnas && columnas.length > 0)
    ? columnas.filter(c => columnasValidas.includes(c))
    : columnasValidas

  if (columnasSeleccionadas.length === 0) {
    throw new Error('Ninguna columna válida fue seleccionada para este reporte')
  }

  const selectClause = columnasSeleccionadas
    .map(c => `${columnsDisponibles[c].expr} AS ${c}`)
    .join(', ')

  // WHERE dinámico, solo con filtros presentes en config o en extensiones activas
  const values = []
  const conditions = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(filtros || {})) {
    const esVacio = value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)
    if (esVacio) continue

    const filterConfig = filtersDisponibles[key]
    if (!filterConfig) continue

    if (filterConfig.op === '<_dia_completo') {
      conditions.push(`${filterConfig.expr} < ($${paramIndex}::date + interval '1 day')`)
      values.push(value)
      paramIndex++
    } else if (filterConfig.op === 'ILIKE_ANY') {
      // Soporta selección múltiple: el valor puede venir como string único
      // (un solo checkbox marcado) o como array (varios), gracias a que Express
      // parsea automáticamente parámetros de query repetidos (?carrera=a&carrera=b) como array.
      const valores = Array.isArray(value) ? value : [value]
      const subCondiciones = valores
        .filter(v => v !== undefined && v !== null && v !== '')
        .map(v => {
          values.push(`%${v}%`)
          return `${filterConfig.expr} ILIKE $${paramIndex++}`
        })
      if (subCondiciones.length > 0) conditions.push(`(${subCondiciones.join(' OR ')})`)
    } else {
      conditions.push(`${filterConfig.expr} ${filterConfig.op} $${paramIndex}`)
      values.push(value)
      paramIndex++
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Orden: solo se permite ordenar por una columna que esté realmente disponible
  // (whitelist otra vez — nunca se interpola el nombre de columna que manda el cliente sin validar)
  let ordenClause = config.defaultOrder
  if (orden_por && columnsDisponibles[orden_por]) {
    const direccion = orden_dir === 'DESC' ? 'DESC' : 'ASC'
    ordenClause = `${columnsDisponibles[orden_por].expr} ${direccion}`
  }

  const query = `
    SELECT ${selectClause}
    ${config.baseQuery}
    ${joinsExtra}
    ${whereClause}
    ORDER BY ${ordenClause}
  `

  const { rows } = await pool.query(query, values)

  return {
    columnas: columnasSeleccionadas.map(c => ({ key: c, label: columnsDisponibles[c].label })),
    filas: rows
  }
}

const getEntidadesDisponibles = () => {
  return Object.entries(REPORT_ENTITIES).map(([key, config]) => ({
    key,
    label: config.label,
    columnas: Object.entries(config.columns).map(([ck, cv]) => ({ key: ck, label: cv.label })),
    filtros: Object.keys(config.filters),
    extensiones: config.extensiones
      ? Object.entries(config.extensiones).map(([ek, ev]) => ({
          key: ek,
          label: ev.label,
          columnas: Object.entries(ev.columns).map(([ck, cv]) => ({ key: ck, label: cv.label })),
          filtros: Object.keys(ev.filters || {})
        }))
      : []
  }))
}


module.exports = { construirReporte, getEntidadesDisponibles, buscarUsuariosParaFiltro, buscarLibrosParaFiltro }