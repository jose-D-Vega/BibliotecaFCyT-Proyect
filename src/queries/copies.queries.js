const pool = require('../config/db')

// Obtener todos los ejemplares de un libro
const getCopiesByBook = async (id_libro) => {
  const { rows } = await pool.query(
    `SELECT
      e.id_ejemplar,
      e.estado_ejemplar,
      e.id_libro
     FROM ejemplares e
     WHERE e.id_libro = $1
     ORDER BY e.id_ejemplar ASC`,
    [id_libro]
  )
  return rows
}

// Obtener un ejemplar por ID
const getCopyById = async (id_ejemplar) => {
  const { rows } = await pool.query(
    `SELECT
      e.id_ejemplar,
      e.estado_ejemplar,
      e.id_libro,
      l.titulo,
      l.autor
     FROM ejemplares e
     JOIN libros l ON e.id_libro = l.id_libro
     WHERE e.id_ejemplar = $1`,
    [id_ejemplar]
  )
  return rows[0] || null
}

// Agregar un ejemplar a un libro
const createCopy = async (id_libro) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Crear el ejemplar
    const { rows } = await client.query(
      `INSERT INTO ejemplares (estado_ejemplar, id_libro)
       VALUES ('disponible', $1)
       RETURNING *`,
      [id_libro]
    )

    // Actualizar cantidad_ejemplar en libros
    await client.query(
      `UPDATE libros SET cantidad_ejemplar = cantidad_ejemplar + 1
       WHERE id_libro = $1`,
      [id_libro]
    )

    await client.query('COMMIT')
    return rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Agregar múltiples ejemplares a un libro de una vez
const createCopies = async (id_libro, cantidad) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const ejemplares = []
    for (let i = 0; i < cantidad; i++) {
      const { rows } = await client.query(
        `INSERT INTO ejemplares (estado_ejemplar, id_libro)
         VALUES ('disponible', $1)
         RETURNING *`,
        [id_libro]
      )
      ejemplares.push(rows[0])
    }

    await client.query(
      `UPDATE libros SET cantidad_ejemplar = cantidad_ejemplar + $1
       WHERE id_libro = $2`,
      [cantidad, id_libro]
    )

    await client.query('COMMIT')
    return ejemplares
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Actualizar estado de un ejemplar — solo el bibliotecario
const updateCopyStatus = async (id_ejemplar, estado_ejemplar) => {
  const { rows } = await pool.query(
    `UPDATE ejemplares SET estado_ejemplar = $1
     WHERE id_ejemplar = $2
     RETURNING *`,
    [estado_ejemplar, id_ejemplar]
  )
  return rows[0] || null
}

// Dar de baja un ejemplar — descuenta de cantidad_ejemplar en libros
const deleteCopy = async (id_ejemplar) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE ejemplares SET estado_ejemplar = 'eliminado'
       WHERE id_ejemplar = $1
       AND estado_ejemplar NOT IN ('prestado', 'reservado')
       RETURNING *`,
      [id_ejemplar]
    )

    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return null
    }

    // Descontar de cantidad_ejemplar porque ya no está activo
    await client.query(
      `UPDATE libros SET cantidad_ejemplar = cantidad_ejemplar - 1
       WHERE id_libro = $1`,
      [rows[0].id_libro]
    )

    await client.query('COMMIT')
    return rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = { getCopiesByBook, getCopyById, createCopy, createCopies, updateCopyStatus, deleteCopy }