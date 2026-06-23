const { getNotificaciones, countNoLeidas, marcarLeida, marcarTodasLeidas } = require('../queries/notifications.queries')

const getNotificacionesHandler = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario
    const rolActivo = req.user.rolActivo || 'normal'
    const [notificaciones, noLeidas] = await Promise.all([
      getNotificaciones(id_usuario, rolActivo),
      countNoLeidas(id_usuario, rolActivo)
    ])
    res.json({ data: notificaciones, no_leidas: noLeidas })
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
    await marcarTodasLeidas(req.user.id_usuario)
    res.json({ message: 'Todas las notificaciones marcadas como leídas' })
  } catch (error) {
    console.error('Error al marcar notificaciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getNotificacionesHandler, marcarLeidaHandler, marcarTodasLeidasHandler }