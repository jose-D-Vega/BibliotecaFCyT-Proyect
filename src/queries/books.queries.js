const pool = require('../config/db')

// Obtener todos los libros con cantidad de ejemplares disponibles
const getAllBooks = async ({ search, tipo_material, carrera, limit, offset }) => {
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
    whereClause += ` AND l.carrera = $${paramIndex}`
    values.push(carrera)
    paramIndex++
  }

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
      l.cantidad_ejemplar,
      COUNT(e.id_ejemplar) FILTER (WHERE e.estado_ejemplar = 'disponible') AS ejemplares_disponibles
    FROM libros l
    LEFT JOIN ejemplares e ON l.id_libro = e.id_libro
    ${whereClause}
    GROUP BY l.id_libro
    ORDER BY l.titulo ASC
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
    whereClause += ` AND (titulo ILIKE $${paramIndex} OR autor ILIKE $${paramIndex})`
    values.push(`%${search}%`)
    paramIndex++
  }
  if (tipo_material) {
    whereClause += ` AND tipo_material = $${paramIndex}`
    values.push(tipo_material)
    paramIndex++
  }
  if (carrera) {
    whereClause += ` AND carrera = $${paramIndex}`
    values.push(carrera)
    paramIndex++
  }

  const query = `SELECT COUNT(*) FROM libros ${whereClause}`
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
const createBook = async ({ titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera }) => {
  const query = `
    INSERT INTO libros (titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `
  const values = [titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera]
  const { rows } = await pool.query(query, values)
  return rows[0]
}

// Actualizar un libro
const updateBook = async (id_libro, fields) => {
  const allowed = ['titulo', 'autor', 'cantidad_ejemplar', 'ciudad', 'facultad', 'tipo_material', 'anio_publicacion', 'editorial', 'carrera']
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
  const query = `DELETE FROM libros WHERE id_libro = $1 RETURNING *`
  const { rows } = await pool.query(query, [id_libro])
  return rows[0]
}

module.exports = { getAllBooks, countBooks, getBookById, createBook, updateBook, deleteBook }