const pool = require('../config/db')
const { REPORT_ENTITIES } = require('../config/reports.config')

// Búsqueda liviana de usuarios para los filtros de tipo "buscar usuario" del frontend.
// Query propia (no reutiliza getAllUsers) porque acá también necesitamos buscar por CI,
const buscarUsuariosParaFiltro = async (search, soloStaff) => {
  if (!search || search.trim().length < 2) return []

  const filtroRol = soloStaff
    ? `AND tu.nombre_tipo IN ('bibliotecario', 'admin')`
    : ''

  const { rows } = await pool.query(
    `SELECT u.id_usuario, u.nombre_apellido, u.correo, u.ci
     FROM usuarios u
     JOIN tipo_usuarios tu ON tu.id_tipo_usuario = u.id_tipo_usuario
     WHERE (u.nombre_apellido ILIKE $1 OR u.correo ILIKE $1 OR u.ci ILIKE $1) ${filtroRol}
     ORDER BY u.nombre_apellido ASC
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
    } else if (filterConfig.op === 'IN_ANY') {
      const valores = Array.isArray(value) ? value : [value]
      const validos = valores.filter(v => v !== undefined && v !== null && v !== '')
      if (validos.length === 0) continue

      const placeholders = validos.map(v => {
        values.push(v)
        return `$${paramIndex++}`
      })
      conditions.push(`${filterConfig.expr} IN (${placeholders.join(', ')})`)
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

const getEntidadesDisponibles = (rol) => {

  let entidades = Object.entries(REPORT_ENTITIES)

if (rol === 'bibliotecario') {
  entidades = entidades.filter(([key]) =>
    [
      'usuarios',
      'prestamos',
      'devoluciones',
      'libros',
      'ejemplares',
      'sanciones',
      'detalles_prestamos'
    ].includes(key)
  )
}


  return entidades.map(([key, config]) => ({
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