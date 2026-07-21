const {
  createLoan,
  respondLoanDetail,
  respondLoanDetailsBatch,
  activateLoan,
  cancelLoan,
  getLoans,
  countLoans,
  getLoanById,
  renewLoan,
  approveRenewal,
  rejectRenewal
} = require('../queries/loans.queries')
const { registrarActividad } = require('../queries/activity.queries')

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

    // Puede generarse un préstamo normal, una reserva, o ambos en la misma solicitud
    if (result.prestamo) {
      registrarActividad({
        id_usuario,
        tipo_accion: 'crear',
        entidad: 'prestamos',
        id_entidad: result.prestamo.id_prestamo,
        descripcion: `Solicitó un préstamo (#${result.prestamo.id_prestamo})`
      }).catch(err => console.error('Error al registrar actividad:', err))
    }
    if (result.reserva) {
      registrarActividad({
        id_usuario,
        tipo_accion: 'crear',
        entidad: 'prestamos',
        id_entidad: result.reserva.id_prestamo,
        descripcion: `Solicitó una reserva (#${result.reserva.id_prestamo})`
      }).catch(err => console.error('Error al registrar actividad:', err))
    }
    
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
    const { estado, observaciones } = req.body

    const estadosValidos = ['aprobado', 'rechazado']
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Debe ser aprobado o rechazado' })
    }

    const result = await respondLoanDetail(
      id,
      id_ejemplar,
      estado,
      req.user.id_usuario,
      observaciones
    )

    if (!result) return res.status(404).json({ error: 'Préstamo o ejemplar no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: estado === 'aprobado' ? 'aprobar' : 'rechazar',
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `${estado === 'aprobado' ? 'Aprobó' : 'Rechazó'} el ejemplar #${id_ejemplar} del préstamo #${id}${observaciones ? `: ${observaciones}` : ''}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Respuesta registrada exitosamente', data: result })
  } catch (error) {
    console.error('Error al responder préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Versión en lote: aprueba/rechaza todos los ejemplares de una solicitud en
// una sola petición, evitando disparar N requests en paralelo desde el
// frontend (lo cual saturaba el pool de conexiones bajo concurrencia).
const respondLoanDetailsBatchHandler = async (req, res) => {
  try {
    const { id } = req.params
    const { respuestas } = req.body // [{ id_ejemplar, estado, observaciones }]

    if (!Array.isArray(respuestas) || respuestas.length === 0) {
      return res.status(400).json({ error: 'Debe enviar al menos una respuesta' })
    }

    const estadosValidos = ['aprobado', 'rechazado']
    const invalido = respuestas.find(r => !estadosValidos.includes(r.estado))
    if (invalido) {
      return res.status(400).json({ error: 'Estado inválido. Debe ser aprobado o rechazado' })
    }

    const result = await respondLoanDetailsBatch(id, respuestas, req.user.id_usuario)

    if (!result) return res.status(404).json({ error: 'Préstamo o algún ejemplar no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    const aprobados = respuestas.filter(r => r.estado === 'aprobado').length
    const rechazados = respuestas.filter(r => r.estado === 'rechazado').length

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: aprobados > 0 && rechazados > 0
        ? 'editar'
        : (aprobados > 0 ? 'aprobar' : 'rechazar'),
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Respondió el préstamo #${id}: ${aprobados} ejemplar(es) aprobado(s), ${rechazados} rechazado(s)`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Respuestas registradas exitosamente', data: result })
  } catch (error) {
    console.error('Error al responder préstamo (batch):', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const activateLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const result = await activateLoan(id, req.user.id_usuario)

    if (!result) return res.status(404).json({ error: 'Préstamo no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'activar',
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Activó el préstamo #${id} (entrega física)`
    }).catch(err => console.error('Error al registrar actividad:', err))

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
    
    registrarActividad({
      id_usuario,
      tipo_accion: 'cancelar',
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Canceló el préstamo #${id}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Préstamo cancelado exitosamente', data: result })
  } catch (error) {
    console.error('Error al cancelar préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const { cancelLoanSmart } = require('../queries/loans.queries')

const cancelLoanSmartHandler = async (req, res) => {
  try {
    const { id } = req.params
    const id_usuario = req.user.id_usuario

    const result = await cancelLoanSmart(id, id_usuario)

    if (!result) return res.status(404).json({ error: 'Préstamo no encontrado' })
    if (result.error) return res.status(400).json({ error: result.error })

    // Agregar un nuevo tipo_accion para la cancelacón de una respuesta
    registrarActividad({
      id_usuario,
      tipo_accion: 'cancelar',
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Canceló la respuesta del préstamo #${id}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({
      message: 'Préstamo cancelado correctamente (reversión aplicada)',
      data: result
    })
  } catch (error) {
    console.error('Error al cancelar préstamo smart:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getLoansHandler = async (req, res) => {
  try {
    const { estado, estados, es_reserva, fecha_desde, fecha_hasta, 
      solo_reservas_listas, excluir_pendientes_solicitud, page = 1, limit = 20 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit

    // Usar rolActivo en lugar de rol real
    // Si el rol activo es normal → solo ve los suyos
    // Si el rol activo es bibliotecario o admin → puede ver todos (o filtrar por id_usuario)
    const rolActivo = req.user.rolActivo
    const id_usuario = rolActivo === 'normal'
      ? req.user.id_usuario
      : req.query.id_usuario // puede ser undefined para ver todos

    const esReservaFilter = es_reserva !== undefined ? es_reserva === 'true' : undefined

    // `estados` permite filtrar por varios estados a la vez (ej: las 3 variantes de
    // "solicitud" en la pestaña de Solicitudes), separados por coma: ?estados=a,b,c
    // Si viene vacío o no se envía, no se aplica este filtro (se usa `estado` singular si está).
    const estadosFilter = estados
      ? estados.split(',').map(e => e.trim()).filter(Boolean)
      : undefined

    const filters = {
      id_usuario,
      estado,
      estados: estadosFilter,
      es_reserva: esReservaFilter,
      fecha_desde,
      fecha_hasta,
      solo_reservas_listas: solo_reservas_listas === 'true',
      excluir_pendientes_solicitud: excluir_pendientes_solicitud === 'true', 
      limit: parsedLimit,
      offset
    }

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
    
    registrarActividad({
      id_usuario,
      tipo_accion: 'crear',
      entidad: 'prestamos',
      id_entidad: result.nuevo_prestamo?.id_prestamo || parseInt(id),
      descripcion: `Solicitó renovación del préstamo #${id}`
    }).catch(err => console.error('Error al registrar actividad:', err))

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

const approveRenewalHandler = async (req, res) => {
  try {
    const { id } = req.params
    const result = await approveRenewal(id, req.user.id_usuario)

    if (!result) return res.status(404).json({ error: 'Renovación no encontrada' })
    if (result.error) return res.status(400).json({ error: result.error })

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'aprobar',
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Aprobó la renovación del préstamo #${id}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Renovación aprobada exitosamente', data: result })
  } catch (error) {
    console.error('Error al aprobar renovación:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const rejectRenewalHandler = async (req, res) => {
  try {
    const { id } = req.params
    const result = await rejectRenewal(id, req.user.id_usuario)

    if (!result) return res.status(404).json({ error: 'Renovación no encontrada' })
    if (result.error) return res.status(400).json({ error: result.error })

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'rechazar', 
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Rechazó la renovación del préstamo #${id}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Renovación rechazada', data: result })
  } catch (error) {
    console.error('Error al rechazar renovación:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  createLoanHandler,
  respondLoanDetailHandler,
  respondLoanDetailsBatchHandler,
  activateLoanHandler,
  cancelLoanHandler,
  cancelLoanSmartHandler,
  getLoansHandler,
  getLoanHandler,
  renewLoanHandler,
  approveRenewalHandler,
  rejectRenewalHandler
}