const { Router } = require("express");
const router = Router();
const {
  searchLoansHandler,
  getAllActiveLoansHandler,
  getLoanHandler,
  registerReturnHandler,
  getHistorialHandler,
  getPrestamosConDevolucionesHandler,
  getDetalleDevolucionesHandler,
  getDevolucionesUsuarioHandler,
  resolveReservaAfectadaHandler,
  recuperarEjemplarPerdidoHandler, 
  reemplazarEjemplarPerdidoHandler,
  getDetalleDevolucionUsuarioHandler
} = require("../controllers/returns.controller");
const { verifyToken } = require("../middlewares/auth");
const { isBibliotecario } = require("../middlewares/roles");



router.get('/mis-devoluciones', verifyToken, getDevolucionesUsuarioHandler);
router.get('/mis-devoluciones/:id/detalle', verifyToken, getDetalleDevolucionUsuarioHandler);

// Solo bibliotecario y admin

router.get("/activos", verifyToken, isBibliotecario, getAllActiveLoansHandler);
router.get("/search", verifyToken, isBibliotecario, searchLoansHandler);
router.get("/historial", verifyToken, isBibliotecario, getHistorialHandler);

router.get(
  "/historial-prestamos",
  verifyToken,
  isBibliotecario,
  getPrestamosConDevolucionesHandler,
);
router.get(
  "/:id/detalle-devoluciones",
  verifyToken,
  isBibliotecario,
  getDetalleDevolucionesHandler,
);

router.post(
  '/prestamo/:id_prestamo/ejemplar/:id_ejemplar/recuperar', 
  verifyToken, isBibliotecario, recuperarEjemplarPerdidoHandler
)

router.post(
  '/prestamo/:id_prestamo/ejemplar/:id_ejemplar/reemplazar', 
  verifyToken, isBibliotecario, reemplazarEjemplarPerdidoHandler
)

router.patch(
  '/prestamo/:id_prestamo/reserva-afectada/:id_ejemplar_anterior',
  verifyToken, isBibliotecario, resolveReservaAfectadaHandler
)

router.post(
  "/:id/devolver",
  verifyToken,
  isBibliotecario,
  registerReturnHandler,
);

router.get("/:id", verifyToken, isBibliotecario, getLoanHandler); // siempre al final

module.exports = router;
