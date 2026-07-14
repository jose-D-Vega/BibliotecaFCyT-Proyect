/* --- FUNCIONES PARA EL MODAL PERSONALIZADO --- */

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

/* --- DROPDOWN CON LÓGICA "GENERAL" --- */
const selectedOptions = new Set();

function selectOption(element) {
    const text = element.innerText.replace('✓', '').trim();
    const options = document.querySelectorAll('.option');

    // REGLA 1: Si el usuario selecciona "General"
    if (text.toUpperCase() === "GENERAL") {
        if (!element.classList.contains('selected')) {
            // Limpiar todo lo anterior y dejar solo General
            selectedOptions.clear();
            options.forEach(opt => opt.classList.remove('selected'));
            
            element.classList.add('selected');
            selectedOptions.add(text);
        } else {
            element.classList.remove('selected');
            selectedOptions.delete(text);
        }
    } 
    // REGLA 2: Si intenta seleccionar cualquier otra carrera
    else {
        // Verificar si "General" ya está seleccionado
        let tieneGeneral = false;
        selectedOptions.forEach(val => {
            if(val.toUpperCase() === "GENERAL") tieneGeneral = true;
        });

        if (tieneGeneral) {
            showAlert("Conflicto de Selección", "⚠️ No puedes elegir carreras específicas si ya seleccionaste 'General'. Desmarca 'General' primero.");
            return; // Bloquea la selección
        }

        // Selección normal (Toggle)
        if (element.classList.contains('selected')) {
            element.classList.remove('selected');
            selectedOptions.delete(text);
        } else {
            element.classList.add('selected');
            selectedOptions.add(text);
        }
    }

    // Actualizar el texto del encabezado
    const header = document.getElementById('selected-text');
    if (header) {
        header.innerText = selectedOptions.size > 0 ? Array.from(selectedOptions).join(', ') : "Seleccionar carreras...";
    }
}

/* --- RESTO DE FUNCIONES (ACORDEÓN Y DROPDOWN) --- */
function toggleDropdown() {
    const list = document.getElementById('dropdown-options');
    if (list) list.style.display = list.style.display === 'block' ? 'none' : 'block';
}

function toggleAccordion(btn) {
    btn.parentElement.classList.toggle('active');
}

window.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-multiselect')) {
        const drop = document.getElementById('dropdown-options');
        if (drop) drop.style.display = 'none';
    }
});

/* --- BLOQUEO DE LETRAS Y VALIDACIÓN DE ENVÍO --- */
window.onload = function() {
    const form = document.getElementById('libroForm');
    const campoAnio = document.querySelector('input[placeholder*="año"]');
    const campoEjemplares = document.querySelector('input[placeholder*="Ej: 3"]');

    const filtrarNumeros = (e) => {
        if (/[^0-9]/.test(e.target.value)) {
            showAlert("Dato no permitido", "⚠️ Solo se permiten números positivos.");
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        }
    };

    if (campoAnio) campoAnio.addEventListener('input', filtrarNumeros);
    if (campoEjemplares) campoEjemplares.addEventListener('input', filtrarNumeros);

    if (form) {
        form.onsubmit = function(e) {
            e.preventDefault(); 

            // Validar Vacíos
            const inputs = form.querySelectorAll('input');
            let vacio = Array.from(inputs).some(i => i.value.trim() === "");

            if (vacio) {
                showAlert("Campos Vacíos", "🚨 Por favor, rellena todos los campos.");
                return;
            }

            // Validar Carreras
            if (selectedOptions.size === 0) {
                showAlert("Faltan Carreras", "🚨 Selecciona al menos una carrera o 'General'.");
                return;
            }

            // Validar Año (1900 - 2026)
            const anioActual = new Date().getFullYear();
            const valorAnio = parseInt(campoAnio.value);

            if (campoAnio.value.length !== 4 || valorAnio < 1900 || valorAnio > anioActual) {
                showAlert("Año fuera de rango", `⚠️ El año debe estar entre 1900 y ${anioActual}.`);
                return;
            }

            // Validar Ejemplares
            const valorEjemplares = parseInt(campoEjemplares.value);
            if (valorEjemplares <= 0) {
                showAlert("Cantidad no válida", "⚠️ El número de ejemplares debe ser 1 o más.");
                return;
            }     
            guardarLibro(); 
        };
    }
};

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
        const res = await fetch(`${API_URL}/api/libros`, {
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
    ['titulo','autor','anio_publicacion','cantidad_ejemplar','inputDinamico','ciudad', 'facultad']
    .forEach(id => {
        document.getElementById(id).value = '';
    });
    selectedOptions.clear();
    document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
    document.getElementById('selected-text').textContent = 'Seleccionar carreras...';
}


