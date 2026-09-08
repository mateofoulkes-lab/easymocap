import { createTake } from "./core/spec.js?v=0.2.0";
import { BodyTracker } from "./tracking/body-tracker.js?v=0.2.0";

const APP_VERSION = "0.2.0";
const $ = (id) => document.getElementById(id);

const ui = {
  camera: $("camera"),
  overlay: $("overlay"),
  cameraPlaceholder: $("cameraPlaceholder"),
  audioInput: $("audioInput"),
  audio: $("audio"),
  audioName: $("audioName"),
  cameraButton: $("cameraButton"),
  recordButton: $("recordButton"),
  downloadButton: $("downloadButton"),
  countdown: $("countdown"),
  status: $("status"),
  trackingStatus: $("trackingStatus"),
  handStatus: $("handStatus"),
  errorPanel: $("errorPanel"),
  errorText: $("errorText")
};

let mode = "body";
let stream = null;
let audioUrl = null;
let audioFile = null;
let currentTake = null;
let recording = false;
let bodyTracker = null;
let trackerLoopId = 0;
let lastVideoTime = -1;
let lastInferenceAt = 0;
let latestTracking = null;
let lastFrameStoredAt = -1;
const handSmooth = {
  EM2_HandOpen_L:null, EM2_IndexOpen_L:null,
  EM2_HandOpen_R:null, EM2_IndexOpen_R:null
};

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

function setTrackerLabels(result) {
  if (mode !== "body") {
    ui.trackingStatus.textContent = "Tracking: Face pendiente";
    ui.handStatus.textContent = "Manos: —";
    return;
  }
  if (!bodyTracker?.ready) {
    ui.trackingStatus.textContent = "Tracking: sin cargar";
    ui.handStatus.textContent = "Manos: —";
    return;
  }
  if (!result?.tracked) {
    ui.trackingStatus.textContent = "Cuerpo: no detectado";
    ui.handStatus.textContent = "Manos: no detectadas";
    return;
  }
  ui.trackingStatus.textContent = "Cuerpo: OK";
  const h = result.frame.hands;
  const left = h.EM2_HandOpen_L == null ? "L —" : `L ${Math.round(h.EM2_HandOpen_L*100)}%`;
  const right = h.EM2_HandOpen_R == null ? "R —" : `R ${Math.round(h.EM2_HandOpen_R*100)}%`;
  ui.handStatus.textContent = `Manos: ${left} · ${right}`;
}

window.addEventListener("error", (event) => showError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => showError(event.reason || "Promise rechazada"));

document.querySelectorAll(".mode[data-mode]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (button.disabled || recording) return;
    mode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b === button));
    clearOverlay();
    setTrackerLabels(null);
    setStatus(`Modo ${mode === "body" ? "Body" : "Face"} listo.`);
    if (mode === "body" && stream) {
      try { await ensureBodyTracker(); } catch (error) { showError(error); }
    }
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
      video: { facingMode:"user", width:{ideal:1280}, height:{ideal:720} },
      audio:false
    });
    ui.camera.srcObject = stream;
    await ui.camera.play();
    ui.cameraPlaceholder.hidden = true;
    ui.cameraButton.textContent = "Apagar cámara";

    if (mode === "body") await ensureBodyTracker();
    startTrackerLoop();
    setStatus("Cámara lista.");
    refreshReadyState();
  } catch (error) {
    stopCamera();
    showError(error);
  }
});

ui.recordButton.addEventListener("click", async () => {
  clearError();
  if (recording) return;
  try {
    if (!audioFile || !stream) throw new Error("Necesito audio y cámara antes de grabar.");
    if (mode === "body" && !bodyTracker?.ready) await ensureBodyTracker();

    ui.recordButton.disabled = true;
    ui.downloadButton.hidden = true;
    ui.audio.pause();
    ui.audio.currentTime = 0;
    await runCountdown();

    currentTake = createTake({
      mode,
      audioName:audioFile.name,
      audioDuration:ui.audio.duration
    });
    currentTake.appVersion = APP_VERSION;
    currentTake.capture = {
      videoWidth:ui.camera.videoWidth,
      videoHeight:ui.camera.videoHeight,
      userAgent:navigator.userAgent,
      tracker: mode === "body" ? "MediaPipe Tasks Vision 1.0.1" : null
    };

    resetSmoothing();
    lastFrameStoredAt = -1;
    recording = true;
    setStatus("Grabando…");
    await ui.audio.play();

    await new Promise((resolve) => {
      const done = () => resolve();
      ui.audio.addEventListener("ended",done,{once:true});
    });

    finishRecording();
  } catch (error) {
    finishRecording(false);
    showError(error);
  }
});

ui.downloadButton.addEventListener("click", () => {
  if (!currentTake) return;
  const blob = new Blob([JSON.stringify(currentTake,null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (audioFile?.name || "take").replace(/\.[^.]+$/,"").replace(/[^a-z0-9_-]+/gi,"-");
  a.href = url;
  a.download = `em2-${mode}-${safe}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url),0);
});

async function ensureBodyTracker() {
  if (bodyTracker?.ready) return;
  setStatus("Cargando tracking corporal y de manos…");
  ui.trackingStatus.textContent = "Tracking: cargando modelos…";
  bodyTracker ||= new BodyTracker();
  await bodyTracker.init();
  ui.trackingStatus.textContent = "Tracking: listo";
  setStatus("Tracking Body listo.");
}

function startTrackerLoop() {
  if (trackerLoopId) cancelAnimationFrame(trackerLoopId);
  const loop = (now) => {
    trackerLoopId = requestAnimationFrame(loop);
    if (!stream || ui.camera.readyState < 2 || mode !== "body" || !bodyTracker?.ready) return;
    if (ui.camera.currentTime === lastVideoTime || now-lastInferenceAt < 34) return;
    lastVideoTime = ui.camera.currentTime;
    lastInferenceAt = now;

    try {
      latestTracking = bodyTracker.detect(ui.camera,Math.round(now));
      bodyTracker.draw(ui.overlay,ui.camera,latestTracking);
      setTrackerLabels(latestTracking);
      if (recording && latestTracking.tracked) storeBodyFrame(latestTracking.frame);
    } catch (error) {
      cancelAnimationFrame(trackerLoopId);
      trackerLoopId = 0;
      showError(error);
    }
  };
  trackerLoopId = requestAnimationFrame(loop);
}

function storeBodyFrame(frame) {
  if (!currentTake || mode !== "body") return;
  const t = ui.audio.currentTime;
  if (!Number.isFinite(t) || t < 0 || Math.abs(t-lastFrameStoredAt) < 0.015) return;
  lastFrameStoredAt = t;

  const hands = {};
  for (const [key,value] of Object.entries(frame.hands)) {
    if (value == null) {
      hands[key] = handSmooth[key];
      continue;
    }
    handSmooth[key] = handSmooth[key] == null ? value : mix(handSmooth[key],value,0.35);
    hands[key] = round(handSmooth[key],4);
  }

  const bones = {};
  for (const [name,bone] of Object.entries(frame.bones)) {
    bones[name] = {
      direction:bone.direction.map((v)=>round(v,5)),
      length:round(bone.length,5),
      confidence:round(bone.confidence,3)
    };
  }

  currentTake.timeline.frames.push({
    t:round(t,4),
    root:{
      screen:frame.root.screen.map((v)=>round(v,5)),
      apparentScale:round(frame.root.apparentScale,5),
      torsoScale:round(frame.root.torsoScale,5),
      confidence:round(frame.root.confidence,3)
    },
    bones,
    hands
  });
}

function resetSmoothing() {
  for (const key of Object.keys(handSmooth)) handSmooth[key] = null;
}

function round(value,digits) {
  const p = 10**digits;
  return Math.round(value*p)/p;
}

function mix(a,b,t) {
  return a+(b-a)*t;
}

async function runCountdown() {
  ui.countdown.hidden = false;
  for (const value of ["3","2","1"]) {
    ui.countdown.textContent = value;
    await sleep(700);
  }
  ui.countdown.hidden = true;
}

function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve,ms));
}

function finishRecording(completed=true) {
  recording = false;
  if (completed && currentTake) {
    currentTake.timeline.frameCount = currentTake.timeline.frames.length;
    currentTake.timeline.duration = ui.audio.duration;
    currentTake.timeline.averageFps = currentTake.timeline.duration > 0
      ? round(currentTake.timeline.frameCount/currentTake.timeline.duration,2)
      : 0;
    ui.downloadButton.hidden = false;
    setStatus(`Take Body capturado: ${currentTake.timeline.frames.length} frames · ${currentTake.timeline.averageFps} fps.`);
  }
  refreshReadyState();
}

function clearOverlay() {
  const ctx = ui.overlay.getContext("2d");
  ctx.clearRect(0,0,ui.overlay.width,ui.overlay.height);
}

function stopCamera() {
  stream?.getTracks().forEach((track)=>track.stop());
  stream = null;
  ui.camera.srcObject = null;
  ui.cameraPlaceholder.hidden = false;
  ui.cameraButton.textContent = "Encender cámara";
  if (trackerLoopId) cancelAnimationFrame(trackerLoopId);
  trackerLoopId = 0;
  latestTracking = null;
  clearOverlay();
  setTrackerLabels(null);
  setStatus("Cámara apagada.");
  refreshReadyState();
}

function refreshReadyState() {
  if (recording) return;
  const trackerReady = mode !== "body" || bodyTracker?.ready;
  const ready = Boolean(stream && audioFile && Number.isFinite(ui.audio.duration) && trackerReady);
  ui.recordButton.disabled = !ready;
  if (ready) setStatus(`Listo para grabar ${mode === "body" ? "Body" : "Face"}.`);
}

setTrackerLabels(null);
setStatus(`EasyMocap 2 v${APP_VERSION} listo. Elegí audio y encendé la cámara.`);
