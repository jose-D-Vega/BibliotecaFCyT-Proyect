# 📚 BibliotecaFCyT - Sistema de Gestión de Biblioteca

Sistema completo de gestión de biblioteca desarrollado con **Node.js/Express** y **PostgreSQL**. Permite administrar libros, copias, préstamos, usuarios y actividades con autenticación segura mediante JWT y Google OAuth.

---

## 🎯 Características

- ✅ **Gestión de Libros** - Crear, actualizar, eliminar y listar libros
- ✅ **Control de Copias** - Administrar copias disponibles de cada libro
- ✅ **Sistema de Préstamos** - Registrar y controlar préstamos de libros
- ✅ **Gestión de Usuarios** - Crear y administrar perfiles de usuarios
- ✅ **Registro de Actividades** - Auditoría de todas las operaciones
- ✅ **Autenticación Segura** - Login con JWT y Google OAuth 2.0
- ✅ **Control de Acceso por Roles** - Autorización basada en roles de usuario
- ✅ **API REST** - Interfaz completa con CORS habilitado

---

## 🏗️ Estructura del Proyecto

```
BibliotecaFCyT-Proyect/
├── server.js                    # Punto de entrada de la aplicación
├── package.json                 # Dependencias del proyecto
├── .env.example                 # Variables de entorno (ejemplo)
│
├── public/                      # Archivos estáticos del frontend
│   ├── index.html
│   ├── agregar_libro.html
│   ├── libro.html
│   ├── inicio.html
│   ├── guardar_libro.js
│   ├── libro.js
│   └── style.css
│
├── src/
│   ├── app.js                   # Configuración de Express
│   ├── config/
│   │   ├── db.js               # Conexión a PostgreSQL
│   │   └── passport.js         # Estrategias de autenticación
│   ├── controllers/            # Lógica de negocio
│   │   ├── books.controller.js
│   │   ├── copies.controller.js
│   │   ├── loans.controller.js
│   │   ├── users.controller.js
│   │   ├── activity.controller.js
│   │   └── paginaController.js
│   ├── middlewares/            # Middleware personalizado
│   │   ├── auth.js            # Verificación de JWT
│   │   └── roles.js           # Control de roles
│   ├── routes/                 # Definición de endpoints
│   │   ├── api.route.js
│   │   ├── auth.routes.js
│   │   ├── books.routes.js
│   │   ├── copies.routes.js
│   │   ├── loans.routes.js
│   │   ├── users.routes.js
│   │   ├── activity.routes.js
│   │   ├── health.routes.js
│   │   └── pagina.route.js
│   ├── queries/                # Consultas a base de datos
│   │   ├── books.queries.js
│   │   ├── copies.queries.js
│   │   ├── loans.queries.js
│   │   ├── users.queries.js
│   │   ├── activity.queries.js
│   │   └── session.queries.js
│   └── services/               # Servicios reutilizables
│
└── views/                      # Vistas (si aplica)
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
Crear archivo `.env` en la raíz del proyecto:
```env
# Puerto del servidor
PORT=3000

# Base de datos PostgreSQL
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/bibliotecafcyt

# Secreto JWT
JWT_SECRET=tu-secreto-super-seguro

# Google OAuth
GOOGLE_CLIENT_ID=tu-cliente-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu-cliente-secreto

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Ambiente
NODE_ENV=development
```

### 4. Inicializar base de datos
Ejecutar las migraciones/scripts SQL necesarios:
```bash
# Crear esquema de BD (desde tu gestor SQL)
psql -U usuario -d bibliotecafcyt -f ./database/schema.sql
```

### 5. Iniciar el servidor
```bash
# Modo desarrollo (con nodemon)
npm run dev

# Modo producción
npm start
```

El servidor estará disponible en: `http://localhost:3000`

---

## 📡 Endpoints de la API

### Health Check
```
GET /api/health - Verificar estado del servidor
```

### Autenticación
```
POST   /api/auth/register       - Registrar nuevo usuario
POST   /api/auth/login          - Login con credenciales
GET    /api/auth/google         - Login con Google
GET    /api/auth/google/callback - Callback de Google
POST   /api/auth/logout         - Cerrar sesión
```

### Libros
```
GET    /api/books               - Listar libros
GET    /api/books/:id           - Obtener libro específico
POST   /api/books               - Crear nuevo libro (admin)
PUT    /api/books/:id           - Actualizar libro (admin)
DELETE /api/books/:id           - Eliminar libro (admin)
```

### Copias
```
GET    /api/books/:id_libro/copies        - Listar copias de un libro
POST   /api/books/:id_libro/copies        - Agregar copia (admin)
PUT    /api/books/:id_libro/copies/:id    - Actualizar copia (admin)
DELETE /api/books/:id_libro/copies/:id    - Eliminar copia (admin)
```

### Préstamos
```
GET    /api/loans               - Listar préstamos
POST   /api/loans               - Crear nuevo préstamo
PUT    /api/loans/:id/return    - Registrar devolución
GET    /api/loans/user/:id_user - Préstamos de un usuario
```

### Usuarios
```
GET    /api/users               - Listar usuarios (admin)
GET    /api/users/:id           - Obtener perfil de usuario
PUT    /api/users/:id           - Actualizar perfil
DELETE /api/users/:id           - Eliminar usuario (admin)
```

### Actividades
```
GET    /api/activity            - Listar todas las actividades
GET    /api/activity/user/:id   - Actividades de un usuario
```

---

## 🔐 Autenticación y Autorización

El proyecto utiliza **JWT (JSON Web Tokens)** para proteger los endpoints.

### Sistema de Roles
- **admin** - Acceso total (crear, editar, eliminar)
- **user** - Lectura y crear préstamos
- **guest** - Solo lectura

### Uso de Middlewares
```javascript
// Verificar autenticación
const { authenticate } = require('./middlewares/auth')

// Verificar role específico
const { authorize } = require('./middlewares/roles')

// Aplicar a una ruta
app.post('/api/books', authenticate, authorize('admin'), createBook)
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

# Ejecutar tests (por implementar)
npm test
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

## 🧪 Testing (Próximamente)

Para ejecutar tests unitarios:
```bash
npm test
```

---

## 📚 Documentación Adicional

- [Express.js Documentation](https://expressjs.com/)
- [Passport.js Documentation](http://www.passportjs.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [JWT Documentation](https://jwt.io/)

---

## 🤝 Contribuir

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

---

## 📄 Licencia

Este proyecto está bajo la licencia **ISC**.

---

## ✨ Autor

**Equipo de Ingeniería de Software II**  
*UNCA - FCyT - 7º Semestre*

---

## 📞 Soporte

Para reportar problemas o sugerencias, abre un **Issue** en el repositorio.

---

**Última actualización:** 23 de Abril de 2026
