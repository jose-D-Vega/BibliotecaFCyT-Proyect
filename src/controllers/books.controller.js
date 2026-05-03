const { getAllBooks, countBooks, getBookById, createBook, updateBook, deleteBook } = require('../queries/books.queries')
const { registrarActividad } = require('../queries/activity.queries')

const getBooks = async (req, res) => {
  try {
    const { search, tipo_material, carrera } = req.query
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const offset = (page - 1) * limit
    const filters = { search, tipo_material, carrera, limit, offset }

    const [books, total] = await Promise.all([
      getAllBooks(filters),
      countBooks(filters)
    ])

    res.json({
      data: books,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error al obtener libros:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getBook = async (req, res) => {
  try {
    const { id } = req.params
    const book = await getBookById(id)

    if (!book) return res.status(404).json({ error: 'Libro no encontrado' })

    res.json({ data: book })
  } catch (error) {
    console.error('Error al obtener libro:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const createBookHandler = async (req, res) => {
  try {
    const { titulo, autor, cantidad_ejemplar, tipo_material, anio_publicacion, ciudad, facultad, editorial, carrera } = req.body

    if (!titulo || !autor || !cantidad_ejemplar || !tipo_material || !anio_publicacion) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: titulo, autor, cantidad_ejemplar, tipo_material, anio_publicacion' })
    }

    const book = await createBook(req.body)
    res.status(201).json({ message: 'Libro creado exitosamente', data: book })
  } catch (error) {
    console.error('Error al crear libro:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const updateBookHandler = async (req, res) => {
  try {
    const { id } = req.params
    const book = await updateBook(id, req.body)

    if (!book) return res.status(404).json({ error: 'Libro no encontrado o sin cambios' })

    res.json({ message: 'Libro actualizado exitosamente', data: book })
  } catch (error) {
    console.error('Error al actualizar libro:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const deleteBookHandler = async (req, res) => {
  try {
    const { id } = req.params
    const result = await deleteBook(id)

    if (!result) return res.status(404).json({ error: 'Libro no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    /*await registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'eliminar',
      entidad: 'libros',
      id_entidad: parseInt(id),
      descripcion: `Eliminó el libro: ${result.titulo}`
    })*/

    res.json({ message: 'Libro eliminado exitosamente', data: result })
  } catch (error) {
    console.error('Error al eliminar libro:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getBooks, getBook, createBookHandler, updateBookHandler, deleteBookHandler }