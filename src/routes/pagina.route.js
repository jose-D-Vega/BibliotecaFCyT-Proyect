const express = require('express');
const route = express.Router();

const paginaController = require('../controller/paginaController');

route.get('/insert/libro', paginaController.mostrarInsertLibros);
route.get('/', paginaController.mostrarInicio);

module.exports = route;