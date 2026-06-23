// src/utils/validators.js
const isValidId = (id) => !isNaN(id) && Number.isInteger(Number(id)) && Number(id) > 0

module.exports = { isValidId }