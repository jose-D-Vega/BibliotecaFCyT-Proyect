const { getSancionesByUsuario, getSancionById } = require('../queries/sanciones.queries')

// Usuario normal — ver sus propias sanciones
const getMisSanciones = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario

    const sanciones = await getSancionesByUsuario(id_usuario)

    res.json({ data: sanciones })
  } catch (error) {
    console.error('Error al obtener sanciones:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Usuario normal — ver el detalle de una sanción propia
const getMiSancionById = async (req, res) => {
  try {
    const { id } = req.params
    const id_usuario = req.user.id_usuario

    const sancion = await getSancionById(id)
    if (!sancion) return res.status(404).json({ error: 'Sanción no encontrada' })

    // El usuario solo puede ver sus propias sanciones
    if (sancion.id_usuario !== id_usuario) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta sanción' })
    }

    res.json({ data: sancion })
  } catch (error) {
    console.error('Error al obtener la sanción:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = {
  getMisSanciones,
  getMiSancionById
}