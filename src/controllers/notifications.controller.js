const {
  getNotificaciones,
  countNotificaciones,
  countNoLeidas,
  marcarLeida,
  marcarTodasLeidas
} = require('../queries/notifications.queries')

const getNotificacionesHandler = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario
    const rolActivo = req.user.rolActivo || 'normal'
    const { tipo, leida, fecha_desde, fecha_hasta } = req.query
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 50
    const offset = (page - 1) * limit

    const filtros = { tipo, leida, fecha_desde, fecha_hasta, limit, offset }

    const [notificaciones, noLeidas, total] = await Promise.all([
      getNotificaciones(id_usuario, rolActivo, filtros),
      countNoLeidas(id_usuario, rolActivo),
      countNotificaciones(id_usuario, rolActivo, filtros)
    ])

    res.json({
      data: notificaciones,
      no_leidas: noLeidas,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    })
  } catch (error) {
    console.error('Error al obtener notificaciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const marcarLeidaHandler = async (req, res) => {
  try {
    const { id } = req.params
    const notif = await marcarLeida(id, req.user.id_usuario)
    if (!notif) return res.status(404).json({ error: 'Notificación no encontrada' })
    res.json({ message: 'Notificación marcada como leída', data: notif })
  } catch (error) {
    console.error('Error al marcar notificación:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const marcarTodasLeidasHandler = async (req, res) => {
  try {
    const rolActivo = req.user.rolActivo || 'normal'
    await marcarTodasLeidas(req.user.id_usuario, rolActivo)
    res.json({ message: 'Todas las notificaciones marcadas como leídas' })
  } catch (error) {
    console.error('Error al marcar notificaciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getNotificacionesHandler, marcarLeidaHandler, marcarTodasLeidasHandler }