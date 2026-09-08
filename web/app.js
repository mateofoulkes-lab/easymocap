import {
  FilesetResolver,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const video = document.querySelector("#video");
const overlay = document.querySelector("#overlay");
const ctx = overlay.getContext("2d");
const cameraBtn = document.querySelector("#cameraBtn");
const recordBtn = document.querySelector("#recordBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const audioInput = document.querySelector("#audioInput");
const audioName = document.querySelector("#audioName");
const audio = document.querySelector("#audio");
const statusEl = document.querySelector("#status");
const countdown = document.querySelector("#countdown");
const footLock = document.querySelector("#footLock");

let stream = null;
let landmarker = null;
let running = false;
let recording = false;
let frames = [];
let audioFile = null;
let startPerf = 0;
let raf = 0;

const connections = [
[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],
[23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]
];

async function initPose(){
  if(landmarker) return;
  statusEl.textContent = "Cargando detector…";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );
  landmarker = await PoseLandmarker.createFromOptions(vision,{
    baseOptions:{
      modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate:"GPU"
    },
    runningMode:"VIDEO",
    numPoses:1,
    minPoseDetectionConfidence:.55,
    minPosePresenceConfidence:.55,
    minTrackingConfidence:.55
  });
}

audioInput.addEventListener("change",()=>{
  audioFile = audioInput.files?.[0] || null;
  if(!audioFile) return;
  audioName.textContent = audioFile.name;
  audio.src = URL.createObjectURL(audioFile);
  updateReady();
});

cameraBtn.addEventListener("click", async ()=>{
  if(stream){
    stopCamera();
    return;
  }
  try{
    await initPose();
    stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},
      audio:false
    });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth || 720;
    overlay.height = video.videoHeight || 1280;
    running = true;
    cameraBtn.textContent="Cerrar cámara";
    loop();
    updateReady();
  }catch(err){
    statusEl.textContent="No pude abrir la cámara";
    alert("EasyMocap necesita permiso para usar la cámara.\n\n"+err.message);
  }
});

recordBtn.addEventListener("click", async ()=>{
  if(recording || !audioFile || !stream) return;
  frames=[];
  downloadBtn.disabled=true;
  for(const n of [3,2,1]){
    countdown.textContent=n;
    countdown.classList.remove("hidden");
    await wait(1000);
  }
  countdown.classList.add("hidden");
  audio.currentTime=0;
  startPerf=performance.now();
  recording=true;
  recordBtn.textContent="Grabando…";
  await audio.play();
});

audio.addEventListener("ended", finishRecording);

downloadBtn.addEventListener("click",()=>{
  if(!frames.length) return;
  const take={
    format:"easymocap-mobile-take-v1",
    rig:"esqueleto-fase2.fbx",
    audio:audioFile?.name || null,
    footLock:footLock.checked,
    duration:frames.at(-1)?.timestamp || 0,
    frames
  };
  const blob=new Blob([JSON.stringify(take)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`easymocap-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function finishRecording(){
  if(!recording) return;
  recording=false;
  recordBtn.textContent="Grabar";
  downloadBtn.disabled=frames.length===0;
  statusEl.textContent=`Take listo · ${frames.length} frames`;
}

function updateReady(){
  recordBtn.disabled=!(audioFile && stream);
}

function stopCamera(){
  running=false;
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach(t=>t.stop());
  stream=null;
  video.srcObject=null;
  cameraBtn.textContent="Abrir cámara";
  recordBtn.disabled=true;
  statusEl.textContent="Cámara apagada";
}

function wait(ms){return new Promise(r=>setTimeout(r,ms));}

function loop(){
  if(!running) return;
  const now=performance.now();
  if(video.readyState>=2 && landmarker){
    const result=landmarker.detectForVideo(video,now);
    draw(result.landmarks?.[0]);
    const world=result.worldLandmarks?.[0];
    if(world?.length){
      statusEl.textContent=recording?"● Grabando movimiento":"● Cuerpo detectado";
      if(recording){
        frames.push({
          timestamp:(now-startPerf)/1000,
          image_landmarks:(result.landmarks?.[0]||[]).map(pack),
          world_landmarks:world.map(pack)
        });
      }
    }else{
      statusEl.textContent="● No detecto cuerpo completo";
    }
  }
  raf=requestAnimationFrame(loop);
}

function pack(p){
  return {x:p.x,y:p.y,z:p.z,visibility:p.visibility ?? 1};
}

function draw(points){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  if(!points) return;
  const sx=overlay.width, sy=overlay.height;
  ctx.lineWidth=4;
  ctx.strokeStyle="#75e6a4";
  ctx.fillStyle="#ffffff";
  for(const [a,b] of connections){
    const p=points[a], q=points[b];
    if(!p||!q) continue;
    ctx.beginPath();ctx.moveTo(p.x*sx,p.y*sy);ctx.lineTo(q.x*sx,q.y*sy);ctx.stroke();
  }
  for(const p of points){
    ctx.beginPath();ctx.arc(p.x*sx,p.y*sy,4,0,Math.PI*2);ctx.fill();
  }
}

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
