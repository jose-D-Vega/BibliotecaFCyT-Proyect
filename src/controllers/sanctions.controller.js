const { crearNotificacion } = require('../queries/notifications.queries')

const {
  createSanction, confirmSanction, rejectSanction,
  getSanctions, countSanctions, getSanctionById,
  resolveSanction, escalateSanction, getMySanctions, desescalateSanction, 
  getSanctionsGroupedByLoan, countSanctionsGrouped, getSanctionsByLoan,
  searchSanctionableLoans, getLoanWithEjemplaresForSanction,
  getSancionesComportamientoAgrupadas, countSancionesComportamientoAgrupadas,
  getSancionesComportamientoByUsuario
} = require('../queries/sanctions.queries')

const confirmSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await confirmSanction(id, req.user.id_usuario)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada o ya procesada' })

    await crearNotificacion({
      id_usuario: sancion.id_usuario,
      tipo: 'sancion_recibida',
      titulo: 'Sanción confirmada',
      mensaje: 'El administrador confirmó tu sanción por falta de entrega. Debés devolver el material para regularizar tu situación.',
      id_prestamo: sancion.id_prestamo,
      id_sancion: sancion.id_sancion
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

    if (sancion.cuenta_habilitada) {
      await crearNotificacion({
        id_usuario: sancion.id_usuario,
        tipo: 'cuenta_habilitada',
        titulo: 'Situación regularizada',
        mensaje: 'El administrador revisó tu situación y tus servicios de biblioteca han sido restaurados.',
        id_prestamo: sancion.id_prestamo,
        id_sancion: sancion.id_sancion
      })
    } else {
      await crearNotificacion({
        id_usuario: sancion.id_usuario,
        tipo: 'sancion_resuelta',
        titulo: 'Sanción rechazada',
        mensaje: 'El administrador rechazó esta sanción, pero todavía tenés otras sanciones activas pendientes de resolución.',
        id_prestamo: sancion.id_prestamo,
        id_sancion: sancion.id_sancion
      })
    }

    res.json({ message: 'Sanción rechazada', data: sancion })
  } catch (error) {
    console.error('Error al rechazar sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const TIPOS_VALIDOS = ['falta_entrega', 'devolucion_tardia', 'deterioro', 'perdida', 'comportamiento']

// Genera una descripción sugerida para sanciones de tipo falta_entrega,
// basada en la fecha tope del préstamo y la fecha actual
const generarDescripcionFaltaEntrega = (fecha_tope_devolucion) => {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const fechaTope = new Date(fecha_tope_devolucion)
  fechaTope.setHours(0, 0, 0, 0)
  const diasVencido = Math.max(0, Math.round((hoy - fechaTope) / (1000 * 60 * 60 * 24)))

  const fechaTopeStr = fechaTope.toLocaleDateString('es-PY')
  return `El usuario no devolvió el material en la fecha tope establecida (${fechaTopeStr}), acumulando ${diasVencido} día${diasVencido === 1 ? '' : 's'} de atraso sin presentarse a regularizar su situación.`
}

const createSanctionHandler = async (req, res) => {
  try {
    const {
      id_prestamo, id_ejemplar, id_usuario,
      tipo_infraccion, descripcion_sancion,
      fecha_limite, dias_suspension
    } = req.body

    if (!tipo_infraccion || !TIPOS_VALIDOS.includes(tipo_infraccion)) {
      return res.status(400).json({ error: 'Tipo de infracción inválido' })
    }

    if (!id_usuario) {
      return res.status(400).json({ error: 'El campo id_usuario es obligatorio' })
    }

    // id_prestamo es obligatorio para todos menos comportamiento
    if (tipo_infraccion !== 'comportamiento' && !id_prestamo) {
      return res.status(400).json({ error: 'El campo id_prestamo es obligatorio para este tipo de infracción' })
    }

    // id_ejemplar es obligatorio para devolucion_tardia, deterioro y perdida
    if (['devolucion_tardia', 'deterioro', 'perdida'].includes(tipo_infraccion) && !id_ejemplar) {
      return res.status(400).json({ error: 'El campo id_ejemplar es obligatorio para este tipo de infracción' })
    }

    // descripción obligatoria para todos menos falta_entrega (se autogenera)
    let descripcionFinal = descripcion_sancion?.trim() || ''
    if (!descripcionFinal && tipo_infraccion !== 'falta_entrega') {
      return res.status(400).json({ error: 'El campo descripcion_sancion es obligatorio' })
    }

    if (tipo_infraccion === 'falta_entrega' && !descripcionFinal) {
      const prestamo = await getLoanWithEjemplaresForSanction(id_prestamo)
      if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' })
      descripcionFinal = generarDescripcionFaltaEntrega(prestamo.fecha_tope_devolucion)
    }

    // dias_suspension: para devolucion_tardia se calcula solo en la query (10 días fijos).
    // Para comportamiento, si no viene, queda indefinida (sin fecha_fin_suspension)
    const sancion = await createSanction({
      id_prestamo: id_prestamo || null,
      id_ejemplar: id_ejemplar || null,
      id_usuario,
      id_admin: req.user.id_usuario,
      tipo_infraccion,
      descripcion_sancion: descripcionFinal,
      fecha_limite,
      dias_suspension: dias_suspension || null
    })

    // Notificar al usuario
    const tipoLabel = {
      falta_entrega: 'falta de entrega de material',
      devolucion_tardia: 'devolución tardía',
      deterioro: 'deterioro de material',
      perdida: 'pérdida de material',
      comportamiento: 'comportamiento inadecuado'
    }

    await crearNotificacion({
      id_usuario,
      tipo: 'sancion_recibida',
      titulo: 'Has recibido una sanción',
      mensaje: `Se registró una sanción por ${tipoLabel[tipo_infraccion]}. ${descripcionFinal}`,
      id_prestamo: id_prestamo || null,
      id_sancion: sancion.id_sancion
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

    await crearNotificacion({
      id_usuario: sancion.id_usuario,
      tipo: 'sancion_resuelta',
      titulo: 'Sanción resuelta',
      mensaje: 'Una de tus sanciones fue marcada como resuelta.',
      id_prestamo: sancion.id_prestamo,
      id_sancion: sancion.id_sancion
    })

    if (sancion.cuenta_habilitada) {
      await crearNotificacion({
        id_usuario: sancion.id_usuario,
        tipo: 'cuenta_habilitada',
        titulo: 'Ya podés volver a usar la biblioteca',
        mensaje: 'No tenés más sanciones activas. Tus servicios de biblioteca fueron restaurados.',
        id_prestamo: sancion.id_prestamo,
        id_sancion: sancion.id_sancion
      })
    }

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

const desescalateSanctionHandler = async (req, res) => {
  try {
    const { id } = req.params
    const sancion = await desescalateSanction(id)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada o no está escalada' })
    res.json({ message: 'Sanción revertida a estado activa', data: sancion })
  } catch (error) {
    console.error('Error al des-escalar sanción:', error)
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

const getSanctionsGroupedHandler = async (req, res) => {
  try {
    const { estado, page = 1, limit = 12 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit

    const [sanciones, total] = await Promise.all([
      getSanctionsGroupedByLoan({ estado, limit: parsedLimit, offset }),
      countSanctionsGrouped({ estado })
    ])

    res.json({
      data: sanciones,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener sanciones agrupadas:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getSanctionsByLoanHandler = async (req, res) => {
  try {
    const { id_prestamo } = req.params
    const sanciones = await getSanctionsByLoan(id_prestamo)
    res.json({ data: sanciones })
  } catch (error) {
    console.error('Error al obtener sanciones del préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Buscar préstamos sancionables por nombre, correo o ci del usuario
// ?search=texto&tipo=falta_entrega|otro
const searchSanctionableLoansHandler = async (req, res) => {
  try {
    const { search, tipo } = req.query
    if (!search || !search.trim()) {
      return res.status(400).json({ error: 'Ingresá un término de búsqueda' })
    }
    if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de infracción inválido' })
    }

    const prestamos = await searchSanctionableLoans(search.trim(), tipo)
    res.json({ data: prestamos })
  } catch (error) {
    console.error('Error al buscar préstamos sancionables:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Obtener un préstamo con todos sus ejemplares — para elegir cuáles sancionar
const getLoanForSanctionHandler = async (req, res) => {
  try {
    const { id_prestamo } = req.params
    const prestamo = await getLoanWithEjemplaresForSanction(id_prestamo)
    if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' })
    res.json({ data: prestamo })
  } catch (error) {
    console.error('Error al obtener préstamo:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getSancionesComportamientoAgrupadasHandler = async (req, res) => {
  try {
    const { estado, page = 1, limit = 12 } = req.query
    const parsedLimit = parseInt(limit)
    const parsedPage  = parseInt(page)
    const offset = (parsedPage - 1) * parsedLimit

    const [sanciones, total] = await Promise.all([
      getSancionesComportamientoAgrupadas({ estado, limit: parsedLimit, offset }),
      countSancionesComportamientoAgrupadas({ estado })
    ])

    res.json({
      data: sanciones,
      pagination: { total, page: parsedPage, limit: parsedLimit, totalPages: Math.ceil(total / parsedLimit) }
    })
  } catch (error) {
    console.error('Error al obtener sanciones de comportamiento:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getSancionesComportamientoByUsuarioHandler = async (req, res) => {
  try {
    const { id_usuario } = req.params
    const sanciones = await getSancionesComportamientoByUsuario(id_usuario)
    res.json({ data: sanciones })
  } catch (error) {
    console.error('Error al obtener sanciones de comportamiento del usuario:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  createSanctionHandler, confirmSanctionHandler, rejectSanctionHandler,
  getSanctionsHandler, getSanctionsGroupedHandler, getSanctionHandler,
  getSanctionsByLoanHandler, resolveSanctionHandler,
  escalateSanctionHandler, getMySanctionsHandler, desescalateSanctionHandler,
  searchSanctionableLoansHandler, getLoanForSanctionHandler,
  getSancionesComportamientoAgrupadasHandler, getSancionesComportamientoByUsuarioHandler
}