const { searchActiveLoans, getAllActiveLoans, getLoanForReturn, registerReturn, getHistorial,
   countHistorial, getPrestamosConDevoluciones, countPrestamosConDevoluciones, 
   getDetalleDevoluciones, getDevolucionesUsuario, countDevolucionesUsuario,
  reassignReservation, recuperarEjemplarPerdido, reemplazarEjemplarPerdido,
  rejectReservaItemSinSustituto, getPrestamoOwner } = require('../queries/returns.queries')
const { registrarActividad } = require('../queries/activity.queries')

const getAllActiveLoansHandler = async (req, res) => {
  try {
    const loans = await getAllActiveLoans()
    res.json({ data: loans })
  } catch (error) {
    console.error('Error al obtener préstamos activos:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const searchLoansHandler = async (req, res) => {
  try {
    const { search } = req.query
    if (!search || !search.trim()) {
      return res.status(400).json({ error: 'Ingresá un término de búsqueda' })
    }
    const loans = await searchActiveLoans(search.trim())
    res.json({ data: loans })
  } catch (error) {
    console.error('Error al buscar préstamos:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getLoanHandler = async (req, res) => {
  try {
    const { id } = req.params
    const loan = await getLoanForReturn(id)
    if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado o no está activo' })
    res.json({ data: loan })
  } catch (error) {
    console.error('Error al obtener préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const registerReturnHandler = async (req, res) => {
  try {
    const { id } = req.params
    const { devoluciones } = req.body

    if (!Array.isArray(devoluciones) || devoluciones.length === 0) {
      return res.status(400).json({ error: 'Debe especificar al menos un ejemplar a devolver' })
    }

    // Validar que cada devolución tenga los campos necesarios
    const estadosValidos = ['bueno', 'deteriorado', 'danado']
    for (const dev of devoluciones) {
      if (!dev.id_ejemplar) {
        return res.status(400).json({ error: 'Cada devolución debe tener id_ejemplar' })
      }
      if (!estadosValidos.includes(dev.estado_devuelto)) {
        return res.status(400).json({
          error: `Estado inválido: ${dev.estado_devuelto}. Debe ser bueno, deteriorado o danado`
        })
      }
    }

    const resultado = await registerReturn(id, req.user.id_usuario, devoluciones)

    let mensaje = 'Devolución registrada exitosamente'
    if (resultado.reservas_afectadas.length > 0) {
      mensaje += '. Hay reservas afectadas por ejemplares dañados/perdidos que requieren tu confirmación.'
    }

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'devolver',
      entidad: 'prestamos',
      id_entidad: parseInt(id),
      descripcion: `Registró la devolución de ${devoluciones.length} ejemplar(es) del préstamo #${id}${resultado.prestamo_cerrado ? ' (préstamo cerrado)' : ' (quedan ejemplares pendientes)'}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: mensaje, data: resultado })
  } catch (error) {
    console.error('Error al registrar devolución:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Confirmar (o rechazar) la reasignación de un ejemplar sustituto a una reserva
// cuyo ejemplar original volvió dañado/perdido
// Confirmar (reasignar sustituto) o descartar definitivamente (rechazar ese
// ítem de la reserva) un ejemplar afectado que volvió dañado/perdido
const resolveReservaAfectadaHandler = async (req, res) => {
  try {
    const { id_prestamo, id_ejemplar_anterior } = req.params
    const { id_ejemplar_nuevo, accion, motivo } = req.body // accion: 'reasignar' | 'descartar'

    if (!['reasignar', 'descartar'].includes(accion)) {
      return res.status(400).json({ error: 'Acción inválida' })
    }

    if (accion === 'descartar') {
      const resultado = await rejectReservaItemSinSustituto(
        id_prestamo, id_ejemplar_anterior, req.user.id_usuario, motivo
      )
      if (resultado.error) return res.status(409).json({ error: resultado.error })

      registrarActividad({
        id_usuario: req.user.id_usuario,
        tipo_accion: 'editar',
        entidad: 'prestamos',
        id_entidad: parseInt(id_prestamo),
        descripcion: `Descartó el ejemplar #${id_ejemplar_anterior} de la reserva del préstamo #${id_prestamo} (sin sustituto disponible)`
      }).catch(err => console.error('Error al registrar actividad:', err))

      return res.json({ message: 'Ítem descartado de la reserva y usuario notificado', data: resultado })
    }

    if (!id_ejemplar_nuevo) {
      return res.status(400).json({ error: 'Debe indicar el ejemplar sustituto' })
    }

    const resultado = await reassignReservation(id_prestamo, id_ejemplar_anterior, id_ejemplar_nuevo)
    if (resultado.error) return res.status(409).json({ error: resultado.error })

    registrarActividad({
      id_usuario: req.user.id_usuario,
      tipo_accion: 'editar',
      entidad: 'prestamos',
      id_entidad: parseInt(id_prestamo),
      descripcion: `Reasignó la reserva del préstamo #${id_prestamo} al ejemplar #${id_ejemplar_nuevo}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Reserva reasignada al ejemplar sustituto', data: resultado })
  } catch (error) {
    console.error('Error al resolver reserva afectada:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getHistorialHandler = async (req, res) => {
  try {
    const { search, fecha_desde, fecha_hasta, page = 1, limit = 20 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const filters = { search, fecha_desde, fecha_hasta, limit: parsedLimit, offset }

    const [historial, total] = await Promise.all([
      getHistorial(filters),
      countHistorial(filters)
    ])

    res.json({
      data: historial,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener historial:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getPrestamosConDevolucionesHandler = async (req, res) => {
  try {
    const { search, fecha_desde, fecha_hasta, id_bibliotecario, page = 1, limit = 12 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const filters = { search, fecha_desde, fecha_hasta, id_bibliotecario, limit: parsedLimit, offset }

    const [prestamos, total] = await Promise.all([
      getPrestamosConDevoluciones(filters),
      countPrestamosConDevoluciones(filters)
    ])

    res.json({
      data: prestamos,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener préstamos con devoluciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getDetalleDevolucionesHandler = async (req, res) => {
  try {
    const { id } = req.params
    const data = await getDetalleDevoluciones(id)
    res.json({ data })
  } catch (error) {
    console.error('Error al obtener detalle:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getDevolucionesUsuarioHandler = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario
    const { search, fecha_desde, fecha_hasta, page = 1, limit = 12 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit
    const filters = { id_usuario, search, fecha_desde, fecha_hasta, limit: parsedLimit, offset }

    const [devoluciones, total] = await Promise.all([
      getDevolucionesUsuario(filters),
      countDevolucionesUsuario(filters)
    ])

    res.json({
      data: devoluciones,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener devoluciones del usuario:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const recuperarEjemplarPerdidoHandler = async (req, res) => {
  try {
    const { id_prestamo, id_ejemplar } = req.params
    const { estado_devuelto, observaciones } = req.body
    const id_bibliotecario = req.user.id_usuario

    if (!estado_devuelto) {
      return res.status(400).json({ error: 'El estado de devolución es requerido' })
    }

    const resultado = await recuperarEjemplarPerdido(
      id_prestamo, id_ejemplar, id_bibliotecario,
      { estado_devuelto, observaciones }
    )

    registrarActividad({
      id_usuario: id_bibliotecario,
      tipo_accion: 'devolver',
      entidad: 'ejemplares',
      id_entidad: parseInt(id_ejemplar),
      descripcion: `Registró la recuperación del ejemplar #${id_ejemplar} (préstamo #${id_prestamo}) como ${estado_devuelto}${resultado.prestamo_cerrado ? ' (préstamo cerrado)' : ''}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Ejemplar recuperado registrado', data: resultado })
  } catch (error) {
    if (error.code === 'EJEMPLAR_NO_PERDIDO') {
      return res.status(400).json({ error: error.message })
    }
    console.error('Error al recuperar ejemplar:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const reemplazarEjemplarPerdidoHandler = async (req, res) => {
  try {
    const { id_prestamo, id_ejemplar } = req.params
    const id_bibliotecario = req.user.id_usuario

    const resultado = await reemplazarEjemplarPerdido(id_prestamo, id_ejemplar, id_bibliotecario)

    registrarActividad({
      id_usuario: id_bibliotecario,
      tipo_accion: 'editar',
      entidad: 'ejemplares',
      id_entidad: parseInt(id_ejemplar),
      descripcion: `Registró el reemplazo del ejemplar perdido #${id_ejemplar} (préstamo #${id_prestamo})${resultado.prestamo_cerrado ? ' (préstamo cerrado)' : ''}`
    }).catch(err => console.error('Error al registrar actividad:', err))

    res.json({ message: 'Reemplazo registrado', data: resultado })
  } catch (error) {
    if (error.code === 'EJEMPLAR_NO_PERDIDO') {
      return res.status(400).json({ error: error.message })
    }
    console.error('Error al registrar reemplazo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getDetalleDevolucionUsuarioHandler = async (req, res) => {
  try {
    const { id } = req.params
    const id_usuario = req.user.id_usuario

    const propietario = await getPrestamoOwner(id)
    if (!propietario) {
      return res.status(404).json({ error: 'Préstamo no encontrado' })
    }
    if (propietario !== id_usuario) {
      return res.status(403).json({ error: 'No tenés permiso para ver este préstamo' })
    }

    const data = await getDetalleDevoluciones(id)
    res.json({ data })
  } catch (error) {
    console.error('Error al obtener detalle del usuario:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { searchLoansHandler, getAllActiveLoansHandler, 
  getLoanHandler, registerReturnHandler, 
  getHistorialHandler, getPrestamosConDevolucionesHandler, 
  getDetalleDevolucionesHandler, getDevolucionesUsuarioHandler,
  resolveReservaAfectadaHandler, recuperarEjemplarPerdidoHandler, 
  reemplazarEjemplarPerdidoHandler, getDetalleDevolucionUsuarioHandler }
