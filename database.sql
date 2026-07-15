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