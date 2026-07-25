const { getDashboardStats, getStaffDashboardStats } = require('../queries/dashboard.queries')

const getDashboardStatsHandler = async (req, res) => {
  try {
    const stats = await getDashboardStats(req.user.id_usuario)
    res.json({ data: stats })
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

const getStaffDashboardStatsHandler = async (req, res) => {
  try {
    const rolEfectivo = (req.user.rolActivo || req.user.rol || '').toLowerCase()
    const esAdmin = rolEfectivo === 'admin'

    const stats = await getStaffDashboardStats(esAdmin)
    res.json({ data: stats })
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard de staff:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { getDashboardStatsHandler, getStaffDashboardStatsHandler }