const {
  getCopiesByBook,
  getCopyById,
  createCopy,
  createCopies,
  updateCopyStatus,
  deleteCopy
} = require('../queries/copies.queries')
const { isValidId } = require('../utils/validators')

const getCopies = async (req, res) => {
  try {
    const { id_libro } = req.params
    if (!isValidId(id_libro)) {
      return res.status(400).json({ error: 'El id del libro debe ser un número entero válido' })
    }
    const copies = await getCopiesByBook(id_libro)
    res.json({ data: copies })
  } catch (error) {
    console.error('Error al obtener ejemplares:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getCopy = async (req, res) => {
  try {
    const { id } = req.params
    if (!isValidId(id)) {
      return res.status(400).json({ error: 'El id del ejemplar debe ser un número entero válido' })
    }
    const copy = await getCopyById(id)
    if (!copy) return res.status(404).json({ error: 'Ejemplar no encontrado' })
    res.json({ data: copy })
  } catch (error) {
    console.error('Error al obtener ejemplar:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const addCopy = async (req, res) => {
  try {
    const { id_libro } = req.params
    const { cantidad } = req.body

    let result
    if (!isValidId(id_libro)) {
      return res.status(400).json({ error: 'El id del libro debe ser un número entero válido' })
    }
    if (cantidad && cantidad > 1) {
      if (cantidad > 50) {
        return res.status(400).json({ error: 'No se pueden agregar más de 50 ejemplares a la vez' })
      }
      result = await createCopies(id_libro, cantidad)
      return res.status(201).json({
        message: `${cantidad} ejemplares agregados exitosamente`,
        data: result
      })
    }

    result = await createCopy(id_libro)
    res.status(201).json({ message: 'Ejemplar agregado exitosamente', data: result })
  } catch (error) {
    console.error('Error al agregar ejemplar:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const updateStatus = async (req, res) => {
  try {
    const { id } = req.params
    if (!isValidId(id)) {
      return res.status(400).json({ error: 'El id del ejemplar debe ser un número entero válido' })
    }
    const { estado_ejemplar } = req.body

    if (!estado_ejemplar) {
      return res.status(400).json({ error: 'El campo estado_ejemplar es requerido' })
    }

    // No permitir cambio manual si está prestado o reservado
    const copy = await getCopyById(id)
    if (!copy) return res.status(404).json({ error: 'Ejemplar no encontrado' })

    if (['prestado', 'reservado'].includes(copy.estado_ejemplar)) {
      return res.status(400).json({
        error: `No se puede cambiar el estado manualmente. El ejemplar está ${copy.estado_ejemplar}`
      })
    }

    const updated = await updateCopyStatus(id, estado_ejemplar)
    res.json({ message: 'Estado actualizado exitosamente', data: updated })
  } catch (error) {
    console.error('Error al actualizar estado:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const removeCopy = async (req, res) => {
  try {
    const { id } = req.params
    if (!isValidId(id)) {
      return res.status(400).json({ error: 'El id del ejemplar debe ser un número entero válido' })
    }

    // No permitir dar de baja si está prestado o reservado
    const copy = await getCopyById(id)
    if (!copy) return res.status(404).json({ error: 'Ejemplar no encontrado' })

    if (['prestado', 'reservado'].includes(copy.estado_ejemplar)) {
      return res.status(400).json({
        error: `No se puede dar de baja el ejemplar. Está ${copy.estado_ejemplar} actualmente`
      })
    }

    const deleted = await deleteCopy(id)
    res.json({ message: 'Ejemplar dado de baja exitosamente', data: deleted })
  } catch (error) {
    console.error('Error al dar de baja ejemplar:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getCopies, getCopy, addCopy, updateStatus, removeCopy }