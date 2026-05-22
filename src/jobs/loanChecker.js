const cron = require('node-cron')
const pool = require('../config/db')
const { crearNotificacion } = require('../queries/notifications.queries')

const verificarPrestamos = async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    // 1. Solicitudes de renovación sin respuesta que superaron fecha_limite_respuesta
    const { rows: renovacionesVencidas } = await client.query(
      `SELECT * FROM prestamos
       WHERE estado_prestamo = 'solicitud_renovacion'
         AND fecha_limite_respuesta_renovacion < $1`,
      [hoy]
    )

    for (const prestamo of renovacionesVencidas) {
      const fechaLimiteDev = new Date()
      fechaLimiteDev.setDate(fechaLimiteDev.getDate() + 2)

      await client.query(
        `UPDATE prestamos
         SET estado_prestamo = 'pendiente_devolucion',
             fecha_tope_devolucion = $1
         WHERE id_prestamo = $2`,
        [fechaLimiteDev, prestamo.id_prestamo]
      )

      await crearNotificacion({
        id_usuario: prestamo.id_usuario,
        tipo: 'renovacion_vencida',
        titulo: 'Renovación sin respuesta',
        mensaje: `Tu solicitud de renovación no fue respondida a tiempo. Tenés hasta el ${fechaLimiteDev.toLocaleDateString('es-PY')} para devolver los libros.`,
        id_prestamo: prestamo.id_prestamo
      })
    }

    // 2. Préstamos en pendiente_devolucion que superaron su nueva fecha tope
    const { rows: pendientesVencidos } = await client.query(
      `SELECT * FROM prestamos
       WHERE estado_prestamo = 'pendiente_devolucion'
         AND fecha_tope_devolucion < $1`,
      [hoy]
    )

    for (const prestamo of pendientesVencidos) {
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'vencido'
         WHERE id_prestamo = $1`,
        [prestamo.id_prestamo]
      )

      // Marcar usuario como sancionado
      await client.query(
        `UPDATE usuarios SET sancionado = true
         WHERE id_usuario = $1`,
        [prestamo.id_usuario]
      )

      await crearNotificacion({
        id_usuario: prestamo.id_usuario,
        tipo: 'prestamo_vencido',
        titulo: 'Préstamo vencido',
        mensaje: 'Tu préstamo ha vencido y has recibido una sanción. Acercate a la biblioteca para regularizar tu situación.',
        id_prestamo: prestamo.id_prestamo
      })
    }

    // 3. Préstamos activos vencidos sin solicitud de renovación pendiente
    const { rows: activosVencidos } = await client.query(
      `SELECT * FROM prestamos
       WHERE estado_prestamo = 'activo'
         AND fecha_tope_devolucion < $1`,
      [hoy]
    )

    for (const prestamo of activosVencidos) {
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'vencido'
         WHERE id_prestamo = $1`,
        [prestamo.id_prestamo]
      )

      await client.query(
        `UPDATE usuarios SET sancionado = true
         WHERE id_usuario = $1`,
        [prestamo.id_usuario]
      )

      await crearNotificacion({
        id_usuario: prestamo.id_usuario,
        tipo: 'prestamo_vencido',
        titulo: 'Préstamo vencido',
        mensaje: 'Tu préstamo ha vencido y has recibido una sanción. Acercate a la biblioteca para regularizar tu situación.',
        id_prestamo: prestamo.id_prestamo
      })
    }

    // 4. Notificar préstamos que vencen mañana
    const manana = new Date(hoy)
    manana.setDate(manana.getDate() + 1)

    const { rows: porVencer } = await client.query(
      `SELECT * FROM prestamos
       WHERE estado_prestamo = 'activo'
         AND fecha_tope_devolucion = $1`,
      [manana]
    )

    for (const prestamo of porVencer) {
      await crearNotificacion({
        id_usuario: prestamo.id_usuario,
        tipo: 'prestamo_por_vencer',
        titulo: 'Tu préstamo vence mañana',
        mensaje: 'Recordá devolver los libros mañana o solicitar una renovación antes de que venza el plazo.',
        id_prestamo: prestamo.id_prestamo
      })
    }

    await client.query('COMMIT')
    console.log(`[${new Date().toISOString()}] Verificación de préstamos completada`)
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error en verificación de préstamos:', error)
  } finally {
    client.release()
  }
}

// Correr cada hora
const iniciarJob = () => {
  cron.schedule('0 * * * *', verificarPrestamos)
  console.log('Job de verificación de préstamos iniciado')

  // Correr una vez al arrancar para no esperar la primera hora
  verificarPrestamos()
}

module.exports = { iniciarJob, verificarPrestamos }