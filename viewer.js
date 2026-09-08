import { loadLatestSession, clearLatestSession } from "./core/session-store.js?v=0.5.5";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BODY_BONES,HAND_CHANNELS,MODEL_FACE_SHAPES,BODY_ROTATION_FORMAT,assertTake } from "./core/spec.js?v=0.5.5";

const $=id=>document.getElementById(id);
const ui={
  viewport:$("viewport"),modelInput:$("modelInput"),bodyInput:$("bodyInput"),faceInput:$("faceInput"),audioInput:$("audioInput"),
  audio:$("audio"),playButton:$("playButton"),scrub:$("scrub"),timeLabel:$("timeLabel"),summary:$("summary"),
  validation:$("validation"),errorPanel:$("errorPanel"),errorText:$("errorText"),
  sessionStatus:$("sessionStatus"),clearSessionButton:$("clearSessionButton")
};

let modelRoot=null,bodyTake=null,faceTake=null,audioUrl=null,boneMap=new Map(),morphMeshes=[],restLocal=new Map(),bodyReference=new Map();
let playing=false,playhead=0,internalStartTime=0,internalStartPerf=0;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x07090c);
const camera=new THREE.PerspectiveCamera(45,1,.01,100);
camera.position.set(2.4,1.6,3.8);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
ui.viewport.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,1,0);
controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x303846,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.5);
key.position.set(3,5,4);
scene.add(key);
scene.add(new THREE.GridHelper(10,20,0x394454,0x202731));
new ResizeObserver(resize).observe(ui.viewport);

function resize(){
  const w=ui.viewport.clientWidth,h=ui.viewport.clientHeight;
  renderer.setSize(w,h,false);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}
function showError(e){
  ui.errorText.textContent=e instanceof Error?`${e.name}: ${e.message}\n${e.stack||""}`:String(e);
  ui.errorPanel.hidden=false;
  console.error(e);
}
function clearError(){ui.errorPanel.hidden=true;ui.errorText.textContent=""}
window.addEventListener("error",e=>showError(e.error||e.message));
window.addEventListener("unhandledrejection",e=>showError(e.reason||"Promise rechazada"));

async function loadModel(url,revoke=false){
  const gltf=await new GLTFLoader().loadAsync(url);
  if(revoke)URL.revokeObjectURL(url);
  if(modelRoot)scene.remove(modelRoot);
  modelRoot=gltf.scene;
  scene.add(modelRoot);
  prepareModel();
  frameModel();
  validateModel();
  applyAt(playhead);
  updateReady();
}

ui.modelInput.addEventListener("change",async()=>{
  clearError();
  try{
    const f=ui.modelInput.files?.[0];
    if(f)await loadModel(URL.createObjectURL(f),true);
  }catch(e){showError(e)}
});
ui.bodyInput.addEventListener("change",async()=>{
  clearError();
  try{
    bodyTake=await readTake(ui.bodyInput.files?.[0],"body");
    validateBodyTake();
    buildBodyReference();
    normalizePlayhead();
    applyAt(playhead);
    updateReady();
  }catch(e){showError(e)}
});
ui.faceInput.addEventListener("change",async()=>{
  clearError();
  try{
    faceTake=await readTake(ui.faceInput.files?.[0],"face");
    normalizePlayhead();
    applyAt(playhead);
    updateReady();
  }catch(e){showError(e)}
});
ui.audioInput.addEventListener("change",()=>{
  const f=ui.audioInput.files?.[0];
  if(!f)return;
  setAudioBlob(f);
});

ui.audio.addEventListener("loadedmetadata",()=>{
  normalizePlayhead();
  if(Number.isFinite(ui.audio.duration))ui.audio.currentTime=Math.min(playhead,ui.audio.duration||0);
  updateReady();
  applyAt(playhead);
});
ui.audio.addEventListener("ended",()=>stopPlayback(true));

ui.playButton.addEventListener("click",async()=>{
  if(playing){stopPlayback(false);return}
  if(!canPlay())return;
  const duration=getDuration();
  if(playhead>=duration-.001)seekTo(0);

  if(hasAudio()){
    ui.audio.currentTime=playhead;
    await ui.audio.play();
  }else{
    internalStartTime=playhead;
    internalStartPerf=performance.now();
  }
  playing=true;
  ui.playButton.textContent="❚❚ Pausa";
});

ui.scrub.addEventListener("input",()=>{
  seekTo(Number(ui.scrub.value));
  if(playing&&!hasAudio()){
    internalStartTime=playhead;
    internalStartPerf=performance.now();
  }
});

ui.clearSessionButton.addEventListener("click",async()=>{
  try{
    await clearLatestSession();
    ui.sessionStatus.textContent="Sesión temporal borrada";
    ui.clearSessionButton.disabled=true;
  }catch(e){showError(e)}
});

async function readTake(file,expected){
  if(!file)return null;
  const data=JSON.parse(await file.text());
  assertTake(data);
  if(data.mode!==expected)throw new Error(`Esperaba take ${expected}, recibí ${data.mode}`);
  return data;
}
function validateTakeObject(data,expected){
  if(!data)return null;
  assertTake(data);
  if(data.mode!==expected)throw new Error(`Take temporal ${data.mode} no coincide con ${expected}`);
  return data;
}
function validateBodyTake(){
  if(!bodyTake)return;
  const fmt=bodyTake.capture?.bodyRotationFormat;
  if(bodyTake.specVersion==="1.1"&&fmt!==BODY_ROTATION_FORMAT)throw new Error(`Formato corporal inesperado: ${fmt||"sin formato"}`);
}

function buildBodyReference(){
  bodyReference=new Map();
  const first=bodyTake?.timeline?.frames?.[0];
  if(!first)return;
  if(first.root?.rotation)bodyReference.set("Root",new THREE.Quaternion(...first.root.rotation).normalize());
  for(const name of BODY_BONES){
    if(name==="Root")continue;
    const q=first.bones?.[name]?.rotation;
    if(q)bodyReference.set(name,new THREE.Quaternion(...q).normalize());
  }
}
function relativeQuat(name,q){
  if(!q)return null;
  const ref=bodyReference.get(name);
  if(!ref)return q;
  return ref.clone().invert().multiply(q).normalize();
}

function prepareModel(){
  boneMap=new Map();
  morphMeshes=[];
  restLocal=new Map();
  modelRoot.traverse(o=>{
    if(o.isBone)boneMap.set(o.name,o);
    if(o.isMesh&&o.morphTargetDictionary)morphMeshes.push(o);
  });
  for(const [name,bone] of boneMap)restLocal.set(name,bone.quaternion.clone());
  attachRigidHeadParts();
}

function attachRigidHeadParts(){
  const head=boneMap.get("Head");
  if(!head)return;
  const matches=[];
  modelRoot.traverse(o=>{
    if(o===head||o.isBone||o.isSkinnedMesh)return;
    const n=(o.name||"").toUpperCase();
    if(n.includes("OJO")||n.includes("EYE")||n.includes("DIENTE")||n.includes("TEETH"))matches.push(o);
  });
  modelRoot.updateMatrixWorld(true);
  for(const o of matches){
    if(o.parent!==head)head.attach(o);
  }
  head.updateMatrixWorld(true);
}

function validateModel(){
  ui.validation.innerHTML="";
  const skinned=[];
  modelRoot.traverse(o=>{if(o.isSkinnedMesh)skinned.push(o)});
  addCheck("Skinned mesh",skinned.length>0,`${skinned.length} encontrado(s)`);

  let missing=0;
  for(const name of BODY_BONES){
    const ok=boneMap.has(name);
    if(!ok)missing++;
    addCheck(name,ok,ok?"bone OK":"FALTA");
  }

  const morphs=new Set();
  for(const mesh of morphMeshes)for(const name of Object.keys(mesh.morphTargetDictionary))morphs.add(name);
  for(const name of [...HAND_CHANNELS,...MODEL_FACE_SHAPES])addCheck(name,morphs.has(name),morphs.has(name)?"shape OK":"FALTA",true);

  ui.summary.textContent=`${skinned.length?"Rig detectado":"Sin skin"} · ${BODY_BONES.length-missing}/${BODY_BONES.length} bones EM2 · ${morphs.size} morph targets`;
}
function addCheck(name,ok,text,optional=false){
  const row=document.createElement("div");
  row.className="check";
  row.innerHTML=`<span>${esc(name)}</span><span class="${ok?"ok":optional?"warn":"bad"}">${esc(text)}</span>`;
  ui.validation.appendChild(row);
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function frameModel(){
  const box=new THREE.Box3().setFromObject(modelRoot);
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const m=Math.max(size.x,size.y,size.z,1);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(m*1.5,m*.7,m*2.2));
  camera.near=m/1000;
  camera.far=m*50;
  camera.updateProjectionMatrix();
  controls.update();
}

function takeDuration(take){
  if(!take)return 0;
  const declared=Number(take.timeline?.duration);
  if(Number.isFinite(declared)&&declared>0)return declared;
  const frames=take.timeline?.frames||[];
  return frames.length?Number(frames[frames.length-1].t)||0:0;
}
function hasAudio(){return Boolean(ui.audio.src&&Number.isFinite(ui.audio.duration)&&ui.audio.duration>0)}
function getDuration(){
  if(hasAudio())return ui.audio.duration;
  return Math.max(takeDuration(bodyTake),takeDuration(faceTake),0);
}
function canPlay(){return Boolean(modelRoot&&(bodyTake||faceTake)&&getDuration()>0)}
function normalizePlayhead(){
  const duration=getDuration();
  playhead=Math.max(0,Math.min(playhead,duration||0));
  ui.scrub.max=String(duration||1);
  ui.scrub.value=String(playhead);
}
function updateReady(){
  normalizePlayhead();
  const ready=canPlay();
  ui.playButton.disabled=!ready;
  ui.scrub.disabled=!ready;
  const parts=[];
  if(bodyTake)parts.push("Body");
  if(faceTake)parts.push("Face");
  if(hasAudio())parts.push("Audio");
  if(ui.sessionStatus&&parts.length)ui.sessionStatus.textContent=`Listo: ${parts.join(" + ")}`;
}
function seekTo(t){
  const duration=getDuration();
  playhead=Math.max(0,Math.min(Number(t)||0,duration||0));
  if(hasAudio())ui.audio.currentTime=playhead;
  ui.scrub.value=String(playhead);
  applyAt(playhead);
}
function stopPlayback(ended){
  if(hasAudio())ui.audio.pause();
  playing=false;
  ui.playButton.textContent="▶ Play";
  if(ended){
    playhead=getDuration();
    ui.scrub.value=String(playhead);
  }
}

function sample(take,t){
  const frames=take?.timeline?.frames;
  if(!frames?.length)return null;
  if(frames.length===1)return{a:frames[0],b:frames[0],alpha:0};
  let lo=0,hi=frames.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(frames[mid].t<t)lo=mid+1;
    else hi=mid;
  }
  if(lo===0)return{a:frames[0],b:frames[0],alpha:0};
  const a=frames[lo-1],b=frames[lo],span=Math.max(1e-6,b.t-a.t);
  return{a,b,alpha:THREE.MathUtils.clamp((t-a.t)/span,0,1)};
}
function qAt(qa,qb,alpha){
  if(!qa&&!qb)return null;
  const a=qa||qb,b=qb||qa;
  return new THREE.Quaternion(a[0],a[1],a[2],a[3]).slerp(new THREE.Quaternion(b[0],b[1],b[2],b[3]),alpha);
}
function scalarAt(a,b,alpha,key){
  const av=a?.[key],bv=b?.[key];
  if(av==null&&bv==null)return null;
  if(av==null)return bv;
  if(bv==null)return av;
  return THREE.MathUtils.lerp(av,bv,alpha);
}
function applyDelta(name,q){
  const bone=boneMap.get(name),rest=restLocal.get(name);
  if(!bone||!rest||!q)return;
  const rel=relativeQuat(name,q);
  bone.quaternion.copy(rest).multiply(rel).normalize();
}
function applyBody(s){
  if(!s)return;
  const {a,b,alpha}=s;
  if(a.root?.rotation||b.root?.rotation)applyDelta("Root",qAt(a.root?.rotation,b.root?.rotation,alpha));
  for(const name of BODY_BONES){
    if(name==="Root")continue;
    const qa=a.bones?.[name]?.rotation,qb=b.bones?.[name]?.rotation;
    if(qa||qb)applyDelta(name,qAt(qa,qb,alpha));
  }
  for(const name of HAND_CHANNELS)setMorph(name,scalarAt(a.hands,b.hands,alpha,name));
}
function applyFace(s){
  if(!s)return;
  const {a,b,alpha}=s;
  const val=k=>scalarAt(a.channels,b.channels,alpha,k);
  setMorph("EM2_Blink_L",val("EM2_Blink_L"));
  setMorph("EM2_Blink_R",val("EM2_Blink_R"));
  setMorph("EM2_MouthOpen",val("EM2_MouthOpen"));
  split(val("EM2_Brow_L"),"EM2_BrowDown_L","EM2_BrowUp_L");
  split(val("EM2_Brow_R"),"EM2_BrowDown_R","EM2_BrowUp_R");
  split(val("EM2_MouthWidth"),"EM2_MouthNarrow","EM2_MouthWide");
  split(val("EM2_MouthCorner_L"),"EM2_MouthFrown_L","EM2_MouthSmile_L");
  split(val("EM2_MouthCorner_R"),"EM2_MouthFrown_R","EM2_MouthSmile_R");
}
function split(v,low,high){
  if(v==null)return;
  setMorph(low,Math.max(0,(.5-v)*2));
  setMorph(high,Math.max(0,(v-.5)*2));
}
function setMorph(name,value){
  if(value==null)return;
  for(const mesh of morphMeshes){
    const i=mesh.morphTargetDictionary?.[name];
    if(i!=null)mesh.morphTargetInfluences[i]=THREE.MathUtils.clamp(value,0,1);
  }
}
function applyAt(t){
  if(bodyTake)applyBody(sample(bodyTake,t));
  if(faceTake)applyFace(sample(faceTake,t));
}

function setAudioBlob(blob){
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioUrl=URL.createObjectURL(blob);
  ui.audio.src=audioUrl;
  ui.audio.load();
}

async function loadTemporarySession(){
  try{
    const s=await loadLatestSession();
    if(!s){
      ui.sessionStatus.textContent="Sin sesión temporal";
      ui.clearSessionButton.disabled=true;
      return;
    }
    bodyTake=s.body?validateTakeObject(s.body,"body"):null;
    faceTake=s.face?validateTakeObject(s.face,"face"):null;
    if(bodyTake){
      validateBodyTake();
      buildBodyReference();
    }
    if(s.audioBlob)setAudioBlob(s.audioBlob);
    const parts=[];
    if(bodyTake)parts.push("Body");
    if(faceTake)parts.push("Face");
    if(s.audioBlob)parts.push("Audio");
    ui.sessionStatus.textContent=parts.length?`Sesión temporal: ${parts.join(" + ")}`:"Sesión temporal vacía";
    ui.clearSessionButton.disabled=false;
    normalizePlayhead();
    applyAt(0);
    updateReady();
  }catch(e){
    console.warn("No pude cargar la sesión temporal",e);
    ui.sessionStatus.textContent="No pude cargar sesión temporal";
  }
}

function animate(){
  requestAnimationFrame(animate);
  controls.update();

  if(playing){
    const duration=getDuration();
    if(hasAudio()){
      playhead=ui.audio.currentTime||0;
    }else{
      playhead=internalStartTime+(performance.now()-internalStartPerf)/1000;
      if(playhead>=duration){
        playhead=duration;
        stopPlayback(true);
      }
    }
    ui.scrub.value=String(playhead);
    applyAt(playhead);
  }

  const d=getDuration();
  ui.timeLabel.textContent=`${playhead.toFixed(2)} / ${d.toFixed(2)}`;
  renderer.render(scene,camera);
}

resize();
animate();
ui.summary.textContent="Cargando castor_em2.glb…";
loadModel("./castor_em2.glb?v=0.5.5")
  .then(loadTemporarySession)
  .catch(e=>{ui.summary.textContent="No pude cargar el modelo de referencia.";showError(e)});
