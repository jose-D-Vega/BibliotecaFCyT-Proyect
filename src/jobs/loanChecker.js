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
      // Marcar préstamo como vencido
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'vencido'
        WHERE id_prestamo = $1`,
        [prestamo.id_prestamo]
      )

      // Bloquear usuario preventivamente
      await client.query(
        `UPDATE usuarios SET sancionado = true
        WHERE id_usuario = $1`,
        [prestamo.id_usuario]
      )

      // Crear sanción en estado pendiente_confirmacion
      // Verificar que no exista ya una sanción pendiente para este préstamo
      const { rows: sancionExistente } = await client.query(
        `SELECT id_sancion FROM sanciones
        WHERE id_prestamo = $1
          AND tipo_infraccion = 'falta_entrega'
          AND estado_sancion = 'pendiente_confirmacion'`,
        [prestamo.id_prestamo]
      )

      if (sancionExistente.length === 0) {
        await client.query(
          `INSERT INTO sanciones (
            id_prestamo, id_usuario, tipo_infraccion,
            descripcion_sancion, estado_sancion, fecha_sancion, fecha_limite
          )
          VALUES ($1, $2, 'falta_entrega',
            'Préstamo vencido sin devolución del material', 
            'pendiente_confirmacion', CURRENT_DATE,
            CURRENT_DATE + INTERVAL '30 days')`,
          [prestamo.id_prestamo, prestamo.id_usuario]
        )
      }

      // Notificar al usuario
      await crearNotificacion({
        id_usuario: prestamo.id_usuario,
        tipo: 'prestamo_vencido',
        titulo: 'Tu préstamo ha vencido',
        mensaje: 'No devolviste los materiales a tiempo. Tus servicios de biblioteca están suspendidos hasta que regularices tu situación.',
        id_prestamo: prestamo.id_prestamo
      })
    }

    // Notificar a admins si hay préstamos vencidos
    if (activosVencidos.length > 0) {
      const { rows: admins } = await client.query(
        `SELECT u.id_usuario FROM usuarios u
        JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
        WHERE t.nombre_tipo = 'admin' AND u.activo = true`
      )
      for (const admin of admins) {
        await crearNotificacion({
          id_usuario: admin.id_usuario,
          tipo: 'prestamo_vencido',
          titulo: 'Préstamos vencidos pendientes',
          mensaje: `${activosVencidos.length} préstamo${activosVencidos.length > 1 ? 's han' : ' ha'} vencido hoy. Revisá la sección de sanciones para confirmar o rechazar.`,
          id_prestamo: null
        })
      }
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

    // Escalar sanciones activas que superaron los 30 días
    const { rows: sancionesAEscalar } = await client.query(
      `SELECT * FROM sanciones
      WHERE estado_sancion = 'activa'
        AND fecha_limite IS NOT NULL
        AND fecha_limite < $1`,
      [hoy]
    )

    for (const sancion of sancionesAEscalar) {
      await client.query(
        `UPDATE sanciones SET estado_sancion = 'escalada'
        WHERE id_sancion = $1`,
        [sancion.id_sancion]
      )

      // Notificar al admin
      const { rows: admins } = await client.query(
        `SELECT u.id_usuario FROM usuarios u
        JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
        WHERE t.nombre_tipo = 'admin' AND u.activo = true`
      )

      for (const admin of admins) {
        await crearNotificacion({
          id_usuario: admin.id_usuario,
          tipo: 'prestamo_vencido',
          titulo: 'Sanción escalada automáticamente',
          mensaje: `La sanción #${sancion.id_sancion} superó el plazo de 30 días y fue escalada a entidades superiores.`,
          id_prestamo: sancion.id_prestamo
        })
      }
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