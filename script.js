// Referencias de elementos HTML
const form = document.getElementById('registro-form');
const btnIngresar = document.getElementById('btn-ingresar');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const fotoPreview = document.getElementById('foto-preview');
let streamActual = null;
let fotoBase64 = null;

// --- LÓGICA DEL PANEL 1: Registro ---
form.addEventListener('input', () => {
    // Verifica si todos los campos requeridos están llenos y son válidos
    if (form.checkValidity()) {
        btnIngresar.disabled = false;
    } else {
        btnIngresar.disabled = true;
    }
});

btnIngresar.addEventListener('click', () => {
    cambiarPanel('panel-registro', 'panel-camara');
    iniciarCamara();
});

// --- LÓGICA DEL PANEL 2: Cámara ---
let modoCamara = "user"; // Empieza con la cámara frontal ('user' = frontal, 'environment' = trasera)

async function iniciarCamara() {
    try {
        const constraints = {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: modoCamara 
            }
        };
        
        streamActual = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = streamActual;
        
        // Aplicamos el efecto espejo VISUAL solo si es la cámara frontal
        if (modoCamara === "user") {
            video.classList.add('espejo');
        } else {
            video.classList.remove('espejo');
        }

        document.getElementById('estado-camara').innerText = "Cámara lista. Ubique su rostro en las guías verdes.";
    } catch (err) {
        console.error("Error al acceder a la cámara: ", err);
        document.getElementById('estado-camara').innerText = "Error: No se pudo acceder a la cámara o no hay otra disponible.";
    }
}

function detenerCamara() {
    if (streamActual) {
        streamActual.getTracks().forEach(track => track.stop());
    }
}

// Evento para cambiar entre cámara frontal y trasera
document.getElementById('btn-cambiar-camara').addEventListener('click', () => {
    // Alterna el modo
    modoCamara = (modoCamara === "user") ? "environment" : "user";
    detenerCamara(); // Apaga la actual
    iniciarCamara(); // Enciende la nueva
});

document.getElementById('btn-volver-registro').addEventListener('click', () => {
    detenerCamara();
    cambiarPanel('panel-camara', 'panel-registro');
});

document.getElementById('btn-capturar').addEventListener('click', () => {
    const context = canvas.getContext('2d');
    
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const canvasAspectRatio = canvas.width / canvas.height;
    
    let drawWidth, drawHeight, startX, startY;

    if (videoAspectRatio > canvasAspectRatio) {
        drawHeight = video.videoHeight;
        drawWidth = video.videoHeight * canvasAspectRatio;
        startX = (video.videoWidth - drawWidth) / 2;
        startY = 0;
    } else {
        drawWidth = video.videoWidth;
        drawHeight = video.videoWidth / canvasAspectRatio;
        startX = 0;
        startY = (video.videoHeight - drawHeight) / 2;
    }

    // Limpiamos el canvas por seguridad
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Guardamos el estado del context
    context.save(); 

    // Si estamos usando la cámara frontal, hacemos efecto espejo en el Canvas 
    // para que la foto quede tal cual como el usuario se vio en pantalla
    if (modoCamara === "user") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    }

    // Dibujamos la imagen
    context.drawImage(video, startX, startY, drawWidth, drawHeight, 0, 0, canvas.width, canvas.height);
    
    // Restauramos el context a su estado normal (para que no afecte siguientes fotos)
    context.restore(); 
    
    fotoBase64 = canvas.toDataURL('image/jpeg', 0.8);
    fotoPreview.src = fotoBase64;
    
    detenerCamara();
    cambiarPanel('panel-camara', 'panel-confirmacion');
});

// --- LÓGICA DEL PANEL 3: Confirmación ---
document.getElementById('btn-cancelar').addEventListener('click', () => {
    cambiarPanel('panel-confirmacion', 'panel-camara');
    iniciarCamara();
});

document.getElementById('btn-enviar').addEventListener('click', async () => {
    const btnEnviar = document.getElementById('btn-enviar');
    const mensaje = document.getElementById('mensaje-envio');
    
    btnEnviar.disabled = true;
    btnEnviar.innerText = "Enviando...";
    
    // Recopilar datos
    const datos = {
        nombre: document.getElementById('nombre').value,
        apellido: document.getElementById('apellido').value,
        correo: document.getElementById('correo').value,
        dni: document.getElementById('dni').value,
        foto: fotoBase64 // La imagen en formato texto
    };

    /* 
      ===============================================================
      IMPORTANTE: Aquí harás la conexión a Google Apps Script.
      Debes crear un Web App en Google Apps Script que reciba un POST, 
      guarde la imagen en Drive y envíe los correos.
      Reemplaza la URL_DE_TU_APPS_SCRIPT por la que Google te dé.
      ===============================================================
    */
    const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbx854B1Q0Fy81R8P0eSQH3AhaiwPoaNFnM0Kz42FO9qEZ-zJMolFpwSXfpJN7oHxEg4/exec";

    try {
        // CÓDIGO REAL PARA PRODUCCIÓN:
        const response = await fetch(URL_APPS_SCRIPT, {
            method: 'POST',
            mode: 'no-cors', // Importante para evitar errores de CORS con Apps Script
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });

        mensaje.style.color = "green";
        mensaje.innerText = "¡Enviado con éxito a Drive y al correo!";
        
        // Reiniciar la app después de 3 segundos
        setTimeout(() => {
            document.getElementById('registro-form').reset();
            cambiarPanel('panel-confirmacion', 'panel-registro');
            mensaje.innerText = "";
            btnEnviar.disabled = false;
            btnEnviar.innerText = "Enviar Datos y Foto";
            btnIngresar.disabled = true;
        }, 3000);

    } catch (error) {
        mensaje.style.color = "red";
        mensaje.innerText = "Hubo un error al enviar.";
        btnEnviar.disabled = false;
        btnEnviar.innerText = "Reintentar";
    }
});

// Utilidad para ocultar y mostrar paneles
function cambiarPanel(panelOcultar, panelMostrar) {
    document.getElementById(panelOcultar).classList.remove('active');
    document.getElementById(panelMostrar).classList.add('active');
}
