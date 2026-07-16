const {
  getSesiones,
  countSesiones,
  getSesionesActivasUsuario,
  cerrarSesion
} = require('../queries/session.queries')



const getSesionesHandler = async (req, res) => {

  try {

    const {
      usuario,
      fecha_desde,
      fecha_hasta,
      page = 1,
      limit = 50
    } = req.query


    const parsedLimit = parseInt(limit)
    const parsedPage = parseInt(page)

    const offset = (parsedPage - 1) * parsedLimit


    const filters = {
      usuario,
      fecha_desde,
      fecha_hasta,
      limit: parsedLimit,
      offset
    }


    const [
      sesiones,
      total
    ] = await Promise.all([
      getSesiones(filters),
      countSesiones(filters)
    ])


    res.json({
      data: sesiones,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    })


  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error interno del servidor'
    })

  }

}



const getMisSesionesActivasHandler = async (req, res) => {

  try {

    const sesiones = await getSesionesActivasUsuario(
      req.user.id_usuario
    )


    res.json({
      data: sesiones
    })


  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error interno del servidor'
    })

  }

}



const cerrarSesionHandler = async (req, res) => {

  try {

    await cerrarSesion(
      req.user.id_usuario
    )


    res.json({
      message: 'Sesión cerrada correctamente'
    })


  } catch (error) {

    console.error('Error al cerrar sesión:', error)

    res.status(500).json({
      error: 'Error interno del servidor'
    })

  }

}



module.exports = {
  getSesionesHandler,
  getMisSesionesActivasHandler,
  cerrarSesionHandler
}