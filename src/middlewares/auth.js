const jwt = require('jsonwebtoken')
const pool = require('../config/db')


const verifyToken = async (req, res, next) => {

  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]


  if (!token) {

    return res.status(401).json({
      error:'Acceso denegado. Token no proporcionado'
    })

  }



  try {


    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    )



    if(!decoded.sid){

      return res.status(401).json({
        error:'Sesión inválida'
      })

    }




    const { rows } = await pool.query(
      `
      SELECT
        estado,
        fecha_expiracion,
        ultima_actividad

      FROM sesiones

      WHERE sid = $1
      `,
      [
        decoded.sid
      ]
    )



    if(rows.length === 0){

      return res.status(401).json({
        error:'Sesión no encontrada'
      })

    }




    const sesion = rows[0]



    if(sesion.estado !== 'Activo'){

      return res.status(401).json({
        error:'Sesión cerrada o inválida'
      })

    }




    if(
      new Date() >
      new Date(sesion.fecha_expiracion)
    ){


      await pool.query(
        `
        UPDATE sesiones

        SET
          estado = 'Expirada',
          fecha_cierre = NOW()

        WHERE sid = $1
        `,
        [
          decoded.sid
        ]
      )



      return res.status(401).json({
        error:'Sesión expirada'
      })

    }





    const ultimaActividad =
      new Date(
        sesion.ultima_actividad
      )


    const ahora = new Date()



    const diferenciaMinutos =
      (ahora - ultimaActividad) / 1000 / 60





    if(diferenciaMinutos >= 5){


      try{


        await pool.query(
          `
          UPDATE sesiones

          SET ultima_actividad = NOW()

          WHERE sid = $1
          `,
          [
            decoded.sid
          ]
        )


      }
      catch(error){

        console.error(
          'Error actualizando actividad:',
          error
        )

      }


    }





    req.user = decoded





    // Leer el rol activo seleccionado en frontend

    const rolActivo =
      req.headers['x-rol-activo']




    const rolesPermitidos = {

      normal:[
        'normal'
      ],

      bibliotecario:[
        'normal',
        'bibliotecario'
      ],

      admin:[
        'normal',
        'bibliotecario',
        'admin'
      ]

    }





    const permitidos =
      rolesPermitidos[decoded.rol]
      ||
      ['normal']





    if(
      rolActivo &&
      permitidos.includes(rolActivo)
    ){

      req.user.rolActivo = rolActivo

    }
    else{

      req.user.rolActivo = decoded.rol

    }





    next()



  }
  catch(error){


    return res.status(401).json({
      error:'Token inválido o expirado'
    })


  }


}



module.exports = {
  verifyToken
}