const pool = require('../config/db')

// Obtener todos los libros con cantidad de ejemplares disponibles
const getAllBooks = async ({ search, orden, tipo_material, carrera, limit, offset }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE l.activo=TRUE'

  if (search) {
    whereClause += ` AND (l.titulo ILIKE $${paramIndex} OR l.autor ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (tipo_material) {
    whereClause += ` AND l.tipo_material = $${paramIndex}`
    values.push(tipo_material)
    paramIndex++
  }
  

  if (carrera) {
    const listaCarreras = carrera.split(',').map(c => c.trim()).filter(Boolean)
    if (listaCarreras.length > 0) {
      const condiciones = listaCarreras.map((c) => {
        values.push(`%${c}%`)
        const idx = paramIndex++
        return `l.carrera ILIKE $${idx}`
      })
      whereClause += ` AND (${condiciones.join(' OR ')})`
    }
  }

  let orderClause = 'ORDER BY l.titulo ASC' // default

  if (orden === 'ZA') orderClause = 'ORDER BY l.titulo DESC'
  if (orden === 'EJ_DESC') orderClause = 'ORDER BY ejemplares_disponibles DESC'
  if (orden === 'EJ_ASC') orderClause = 'ORDER BY ejemplares_disponibles ASC'

  values.push(limit)
  values.push(offset)

  const query = `
    SELECT
      l.id_libro,
      l.titulo,
      l.autor,
      l.tipo_material,
      l.anio_publicacion,
      l.editorial,
      l.carrera,
      l.facultad,
      l.ciudad,
      l.imagen_url,
      l.cantidad_ejemplar,
      COUNT(e.id_ejemplar) FILTER (WHERE e.estado_ejemplar = 'disponible') AS ejemplares_disponibles
    FROM libros l
    LEFT JOIN ejemplares e ON l.id_libro = e.id_libro
    ${whereClause}
    GROUP BY l.id_libro
    ${orderClause}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `

  const { rows } = await pool.query(query, values)
  return rows
}

// Contar total de libros (para paginación)
const countBooks = async ({ search, tipo_material, carrera }) => {
  const values = []
  let paramIndex = 1
  let whereClause = 'WHERE 1=1'

  if (search) {
    whereClause += ` AND (l.titulo ILIKE $${paramIndex} OR l.autor ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (tipo_material) {
    whereClause += ` AND l.tipo_material = $${paramIndex}`
    values.push(tipo_material)
    paramIndex++
  }
  if (carrera) {
    const listaCarreras = carrera.split(',').map(c => c.trim()).filter(Boolean)
    if (listaCarreras.length > 0) {
      const condiciones = listaCarreras.map((c) => {
        values.push(`%${c}%`)
        const idx = paramIndex++
        return `l.carrera ILIKE $${idx}`
      })
      whereClause += ` AND (${condiciones.join(' OR ')})`
    }
  }

  const query = `SELECT COUNT(*) FROM libros l ${whereClause}`
  const { rows } = await pool.query(query, values)
  return parseInt(rows[0].count)
}

// Obtener un libro por ID con sus ejemplares
const getBookById = async (id_libro) => {
  const bookQuery = `
    SELECT
      l.*,
      COUNT(e.id_ejemplar) FILTER (WHERE e.estado_ejemplar = 'disponible') AS ejemplares_disponibles
    FROM libros l
    LEFT JOIN ejemplares e ON l.id_libro = e.id_libro
    WHERE l.id_libro = $1
    GROUP BY l.id_libro
  `
  const ejemplaresQuery = `
    SELECT id_ejemplar, estado_ejemplar
    FROM ejemplares
    WHERE id_libro = $1
    ORDER BY id_ejemplar ASC
  `

  const [bookResult, ejemplaresResult] = await Promise.all([
    pool.query(bookQuery, [id_libro]),
    pool.query(ejemplaresQuery, [id_libro])
  ])

  if (bookResult.rows.length === 0) return null

  return {
    ...bookResult.rows[0],
    ejemplares: ejemplaresResult.rows
  }
}

// Crear un libro nuevo
const createBook = async ({ titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera, imagen_url }) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO libros (titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera, imagen_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera, imagen_url]
    )

    const libro = rows[0]

    // Crear automáticamente los ejemplares según cantidad_ejemplar
    for (let i = 0; i < cantidad_ejemplar; i++) {
      await client.query(
        `INSERT INTO ejemplares (estado_ejemplar, id_libro) VALUES ('disponible', $1)`,
        [libro.id_libro]
      )
    }

    await client.query('COMMIT')
    return libro
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Actualizar un libro
const updateBook = async (id_libro, fields) => {
  const allowed = ['titulo', 'autor', 'cantidad_ejemplar', 'ciudad', 'facultad', 'tipo_material', 'anio_publicacion', 'editorial', 'carrera', 'imagen_url']
  const updates = []
  const values = []
  let paramIndex = 1

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${paramIndex}`)
      values.push(fields[key])
      paramIndex++
    }
  }

  if (updates.length === 0) return null

  values.push(id_libro)
  const query = `
    UPDATE libros SET ${updates.join(', ')}
    WHERE id_libro = $${paramIndex}
    RETURNING *
  `
  const { rows } = await pool.query(query, values)
  return rows[0]
}

// Eliminar un libro
const deleteBook = async (id_libro) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Verificar si quedaron ejemplares activos (prestados o reservados)
    const { rows: activos } = await client.query(
      `SELECT COUNT(*) FROM ejemplares
       WHERE id_libro = $1 AND estado_ejemplar IN ('prestado', 'reservado')`,
      [id_libro]
    )

    if (parseInt(activos[0].count) > 0) {
      await client.query('ROLLBACK')
      return { error: 'No se puede eliminar el libro. Tiene ejemplares prestados o reservados actualmente' }
    }

    await client.query(
      `UPDATE ejemplares SET estado_ejemplar = 'eliminado'
       WHERE id_libro = $1 AND estado_ejemplar NOT IN ('prestado', 'reservado')`,
      [id_libro]
    )

    const { rows } = await client.query(
      `UPDATE libros SET activo = false
       WHERE id_libro = $1
       RETURNING *`,
      [id_libro]
    )

    await client.query('COMMIT')
    return rows[0] || null
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { getAllBooks, countBooks, getBookById, createBook, updateBook, deleteBook }