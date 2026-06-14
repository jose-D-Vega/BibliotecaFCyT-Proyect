const { crearNotificacion } = require('../queries/notifications.queries')

const {
  createSanction, confirmSanction, rejectSanction,
  getSanctions, countSanctions, getSanctionById,
  resolveSanction, escalateSanction, getMySanctions
} = require('../queries/sanctions.queries')

const confirmSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await confirmSanction(id, req.user.id_usuario)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada o ya procesada' })

    await crearNotificacion({
      id_usuario: sancion.id_usuario,
      tipo: 'prestamo_vencido',
      titulo: 'Sanción confirmada',
      mensaje: 'El administrador confirmó tu sanción por falta de entrega. Debés devolver el material para regularizar tu situación.',
      id_prestamo: sancion.id_prestamo
    })

    res.json({ message: 'Sanción confirmada', data: sancion })
  } catch (error) {
    console.error('Error al confirmar sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const rejectSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await rejectSanction(id, req.user.id_usuario)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada o ya procesada' })

    await crearNotificacion({
      id_usuario: sancion.id_usuario,
      tipo: 'renovacion_aprobada',
      titulo: 'Situación regularizada',
      mensaje: 'El administrador revisó tu situación y tus servicios de biblioteca han sido restaurados.',
      id_prestamo: sancion.id_prestamo
    })

    res.json({ message: 'Sanción rechazada, usuario desbloqueado', data: sancion })
  } catch (error) {
    console.error('Error al rechazar sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const createSanctionHandler = async (req, res) => {
  try {
    const {
      id_prestamo, id_ejemplar, id_usuario,
      tipo_infraccion, descripcion_sancion,
      fecha_limite, dias_suspension
    } = req.body

    if (!id_prestamo || !id_ejemplar || !id_usuario || !tipo_infraccion || !descripcion_sancion) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' })
    }

    const tiposValidos = ['devolucion_tardia', 'deterioro', 'perdida', 'comportamiento']
    if (!tiposValidos.includes(tipo_infraccion)) {
      return res.status(400).json({ error: 'Tipo de infracción inválido' })
    }

    if (tipo_infraccion === 'comportamiento' && !dias_suspension) {
      return res.status(400).json({ error: 'Debe especificar los días de suspensión' })
    }

    const sancion = await createSanction({
      id_prestamo, id_ejemplar, id_usuario,
      id_admin: req.user.id_usuario,
      tipo_infraccion, descripcion_sancion,
      fecha_limite, dias_suspension
    })

    // Notificar al usuario
    const tipoLabel = {
      devolucion_tardia: 'devolución tardía',
      deterioro: 'deterioro de material',
      perdida: 'pérdida de material',
      comportamiento: 'comportamiento inadecuado'
    }

    await crearNotificacion({
      id_usuario,
      tipo: 'prestamo_vencido',
      titulo: 'Has recibido una sanción',
      mensaje: `Se registró una sanción por ${tipoLabel[tipo_infraccion]}. ${descripcion_sancion}`,
      id_prestamo
    })

    res.status(201).json({ message: 'Sanción registrada exitosamente', data: sancion })
  } catch (error) {
    console.error('Error al registrar sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getSanctionsHandler = async (req, res) => {
  try {
    const { id_usuario, estado, tipo_infraccion, page = 1, limit = 15 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit

    const [sanctions, total] = await Promise.all([
      getSanctions({ id_usuario, estado, tipo_infraccion, limit: parsedLimit, offset }),
      countSanctions({ id_usuario, estado, tipo_infraccion })
    ])

    res.json({
      data: sanctions,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener sanciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await getSanctionById(id)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada' })
    res.json({ data: sancion })
  } catch (error) {
    console.error('Error al obtener sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const resolveSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await resolveSanction(id, req.user.id_usuario)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada o ya resuelta' })

    // Notificar al usuario
    await crearNotificacion({
      id_usuario: sancion.id_usuario,
      tipo: 'renovacion_aprobada',
      titulo: 'Sanción resuelta',
      mensaje: 'Tu sanción ha sido resuelta. Ya podés volver a utilizar los servicios de la biblioteca.',
      id_prestamo: sancion.id_prestamo
    })

    res.json({ message: 'Sanción resuelta exitosamente', data: sancion })
  } catch (error) {
    console.error('Error al resolver sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const escalateSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await escalateSanction(id)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada o no está activa' })
    res.json({ message: 'Sanción escalada a entidades superiores', data: sancion })
  } catch (error) {
    console.error('Error al escalar sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getMySanctionsHandler = async (req, res) => {
  try {
    const sanctions = await getMySanctions(req.user.id_usuario)
    res.json({ data: sanctions })
  } catch (error) {
    console.error('Error al obtener mis sanciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  createSanctionHandler, confirmSanctionHandler, rejectSanctionHandler,
  getSanctionsHandler, getSanctionHandler,
  resolveSanctionHandler, escalateSanctionHandler, getMySanctionsHandler
}