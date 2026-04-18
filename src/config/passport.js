const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const pool = require('./db')
require('dotenv').config()

const INSTITUTIONAL_DOMAIN = 'fctunca.edu.py'

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value

    // Verificar dominio institucional
    if (!email.endsWith(`@${INSTITUTIONAL_DOMAIN}`)) {
      return done(null, false, { message: 'Solo se permiten correos institucionales de la FCyT' })
    }

    // Buscar usuario existente con JOIN a tipo_usuarios
    const { rows } = await pool.query(
      `SELECT u.*, t.nombre_tipo AS rol
       FROM usuarios u
       JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
       WHERE u.correo = $1 OR u.google_id = $2`,
      [email, profile.id]
    )

    if (rows.length > 0) {
      const user = rows[0]
      // Actualizar google_id si no lo tiene aún
      if (!user.google_id) {
        await pool.query(
          'UPDATE usuarios SET google_id = $1 WHERE id_usuario = $2',
          [profile.id, user.id_usuario]
        )
      }
      return done(null, user)
    }

    // Usuario nuevo — crear con rol 'normal' (id_tipo_usuario = 1)
    const nombre = profile.displayName || email.split('@')[0]
    const { rows: newUser } = await pool.query(
      `INSERT INTO usuarios (nombre_apellido, ci, correo, sancionado, activo, google_id, id_tipo_usuario)
       VALUES ($1, $2, $3, $4, $5, $6, 1)
       RETURNING *`,
      [nombre, 'pendiente', email, false, true, profile.id]
    )

    // Retornar el usuario nuevo con el rol incluido
    const { rows: userWithRol } = await pool.query(
      `SELECT u.*, t.nombre_tipo AS rol
       FROM usuarios u
       JOIN tipo_usuarios t ON u.id_tipo_usuario = t.id_tipo_usuario
       WHERE u.id_usuario = $1`,
      [newUser[0].id_usuario]
    )

    return done(null, userWithRol[0])
  } catch (error) {
    return done(error, null)
  }
}))

module.exports = passport