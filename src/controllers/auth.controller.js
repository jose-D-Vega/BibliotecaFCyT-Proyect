const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { registrarSesion } = require("../queries/session.queries");
const { getUserById } = require("../queries/users.queries")

const handleGoogleCallback = (req, res) => {
  const user = req.user;

  // Determinar el rol: si es bibliotecario en la tabla bibliotecarios, es admin
  // Por ahora usamos tipo_usuario de la tabla usuarios
  const payload = {
    id_usuario: user.id_usuario,
    correo: user.correo,
    nombre: user.nombre_apellido,
    rol: user.rol,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });

  // Registrar la sesión en la base de datos (sin await para no retrasar la respuesta)
  registrarSesion(user.id_usuario).catch((err) =>
    console.error("Error al registrar sesión:", err),
  );

  // Redirigir al frontend con el token como query param
  // El frontend lo lee, lo guarda y elimina el param de la URL
  res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
};

const getMeHandler = async (req, res) => {
  try {
    const user = await getUserById(req.user.id_usuario)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })
    res.json({ data: user })
  } catch (error) {
    console.error('Error en /me:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

module.exports = { handleGoogleCallback, getMeHandler };
