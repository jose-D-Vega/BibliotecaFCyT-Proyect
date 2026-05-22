require('dotenv').config()
const app = require('./src/app')
const { iniciarJob } = require('./src/jobs/loanChecker')

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
  iniciarJob()
})