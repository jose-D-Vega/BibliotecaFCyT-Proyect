# 📚 BibliotecaFCyT - Sistema de Gestión de Biblioteca

Sistema completo de gestión de biblioteca desarrollado con **Node.js/Express** y **PostgreSQL**. Permite administrar libros, copias, préstamos, usuarios, sanciones y actividades con autenticación segura mediante JWT y Google OAuth.

---

## 🎯 Características

- ✅ **Gestión de Libros** - Crear, actualizar, eliminar y listar libros
- ✅ **Control de Copias** - Administrar copias disponibles de cada libro
- ✅ **Sistema de Préstamos** - Registrar y controlar préstamos de libros
- ✅ **Sistema de Devoluciones** - Gestión de devoluciones de libros
- ✅ **Sistema de Sanciones** - Control de sanciones por retrasos o daños
- ✅ **Notificaciones** - Sistema de notificaciones para usuarios
- ✅ **Gestión de Usuarios** - Crear y administrar perfiles de usuarios
- ✅ **Registro de Actividades** - Auditoría de todas las operaciones
- ✅ **Control de Sesiones** - Seguimiento de sesiones activas
- ✅ **Autenticación Segura** - Login con JWT y Google OAuth 2.0
- ✅ **Control de Acceso por Roles** - Autorización basada en roles (admin, bibliotecario, normal)
- ✅ **Subida de Imágenes** - Upload de portadas con Multer + Supabase
- ✅ **API REST** - Interfaz completa con CORS habilitado
- ✅ **Manejo Global de Errores** - Middleware centralizado de errores

---

## 🏗️ Estructura del Proyecto

```
BibliotecaFCyT-Proyect/
├── server.js # Punto de entrada de la aplicación
├── package.json # Dependencias del proyecto
├── .env.example # Variables de entorno (ejemplo)
│
├── src/
│ ├── app.js # Configuración de Express y registro de rutas
│ ├── config/
│ │ ├── db.js # Conexión a PostgreSQL
│ │ ├── passport.js # Estrategias de autenticación (Google OAuth)
│ │ └── supabase.js # Cliente Supabase (almacenamiento)
│ ├── controllers/ # Lógica de negocio
│ │ ├── auth.controller.js
│ │ ├── books.controller.js
│ │ ├── copies.controller.js
│ │ ├── loans.controller.js
│ │ ├── returns.controller.js
│ │ ├── sanctions.controller.js
│ │ ├── users.controller.js
│ │ ├── activity.controller.js
│ │ ├── notifications.controller.js
│ │ └── session.controller.js
│ ├── middlewares/ # Middleware personalizado
│ │ ├── auth.js # Verificación de JWT (verifyToken)
│ │ ├── roles.js # Control de roles (isAdmin, isBibliotecario, isNormal)
│ │ ├── upload.js # Multer para subida de imágenes
│ │ └── error.middleware.js # Manejo global de errores
│ ├── routes/ # Definición de endpoints
│ │ ├── auth.routes.js
│ │ ├── books.routes.js
│ │ ├── copies.routes.js
│ │ ├── loans.routes.js
│ │ ├── returns.routes.js
│ │ ├── sanctions.routes.js
│ │ ├── users.routes.js
│ │ ├── activity.routes.js
│ │ ├── health.routes.js
│ │ ├── notifications.routes.js
│ │ └── session.routes.js
│ ├── queries/ # Consultas a base de datos
│ │ ├── books.queries.js
│ │ ├── copies.queries.js
│ │ ├── loans.queries.js
│ │ ├── returns.queries.js
│ │ ├── sanctions.queries.js
│ │ ├── users.queries.js
│ │ ├── activity.queries.js
│ │ ├── notifications.queries.js
│ │ └── session.queries.js
│ ├── jobs/
│ │ └── loan.checker.js # Job automático para préstamos vencidos
│ ├── utils/
│ │ ├── validators.js # Validadores reutilizables
│ │ └── storage.js # Utilidades de almacenamiento
│ └── services/ # Servicios reutilizables
│
└── .env # Variables de entorno (no subir a git)
```

---

## 🛠️ Tecnologías Utilizadas

| Tecnología | Versión | Propósito |
|-----------|---------|----------|
| **Node.js** | LTS | Runtime de JavaScript |
| **Express.js** | 5.2.1 | Framework web |
| **PostgreSQL** | 8.20.0 | Base de datos |
| **Passport.js** | 0.7.0 | Autenticación |
| **JWT** | 9.0.3 | Tokens de autorización |
| **Google OAuth 2.0** | 2.0.0 | Login social |
| **CORS** | 2.8.6 | Compartir recursos entre dominios |
| **dotenv** | 17.3.1 | Variables de entorno |
| **Multer** | 2.1.1 | Subida de archivos |
| **Supabase** | 2.105.1 | Almacenamiento en la nube |
| **node-cron** | 4.2.1 | Jobs programados |
| **Nodemon** | 3.1.14 | Reinicio automático (dev) |

---

## 📋 Requisitos Previos

- **Node.js** (v14 o superior)
- **PostgreSQL** (v12 o superior)
- **npm** o **yarn**

---

## 🚀 Instalación

### 1. Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/BibliotecaFCyT-Proyect.git
cd BibliotecaFCyT-Proyect
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Copiar `.env.example` a `.env` y completar los valores:
```env
PORT=3210
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/bibliotecafcyt
JWT_SECRET=tu-secreto-super-seguro
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=tu_client_id_de_google
GOOGLE_CLIENT_SECRET=tu_client_secret_de_google
GOOGLE_CALLBACK_URL=http://localhost:3210/api/auth/google/callback
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=tu-service-role-key
NODE_ENV=development
```

### 4. Iniciar el servidor
```bash
# Modo desarrollo (con nodemon)
npm run dev

# Modo producción
npm start
```

El servidor estará disponible en: `http://localhost:3210`

---

## 📡 Endpoints de la API

### Health Check
```
GET    /api/health                          - Verificar estado del servidor
```

### Autenticación
```
GET    /api/auth/google                     - Iniciar login con Google (redirige a Google)
GET    /api/auth/google/callback            - Callback de Google; genera y devuelve el JWT
GET    /api/auth/me                         - Obtener datos del usuario autenticado          🔒 Requiere auth
```

### Libros
```
GET    /api/books                           - Listar libros (filtros y paginación)
GET    /api/books/:id                       - Obtener libro por ID
POST   /api/books                           - Crear nuevo libro (con imagen)                 🔒 bibliotecario / admin
PUT    /api/books/:id                       - Actualizar libro (con imagen)                  🔒 bibliotecario / admin
DELETE /api/books/:id                       - Eliminar libro                                 🔒 admin
```

### Ejemplares (Copias)
```
GET    /api/books/:id_libro/copies          - Listar ejemplares de un libro
GET    /api/books/:id_libro/copies/:id      - Obtener un ejemplar
POST   /api/books/:id_libro/copies          - Agregar ejemplar                               🔒 bibliotecario / admin
PATCH  /api/books/:id_libro/copies/:id/estado - Cambiar estado del ejemplar                  🔒 admin
DELETE /api/books/:id_libro/copies/:id      - Eliminar ejemplar                              🔒 admin
```

### Préstamos
```
GET    /api/loans                           - Listar préstamos (según rol del usuario)       🔒 Requiere auth
GET    /api/loans/:id                       - Obtener detalle de un préstamo                 🔒 Requiere auth
POST   /api/loans                           - Crear solicitud de préstamo                    🔒 Requiere auth
PATCH  /api/loans/:id/cancel                - Cancelar un préstamo                           🔒 Requiere auth
PATCH  /api/loans/:id/cancel-smart          - Cancelar solo ítems pendientes                 🔒 Requiere auth
PATCH  /api/loans/:id/renew                 - Solicitar renovación de préstamo               🔒 Requiere auth
PATCH  /api/loans/:id/renew/approve         - Aprobar solicitud de renovación                🔒 bibliotecario / admin
PATCH  /api/loans/:id/renew/reject          - Rechazar solicitud de renovación               🔒 bibliotecario / admin
PATCH  /api/loans/:id/detalle/:id_ejemplar  - Aprobar o rechazar un ítem del préstamo        🔒 bibliotecario / admin
PATCH  /api/loans/:id/activate              - Activar préstamo aprobado (entrega física)     🔒 bibliotecario / admin
```

### Devoluciones
```
GET    /api/returns/mis-devoluciones        - Ver mis devoluciones                           🔒 Requiere auth
GET    /api/returns/activos                 - Listar todos los préstamos activos             🔒 bibliotecario / admin
GET    /api/returns/search                  - Buscar préstamos activos                       🔒 bibliotecario / admin
GET    /api/returns/historial               - Historial de devoluciones                      🔒 bibliotecario / admin
GET    /api/returns/historial-prestamos     - Préstamos con sus devoluciones                 🔒 bibliotecario / admin
GET    /api/returns/:id                     - Detalle de préstamo para devolución            🔒 bibliotecario / admin
GET    /api/returns/:id/detalle-devoluciones - Detalle de devoluciones de un préstamo        🔒 bibliotecario / admin
POST   /api/returns/:id/devolver            - Registrar devolución de ejemplares             🔒 bibliotecario / admin
PATCH  /api/returns/prestamo/:id_prestamo/reserva-afectada/:id_ejemplar_anterior - Resolver reserva afectada 🔒 bibliotecario / admin
```

### Sanciones
```
GET    /api/sanctions/mis-sanciones                          - Mis sanciones                 🔒 Requiere auth
GET    /api/sanctions/buscar-prestamo                        - Buscar préstamos sancionables 🔒 admin
GET    /api/sanctions/prestamo/:id_prestamo/ejemplares       - Ejemplares de un préstamo     🔒 admin
GET    /api/sanctions/agrupadas                              - Sanciones agrupadas           🔒 admin
GET    /api/sanctions/prestamo/:id_prestamo                  - Sanciones de un préstamo      🔒 admin
GET    /api/sanctions                                        - Listar todas las sanciones    🔒 bibliotecario / admin
GET    /api/sanctions/:id                                    - Obtener sanción por ID        🔒 bibliotecario / admin
POST   /api/sanctions                                        - Crear sanción                 🔒 admin
PATCH  /api/sanctions/:id/confirmar                          - Confirmar sanción             🔒 admin
PATCH  /api/sanctions/:id/rechazar                           - Rechazar sanción              🔒 admin
PATCH  /api/sanctions/:id/resolver                           - Resolver sanción              🔒 admin
PATCH  /api/sanctions/:id/escalar                            - Escalar sanción               🔒 admin
```

### Usuarios
```
GET    /api/users/tipos                     - Listar tipos de usuario                        🔒 Requiere auth
GET    /api/users                           - Listar todos los usuarios                      🔒 admin
GET    /api/users/:id                       - Obtener perfil de usuario                      🔒 Requiere auth
PUT    /api/users/me                        - Actualizar propio perfil (CI, teléfono)        🔒 Requiere auth
PATCH  /api/users/:id/rol                   - Cambiar rol de un usuario                      🔒 admin
PATCH  /api/users/:id/activo                - Activar o desactivar cuenta                    🔒 admin
PATCH  /api/users/:id/telefono              - Actualizar teléfono de un usuario              🔒 admin
DELETE /api/users/:id                       - Eliminar usuario                               🔒 admin
```

### Actividades
```
GET    /api/activity                        - Historial de actividades del sistema           🔒 bibliotecario / admin
```

### Notificaciones
```
GET    /api/notifications                   - Ver mis notificaciones                         🔒 Requiere auth
PATCH  /api/notifications/:id/leida         - Marcar notificación como leída                 🔒 Requiere auth
PATCH  /api/notifications/leidas            - Marcar todas las notificaciones como leídas    🔒 Requiere auth
```

### Sesiones
```
GET    /api/sessions                        - Ver historial de sesiones                      🔒 admin
```

---

## 🔐 Autenticación y Autorización

El sistema usa **Google OAuth 2.0** restringido al dominio institucional `@fctunca.edu.py`. Al autenticarse, el backend genera un **JWT** que el cliente debe enviar en el header de cada request protegido.

**Header requerido en rutas protegidas:**
```
Authorization: Bearer <token>
```


### Sistema de Roles
- **admin** - Acceso total al sistema
- **bibliotecario** - Gestión de préstamos, devoluciones, libros y actividad
- **normal** - Consultas, solicitud de préstamos y perfil propio

### Middlewares disponibles
```javascript
const { verifyToken } = require('./middlewares/auth')       // Verifica el JWT
const { isAdmin } = require('./middlewares/roles')          // admin o bibliotecario
const { isBibliotecario } = require('./middlewares/roles')  // bibliotecario o admin
const { isNormal } = require('./middlewares/roles')         // cualquier usuario autenticado
```

---

## 📝 Scripts Disponibles

```bash
# Instalar dependencias
npm install

# Iniciar desarrollo (con hot-reload)
npm run dev

# Iniciar producción
npm start
```

---

## 🔧 Configuración de Base de Datos

### Conexión PostgreSQL
La conexión se configura en `src/config/db.js`:
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

module.exports = pool;
```

---

## ✨ Autores

**Equipo de Ingeniería en Informática — Programación Web I**  
- José Santos David Vega Acosta.
- Alejandro Manuel Villalba Irigoitia.
- Carina Velazquez Rodríguez.

*FCyT — Universidad Nacional de Caaguazú*

---

**Última actualización:** 23 de Junio de 2026