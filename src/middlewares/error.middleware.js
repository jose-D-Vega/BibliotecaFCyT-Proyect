const errorHandler = (err, req, res, next) => {
    // Registro detallado del error para el desarrollador
    console.error(`[ERROR] ${req.method} ${req.url}:`, err.message);
    
    // Si estamos en desarrollo, podemos ver el stack
    if (process.env.NODE_ENV === 'development') {
        console.error(err.stack);
    }

    const statusCode = err.status || 500;
    
    res.status(statusCode).json({
        success: false,
        status: statusCode,
        message: err.message || 'Error interno del servidor',
        timestamp: new Date().toISOString(),
        // Incluir el stack solo en desarrollo
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorHandler;