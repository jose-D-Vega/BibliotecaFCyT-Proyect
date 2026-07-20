const {
  actualizarSesionesExpiradas
} = require("../queries/session.queries")


const iniciarSessionJob = () => {

  console.log(
    "Job de sesiones iniciado"
  )


  setInterval(async () => {

    try {

      const cantidad =
        await actualizarSesionesExpiradas()


      if(cantidad > 0){

        console.log(
          `Sesiones expiradas actualizadas: ${cantidad}`
        )

      }

    } catch(error) {

      console.error(
        "Error actualizando sesiones expiradas:",
        error
      )

    }

  }, 5 * 60 * 1000)

}


module.exports = {
  iniciarSessionJob
}