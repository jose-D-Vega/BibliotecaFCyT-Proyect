const express = require('express')
const cors = require('cors')
require('dotenv').config()

const healthRoutes = require('./routes/health.routes')
const booksRoutes = require('./routes/books.routes')

const app = express()

// Middlewares globales
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Rutas
app.use('/api/health', healthRoutes)
app.use('/api/books', booksRoutes)

// Ruta base — por si alguien entra a la raíz del servidor
app.get('/', (req, res) => {
  res.json({ message: 'API BibliotecaFCyT' })
})

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

module.exports = app