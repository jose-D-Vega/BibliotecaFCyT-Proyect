// Reglas de negocio de la biblioteca relacionadas a plazos de préstamos y renovaciones.
// Centralizadas acá para que un cambio de política (ej. pasar de 5 a 7 días) se haga
// en un solo lugar, en vez de buscar números sueltos repartidos por loans.queries.js.

// Días desde la activación hasta la fecha tope de devolución de un préstamo.
const DIAS_PRESTAMO_ACTIVO = 5

// Días que se suman a la fecha tope actual cuando se aprueba una renovación.
const DIAS_RENOVACION = 5

// Ventana en la que un usuario puede solicitar la renovación de su préstamo:
// solo cuando falten este número de días (o menos) para el vencimiento.
const DIAS_ANTICIPACION_SOLICITUD_RENOVACION = 1

// Cantidad máxima de renovaciones permitidas sobre un mismo préstamo original.
const MAX_RENOVACIONES = 3

// Días de plazo que tiene el bibliotecario para responder una solicitud de renovación,
// contados desde la fecha tope vigente del préstamo.
const DIAS_LIMITE_RESPUESTA_RENOVACION = 2

// Días de margen para la devolución del préstamo original cuando se rechaza
// una renovación (el usuario queda en "pendiente_devolucion" con este colchón).
const DIAS_MARGEN_DEVOLUCION_TRAS_RECHAZO_RENOVACION = 2

// Fecha "placeholder" para el campo fecha_tope_devolucion al crear una solicitud
// (todavía no hay fecha real hasta que se aprueba/activa el préstamo).
const DIAS_PLACEHOLDER_SOLICITUD = 30

// Cantidad máxima de préstamos/reservas simultáneos que puede tener un usuario.
// Cuenta cada cadena de préstamo una sola vez (un préstamo renovado no suma
// doble aunque tenga varias filas en `prestamos`), y las reservas cuentan
// igual que los préstamos activos.
const MAX_PRESTAMOS_SIMULTANEOS = 5

// Cantidad máxima de ejemplares que se pueden pedir en una misma solicitud
// (suma de las cantidades de todos los libros del carrito).
const MAX_EJEMPLARES_POR_SOLICITUD = 10

module.exports = {
  DIAS_PRESTAMO_ACTIVO,
  DIAS_RENOVACION,
  DIAS_ANTICIPACION_SOLICITUD_RENOVACION,
  MAX_RENOVACIONES,
  DIAS_LIMITE_RESPUESTA_RENOVACION,
  DIAS_MARGEN_DEVOLUCION_TRAS_RECHAZO_RENOVACION,
  DIAS_PLACEHOLDER_SOLICITUD,
  MAX_PRESTAMOS_SIMULTANEOS,
  MAX_EJEMPLARES_POR_SOLICITUD
}