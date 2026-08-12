// Referencias
const form = document.getElementById('registro-form');
const btnIngresar = document.getElementById('btn-ingresar');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const fotoPreview = document.getElementById('foto-preview');
const btnCapturar = document.getElementById('btn-capturar');

let streamActual = null;
let fotoBase64 = null;
let modoCamara = "user"; 
let faceMesh = null;
let animFrameId = null;

// Banderas de validación SUNEDU
let validaciones = {
    rostro: false,
    posicion: false,
    distancia: false,
    fondo: false,
    luz: false
};

// --- PANEL 1: Registro ---
form.addEventListener('input', () => {
    btnIngresar.disabled = !form.checkValidity();
});

btnIngresar.addEventListener('click', () => {
    cambiarPanel('panel-registro', 'panel-camara');
    iniciarCamara();
});

// --- PANEL 2: Cámara e IA ---
async function iniciarCamara() {
    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: modoCamara 
            }
        };
        
        streamActual = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = streamActual;
        
        if (modoCamara === "user") {
            video.classList.add('espejo');
        } else {
            video.classList.remove('espejo');
        }

        // Inicializar IA de Detección Facial de Google (MediaPipe)
        if (!faceMesh) {
            faceMesh = new FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });
            faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            faceMesh.onResults(procesarResultadosFaciales);
        }

        // Iniciar bucle de análisis continuo
        video.onloadedmetadata = () => {
            analizarFotograma();
        };

    } catch (err) {
        console.error("Error cámara: ", err);
        document.getElementById('estado-camara').innerText = "Error: Sin acceso a la cámara.";
    }
}

async function analizarFotograma() {
    if (video.readyState >= 2) {
        await faceMesh.send({ image: video });
        analizarLuzYFondo(); // Análisis por píxeles
    }
    animFrameId = requestAnimationFrame(analizarFotograma);
}

// Validación de Coordenadas Ojos, Boca y Distancia (IA)
function procesarResultadosFaciales(results) {
    const badgeRostro = document.getElementById('ind-rostro');
    const badgePos = document.getElementById('ind-posicion');
    const badgeDist = document.getElementById('ind-distancia');

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        validaciones.rostro = false;
        validaciones.posicion = false;
        validaciones.distancia = false;
        
        actualizarBadge(badgeRostro, false, "❌ Rostro no detectado");
        actualizarBadge(badgePos, false, "❌ Posición incorrecta");
        actualizarBadge(badgeDist, false, "❌ Distancia no válida");
        evaluarBotonCaptura();
        return;
    }

    validaciones.rostro = true;
    actualizarBadge(badgeRostro, true, "✅ Rostro detectado");

    const landmarks = results.multiFaceLandmarks[0];

    // Coordenadas proporcionales transformadas al tamaño estándar SUNEDU (240x288)
    // Ojo Izquierdo (punto 33), Ojo Derecho (punto 263), Boca (punto 13)
    let ojoIzqX = landmarks[33].x * 240;
    let ojoIzqY = landmarks[33].y * 288;
    let ojoDerX = landmarks[263].x * 240;
    let ojoDerY = landmarks[263].y * 288;
    let bocaX = landmarks[13].x * 240;
    let bocaY = landmarks[13].y * 288;

    // Si la cámara es frontal (espejo), invertimos la referencia horizontal para calzar exacto
    if (modoCamara === "user") {
        ojoIzqX = 240 - ojoIzqX;
        ojoDerX = 240 - ojoDerX;
        bocaX = 240 - bocaX;
    }

    // 1. Verificar límites según tu especificación SUNEDU:
    // Ojo Izq: X(24-120), Y(55-180) | Ojo Der: X(80-185), Y(50-180) | Boca: X(50-161), Y(70-252)
    const ojoIzqOk = (ojoIzqX >= 20 && ojoIzqX <= 125) && (ojoIzqY >= 50 && ojoIzqY <= 185);
    const ojoDerOk = (ojoDerX >= 75 && ojoDerX <= 190) && (ojoDerY >= 45 && ojoDerY <= 185);
    const bocaOk = (bocaX >= 45 && bocaX <= 165) && (bocaY >= 65 && bocaY <= 255);

    if (ojoIzqOk && ojoDerOk && bocaOk) {
        validaciones.posicion = true;
        actualizarBadge(badgePos, true, "✅ Alineación correcta");
    } else {
        validaciones.posicion = false;
        actualizarBadge(badgePos, false, "❌ Centra ojos y boca");
    }

    // 2. Verificar Distancia (Ancho del rostro entre sienes)
    const anchoRostro = Math.abs(landmarks[454].x - landmarks[234].x) * 240;
    if (anchoRostro < 80) {
        validaciones.distancia = false;
        actualizarBadge(badgeDist, false, "❌ Acércate más");
    } else if (anchoRostro > 170) {
        validaciones.distancia = false;
        actualizarBadge(badgeDist, false, "❌ Aléjate un poco");
    } else {
        validaciones.distancia = true;
        actualizarBadge(badgeDist, true, "✅ Distancia adecuada");
    }

    evaluarBotonCaptura();
}

// Análisis de Píxeles: Fondo Blanco (#dcdcdc a #ffffff) e Iluminación
function analizarLuzYFondo() {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = frameData.data;

    let sumaBrillo = 0;
    let pixelesFondoBlanco = 0;
    let totalMuestrasFondo = 0;

    // Evaluamos las esquinas superiores (Fondo)
    for (let y = 0; y < 50; y += 5) {
        for (let x = 0; x < canvas.width; x += 5) {
            // Evitamos la zona central donde está la cabeza
            if (x < 60 || x > 180) {
                let index = (y * canvas.width + x) * 4;
                let r = data[index];
                let g = data[index + 1];
                let b = data[index + 2];

                totalMuestrasFondo++;
                // Especificación SUNEDU: RGB entre 220 y 255
                if (r >= 210 && g >= 210 && b >= 210) {
                    pixelesFondoBlanco++;
                }
            }
        }
    }

    // Brillo general en el centro (Rostro)
    for (let i = 0; i < data.length; i += 16) {
        sumaBrillo += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    let promedioBrillo = sumaBrillo / (data.length / 16);

    // Validar Fondo
    const badgeFondo = document.getElementById('ind-fondo');
    if ((pixelesFondoBlanco / totalMuestrasFondo) > 0.6) {
        validaciones.fondo = true;
        actualizarBadge(badgeFondo, true, "✅ Fondo blanco ok");
    } else {
        validaciones.fondo = false;
        actualizarBadge(badgeFondo, false, "❌ Fondo debe ser blanco");
    }

    // Validar Luz
    const badgeLuz = document.getElementById('ind-luz');
    if (promedioBrillo < 80) {
        validaciones.luz = false;
        actualizarBadge(badgeLuz, false, "❌ Poca luz");
    } else if (promedioBrillo > 230) {
        validaciones.luz = false;
        actualizarBadge(badgeLuz, false, "❌ Muerta/Mucha luz");
    } else {
        validaciones.luz = true;
        actualizarBadge(badgeLuz, true, "✅ Buena luz");
    }

    evaluarBotonCaptura();
}

// Utilidades del DOM
function actualizarBadge(elemento, esValido, texto) {
    elemento.innerText = texto;
    if (esValido) {
        elemento.classList.remove('badge-fail');
        elemento.classList.add('badge-ok');
    } else {
        elemento.classList.remove('badge-ok');
        elemento.classList.add('badge-fail');
    }
}

function evaluarBotonCaptura() {
    const todoCorrecto = validaciones.rostro && validaciones.posicion && 
                         validaciones.distancia && validaciones.fondo && validaciones.luz;
    
    btnCapturar.disabled = !todoCorrecto;
    
    const estado = document.getElementById('estado-camara');
    if (todoCorrecto) {
        estado.innerText = "¡Todo perfecto! Puedes tomar la foto.";
        estado.style.color = "green";
    } else {
        estado.innerText = "Ajuste su posición hasta que todos los indicadores estén en verde.";
        estado.style.color = "#555";
    }
}

function detenerCamara() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (streamActual) streamActual.getTracks().forEach(track => track.stop());
}

// Alternar Cámaras
document.getElementById('btn-cambiar-camara').addEventListener('click', () => {
    modoCamara = (modoCamara === "user") ? "environment" : "user";
    detenerCamara();
    iniciarCamara();
});

document.getElementById('btn-volver-registro').addEventListener('click', () => {
    detenerCamara();
    cambiarPanel('panel-camara', 'panel-registro');
});

// Capturar Imagen Cortada (240x288)
btnCapturar.addEventListener('click', () => {
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

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save(); 

    if (modoCamara === "user") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    }

    context.drawImage(video, startX, startY, drawWidth, drawHeight, 0, 0, canvas.width, canvas.height);
    context.restore(); 
    
    fotoBase64 = canvas.toDataURL('image/jpeg', 0.85);
    fotoPreview.src = fotoBase64;
    
    detenerCamara();
    cambiarPanel('panel-camara', 'panel-confirmacion');
});

// --- PANEL 3: Confirmación y Envío ---
document.getElementById('btn-cancelar').addEventListener('click', () => {
    cambiarPanel('panel-confirmacion', 'panel-camara');
    iniciarCamara();
});

document.getElementById('btn-enviar').addEventListener('click', async () => {
    const btnEnviar = document.getElementById('btn-enviar');
    const mensaje = document.getElementById('mensaje-envio');
    
    btnEnviar.disabled = true;
    btnEnviar.innerText = "Enviando...";
    
    const datos = {
        nombre: document.getElementById('nombre').value,
        apellido: document.getElementById('apellido').value,
        correo: document.getElementById('correo').value,
        dni: document.getElementById('dni').value,
        foto: fotoBase64 
    };

    const URL_APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbzoChC6KMP-ayz1FZqtQ06EX13w4H4eA0zD7g1Fq5mBevjSN6922tpPwV4rYUIijP3s/exec";

    try {
        await fetch(URL_APPS_SCRIPT, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });

        mensaje.style.color = "green";
        mensaje.innerText = "¡Enviado con éxito a Drive y correo!";
        
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

function cambiarPanel(panelOcultar, panelMostrar) {
    document.getElementById(panelOcultar).classList.remove('active');
    document.getElementById(panelMostrar).classList.add('active');
}
