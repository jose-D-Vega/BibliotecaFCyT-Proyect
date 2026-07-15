// Whitelist de entidades reportables. Agregar un reporte nuevo = agregar un bloque acá,
// sin tocar controller ni queries.
const REPORT_ENTITIES = {
  ejemplares: {
    label: 'Materiales (Ejemplares)',
    baseQuery: `
      FROM ejemplares e
      JOIN libros l ON l.id_libro = e.id_libro
    `,
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
      carrera:         { expr: 'l.carrera', op: '=' },
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
      fecha_hasta:     { expr: 'p.fecha_solicitud', op: '<_dia_completo' } // caso especial, ver builder
    },
    defaultOrder: 'p.fecha_solicitud DESC'
  },

  sanciones: {
    label: 'Sanciones',
    baseQuery: `
      FROM sanciones s
      JOIN usuarios u ON u.id_usuario = s.id_usuario
    `,
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
    baseQuery: `
      FROM usuarios u
      JOIN tipo_usuarios t ON t.id_tipo_usuario = u.id_tipo_usuario
    `,
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