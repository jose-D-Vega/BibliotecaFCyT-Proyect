const pool = require('../db');

const librosController = {
    insertarLibro: async (req, res) => {
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
            res.status(201).json(resultado.rows[0]);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error al insertar el libro, lpm' });
        }
    },
    
    mostrarJson: async (req, res) => {
        try {
            const resultado = await pool.query('SELECT * FROM libros');
            res.json(resultado.rows);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error al consultar la base de datos' });
        }
    },
}

module.exports = librosController;