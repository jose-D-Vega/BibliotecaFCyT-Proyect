const path = require('path');

const paginaController = {
    mostrarInicio:  (req, res) => {
        res.status(200)
        .sendFile(path.join(__dirname, '../public/inicio.html'));
    },
    mostrarInsertLibros: (req, res) => {
        res.status(200)
        .sendFile(path.join(__dirname, '../public/libro.html'));
    },

}

module.exports = paginaController;