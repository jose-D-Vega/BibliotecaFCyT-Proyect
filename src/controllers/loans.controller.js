const {
  createLoan,
  respondLoanDetail,
  activateLoan,
  cancelLoan,
  getLoans,
  countLoans,
  getLoanById,
  renewLoan
} = require('../queries/loans.queries')

const createLoanHandler = async (req, res) => {
  try {
    const { items } = req.body
    const id_usuario = req.user.id_usuario

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío' })
    }

    // Validar estructura de cada item
    for (const item of items) {
      if (!item.id_libro || !item.cantidad || item.cantidad < 1) {
        return res.status(400).json({
          error: 'Cada item debe tener id_libro y cantidad mayor a 0'
        })
      }
    }

    const result = await createLoan(id_usuario, items)

    if (result.error) return res.status(400).json({ error: result.error })

    res.status(201).json({
      message: 'Solicitud creada exitosamente',
      data: result,
      ...(result.advertencias && { advertencias: result.advertencias })
    })
  } catch (error) {
    console.error('Error al crear préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const respondLoanDetailHandler = async (req, res) => {
  try {
    const { id, id_ejemplar } = req.params
    const { estado } = req.body

    const estadosValidos = ['aprobado', 'rechazado']
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Debe ser aprobado o rechazado' })
    }

    const result = await respondLoanDetail(id, id_ejemplar, estado, req.user.id_usuario)

    if (!result) return res.status(404).json({ error: 'Préstamo o ejemplar no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    res.json({ message: 'Respuesta registrada exitosamente', data: result })
  } catch (error) {
    console.error('Error al responder préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const activateLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const result = await activateLoan(id)

    if (!result) return res.status(404).json({ error: 'Préstamo no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    res.json({ message: 'Préstamo activado exitosamente', data: result })
  } catch (error) {
    console.error('Error al activar préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const cancelLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const id_usuario = req.user.id_usuario
    const result = await cancelLoan(id, id_usuario)

    if (!result) return res.status(404).json({ error: 'Préstamo no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    res.json({ message: 'Préstamo cancelado exitosamente', data: result })
  } catch (error) {
    console.error('Error al cancelar préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getLoansHandler = async (req, res) => {
  try {
    const { estado, es_reserva, page = 1, limit = 20 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit

    // Usuario normal solo ve sus propios préstamos
    const id_usuario = req.user.rol === 'normal' ? req.user.id_usuario : req.query.id_usuario

    const esReservaFilter = es_reserva !== undefined ? es_reserva === 'true' : undefined
    const filters = { id_usuario, estado, es_reserva: esReservaFilter, limit: parsedLimit, offset }

    const [loans, total] = await Promise.all([
      getLoans(filters),
      countLoans(filters)
    ])

    res.json({
      data: loans,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Error al obtener préstamos:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const loan = await getLoanById(id)

    if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' })

    // Usuario normal solo puede ver sus propios préstamos
    if (req.user.rol === 'normal' && loan.id_usuario !== req.user.id_usuario) {
      return res.status(403).json({ error: 'No tenés permiso para ver este préstamo' })
    }

    res.json({ data: loan })
  } catch (error) {
    console.error('Error al obtener préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const renewLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const id_usuario = req.user.id_usuario
    const result = await renewLoan(id, id_usuario)

    if (!result) return res.status(404).json({ error: 'Préstamo no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    res.json({
      message: 'Solicitud de renovación enviada',
      data: {
        prestamo_original: result.prestamo_original,
        nuevo_prestamo: result.nuevo_prestamo
      }
    })
  } catch (error) {
    console.error('Error al renovar préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  createLoanHandler,
  respondLoanDetailHandler,
  activateLoanHandler,
  cancelLoanHandler,
  getLoansHandler,
  getLoanHandler,
  renewLoanHandler
}