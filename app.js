import { createTake, BODY_ROTATION_FORMAT } from "./core/spec.js?v=0.5.3";
import { BodyTracker } from "./tracking/body-tracker.js?v=0.5.3";
import { FaceTracker } from "./tracking/face-tracker.js?v=0.5.3";

const APP_VERSION="0.5.3";
const $=(id)=>document.getElementById(id);
const ui={
  camera:$("camera"),overlay:$("overlay"),cameraPlaceholder:$("cameraPlaceholder"),
  audioInput:$("audioInput"),audio:$("audio"),audioName:$("audioName"),
  cameraButton:$("cameraButton"),flipCameraButton:$("flipCameraButton"),recordButton:$("recordButton"),downloadButton:$("downloadButton"),
  countdown:$("countdown"),status:$("status"),trackingStatus:$("trackingStatus"),handStatus:$("handStatus"),
  errorPanel:$("errorPanel"),errorText:$("errorText")
};

let mode="body",stream=null,audioUrl=null,audioFile=null,currentTake=null,recording=false,cameraFacing="user",switchingCamera=false;
let bodyTracker=null,faceTracker=null,trackerLoopId=0,lastVideoTime=-1,lastInferenceAt=0,lastFrameStoredAt=-1;
const handSmooth={EM2_HandOpen_L:null,EM2_IndexOpen_L:null,EM2_HandOpen_R:null,EM2_IndexOpen_R:null};
const faceSmooth={
  EM2_Blink_L:null,EM2_Blink_R:null,EM2_Brow_L:null,EM2_Brow_R:null,
  EM2_MouthOpen:null,EM2_MouthWidth:null,EM2_MouthCorner_L:null,EM2_MouthCorner_R:null
};
const bodyRotationSmooth={root:null,bones:{}};

function setStatus(s){ui.status.textContent=s}
function clearError(){ui.errorPanel.hidden=true;ui.errorText.textContent=""}
function showError(error){
  ui.errorText.textContent=error instanceof Error?`${error.name}: ${error.message}\n${error.stack||""}`:String(error);
  ui.errorPanel.hidden=false;setStatus("Falló una operación.");console.error(error);
}
window.addEventListener("error",e=>showError(e.error||e.message));
window.addEventListener("unhandledrejection",e=>showError(e.reason||"Promise rechazada"));

function setTrackerLabels(result){
  if(mode==="body"){
    if(!bodyTracker?.ready){ui.trackingStatus.textContent="Tracking: sin cargar";ui.handStatus.textContent="Manos: —";return}
    if(!result?.tracked){ui.trackingStatus.textContent="Cuerpo: no detectado";ui.handStatus.textContent="Manos: no detectadas";return}
    ui.trackingStatus.textContent="Cuerpo: OK";
    const h=result.frame.hands;
    const l=h.EM2_HandOpen_L==null?"L —":`L ${Math.round(h.EM2_HandOpen_L*100)}%`;
    const r=h.EM2_HandOpen_R==null?"R —":`R ${Math.round(h.EM2_HandOpen_R*100)}%`;
    ui.handStatus.textContent=`Manos: ${l} · ${r}`;return;
  }
  if(!faceTracker?.ready){ui.trackingStatus.textContent="Face: sin cargar";ui.handStatus.textContent="Expresión: —";return}
  if(!result?.tracked){ui.trackingStatus.textContent="Face: no detectada";ui.handStatus.textContent="Expresión: —";return}
  const c=result.frame.channels;
  ui.trackingStatus.textContent="Face: OK";
  ui.handStatus.textContent=`Boca ${Math.round(c.EM2_MouthOpen*100)}% · Blink L/R ${Math.round(c.EM2_Blink_L*100)}/${Math.round(c.EM2_Blink_R*100)}`;
}

document.querySelectorAll(".mode[data-mode]").forEach(button=>{
  button.addEventListener("click",async()=>{
    if(button.disabled||recording)return;
    mode=button.dataset.mode;
    document.querySelectorAll(".mode").forEach(b=>b.classList.toggle("active",b===button));
    clearOverlay();setTrackerLabels(null);setStatus(`Modo ${mode==="body"?"Body":"Face"} listo.`);
    if(stream){
      try{mode==="body"?await ensureBodyTracker():await ensureFaceTracker()}catch(e){showError(e)}
    }
    refreshReadyState();
  });
});

ui.audioInput.addEventListener("change",()=>{
  clearError();const file=ui.audioInput.files?.[0];if(!file)return;
  if(!file.type.startsWith("audio/"))return showError(new Error("El archivo elegido no parece ser audio."));
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioFile=file;audioUrl=URL.createObjectURL(file);ui.audio.src=audioUrl;ui.audioName.textContent=file.name;ui.audio.load();refreshReadyState();
});
ui.audio.addEventListener("loadedmetadata",refreshReadyState);
ui.audio.addEventListener("error",()=>showError(new Error("El navegador no pudo cargar ese audio.")));

ui.flipCameraButton.addEventListener("click",()=>switchCamera());

ui.cameraButton.addEventListener("click",async()=>{
  clearError();if(stream){stopCamera();return}
  try{await startCamera(cameraFacing)}catch(e){stopCamera();showError(e)}
});

async function startCamera(facing){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("getUserMedia no está disponible en este navegador/contexto.");
  setStatus(`Abriendo cámara ${facing==="user"?"frontal":"trasera"}…`);
  const nextStream=await navigator.mediaDevices.getUserMedia({
    video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},
    audio:false
  });
  stream=nextStream;
  cameraFacing=facing;
  ui.camera.srcObject=stream;
  await ui.camera.play();
  ui.cameraPlaceholder.hidden=true;
  ui.cameraButton.textContent="Apagar cámara";
  ui.camera.classList.toggle("rear",cameraFacing==="environment");
  mode==="body"?await ensureBodyTracker():await ensureFaceTracker();
  startTrackerLoop();
  setStatus(`Cámara ${cameraFacing==="user"?"frontal":"trasera"} lista.`);
  refreshReadyState();
}

async function switchCamera(){
  if(recording||switchingCamera||!stream)return;
  switchingCamera=true;
  ui.flipCameraButton.disabled=true;
  ui.flipCameraButton.textContent="Cambiando…";
  const previous=cameraFacing;
  const next=previous==="user"?"environment":"user";
  try{
    const oldStream=stream;
    stream=null;
    ui.camera.srcObject=null;
    oldStream.getTracks().forEach(t=>t.stop());
    clearOverlay();
    await startCamera(next);
  }catch(error){
    showError(new Error(`No pude cambiar a la cámara ${next==="user"?"frontal":"trasera"}: ${error.message||error}`));
    try{await startCamera(previous)}catch(recoveryError){showError(recoveryError)}
  }finally{
    switchingCamera=false;
    ui.flipCameraButton.disabled=!stream;
    ui.flipCameraButton.textContent="Girar cámara";
  }
}

ui.recordButton.addEventListener("click",async()=>{
  clearError();if(recording)return;
  try{
    if(!audioFile||!stream)throw new Error("Necesito audio y cámara antes de grabar.");
    if(mode==="body"&&!bodyTracker?.ready)await ensureBodyTracker();
    if(mode==="face"&&!faceTracker?.ready)await ensureFaceTracker();
    ui.recordButton.disabled=true;ui.downloadButton.hidden=true;ui.audio.pause();ui.audio.currentTime=0;
    await runCountdown();

    currentTake=createTake({mode,audioName:audioFile.name,audioDuration:ui.audio.duration});
    currentTake.appVersion=APP_VERSION;
    currentTake.capture={
      videoWidth:ui.camera.videoWidth,videoHeight:ui.camera.videoHeight,userAgent:navigator.userAgent,
      tracker:"MediaPipe Tasks Vision 1.0.1",cameraFacing
    };
    if(mode==="body")currentTake.capture.bodyRotationFormat=BODY_ROTATION_FORMAT;

    resetSmoothing();lastFrameStoredAt=-1;recording=true;setStatus("Grabando…");await ui.audio.play();
    await new Promise(resolve=>ui.audio.addEventListener("ended",resolve,{once:true}));
    finishRecording();
  }catch(e){finishRecording(false);showError(e)}
});

ui.downloadButton.addEventListener("click",()=>{
  if(!currentTake)return;
  const blob=new Blob([JSON.stringify(currentTake,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  const safe=(audioFile?.name||"take").replace(/\.[^.]+$/,"").replace(/[^a-z0-9_-]+/gi,"-");
  a.href=url;a.download=`em2-${mode}-${safe}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
});

async function ensureBodyTracker(){
  if(bodyTracker?.ready)return;
  setStatus("Cargando tracking corporal y de manos…");ui.trackingStatus.textContent="Tracking: cargando modelos…";
  bodyTracker||=new BodyTracker();await bodyTracker.init();ui.trackingStatus.textContent="Tracking: listo";setStatus("Tracking Body listo.");
}
async function ensureFaceTracker(){
  if(faceTracker?.ready)return;
  setStatus("Cargando tracking facial…");ui.trackingStatus.textContent="Face: cargando modelo…";
  faceTracker||=new FaceTracker();await faceTracker.init();ui.trackingStatus.textContent="Face: listo";setStatus("Tracking Face listo.");
}

function startTrackerLoop(){
  if(trackerLoopId)cancelAnimationFrame(trackerLoopId);
  const loop=now=>{
    trackerLoopId=requestAnimationFrame(loop);
    if(!stream||ui.camera.readyState<2)return;
    const tracker=mode==="body"?bodyTracker:faceTracker;if(!tracker?.ready)return;
    if(ui.camera.currentTime===lastVideoTime||now-lastInferenceAt<34)return;
    lastVideoTime=ui.camera.currentTime;lastInferenceAt=now;
    try{
      const result=tracker.detect(ui.camera,Math.round(now));tracker.draw(ui.overlay,ui.camera,result,cameraFacing==="user");setTrackerLabels(result);
      if(recording&&result.tracked)(mode==="body"?storeBodyFrame(result.frame):storeFaceFrame(result.frame));
    }catch(e){cancelAnimationFrame(trackerLoopId);trackerLoopId=0;showError(e)}
  };
  trackerLoopId=requestAnimationFrame(loop);
}

function smoothQuat(prev,next,alpha){
  if(!prev)return [...next];
  let n=[...next];const d=prev[0]*n[0]+prev[1]*n[1]+prev[2]*n[2]+prev[3]*n[3];
  if(d<0)n=n.map(x=>-x);
  const q=prev.map((x,i)=>x+(n[i]-x)*alpha),l=Math.hypot(...q)||1;
  return q.map(x=>x/l);
}
function qRound(q){return q.map(x=>round(x,6))}

function storeBodyFrame(frame){
  if(!currentTake||mode!=="body")return;
  const t=ui.audio.currentTime;if(!Number.isFinite(t)||t<0||Math.abs(t-lastFrameStoredAt)<.015)return;lastFrameStoredAt=t;

  bodyRotationSmooth.root=smoothQuat(bodyRotationSmooth.root,frame.root.rotation,.42);
  const bones={};
  for(const [name,bone] of Object.entries(frame.bones)){
    bodyRotationSmooth.bones[name]=smoothQuat(bodyRotationSmooth.bones[name],bone.rotation,.42);
    bones[name]={rotation:qRound(bodyRotationSmooth.bones[name]),length:round(bone.length,5),confidence:round(bone.confidence,3)};
  }
  const hands={};
  for(const [key,value] of Object.entries(frame.hands)){
    if(value==null){hands[key]=handSmooth[key];continue}
    handSmooth[key]=handSmooth[key]==null?value:mix(handSmooth[key],value,.35);hands[key]=round(handSmooth[key],4);
  }
  currentTake.timeline.frames.push({
    t:round(t,4),
    root:{
      screen:frame.root.screen.map(x=>round(x,5)),apparentScale:round(frame.root.apparentScale,5),
      torsoScale:round(frame.root.torsoScale,5),confidence:round(frame.root.confidence,3),
      rotation:qRound(bodyRotationSmooth.root)
    },
    bones,hands
  });
}

function storeFaceFrame(frame){
  if(!currentTake||mode!=="face")return;
  const t=ui.audio.currentTime;if(!Number.isFinite(t)||t<0||Math.abs(t-lastFrameStoredAt)<.015)return;lastFrameStoredAt=t;
  const channels={};
  for(const [key,value] of Object.entries(frame.channels)){
    faceSmooth[key]=faceSmooth[key]==null?value:mix(faceSmooth[key],value,.4);channels[key]=round(faceSmooth[key],4);
  }
  currentTake.timeline.frames.push({t:round(t,4),channels});
}

function resetSmoothing(){
  for(const k of Object.keys(handSmooth))handSmooth[k]=null;
  for(const k of Object.keys(faceSmooth))faceSmooth[k]=null;
  bodyRotationSmooth.root=null;bodyRotationSmooth.bones={};
}
function round(v,d){const p=10**d;return Math.round(v*p)/p}
function mix(a,b,t){return a+(b-a)*t}
async function runCountdown(){ui.countdown.hidden=false;for(const n of ["3","2","1"]){ui.countdown.textContent=n;await new Promise(r=>setTimeout(r,700))}ui.countdown.hidden=true}
function finishRecording(completed=true){
  recording=false;
  if(completed&&currentTake){
    currentTake.timeline.frameCount=currentTake.timeline.frames.length;currentTake.timeline.duration=ui.audio.duration;
    currentTake.timeline.averageFps=currentTake.timeline.duration>0?round(currentTake.timeline.frameCount/currentTake.timeline.duration,2):0;
    ui.downloadButton.hidden=false;setStatus(`Take ${mode==="body"?"Body":"Face"}: ${currentTake.timeline.frames.length} frames · ${currentTake.timeline.averageFps} fps.`);
  }
  refreshReadyState();
}
function clearOverlay(){ui.overlay.getContext("2d").clearRect(0,0,ui.overlay.width,ui.overlay.height)}
function stopCamera(){
  stream?.getTracks().forEach(t=>t.stop());stream=null;ui.camera.srcObject=null;ui.cameraPlaceholder.hidden=false;ui.cameraButton.textContent="Encender cámara";ui.flipCameraButton.disabled=true;
  if(trackerLoopId)cancelAnimationFrame(trackerLoopId);trackerLoopId=0;clearOverlay();setTrackerLabels(null);setStatus("Cámara apagada.");refreshReadyState();
}
function refreshReadyState(){
  if(recording)return;
  const trackerReady=mode==="body"?bodyTracker?.ready:faceTracker?.ready;
  const ready=Boolean(stream&&audioFile&&Number.isFinite(ui.audio.duration)&&trackerReady);
  ui.recordButton.disabled=!ready;ui.flipCameraButton.disabled=!stream||recording||switchingCamera;if(ready)setStatus(`Listo para grabar ${mode==="body"?"Body":"Face"}.`);
}
setTrackerLabels(null);setStatus(`EasyMocap 2 v${APP_VERSION} listo. Elegí audio y encendé la cámara.`);
