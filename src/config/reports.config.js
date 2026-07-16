// Whitelist de entidades reportables. Cada entidad puede además declarar "extensiones":
// joins opcionales que agregan columnas/filtros de otra tabla relacionada, sin
// necesidad de crear una entidad nueva por cada combinación posible (detalles+devolución,
// detalles+sanción, etc.). Agregar un reporte nuevo = agregar un bloque acá.

const REPORT_ENTITIES = {
  libros: {
    label: 'Libros (catálogo)',
    baseQuery: `FROM libros l`,
    columns: {
      id_libro:          { label: 'N° Libro', expr: 'l.id_libro' },
      titulo:            { label: 'Título', expr: 'l.titulo' },
      autor:             { label: 'Autor', expr: 'l.autor' },
      tipo_material:     { label: 'Tipo', expr: 'l.tipo_material' },
      carrera:           { label: 'Carrera', expr: 'l.carrera' },
      facultad:          { label: 'Facultad', expr: 'l.facultad' },
      editorial:         { label: 'Editorial', expr: 'l.editorial' },
      anio_publicacion:  { label: 'Año de publicación', expr: 'l.anio_publicacion' },
      cantidad_ejemplar: { label: 'Cantidad de ejemplares', expr: 'l.cantidad_ejemplar' },
      activo:            { label: 'Activo', expr: 'l.activo' }
    },
    filters: {
      tipo_material: { expr: 'l.tipo_material', op: '=' },
      carrera:       { expr: 'l.carrera', op: 'ILIKE_ANY' },
      facultad:      { expr: 'l.facultad', op: '=' },
      activo:        { expr: 'l.activo', op: '=' },
      anio_desde:    { expr: 'l.anio_publicacion', op: '>=' },
      anio_hasta:    { expr: 'l.anio_publicacion', op: '<=' }
    },
    defaultOrder: 'l.titulo ASC'
  },

  ejemplares: {
    label: 'Materiales (Ejemplares)',
    baseQuery: `FROM ejemplares e JOIN libros l ON l.id_libro = e.id_libro`,
    columns: {
      id_ejemplar:     { label: 'N° Ejemplar', expr: 'e.id_ejemplar' },
      titulo:          { label: 'Título', expr: 'l.titulo' },
      autor:           { label: 'Autor', expr: 'l.autor' },
      tipo_material:   { label: 'Tipo', expr: 'l.tipo_material' },
      carrera:         { label: 'Carrera', expr: 'l.carrera' },
      estado_ejemplar: { label: 'Estado', expr: 'e.estado_ejemplar' }
    },
    filters: {
      estado_ejemplar: { expr: 'e.estado_ejemplar', op: '=' },
      tipo_material:   { expr: 'l.tipo_material', op: '=' },
      carrera:         { expr: 'l.carrera', op: 'ILIKE_ANY' },
      id_libro:        { expr: 'l.id_libro', op: '=' }
    },
    defaultOrder: 'l.titulo ASC'
  },

  prestamos: {
    label: 'Préstamos',
    baseQuery: `
      FROM prestamos p
      JOIN usuarios u ON u.id_usuario = p.id_usuario
      LEFT JOIN usuarios b ON b.id_usuario = p.id_bibliotecario
    `,
    columns: {
      id_prestamo:           { label: 'N° Préstamo', expr: 'p.id_prestamo' },
      usuario:               { label: 'Usuario', expr: 'u.nombre_apellido' },
      correo_usuario:        { label: 'Correo', expr: 'u.correo' },
      bibliotecario:         { label: 'Gestionado por', expr: 'b.nombre_apellido' },
      estado_prestamo:       { label: 'Estado', expr: 'p.estado_prestamo' },
      es_reserva:            { label: 'Es reserva', expr: 'p.es_reserva' },
      fecha_solicitud:       { label: 'Fecha solicitud', expr: 'p.fecha_solicitud' },
      fecha_tope_devolucion: { label: 'Fecha tope', expr: 'p.fecha_tope_devolucion' },
      fecha_activacion:      { label: 'Fecha activación', expr: 'p.fecha_activacion' }
    },
    filters: {
      id_usuario:      { expr: 'p.id_usuario', op: '=' },
      estado_prestamo: { expr: 'p.estado_prestamo', op: '=' },
      es_reserva:      { expr: 'p.es_reserva', op: '=' },
      fecha_desde:     { expr: 'p.fecha_solicitud', op: '>=' },
      fecha_hasta:     { expr: 'p.fecha_solicitud', op: '<_dia_completo' }
    },
    defaultOrder: 'p.fecha_solicitud DESC'
  },

  // Entidad "ancla" para combinaciones: cada ítem individual de un préstamo,
  // con la posibilidad de sumar columnas de devolución y/o sanción vía extensiones.
  detalles_prestamos: {
    label: 'Detalles de préstamo (ítem por ítem)',
    baseQuery: `
      FROM detalles_prestamos dp
      JOIN prestamos p ON p.id_prestamo = dp.id_prestamo
      JOIN ejemplares e ON e.id_ejemplar = dp.id_ejemplar
      JOIN libros l ON l.id_libro = e.id_libro
      JOIN usuarios u ON u.id_usuario = p.id_usuario
    `,
    columns: {
      id_prestamo:               { label: 'N° Préstamo', expr: 'dp.id_prestamo' },
      id_ejemplar:               { label: 'N° Ejemplar', expr: 'dp.id_ejemplar' },
      titulo:                    { label: 'Título', expr: 'l.titulo' },
      usuario:                   { label: 'Usuario', expr: 'u.nombre_apellido' },
      estado_prestamo_ejemplar:  { label: 'Estado del ítem', expr: 'dp.estado_prestamo_ejemplar' },
      es_reserva:                { label: 'Es reserva', expr: 'dp.es_reserva' },
      observaciones:             { label: 'Observaciones', expr: 'dp.observaciones' },
      fecha_solicitud:           { label: 'Fecha de solicitud', expr: 'p.fecha_solicitud' }
    },
    filters: {
      id_usuario:               { expr: 'p.id_usuario', op: '=' },
      id_prestamo:              { expr: 'dp.id_prestamo', op: '=' },
      estado_prestamo_ejemplar: { expr: 'dp.estado_prestamo_ejemplar', op: '=' },
      es_reserva:               { expr: 'dp.es_reserva', op: '=' },
      fecha_desde:              { expr: 'p.fecha_solicitud', op: '>=' },
      fecha_hasta:              { expr: 'p.fecha_solicitud', op: '<_dia_completo' }
    },
    defaultOrder: 'p.fecha_solicitud DESC',
    extensiones: {
      devolucion: {
        label: 'Incluir datos de devolución',
        joinClause: `
          LEFT JOIN devoluciones dev
            ON dev.id_prestamo = dp.id_prestamo AND dev.id_ejemplar = dp.id_ejemplar
          LEFT JOIN usuarios bib_dev ON bib_dev.id_usuario = dev.id_bibliotecario
        `,
        columns: {
          fecha_devolucion:         { label: 'Fecha de devolución', expr: 'dev.fecha_devolucion' },
          estado_devuelto:          { label: 'Estado al devolver', expr: 'dev.estado_devuelto' },
          observaciones_devolucion: { label: 'Observaciones de devolución', expr: 'dev.observaciones' },
          bibliotecario_devolucion: { label: 'Recibido por', expr: 'bib_dev.nombre_apellido' }
        },
        filters: {
          estado_devuelto: { expr: 'dev.estado_devuelto', op: '=' }
        }
      },
      sancion: {
        label: 'Incluir datos de sanción',
        joinClause: `
          LEFT JOIN sanciones s
            ON s.id_prestamo = dp.id_prestamo AND s.id_ejemplar = dp.id_ejemplar
        `,
        columns: {
          tipo_infraccion: { label: 'Tipo de infracción', expr: 's.tipo_infraccion' },
          estado_sancion:  { label: 'Estado de la sanción', expr: 's.estado_sancion' },
          fecha_sancion:   { label: 'Fecha de sanción', expr: 's.fecha_sancion' },
          dias_suspension: { label: 'Días de suspensión', expr: 's.dias_suspension' }
        },
        filters: {
          estado_sancion:  { expr: 's.estado_sancion', op: '=' },
          tipo_infraccion: { expr: 's.tipo_infraccion', op: '=' }
        }
      }
    }
  },

  devoluciones: {
    label: 'Devoluciones',
    baseQuery: `
      FROM devoluciones dev
      JOIN prestamos p ON p.id_prestamo = dev.id_prestamo
      JOIN usuarios u ON u.id_usuario = p.id_usuario
      JOIN usuarios bib ON bib.id_usuario = dev.id_bibliotecario
      JOIN ejemplares e ON e.id_ejemplar = dev.id_ejemplar
      JOIN libros l ON l.id_libro = e.id_libro
    `,
    columns: {
      id_devolucion:    { label: 'N° Devolución', expr: 'dev.id_devolucion' },
      id_prestamo:      { label: 'N° Préstamo', expr: 'dev.id_prestamo' },
      titulo:           { label: 'Título', expr: 'l.titulo' },
      usuario:          { label: 'Usuario', expr: 'u.nombre_apellido' },
      bibliotecario:    { label: 'Recibido por', expr: 'bib.nombre_apellido' },
      estado_devuelto:  { label: 'Estado al devolver', expr: 'dev.estado_devuelto' },
      fecha_devolucion: { label: 'Fecha de devolución', expr: 'dev.fecha_devolucion' },
      observaciones:    { label: 'Observaciones', expr: 'dev.observaciones' }
    },
    filters: {
      id_usuario:       { expr: 'p.id_usuario', op: '=' },
      estado_devuelto:  { expr: 'dev.estado_devuelto', op: '=' },
      fecha_desde:      { expr: 'dev.fecha_devolucion', op: '>=' },
      fecha_hasta:      { expr: 'dev.fecha_devolucion', op: '<_dia_completo' }
    },
    defaultOrder: 'dev.fecha_devolucion DESC'
  },

  sanciones: {
    label: 'Sanciones',
    baseQuery: `FROM sanciones s JOIN usuarios u ON u.id_usuario = s.id_usuario`,
    columns: {
      id_sancion:      { label: 'N° Sanción', expr: 's.id_sancion' },
      usuario:         { label: 'Usuario', expr: 'u.nombre_apellido' },
      tipo_infraccion: { label: 'Tipo de infracción', expr: 's.tipo_infraccion' },
      estado_sancion:  { label: 'Estado', expr: 's.estado_sancion' },
      fecha_sancion:   { label: 'Fecha', expr: 's.fecha_sancion' },
      dias_suspension: { label: 'Días de suspensión', expr: 's.dias_suspension' }
    },
    filters: {
      id_usuario:      { expr: 's.id_usuario', op: '=' },
      tipo_infraccion: { expr: 's.tipo_infraccion', op: '=' },
      estado_sancion:  { expr: 's.estado_sancion', op: '=' },
      fecha_desde:     { expr: 's.fecha_sancion', op: '>=' },
      fecha_hasta:     { expr: 's.fecha_sancion', op: '<=' }
    },
    defaultOrder: 's.fecha_sancion DESC'
  },

  usuarios: {
    label: 'Usuarios',
    baseQuery: `FROM usuarios u JOIN tipo_usuarios t ON t.id_tipo_usuario = u.id_tipo_usuario`,
    columns: {
      id_usuario: { label: 'N° Usuario', expr: 'u.id_usuario' },
      nombre:     { label: 'Nombre', expr: 'u.nombre_apellido' },
      correo:     { label: 'Correo', expr: 'u.correo' },
      rol:        { label: 'Rol', expr: 't.nombre_tipo' },
      activo:     { label: 'Activo', expr: 'u.activo' },
      sancionado: { label: 'Sancionado', expr: 'u.sancionado' }
    },
    filters: {
      rol:        { expr: 't.nombre_tipo', op: '=' },
      activo:     { expr: 'u.activo', op: '=' },
      sancionado: { expr: 'u.sancionado', op: '=' }
    },
    defaultOrder: 'u.nombre_apellido ASC'
  }
}

module.exports = { REPORT_ENTITIES }