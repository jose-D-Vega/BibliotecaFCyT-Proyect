const express = require('express');
const path = require('path');
const pool = require('./db');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get('/api', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM libros');
        res.json(resultado.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al consultar la base de datos' });
    }
});

app.get('/insert', (req, res) => {
    res.status(200)
    .sendFile(path.join(__dirname, '/public/libro.html'));
});

app.get('/', (req, res) => {
    res.status(200)
    .sendFile(path.join(__dirname, '/public/inicio.html'));
});

app.post('/libros', async (req, res) => {
    const {
        titulo, autor, anio_publicacion, cantidad_ejemplar,
        editorial, ciudad, carrera, facultad, tipo_material
    } = req.body;

    try {
        const resultado = await pool.query(
            `INSERT INTO libros 
                (titulo, autor, anio_publicacion, cantidad_ejemplar, editorial, ciudad, carrera, facultad, tipo_material)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [titulo, autor, anio_publicacion, cantidad_ejemplar, editorial, ciudad, carrera, facultad, tipo_material]
        );
        console.log(resultado);
        res.status(201).json(resultado.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al insertar el libro, lpm' });
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Servidor corriendo en puerto ${process.env.PORT}`);
});