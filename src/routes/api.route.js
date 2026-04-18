const express = require('express');
const route = express.Router();

const libroController = require('../controller/librosController');

route.get('/librosjson', libroController.mostrarJson);
route.post('/libros', libroController.insertarLibro);

module.exports = route;