-- ============================================================
-- seed.sql — BibliotecaFCyT
-- Datos de prueba para desarrollo local.
--
-- Requisitos: ejecutar DESPUÉS de database.sql (el esquema debe existir).
-- Uso:
--   Supabase -> SQL Editor -> pegar y ejecutar
--   PostgreSQL local -> psql -U tu_usuario -d bibliotecafcyt -f seed.sql
--
-- Es idempotente-friendly: podés correrlo sobre una base ya sembrada,
-- las secciones borran sus propios datos antes de insertar (ver TRUNCATE).
-- ============================================================

BEGIN;

-- Limpieza en orden inverso a las dependencias (evita error de FK)
TRUNCATE TABLE
  notificaciones,
  historial_actividades,
  sesiones,
  devoluciones,
  sanciones,
  detalles_prestamos,
  prestamos,
  ejemplares,
  libros,
  usuarios,
  tipo_usuarios
RESTART IDENTITY CASCADE;

-- ============================================================
-- 1. tipo_usuarios
-- ============================================================
INSERT INTO tipo_usuarios (nombre_tipo, descripcion) VALUES
  ('normal',        'Usuario estándar: estudiante o docente'),
  ('bibliotecario', 'Gestiona préstamos, devoluciones y catálogo'),
  ('admin',         'Administración completa del sistema');
-- id_tipo_usuario: 1 = normal, 2 = bibliotecario, 3 = admin

-- ============================================================
-- 2. usuarios
-- Nota: la auth es solo por Google OAuth (columna google_id).
-- Para poder loguearte como alguno de estos usuarios en desarrollo,
-- actualizá su google_id con el de tu cuenta de Google real:
--   UPDATE usuarios SET google_id = 'TU_GOOGLE_ID' WHERE correo = 'admin@fcyt.una.py';
-- ============================================================
INSERT INTO usuarios (nombre_apellido, ci, telefono, correo, sancionado, google_id, id_tipo_usuario, activo) VALUES
  ('Ana Administradora',    '1000001', '0981000001', 'admin@fcyt.una.py',         false, NULL, 3, true),
  ('Beto Bibliotecario',    '1000002', '0981000002', 'bibliotecario@fcyt.una.py', false, NULL, 2, true),
  ('Carla Bibliotecaria',   '1000003', '0981000003', 'bibliotecaria2@fcyt.una.py',false, NULL, 2, true),
  ('Diego Estudiante',      '1000004', '0981000004', 'diego.estudiante@fcyt.una.py', false, NULL, 1, true),
  ('Elena Estudiante',      '1000005', '0981000005', 'elena.estudiante@fcyt.una.py', false, NULL, 1, true),
  ('Fabio Sancionado',      '1000006', '0981000006', 'fabio.sancionado@fcyt.una.py', true,  NULL, 1, true),
  ('Gloria Docente',        '1000007', '0981000007', 'gloria.docente@fcyt.una.py',   false, NULL, 1, true),
  ('Hugo Inactivo',         '1000008', '0981000008', 'hugo.inactivo@fcyt.una.py',    false, NULL, 1, false);
-- id_usuario: 1 Ana(admin) 2 Beto(biblio) 3 Carla(biblio) 4 Diego 5 Elena 6 Fabio 7 Gloria 8 Hugo

-- ============================================================
-- 3. libros
-- ============================================================
INSERT INTO libros (titulo, autor, cantidad_ejemplar, ciudad, facultad, tipo_material, anio_publicacion, editorial, carrera, activo, imagen_url) VALUES
  ('Cálculo I',                         'James Stewart',        3, 'Coronel Oviedo', 'FCyT', 'libro',  2018, 'Cengage',    'Ingeniería Informática', true, NULL),
  ('Álgebra Lineal',                    'Gilbert Strang',       2, 'Coronel Oviedo', 'FCyT', 'libro',  2016, 'Wellesley',  'Ingeniería Informática', true, NULL),
  ('Estructuras de Datos y Algoritmos', 'Robert Sedgewick',     4, 'Coronel Oviedo', 'FCyT', 'libro',  2015, 'Pearson',    'Ingeniería Informática', true, NULL),
  ('Bases de Datos: Diseño y Gestión',  'Elmasri & Navathe',    2, 'Coronel Oviedo', 'FCyT', 'libro',  2017, 'Pearson',    'Ingeniería Informática', true, NULL),
  ('Redes de Computadoras',             'Andrew Tanenbaum',     2, 'Coronel Oviedo', 'FCyT', 'libro',  2013, 'Pearson',    'Ingeniería Informática', true, NULL),
  ('Circuitos Eléctricos',              'James Nilsson',        2, 'Coronel Oviedo', 'FCyT', 'libro',  2015, 'Pearson',    'Ingeniería Eléctrica',   true, NULL),
  ('Física General',                    'Raymond Serway',       3, 'Coronel Oviedo', 'FCyT', 'libro',  2014, 'Cengage',    'Ingeniería Eléctrica',   true, NULL),
  ('Ingeniería de Software',            'Ian Sommerville',      2, 'Coronel Oviedo', 'FCyT', 'libro',  2019, 'Pearson',    'Ingeniería Informática', true, NULL),
  ('Tesis: Sistemas Distribuidos aplicados a IoT', 'M. Fernández', 1, 'Coronel Oviedo', 'FCyT', 'tfg', 2021, NULL, 'Ingeniería Informática', true, NULL);

-- ============================================================
-- 4. ejemplares (cantidad acorde a libros.cantidad_ejemplar)
-- ============================================================
INSERT INTO ejemplares (estado_ejemplar, id_libro) VALUES
  ('disponible', 1), ('disponible', 1), ('prestado', 1),
  ('disponible', 2), ('disponible', 2),
  ('disponible', 3), ('disponible', 3), ('disponible', 3), ('prestado', 3),
  ('disponible', 4), ('reservado', 4),
  ('disponible', 5), ('deteriorado', 5),
  ('disponible', 6), ('disponible', 6),
  ('disponible', 7), ('disponible', 7), ('prestado', 7),
  ('disponible', 8), ('perdido', 8),
  ('disponible', 9),
  ('disponible', 10);

-- ============================================================
-- 5. prestamos + detalles_prestamos
-- ============================================================

-- Préstamo activo de Diego (id_usuario 4), aprobado por Beto (id_usuario 2)
INSERT INTO prestamos (fecha_solicitud, fecha_tope_devolucion, estado_prestamo, id_usuario, id_bibliotecario, fecha_respuesta, fecha_activacion, es_reserva, numero_renovacion)
VALUES (now() - interval '5 days', CURRENT_DATE + 2, 'activo', 4, 2, now() - interval '5 days', now() - interval '4 days', false, 0);

INSERT INTO detalles_prestamos (id_prestamo, id_ejemplar, observaciones, estado_prestamo_ejemplar, es_reserva)
VALUES (1, 3, 'Cálculo I - ejemplar en préstamo activo', 'activo', false);

-- Préstamo vencido de Fabio (id_usuario 6) — motivo de su sanción
INSERT INTO prestamos (fecha_solicitud, fecha_tope_devolucion, estado_prestamo, id_usuario, id_bibliotecario, fecha_respuesta, fecha_activacion, es_reserva, numero_renovacion)
VALUES (now() - interval '20 days', CURRENT_DATE - 5, 'vencido', 6, 2, now() - interval '20 days', now() - interval '19 days', false, 0);

INSERT INTO detalles_prestamos (id_prestamo, id_ejemplar, observaciones, estado_prestamo_ejemplar, es_reserva)
VALUES (2, 9, 'Estructuras de Datos - vencido, sin devolver', 'activo', false);

-- Préstamo ya devuelto de Elena (id_usuario 5)
INSERT INTO prestamos (fecha_solicitud, fecha_tope_devolucion, estado_prestamo, id_usuario, id_bibliotecario, fecha_respuesta, fecha_activacion, es_reserva, numero_renovacion)
VALUES (now() - interval '15 days', CURRENT_DATE - 8, 'devuelto', 5, 3, now() - interval '15 days', now() - interval '14 days', false, 0);

INSERT INTO detalles_prestamos (id_prestamo, id_ejemplar, observaciones, estado_prestamo_ejemplar, es_reserva)
VALUES (3, 18, 'Física General - devuelto en buen estado', 'devuelto', false);

-- Solicitud pendiente de aprobación de Gloria (id_usuario 7)
INSERT INTO prestamos (fecha_solicitud, fecha_tope_devolucion, estado_prestamo, id_usuario, es_reserva, numero_renovacion)
VALUES (now() - interval '1 day', CURRENT_DATE + 7, 'solicitado', 7, false, 0);

INSERT INTO detalles_prestamos (id_prestamo, id_ejemplar, observaciones, estado_prestamo_ejemplar, es_reserva)
VALUES (4, 10, 'Bases de Datos - solicitud pendiente', 'solicitado', false);

-- ============================================================
-- 6. devoluciones (referencia al préstamo #3, ya devuelto)
-- ============================================================
INSERT INTO devoluciones (id_prestamo, id_ejemplar, id_bibliotecario, fecha_devolucion, estado_devuelto, observaciones)
VALUES (3, 18, 3, now() - interval '8 days', 'bueno', 'Devolución sin novedades');

-- ============================================================
-- 7. sanciones (Fabio, por el préstamo vencido #2)
-- ============================================================
INSERT INTO sanciones (id_prestamo, id_ejemplar, id_usuario, tipo_infraccion, descripcion_sancion, estado_sancion, id_admin, fecha_limite, dias_suspension, fecha_fin_suspension)
VALUES (2, 9, 6, 'devolucion_tardia', 'Préstamo vencido hace más de 5 días sin devolución', 'activa', 1, CURRENT_DATE + 10, 15, CURRENT_DATE + 15);

-- ============================================================
-- 8. notificaciones
-- ============================================================
INSERT INTO notificaciones (id_usuario, tipo, titulo, mensaje, id_prestamo, leida, rol_destino) VALUES
  (4, 'prestamo_activado',  'Préstamo activado',        'Tu préstamo de "Cálculo I" fue activado. Fecha de devolución: en 2 días.', 1, false, 'normal'),
  (6, 'prestamo_vencido',   'Préstamo vencido',         'Tu préstamo de "Estructuras de Datos y Algoritmos" está vencido.',        2, false, 'normal'),
  (6, 'sancion_recibida',   'Sanción recibida',         'Se te aplicó una sanción por devolución tardía.',                          NULL, false, 'normal'),
  (7, 'prestamo_por_vencer','Solicitud en revisión',    'Tu solicitud de "Bases de Datos: Diseño y Gestión" está pendiente de aprobación.', 4, false, 'normal'),
  (2, 'admin_renovacion_pendiente', 'Nueva solicitud',  'Hay una nueva solicitud de préstamo pendiente de revisión.',               4, false, 'bibliotecario');

-- ============================================================
-- 9. historial_actividades
-- ============================================================
INSERT INTO historial_actividades (id_usuario, tipo_accion, entidad, id_entidad, descripcion) VALUES
  (2, 'aprobar',   'prestamo', 1, 'Beto Bibliotecario aprobó y activó el préstamo #1 de Diego Estudiante'),
  (3, 'devolver',  'prestamo', 3, 'Carla Bibliotecaria registró la devolución del préstamo #3 de Elena Estudiante'),
  (1, 'sancionar', 'sancion',  1, 'Ana Administradora confirmó la sanción #1 sobre Fabio Sancionado'),
  (1, 'crear',     'libro',    1, 'Ana Administradora cargó el libro "Cálculo I" al catálogo');

-- ============================================================
-- 10. sesiones (ejemplo de sesión activa)
-- ============================================================
INSERT INTO sesiones (id_usuario, fecha_ingreso, sid, ultima_actividad, fecha_expiracion, estado, ip, user_agent)
VALUES (4, now() - interval '1 hour', gen_random_uuid(), now() - interval '5 minutes', now() + interval '23 hours', 'Activo', '127.0.0.1', 'Mozilla/5.0 (seed data)');

COMMIT;

-- ============================================================
-- Verificación rápida
-- ============================================================
-- SELECT count(*) FROM usuarios;
-- SELECT count(*) FROM libros;
-- SELECT count(*) FROM ejemplares;
-- SELECT count(*) FROM prestamos;