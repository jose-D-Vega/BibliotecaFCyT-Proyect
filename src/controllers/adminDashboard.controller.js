const { getAdminDashboardStats } = require('../queries/adminDashboard.queries')

const getAdminDashboardStatsHandler = async (req, res) => {
  try {
    const stats = await getAdminDashboardStats()
    res.json({ data: stats })
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard admin:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getAdminDashboardStatsHandler }