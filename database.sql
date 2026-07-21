-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.detalles_prestamos (
  id_prestamo integer NOT NULL,
  id_ejemplar integer NOT NULL,
  observaciones character varying NOT NULL,
  estado_prestamo_ejemplar character varying NOT NULL CHECK (estado_prestamo_ejemplar::text = ANY (ARRAY['solicitado'::text, 'aprobado'::text, 'rechazado'::text, 'activo'::text, 'devuelto'::text, 'cancelado'::text, 'perdido'::text, 'reemplazado'::text])),
  es_reserva boolean NOT NULL DEFAULT false,
  CONSTRAINT detalles_prestamos_pkey PRIMARY KEY (id_prestamo, id_ejemplar),
  CONSTRAINT id_ejemplar FOREIGN KEY (id_ejemplar) REFERENCES public.ejemplares(id_ejemplar),
  CONSTRAINT id_prestamo FOREIGN KEY (id_prestamo) REFERENCES public.prestamos(id_prestamo)
);
CREATE TABLE public.ejemplares (
  id_ejemplar integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  estado_ejemplar character varying NOT NULL CHECK (estado_ejemplar::text = ANY (ARRAY['disponible'::character varying::text, 'prestado'::character varying::text, 'reservado'::character varying::text, 'eliminado'::character varying::text, 'inhabilitado'::character varying::text, 'deteriorado'::character varying::text, 'perdido'::character varying::text, 'solicitado'::character varying::text])),
  id_libro integer NOT NULL,
  CONSTRAINT ejemplares_pkey PRIMARY KEY (id_ejemplar),
  CONSTRAINT id_libro FOREIGN KEY (id_libro) REFERENCES public.libros(id_libro)
);
CREATE TABLE public.libros (
  id_libro integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  titulo character varying NOT NULL,
  autor character varying NOT NULL,
  cantidad_ejemplar integer NOT NULL,
  ciudad character varying,
  facultad character varying,
  tipo_material character varying NOT NULL,
  anio_publicacion integer NOT NULL,
  editorial character varying,
  carrera character varying,
  activo boolean NOT NULL DEFAULT true,
  imagen_url character varying,
  CONSTRAINT libros_pkey PRIMARY KEY (id_libro)
);
CREATE TABLE public.prestamos (
  id_prestamo integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  fecha_solicitud timestamp with time zone NOT NULL DEFAULT now(),
  fecha_tope_devolucion date NOT NULL,
  estado_prestamo character varying NOT NULL CHECK (estado_prestamo::text = ANY (ARRAY['solicitado'::text, 'aprobado'::text, 'parcialmente_aprobado'::text, 'rechazado'::text, 'cancelado'::text, 'activo'::text, 'devuelto'::text, 'vencido'::text, 'pendiente_devolucion'::text, 'solicitud_renovacion'::text, 'renovado'::text, 'renovacion_finalizada'::text, 'cerrado_con_perdida'::text, 'solicitud_reserva'::text, 'reserva_aprobada'::text, 'reserva_parcialmente_aprobada'::text, 'reserva_rechazada'::text])),
  id_usuario integer NOT NULL,
  id_bibliotecario integer,
  fecha_respuesta timestamp with time zone,
  fecha_activacion timestamp with time zone,
  es_reserva boolean NOT NULL DEFAULT false,
  fecha_limite_respuesta_renovacion date,
  id_prestamo_original integer,
  numero_renovacion integer NOT NULL DEFAULT 0,
  id_bibliotecario_activacion integer,
  fecha_cancelacion timestamp with time zone,
  CONSTRAINT prestamos_pkey PRIMARY KEY (id_prestamo),
  CONSTRAINT id_usuario FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT prestamos_id_bibliotecario_fkey FOREIGN KEY (id_bibliotecario) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT prestamos_id_prestamo_original_fkey FOREIGN KEY (id_prestamo_original) REFERENCES public.prestamos(id_prestamo),
  CONSTRAINT prestamos_id_bibliotecario_activacion_fkey FOREIGN KEY (id_bibliotecario_activacion) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.usuarios (
  id_usuario integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_apellido character varying NOT NULL,
  ci character varying NOT NULL,
  telefono character varying,
  correo character varying NOT NULL,
  sancionado boolean NOT NULL,
  google_id character varying UNIQUE,
  id_tipo_usuario integer NOT NULL DEFAULT 1,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT usuarios_pkey PRIMARY KEY (id_usuario),
  CONSTRAINT usuarios_id_tipo_usuario_fkey FOREIGN KEY (id_tipo_usuario) REFERENCES public.tipo_usuarios(id_tipo_usuario)
);
CREATE TABLE public.tipo_usuarios (
  id_tipo_usuario integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  nombre_tipo character varying NOT NULL UNIQUE,
  descripcion character varying,
  CONSTRAINT tipo_usuarios_pkey PRIMARY KEY (id_tipo_usuario)
);
CREATE TABLE public.historial_actividades (
  id_actividad integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_usuario integer NOT NULL,
  tipo_accion character varying NOT NULL CHECK (tipo_accion::text = ANY (ARRAY['crear'::character varying, 'editar'::character varying, 'eliminar'::character varying, 'ocultar'::character varying, 'aprobar'::character varying, 'rechazar'::character varying, 'activar'::character varying, 'cancelar'::character varying, 'devolver'::character varying, 'sancionar'::character varying, 'cambio_rol'::character varying]::text[])),
  entidad character varying NOT NULL,
  id_entidad integer,
  descripcion character varying NOT NULL,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT historial_actividades_pkey PRIMARY KEY (id_actividad),
  CONSTRAINT id_usuario FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.sesiones (
  id_sesion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_usuario integer NOT NULL,
  fecha_ingreso timestamp with time zone NOT NULL DEFAULT now(),
  fecha_cierre timestamp with time zone,
  sid uuid,
  ultima_actividad timestamp with time zone,
  fecha_expiracion timestamp with time zone,
  estado character varying CHECK (estado::text = ANY (ARRAY['Activo'::character varying, 'Cerrada'::character varying, 'Expirada'::character varying, 'Revocada'::character varying]::text[])),
  ip character varying,
  user_agent text,
  CONSTRAINT sesiones_pkey PRIMARY KEY (id_sesion),
  CONSTRAINT id_usuario_sesion FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.notificaciones (
  id_notificacion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_usuario integer NOT NULL,
  tipo character varying NOT NULL CHECK (tipo::text = ANY (ARRAY['renovacion_aprobada'::text, 'renovacion_rechazada'::text, 'renovacion_vencida'::text, 'prestamo_por_vencer'::text, 'prestamo_vencido'::text, 'pendiente_devolucion'::text, 'reserva_disponible'::text, 'prestamo_aprobado'::text, 'prestamo_parcial'::text, 'prestamo_rechazado'::text, 'prestamo_activado'::text, 'prestamo_devuelto'::text, 'reserva_aprobada'::text, 'reserva_parcial'::text, 'reserva_rechazada'::text, 'reserva_modificada'::text, 'sancion_recibida'::text, 'sancion_resuelta'::text, 'cuenta_habilitada'::text, 'admin_renovacion_pendiente'::text, 'admin_sancion_escalada'::text, 'admin_reserva_lista'::text])),
  titulo character varying NOT NULL,
  mensaje character varying NOT NULL,
  id_prestamo integer,
  leida boolean NOT NULL DEFAULT false,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  rol_destino character varying DEFAULT 'normal'::character varying CHECK (rol_destino::text = ANY (ARRAY['normal'::character varying, 'bibliotecario'::character varying, 'admin'::character varying]::text[])),
  id_sancion integer,
  CONSTRAINT notificaciones_pkey PRIMARY KEY (id_notificacion),
  CONSTRAINT notificaciones_usuario FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT notificaciones_prestamo FOREIGN KEY (id_prestamo) REFERENCES public.prestamos(id_prestamo),
  CONSTRAINT notificaciones_id_sancion_fkey FOREIGN KEY (id_sancion) REFERENCES public.sanciones(id_sancion)
);
CREATE TABLE public.devoluciones (
  id_devolucion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_prestamo integer NOT NULL,
  id_ejemplar integer NOT NULL,
  id_bibliotecario integer NOT NULL,
  fecha_devolucion timestamp with time zone NOT NULL DEFAULT now(),
  estado_devuelto character varying NOT NULL CHECK (estado_devuelto::text = ANY (ARRAY['bueno'::character varying, 'deteriorado'::character varying, 'danado'::character varying]::text[])),
  observaciones character varying,
  CONSTRAINT devoluciones_pkey PRIMARY KEY (id_devolucion),
  CONSTRAINT devoluciones_prestamo FOREIGN KEY (id_prestamo) REFERENCES public.prestamos(id_prestamo),
  CONSTRAINT devoluciones_ejemplar FOREIGN KEY (id_ejemplar) REFERENCES public.ejemplares(id_ejemplar),
  CONSTRAINT devoluciones_bibliotecario FOREIGN KEY (id_bibliotecario) REFERENCES public.usuarios(id_usuario)
);
CREATE TABLE public.sanciones (
  id_sancion integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_prestamo integer,
  id_ejemplar integer,
  id_usuario integer NOT NULL,
  tipo_infraccion character varying NOT NULL CHECK (tipo_infraccion::text = ANY (ARRAY['falta_entrega'::character varying, 'devolucion_tardia'::character varying, 'deterioro'::character varying, 'perdida'::character varying, 'comportamiento'::character varying]::text[])),
  descripcion_sancion character varying NOT NULL,
  fecha_sancion date NOT NULL DEFAULT CURRENT_DATE,
  estado_sancion character varying NOT NULL DEFAULT 'activa'::character varying CHECK (estado_sancion::text = ANY (ARRAY['pendiente_confirmacion'::character varying, 'activa'::character varying, 'rechazada'::character varying, 'resuelta'::character varying, 'escalada'::character varying]::text[])),
  id_admin integer,
  fecha_limite date,
  dias_suspension integer,
  fecha_fin_suspension date,
  CONSTRAINT sanciones_pkey PRIMARY KEY (id_sancion),
  CONSTRAINT sanciones_prestamo FOREIGN KEY (id_prestamo) REFERENCES public.prestamos(id_prestamo),
  CONSTRAINT sanciones_ejemplar FOREIGN KEY (id_ejemplar) REFERENCES public.ejemplares(id_ejemplar),
  CONSTRAINT sanciones_id_admin_fkey FOREIGN KEY (id_admin) REFERENCES public.usuarios(id_usuario),
  CONSTRAINT sanciones_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id_usuario)
);

CREATE INDEX idx_historial_actividades_fecha ON public.historial_actividades (fecha DESC);
CREATE INDEX idx_historial_actividades_usuario ON public.historial_actividades (id_usuario);
CREATE INDEX idx_historial_actividades_entidad_accion ON public.historial_actividades (entidad, tipo_accion);

-- ============================================================
-- Índices de optimización — BibliotecaFCyT
-- ============================================================

-- ============================================================
-- Requisito para los índices de búsqueda por texto (trigram):
-- Ejecutar UNA sola vez antes de las líneas de libros_titulo_trgm/autor_trgm.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── prestamos ──
-- Foreign keys sin índice (usadas en casi todos los joins de loans.queries.js)
CREATE INDEX IF NOT EXISTS idx_prestamos_id_usuario ON public.prestamos (id_usuario);
CREATE INDEX IF NOT EXISTS idx_prestamos_id_bibliotecario ON public.prestamos (id_bibliotecario);
CREATE INDEX IF NOT EXISTS idx_prestamos_id_prestamo_original ON public.prestamos (id_prestamo_original);
CREATE INDEX IF NOT EXISTS idx_prestamos_id_bibliotecario_activacion ON public.prestamos (id_bibliotecario_activacion);

-- Columnas usadas en WHERE y ORDER BY en getLoans/countLoans
CREATE INDEX IF NOT EXISTS idx_prestamos_estado ON public.prestamos (estado_prestamo);
CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_solicitud ON public.prestamos (fecha_solicitud DESC);
CREATE INDEX IF NOT EXISTS idx_prestamos_es_reserva ON public.prestamos (es_reserva);

-- Índice compuesto: acelera el patrón más común (filtrar por usuario + ordenar por fecha)
CREATE INDEX IF NOT EXISTS idx_prestamos_usuario_fecha ON public.prestamos (id_usuario, fecha_solicitud DESC);

-- ── detalles_prestamos ──
-- La PK ya cubre (id_prestamo, id_ejemplar), pero falta el sentido inverso
-- para cuando se busca por ejemplar primero (ej: ¿qué préstamos usaron este ejemplar?)
CREATE INDEX IF NOT EXISTS idx_detalles_id_ejemplar ON public.detalles_prestamos (id_ejemplar);
CREATE INDEX IF NOT EXISTS idx_detalles_estado ON public.detalles_prestamos (estado_prestamo_ejemplar);

-- ── ejemplares ──
CREATE INDEX IF NOT EXISTS idx_ejemplares_id_libro ON public.ejemplares (id_libro);
CREATE INDEX IF NOT EXISTS idx_ejemplares_estado ON public.ejemplares (estado_ejemplar);

-- ── libros ──
CREATE INDEX IF NOT EXISTS idx_libros_activo ON public.libros (activo);
CREATE INDEX IF NOT EXISTS idx_libros_tipo_material ON public.libros (tipo_material);
-- Búsqueda de libros por título/autor (usado en BuscadorLibroFiltro, catálogo)
CREATE INDEX IF NOT EXISTS idx_libros_titulo_trgm ON public.libros USING gin (titulo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_libros_autor_trgm ON public.libros USING gin (autor gin_trgm_ops);

-- ── usuarios ──
CREATE INDEX IF NOT EXISTS idx_usuarios_id_tipo_usuario ON public.usuarios (id_tipo_usuario);
CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON public.usuarios (activo);
-- Login por correo (usado en auth.controller / passport)
CREATE INDEX IF NOT EXISTS idx_usuarios_correo ON public.usuarios (correo);

-- ── sanciones ──
CREATE INDEX IF NOT EXISTS idx_sanciones_id_usuario ON public.sanciones (id_usuario);
CREATE INDEX IF NOT EXISTS idx_sanciones_id_prestamo ON public.sanciones (id_prestamo);
CREATE INDEX IF NOT EXISTS idx_sanciones_estado ON public.sanciones (estado_sancion);

-- ── devoluciones ──
CREATE INDEX IF NOT EXISTS idx_devoluciones_id_prestamo ON public.devoluciones (id_prestamo);
CREATE INDEX IF NOT EXISTS idx_devoluciones_id_ejemplar ON public.devoluciones (id_ejemplar);

-- ── notificaciones ──
-- Muy consultada: "notificaciones no leídas del usuario X"
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_leida ON public.notificaciones (id_usuario, leida);

-- ── sesiones ──
CREATE INDEX IF NOT EXISTS idx_sesiones_id_usuario ON public.sesiones (id_usuario);
CREATE INDEX IF NOT EXISTS idx_sesiones_sid ON public.sesiones (sid);


-- Para ver el efecto real, corré ANALYZE después de crear los índices:
ANALYZE;