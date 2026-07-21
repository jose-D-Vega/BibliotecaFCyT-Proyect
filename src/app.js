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
const sanctionsRoutes = require('./routes/sanctions.routes')
const reportsRoutes = require('./routes/reports.routes')

const adminDashboardRoutes = require('./routes/adminDashboard.routes')

const errorHandler = require('./middlewares/error.middleware')

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
app.use('/api/sanctions', sanctionsRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/admin-dashboard', adminDashboardRoutes)

app.use('/api/dashboard', require('./routes/dashboard.route'))
app.use('/api/bibliotecario-dashboard', require('./routes/biblioDashboard.route'))

// Ruta base — por si alguien entra a la raíz del servidor
app.get('/', (req, res) => {
  res.json({ message: 'API BibliotecaFCyT' })
})

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

app.use(errorHandler)

module.exports = app