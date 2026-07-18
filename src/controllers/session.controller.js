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



    const finalLimit =
      isNaN(parsedLimit)
      ? 50
      : parsedLimit


    const finalPage =
      isNaN(parsedPage)
      ? 1
      : parsedPage



    const offset =
      (finalPage - 1) * finalLimit



    const filters = {

      usuario,

      fecha_desde,

      fecha_hasta,

      limit: finalLimit,

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

        page: finalPage,

        limit: finalLimit,

        totalPages:
          Math.ceil(total / finalLimit)

      }

    })



  } catch (error) {


    console.error(
      'Error obteniendo sesiones:',
      error
    )



    res.status(500).json({

      error:'Error interno del servidor'

    })


  }

}







const getMisSesionesActivasHandler = async (req, res) => {

  try {


    const sesiones = await getSesionesActivasUsuario(
  req.user.id_usuario,
  req.user.sid
)



    res.json({

      data: sesiones

    })



  } catch(error) {


    console.error(
      'Error obteniendo sesiones activas:',
      error
    )



    res.status(500).json({

      error:'Error interno del servidor'

    })


  }

}









const cerrarSesionHandler = async (req, res) => {

  try {


    if(!req.user.sid){

      return res.status(401).json({

        error:'Sesión inválida'

      })

    }




    await cerrarSesion(
      req.user.sid
    )




    res.json({

      message:'Sesión cerrada correctamente'

    })



  } catch(error) {


    console.error(

      'Error al cerrar sesión:',

      error

    )



    res.status(500).json({

      error:'Error interno del servidor'

    })


  }

}







module.exports = {

  getSesionesHandler,

  getMisSesionesActivasHandler,

  cerrarSesionHandler

}