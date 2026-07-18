const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const { registrarSesion } = require("../queries/session.queries");
const { getUserById } = require("../queries/users.queries");


const handleGoogleCallback = async (req, res) => {

  const user = req.user;


  const sid = randomUUID();



  const payload = {

    id_usuario: user.id_usuario,

    correo: user.correo,

    nombre: user.nombre_apellido,

    rol: user.rol,

    sid

  };



  const token = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    {
      expiresIn: "8h",
    }
  );



  try {

    await registrarSesion({

      id_usuario: user.id_usuario,

      sid,

      ip: req.ip,

      user_agent: req.headers["user-agent"]

    });


  } catch (err) {

    console.error(
      "Error al registrar sesión:",
      err
    );


    return res.status(500).json({
      error: "No se pudo crear la sesión"
    });

  }



  res.redirect(
    `${process.env.FRONTEND_URL}/auth/callback?token=${token}`
  );

};





const getMeHandler = async (req, res) => {

  try {

    const user = await getUserById(
      req.user.id_usuario
    );


    if (!user) {

      return res.status(404).json({
        error: "Usuario no encontrado",
      });

    }


    res.json({
      data: user,
    });


  } catch (error) {

    console.error(
      "Error en /me:",
      error
    );


    res.status(500).json({
      error: "Error interno del servidor",
    });

  }

};



module.exports = {
  handleGoogleCallback,
  getMeHandler,
};