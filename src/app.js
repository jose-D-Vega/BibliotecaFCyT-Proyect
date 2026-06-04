const express = require('express')
const cors = require('cors')
const passport = require('./config/passport')
require('dotenv').config()

const healthRoutes = require('./routes/health.routes')
const booksRoutes = require('./routes/books.routes')
const copiesRoutes = require('./routes/copies.routes')
const authRoutes = require('./routes/auth.routes')
const usersRoutes = require('./routes/users.routes')
const loansRoutes = require('./routes/loans.routes')
const activityRoutes = require('./routes/activity.routes')
const sessionRoutes = require('./routes/session.routes')
const notificationsRoutes = require('./routes/notifications.routes')
const returnsRoutes = require('./routes/returns.routes')

const app = express()

// Middlewares globales
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(passport.initialize()) 

// Rutas
app.use('/api/health', healthRoutes)
app.use('/api/books', booksRoutes)
app.use('/api/books/:id_libro/copies', copiesRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/loans', loansRoutes)
app.use('/api/activity', activityRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/returns', returnsRoutes)

// Ruta base — por si alguien entra a la raíz del servidor
app.get('/', (req, res) => {
  res.json({ message: 'API BibliotecaFCyT' })
})

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

module.exports = app