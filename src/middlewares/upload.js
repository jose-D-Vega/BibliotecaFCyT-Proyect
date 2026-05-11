const multer = require('multer')

// Guardar en memoria en lugar de disco — lo subimos directo a Supabase
const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Solo se permiten imágenes JPG, PNG o WebP'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB máximo
})

module.exports = upload