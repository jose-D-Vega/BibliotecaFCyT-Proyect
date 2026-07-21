const pool = require('../config/db')


const getAdminDashboardStats = async () => {

  const [
    totalLibrosResult,
    usuariosActivosResult,
    prestamosActivosResult,
    librosVencidosResult,
    devueltosHoyResult,
    reservasPendientesResult,
    actividadAreaResult,
    tendenciaResult,
    masPrestadosResult

  ] = await Promise.all([


    // TOTAL LIBROS
    pool.query(`
      SELECT COUNT(*)
      FROM libros
      WHERE activo = true
    `),



    // USUARIOS ACTIVOS
    pool.query(`
      SELECT COUNT(*)
      FROM usuarios
      WHERE activo = true
    `),



    // PRESTAMOS ACTIVOS
    pool.query(`
      SELECT COUNT(*)
      FROM prestamos
      WHERE estado_prestamo = 'activo'
    `),



    // VENCIDOS
    pool.query(`
      SELECT COUNT(*)
      FROM prestamos
      WHERE estado_prestamo = 'vencido'
    `),



    // DEVUELTOS HOY
    pool.query(`
      SELECT COUNT(*)
      FROM devoluciones
      WHERE fecha_devolucion::date = CURRENT_DATE
    `),



    // RESERVAS
    pool.query(`
      SELECT COUNT(*)
      FROM prestamos
      WHERE estado_prestamo = 'solicitud_reserva'
    `),




    // PRESTAMOS POR CARRERA
    pool.query(`
      SELECT 
        TRIM(carrera_individual) AS carrera,
        COUNT(*) AS cantidad

      FROM detalles_prestamos dp

      JOIN ejemplares e
      ON dp.id_ejemplar = e.id_ejemplar

      JOIN libros l
      ON e.id_libro = l.id_libro


      CROSS JOIN LATERAL
      unnest(
        string_to_array(l.carrera, ',')
      )
      AS carrera_individual


      WHERE l.carrera IS NOT NULL

      GROUP BY carrera_individual

      ORDER BY cantidad DESC
    `),




    // TENDENCIA MENSUAL
    pool.query(`
      SELECT
        EXTRACT(MONTH FROM fecha_solicitud)::int AS mes,
        COUNT(*) AS cantidad

      FROM prestamos

      WHERE EXTRACT(YEAR FROM fecha_solicitud)
      =
      EXTRACT(YEAR FROM CURRENT_DATE)

      GROUP BY mes

      ORDER BY mes
    `),




    // LIBROS MAS PRESTADOS

    pool.query(`
      SELECT

        l.id_libro,
        l.titulo,
        l.autor,
        l.imagen_url,

        COUNT(*) AS total_prestamos


      FROM detalles_prestamos dp


      JOIN ejemplares e
      ON dp.id_ejemplar = e.id_ejemplar


      JOIN libros l
      ON e.id_libro = l.id_libro


      GROUP BY
        l.id_libro,
        l.titulo,
        l.autor,
        l.imagen_url


      ORDER BY total_prestamos DESC


      LIMIT 5
    `)

  ])




  const actividad = actividadAreaResult.rows


  const total =
    actividad.reduce(
      (a,b)=>a + Number(b.cantidad),
      0
    )



  const actividadPorArea =
    actividad.map(item=>({

      area:item.carrera,

      porcentaje:
        total > 0
        ?
        Math.round(
          Number(item.cantidad)
          /
          total
          *
          100
        )
        :
        0

    }))





  const libros =
    masPrestadosResult.rows



  const max =
    Math.max(
      ...libros.map(
        x=>Number(x.total_prestamos)
      ),
      1
    )



  const librosMasPrestados =
    libros.map(lib=>({

      ...lib,

      total_prestamos:
        Number(lib.total_prestamos),


      porcentaje_relativo:
        Math.round(
          Number(lib.total_prestamos)
          /
          max
          *
          100
        )

    }))





  return {


    totalLibros:
      Number(totalLibrosResult.rows[0].count),


    usuariosActivos:
      Number(usuariosActivosResult.rows[0].count),


    prestamosActivos:
      Number(prestamosActivosResult.rows[0].count),


    librosVencidos:
      Number(librosVencidosResult.rows[0].count),


    librosDevueltosHoy:
      Number(devueltosHoyResult.rows[0].count),


    reservasPendientes:
      Number(reservasPendientesResult.rows[0].count),



    actividadPorArea,


    tendenciaMensual:
      tendenciaResult.rows.map(x=>({
        mes:Number(x.mes),
        cantidad:Number(x.cantidad)
      })),



    librosMasPrestados

  }

}




const getAdminExtraStats = async()=>{


  const [
    usuariosRol,
    sesiones,
    actividades

  ] = await Promise.all([



    pool.query(`
      SELECT

      tu.nombre_tipo AS rol,
      COUNT(*) AS cantidad


      FROM usuarios u


      JOIN tipo_usuarios tu

      ON u.id_tipo_usuario =
      tu.id_tipo_usuario


      WHERE u.activo=true


      GROUP BY tu.nombre_tipo

    `),



    pool.query(`
      SELECT COUNT(*)

      FROM sesiones

      WHERE estado='Activo'
    `),




    pool.query(`
      SELECT

      ha.id_actividad,
      ha.tipo_accion,
      ha.entidad,
      ha.descripcion,
      ha.fecha,
      u.nombre_apellido


      FROM historial_actividades ha


      JOIN usuarios u

      ON ha.id_usuario =
      u.id_usuario


      ORDER BY ha.fecha DESC


      LIMIT 10
    `)


  ])




  return {


    usuariosPorRol:

      usuariosRol.rows.map(x=>({

        rol:x.rol,

        cantidad:Number(x.cantidad)

      })),



    sesionesActivas:

      Number(
        sesiones.rows[0].count
      ),



    actividadesRecientes:

      actividades.rows


  }


}



module.exports={
 getAdminDashboardStats,
 getAdminExtraStats
}