const express = require('express');
const path = require('path');
require('dotenv').config();

const api = require('./routes/api.route');
const pagina = require('./routes/pagina.route');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use('/api', api);
app.use('/', pagina);

app.listen(process.env.PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${process.env.PORT}/`);
});