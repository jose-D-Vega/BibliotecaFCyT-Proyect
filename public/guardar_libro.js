const API_URL = 'http://localhost:3210';

async function guardarLibro() {
    const btn = document.getElementById('btnGuardar');

    const campos = {
        titulo:           document.getElementById('titulo').value.trim(),
        autor:            document.getElementById('autor').value.trim(),
        anio_publicacion: document.getElementById('anio_publicacion').value,
        cantidad_ejemplar:document.getElementById('cantidad_ejemplar').value,
        editorial:        document.getElementById('inputDinamico').value.trim() || null,
        ciudad:           document.getElementById('ciudad').value.trim() || null,
        carrera:          document.getElementById('selected-text').textContent || null,
        facultad:         document.getElementById('facultad').value || null,
        tipo_material:    document.getElementById('tipoMaterial').value,
    };

    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
        const res = await fetch(`${API_URL}/libros`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campos),
        });

        if (!res.ok) throw new Error('Error del servidor');
        showAlert("¡Registro Exitoso!", "✅ El libro ha sido registrado correctamente.");
        limpiarFormulario();
    } catch (err) {
        showAlert("Error", "❌️ No se pudo guardar el libro. Verificá la conexión.");
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar registro';
    }
    
}

function limpiarFormulario() {
    ['titulo','autor','anio_publicacion','cantidad_ejemplar','inputDinamico','ciudad', 'facultad', 'tipoMaterial']
    .forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('selected-text').textContent = 'Seleccionar carreras...';
}


function showAlert(titulo, mensaje) {
    const modal = document.getElementById('customAlert');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');

    if (modal && modalTitle && modalMessage) {
        modalTitle.innerText = titulo;
        modalMessage.innerText = mensaje;
        modal.style.display = 'flex'; 
    } else {
        alert(titulo + ": " + mensaje);
    }
}

function closeAlert() {
    const modal = document.getElementById('customAlert');
    if (modal) modal.style.display = 'none';
}
