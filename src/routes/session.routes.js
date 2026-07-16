const { Router } = require('express')

const router = Router()

const {
  getSesionesHandler,
  getMisSesionesActivasHandler,
  cerrarSesionHandler
} = require('../controllers/session.controller')


const { verifyToken } = require('../middlewares/auth')
const { isAdmin } = require('../middlewares/roles')



router.get(
  '/',
  verifyToken,
  isAdmin,
  getSesionesHandler
)



router.get(
  '/active',
  verifyToken,
  getMisSesionesActivasHandler
)



router.post(
  '/logout',
  verifyToken,
  cerrarSesionHandler
)



module.exports = router