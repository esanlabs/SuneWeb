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

    // --- CÁLCULO MATEMÁTICO: Adaptar coordenadas al RECORTE (240x288) ---
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const videoAspectRatio = videoWidth / videoHeight;
    const canvasAspectRatio = 240 / 288;
    
    let drawWidth, drawHeight, startX, startY;
    if (videoAspectRatio > canvasAspectRatio) {
        drawHeight = videoHeight;
        drawWidth = videoHeight * canvasAspectRatio;
        startX = (videoWidth - drawWidth) / 2;
        startY = 0;
    } else {
        drawWidth = videoWidth;
        drawHeight = videoWidth / canvasAspectRatio;
        startX = 0;
        startY = (videoHeight - drawHeight) / 2;
    }

    // Función interna para mapear el punto de la IA al pixel exacto de la foto final
    function mapearCoordenada(landmark) {
        let vidX = landmark.x * videoWidth;
        let vidY = landmark.y * videoHeight;
        
        let canvasX = (vidX - startX) * (240 / drawWidth);
        let canvasY = (vidY - startY) * (288 / drawHeight);
        
        if (modoCamara === "user") {
            canvasX = 240 - canvasX; // Aplicar espejo si es cámara frontal
        }
        return { x: canvasX, y: canvasY };
    }

    // Obtenemos las coordenadas ya convertidas al tamaño SUNEDU
    const ojoIzq = mapearCoordenada(landmarks[33]);
    const ojoDer = mapearCoordenada(landmarks[263]);
    const nariz = mapearCoordenada(landmarks[1]); // Usaremos la nariz para centrar

    // 1. Verificar Posición (Usamos la nariz para saber si estás en el centro)
    // El centro ideal del lienzo es X=120, Y=144. Te damos un margen cómodo.
    const estaCentradoX = nariz.x >= 95 && nariz.x <= 145;
    const estaCentradoY = nariz.y >= 110 && nariz.y <= 165;

    if (estaCentradoX && estaCentradoY) {
        validaciones.posicion = true;
        actualizarBadge(badgePos, true, "✅ Rostro centrado");
    } else {
        validaciones.posicion = false;
        actualizarBadge(badgePos, false, "❌ Centra tu rostro");
    }

    // 2. Verificar Distancia (Separación exacta en píxeles entre los ojos)
    // Para encajar en las medidas SUNEDU, tus ojos deben tener esta separación.
    const distanciaOjos = ojoDer.x - ojoIzq.x;
    
    if (distanciaOjos < 45) {
        validaciones.distancia = false;
        actualizarBadge(badgeDist, false, "❌ Acércate más");
    } else if (distanciaOjos > 80) {
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
