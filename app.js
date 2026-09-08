import { createTake } from "./core/spec.js?v=0.1.0";

const APP_VERSION = "0.1.0";
const $ = (id) => document.getElementById(id);

const ui = {
  camera: $("camera"),
  cameraPlaceholder: $("cameraPlaceholder"),
  audioInput: $("audioInput"),
  audio: $("audio"),
  audioName: $("audioName"),
  cameraButton: $("cameraButton"),
  recordButton: $("recordButton"),
  downloadButton: $("downloadButton"),
  countdown: $("countdown"),
  status: $("status"),
  errorPanel: $("errorPanel"),
  errorText: $("errorText")
};

let mode = "body";
let stream = null;
let audioUrl = null;
let audioFile = null;
let currentTake = null;
let captureRaf = 0;
let recording = false;

function setStatus(message) {
  ui.status.textContent = message;
}

function showError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  ui.errorText.textContent = message;
  ui.errorPanel.hidden = false;
  setStatus("Falló una operación.");
  console.error(error);
}

function clearError() {
  ui.errorPanel.hidden = true;
  ui.errorText.textContent = "";
}

window.addEventListener("error", (event) => showError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => showError(event.reason || "Promise rechazada"));

document.querySelectorAll(".mode[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    mode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b === button));
    setStatus(`Modo ${mode === "body" ? "Body" : "Face"} listo.`);
  });
});

ui.audioInput.addEventListener("change", () => {
  clearError();
  const file = ui.audioInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("audio/")) {
    showError(new Error("El archivo elegido no parece ser audio."));
    return;
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioFile = file;
  audioUrl = URL.createObjectURL(file);
  ui.audio.src = audioUrl;
  ui.audioName.textContent = file.name;
  ui.audio.load();
  refreshReadyState();
});

ui.audio.addEventListener("loadedmetadata", refreshReadyState);
ui.audio.addEventListener("error", () => showError(new Error("El navegador no pudo cargar ese audio.")));

ui.cameraButton.addEventListener("click", async () => {
  clearError();
  if (stream) {
    stopCamera();
    return;
  }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia no está disponible en este navegador/contexto.");
    setStatus("Pidiendo permiso de cámara…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    ui.camera.srcObject = stream;
    await ui.camera.play();
    ui.cameraPlaceholder.hidden = true;
    ui.cameraButton.textContent = "Apagar cámara";
    setStatus("Cámara lista.");
    refreshReadyState();
  } catch (error) {
    stream = null;
    showError(error);
    refreshReadyState();
  }
});

ui.recordButton.addEventListener("click", async () => {
  clearError();
  if (recording) return;
  try {
    if (!audioFile || !stream) throw new Error("Necesito audio y cámara antes de grabar.");
    ui.recordButton.disabled = true;
    ui.downloadButton.hidden = true;
    ui.audio.pause();
    ui.audio.currentTime = 0;
    await runCountdown();

    currentTake = createTake({
      mode,
      audioName: audioFile.name,
      audioDuration: ui.audio.duration
    });
    currentTake.appVersion = APP_VERSION;
    currentTake.capture = {
      videoWidth: ui.camera.videoWidth,
      videoHeight: ui.camera.videoHeight,
      userAgent: navigator.userAgent
    };

    recording = true;
    const start = performance.now();
    setStatus("Grabando…");
    await ui.audio.play();

    const captureFrame = (now) => {
      if (!recording) return;
      const t = Math.max(0, (now - start) / 1000);
      currentTake.timeline.frames.push({ t });
      captureRaf = requestAnimationFrame(captureFrame);
    };
    captureRaf = requestAnimationFrame(captureFrame);

    await new Promise((resolve) => {
      const done = () => {
        ui.audio.removeEventListener("ended", done);
        resolve();
      };
      ui.audio.addEventListener("ended", done, { once: true });
    });

    finishRecording();
  } catch (error) {
    finishRecording(false);
    showError(error);
  }
});

ui.downloadButton.addEventListener("click", () => {
  if (!currentTake) return;
  const blob = new Blob([JSON.stringify(currentTake, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (audioFile?.name || "take").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-");
  a.href = url;
  a.download = `em2-${mode}-${safe}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

async function runCountdown() {
  ui.countdown.hidden = false;
  for (const value of ["3","2","1"]) {
    ui.countdown.textContent = value;
    await sleep(700);
  }
  ui.countdown.hidden = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finishRecording(completed = true) {
  if (captureRaf) cancelAnimationFrame(captureRaf);
  captureRaf = 0;
  recording = false;
  ui.recordButton.disabled = false;
  if (completed && currentTake) {
    currentTake.timeline.frameCount = currentTake.timeline.frames.length;
    currentTake.timeline.duration = ui.audio.duration;
    ui.downloadButton.hidden = false;
    setStatus(`Take capturado: ${currentTake.timeline.frames.length} muestras. Tracking corporal/facial entra en la próxima capa.`);
  }
  refreshReadyState();
}

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  ui.camera.srcObject = null;
  ui.cameraPlaceholder.hidden = false;
  ui.cameraButton.textContent = "Encender cámara";
  setStatus("Cámara apagada.");
  refreshReadyState();
}

function refreshReadyState() {
  if (recording) return;
  const ready = Boolean(stream && audioFile && Number.isFinite(ui.audio.duration));
  ui.recordButton.disabled = !ready;
  if (ready) setStatus(`Listo para grabar ${mode === "body" ? "Body" : "Face"}.`);
}

setStatus(`EasyMocap 2 v${APP_VERSION} listo. Elegí audio y encendé la cámara.`);
