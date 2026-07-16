const { getDashboardStats } = require('../queries/dashboard.queries')

const getDashboardStatsHandler = async (req, res) => {
  try {
    const stats = await getDashboardStats(req.user.id_usuario)
    res.json({ data: stats })
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getDashboardStatsHandler }