const APP_VERSION = "0.1.8";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const cameraBtn = document.getElementById("cameraBtn");
const cameraFacingBtn = document.getElementById("cameraFacingBtn");
const recordBtn = document.getElementById("recordBtn");
const downloadBtn = document.getElementById("downloadBtn");
const audioInput = document.getElementById("audioInput");
const audioName = document.getElementById("audioName");
const audio = document.getElementById("audio");
const statusEl = document.getElementById("status");
const countdown = document.getElementById("countdown");
const footLock = document.getElementById("footLock");
const versionEl = document.getElementById("version");

versionEl.textContent = "v" + APP_VERSION;

let stream = null;
let facing = "user";
let landmarker = null;
let running = false;
let raf = 0;
let recording = false;
let frames = [];
let audioFile = null;
let startPerf = 0;

const connections = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[27,29],[29,31],
  [24,26],[26,28],[28,30],[30,32]
];

cameraBtn.addEventListener("click", async () => {
  if (stream) {
    stopCamera();
    return;
  }
  await openCamera();
});

cameraFacingBtn.addEventListener("click", async () => {
  facing = facing === "user" ? "environment" : "user";
  cameraFacingBtn.textContent = facing === "user" ? "Usar trasera" : "Usar frontal";

  if (stream) {
    stopCamera(false);
    await openCamera();
  }
});

audioInput.addEventListener("change", () => {
  audioFile = audioInput.files && audioInput.files[0] ? audioInput.files[0] : null;
  if (!audioFile) return;
  audioName.textContent = audioFile.name;
  audio.src = URL.createObjectURL(audioFile);
  updateReady();
});

recordBtn.addEventListener("click", async () => {
  if (recording || !audioFile || !stream || !landmarker) return;

  frames = [];
  downloadBtn.disabled = true;

  for (const n of [3,2,1]) {
    countdown.textContent = String(n);
    countdown.classList.remove("hidden");
    await wait(1000);
  }

  countdown.classList.add("hidden");
  audio.currentTime = 0;
  startPerf = performance.now();
  recording = true;
  recordBtn.textContent = "Grabando…";
  await audio.play();
});

audio.addEventListener("ended", finishRecording);

downloadBtn.addEventListener("click", () => {
  if (!frames.length) return;

  const take = {
    format: "easymocap-mobile-take-v1",
    rig: "esqueleto-fase2.fbx",
    audio: audioFile ? audioFile.name : null,
    footLock: footLock.checked,
    duration: frames.length ? frames[frames.length - 1].timestamp : 0,
    frames
  };

  const blob = new Blob([JSON.stringify(take)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "easymocap-" + Date.now() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});

async function openCamera() {
  try {
    statusEl.textContent = "Pidiendo permiso de cámara…";

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia no está disponible en este navegador.");
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing } },
      audio: false
    });

    video.srcObject = stream;
    video.muted = true;
    video.setAttribute("playsinline", "");
    await video.play();

    applyMirror();
    syncOverlay();
    cameraBtn.textContent = "Cerrar cámara";
    statusEl.textContent = "● Cámara activa · cargando tracking…";

    try {
      await initPose();
      running = true;
      loop();
    } catch (err) {
      console.error(err);
      statusEl.textContent = "● Cámara activa · tracking no disponible";
    }

    updateReady();
  } catch (err) {
    stream = null;
    const name = err && err.name ? err.name : "Error";
    const msg = err && err.message ? err.message : String(err);
    statusEl.textContent = "Error cámara: " + name;
    alert("Error al abrir cámara: " + name + "\n\n" + msg);
  }
}

function stopCamera(updateLabel = true) {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }

  stream = null;
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (updateLabel) {
    cameraBtn.textContent = "Abrir cámara";
    statusEl.textContent = "Cámara apagada";
  }

  updateReady();
}

async function initPose() {
  if (landmarker) return;

  const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
  const vision = await visionModule.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );

  landmarker = await visionModule.PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });

  statusEl.textContent = "● Tracking listo";
}

function loop() {
  if (!running) return;

  const now = performance.now();

  if (video.readyState >= 2 && landmarker) {
    const result = landmarker.detectForVideo(video, now);
    const points = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
    const world = result.worldLandmarks && result.worldLandmarks[0] ? result.worldLandmarks[0] : null;

    drawPose(points);

    if (world && world.length) {
      statusEl.textContent = recording ? "● Grabando movimiento" : "● Cuerpo detectado";

      if (recording) {
        frames.push({
          timestamp: (now - startPerf) / 1000,
          image_landmarks: (points || []).map(pack),
          world_landmarks: world.map(pack)
        });
      }
    } else {
      statusEl.textContent = "● No detecto cuerpo completo";
    }
  }

  raf = requestAnimationFrame(loop);
}

function drawPose(points) {
  syncOverlay();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!points) return;

  const w = overlay.width;
  const h = overlay.height;

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#75e6a4";
  ctx.fillStyle = "#ffffff";

  for (const pair of connections) {
    const p = points[pair[0]];
    const q = points[pair[1]];
    if (!p || !q) continue;
    if ((p.visibility || 1) < 0.35 || (q.visibility || 1) < 0.35) continue;

    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.stroke();
  }

  for (const p of points) {
    if ((p.visibility || 1) < 0.35) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function syncOverlay() {
  const rect = video.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (overlay.width !== w) overlay.width = w;
  if (overlay.height !== h) overlay.height = h;
}

function applyMirror() {
  const mirrored = facing === "user";
  video.classList.toggle("mirror", mirrored);
  overlay.classList.toggle("mirror", mirrored);
}

function pack(p) {
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: p.visibility == null ? 1 : p.visibility
  };
}

function updateReady() {
  recordBtn.disabled = !(audioFile && stream && landmarker);
}

function finishRecording() {
  if (!recording) return;
  recording = false;
  recordBtn.textContent = "Grabar";
  downloadBtn.disabled = frames.length === 0;
  statusEl.textContent = "Take listo · " + frames.length + " frames";
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener("resize", syncOverlay);
window.addEventListener("orientationchange", () => setTimeout(syncOverlay, 250));
