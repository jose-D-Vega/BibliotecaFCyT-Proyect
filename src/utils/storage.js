const supabase = require('../config/supabase')

const BUCKET = 'libros-portadas'

const subirImagen = async (buffer, mimetype, originalName) => {
  // Sanitizar nombre — solo letras, números, guiones y puntos
  const extension = originalName.split('.').pop().toLowerCase()
  const nombreLimpio = `libro-${Date.now()}.${extension}`

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(nombreLimpio, buffer, {
      contentType: mimetype,
      upsert: true
    })

  if (error) throw new Error(`Error al subir imagen: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(nombreLimpio)

  return urlData.publicUrl
}

const eliminarImagen = async (nombreArchivo) => {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([nombreArchivo])

  if (error) throw new Error(`Error al eliminar imagen: ${error.message}`)
}

module.exports = { subirImagen, eliminarImagen }