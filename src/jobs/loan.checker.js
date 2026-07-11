const cron = require('node-cron')
const pool = require('../config/db')
const { crearNotificacion } = require('../queries/notifications.queries')

const verificarPrestamos = async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    // ---------- Solicitudes de renovación sin respuesta que superaron fecha_limite_respuesta --------
    // El registro con estado 'solicitud_renovacion' es el de la renovación nueva (no el original).
    // Cuando vence sin respuesta: la renovación pasa a 'rechazado' y el original a 'pendiente_devolucion'.

    const { rows: renovacionesVencidas } = await client.query(
      `SELECT * FROM prestamos
       WHERE estado_prestamo = 'solicitud_renovacion'
         AND fecha_limite_respuesta_renovacion < $1`,
      [hoy]
    )

    for (const renovacion of renovacionesVencidas) {
      const fechaLimiteDev = new Date()
      fechaLimiteDev.setDate(fechaLimiteDev.getDate() + 2)

      // La solicitud de renovación queda como rechazada por vencimiento
      await client.query(
        `UPDATE prestamos SET estado_prestamo = 'rechazado'
         WHERE id_prestamo = $1`,
        [renovacion.id_prestamo]
      )

      // Encontrar el préstamo activo anterior (original o renovación previa)
      // y pasarlo a pendiente_devolucion
      await client.query(
        `UPDATE prestamos
         SET estado_prestamo = 'pendiente_devolucion',
             fecha_tope_devolucion = $1
         WHERE estado_prestamo = 'activo'
           AND (id_prestamo = $2 OR id_prestamo_original = $2)
           AND id_prestamo != $3`,
        [fechaLimiteDev, renovacion.id_prestamo_original, renovacion.id_prestamo]
      )

      await crearNotificacion({
        id_usuario: renovacion.id_usuario,
        tipo: 'renovacion_vencida',
        titulo: 'Renovación sin respuesta',
        mensaje: `Tu solicitud de renovación no fue respondida a tiempo. Tenés hasta el ${fechaLimiteDev.toLocaleDateString('es-PY')} para devolver los libros.`,
        id_prestamo: renovacion.id_prestamo_original,
        unica: true
      }, client)
    }

    // -------------- Préstamos en pendiente_devolucion que superaron su nueva fecha tope ----------

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
        id_prestamo: prestamo.id_prestamo,
        unica: true
      }, client)
    }

    // ------------ Préstamos activos vencidos sin solicitud de renovación pendiente -------------
    // Excluye explícitamente los préstamos que tienen una renovación en curso,
    // porque esos se manejan en la sección anterior cuando vence su fecha_limite_respuesta_renovacion.

    const { rows: activosVencidos } = await client.query(
      `SELECT p.* FROM prestamos p
       WHERE p.estado_prestamo = 'activo'
         AND p.fecha_tope_devolucion < $1
         AND NOT EXISTS (
           SELECT 1 FROM prestamos r
           WHERE r.id_prestamo_original = p.id_prestamo
             AND r.estado_prestamo = 'solicitud_renovacion'
         )`,
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

      await crearNotificacion({
        id_usuario: prestamo.id_usuario,
        tipo: 'prestamo_vencido',
        titulo: 'Tu préstamo ha vencido',
        mensaje: 'No devolviste los materiales a tiempo. Tus servicios de biblioteca están suspendidos hasta que regularices tu situación.',
        id_prestamo: prestamo.id_prestamo,
        unica: true
      }, client)
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
          id_prestamo: null,
          rol_destino: 'admin',
          unica: true
        }, client)
      }
    }

    //----------- Notificar préstamos que vencen mañana --------------

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
        id_prestamo: prestamo.id_prestamo,
        unica: true
      }, client)
    }

    // Alertar a los admins sobre sanciones activas que superaron los 30 días.
    // La decisión de escalar es manual del admin desde la página de sanciones;
    // este job solo notifica, no toca estado_sancion.

    const { rows: sancionesVencidas } = await client.query(
      `SELECT * FROM sanciones
      WHERE estado_sancion = 'activa'
        AND fecha_limite IS NOT NULL
        AND tipo_infraccion != 'comportamiento'
        AND fecha_limite < $1`,
      [hoy]
    )

    if (sancionesVencidas.length > 0) {
      const { rows: admins } = await client.query(
        `SELECT u.id_usuario FROM usuarios u
        JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
        WHERE t.nombre_tipo = 'admin' AND u.activo = true`
      )

      for (const sancion of sancionesVencidas) {
        for (const admin of admins) {
          await crearNotificacion({
            id_usuario: admin.id_usuario,
            tipo: 'admin_sancion_escalada',
            titulo: 'Sanción sin resolver hace más de 30 días',
            mensaje: `La sanción #${sancion.id_sancion} superó el plazo de 30 días sin resolverse. Revisala en la sección de sanciones para decidir si corresponde escalarla.`,
            id_prestamo: sancion.id_prestamo,
            id_sancion: sancion.id_sancion,
            rol_destino: 'admin',
            unica: true
          }, client)
        }
      }
    }

    // ------------ Resolución automática de sanciones por suspensión vencida ------------
    // Aplica a: devolucion_tardia y comportamiento cuando fecha_fin_suspension <= hoy

    const { rows: sancionesVencidaSuspension } = await client.query(
      `SELECT s.*, u.nombre_apellido
      FROM sanciones s
      JOIN usuarios u ON s.id_usuario = u.id_usuario
      WHERE s.estado_sancion IN ('activa', 'escalada')
        AND s.tipo_infraccion IN ('devolucion_tardia', 'comportamiento')
        AND s.fecha_fin_suspension IS NOT NULL
        AND s.fecha_fin_suspension < $1`,
      [hoy]
    )

    for (const sancion of sancionesVencidaSuspension) {
      // Resolver la sanción
      await client.query(
        `UPDATE sanciones SET estado_sancion = 'resuelta'
        WHERE id_sancion = $1`,
        [sancion.id_sancion]
      )

      // Verificar si el usuario tiene otras sanciones activas antes de desbloquear
      const { rows: otrasSanciones } = await client.query(
        `SELECT COUNT(*) FROM sanciones
        WHERE id_usuario = $1
          AND estado_sancion IN ('activa', 'pendiente_confirmacion')
          AND id_sancion != $2`,
        [sancion.id_usuario, sancion.id_sancion]
      )

      const cuentaHabilitada = parseInt(otrasSanciones[0].count) === 0

      if (cuentaHabilitada) {
        await client.query(
          `UPDATE usuarios SET sancionado = false WHERE id_usuario = $1`,
          [sancion.id_usuario]
        )
      }

      // Notificar al usuario
      const tipoLabel = sancion.tipo_infraccion === 'devolucion_tardia'
        ? 'devolución tardía'
        : 'comportamiento inadecuado'

      await crearNotificacion({
        id_usuario: sancion.id_usuario,
        tipo: 'sancion_resuelta',
        titulo: 'Tu sanción fue resuelta',
        mensaje: cuentaHabilitada
          ? `Tu sanción por ${tipoLabel} ha concluido y tu cuenta ha sido habilitada nuevamente.`
          : `Tu sanción por ${tipoLabel} ha concluido. Tenés otras sanciones activas pendientes de resolución.`,
        id_prestamo: sancion.id_prestamo || null,
        id_sancion: sancion.id_sancion,
        unica: true
      }, client)
    }

    // Notificar a admins si se resolvieron sanciones automáticamente
    if (sancionesVencidaSuspension.length > 0) {
      const { rows: admins } = await client.query(
        `SELECT u.id_usuario FROM usuarios u
        JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
        WHERE t.nombre_tipo = 'admin' AND u.activo = true`
      )

      for (const admin of admins) {
        await crearNotificacion({
          id_usuario: admin.id_usuario,
          tipo: 'sancion_resuelta',
          titulo: 'Sanciones resueltas automáticamente',
          mensaje: `${sancionesVencidaSuspension.length} sanción${sancionesVencidaSuspension.length > 1 ? 'es fueron resueltas' : ' fue resuelta'} automáticamente por vencimiento del período de suspensión.`,
          id_prestamo: null,
          rol_destino: 'admin',
          unica: true
        }, client)
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

  // Esperar 5 segundos al arrancar para asegurar que la conexión a la DB esté lista
  setTimeout(verificarPrestamos, 5000)
}

module.exports = { iniciarJob, verificarPrestamos }