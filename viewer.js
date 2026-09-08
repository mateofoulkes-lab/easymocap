import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BODY_BONES,HAND_CHANNELS,MODEL_FACE_SHAPES,BODY_ROTATION_FORMAT,assertTake } from "./core/spec.js?v=0.5.0";

const $=id=>document.getElementById(id);
const ui={
  viewport:$("viewport"),modelInput:$("modelInput"),bodyInput:$("bodyInput"),faceInput:$("faceInput"),audioInput:$("audioInput"),
  audio:$("audio"),playButton:$("playButton"),scrub:$("scrub"),timeLabel:$("timeLabel"),summary:$("summary"),
  validation:$("validation"),errorPanel:$("errorPanel"),errorText:$("errorText")
};
let modelRoot=null,bodyTake=null,faceTake=null,audioUrl=null,boneMap=new Map(),morphMeshes=[],restLocal=new Map(),playing=false;

const scene=new THREE.Scene();scene.background=new THREE.Color(0x07090c);
const camera=new THREE.PerspectiveCamera(45,1,.01,100);camera.position.set(2.4,1.6,3.8);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));ui.viewport.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x303846,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(3,5,4);scene.add(key);
scene.add(new THREE.GridHelper(10,20,0x394454,0x202731));
new ResizeObserver(resize).observe(ui.viewport);

function resize(){const w=ui.viewport.clientWidth,h=ui.viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
function showError(e){ui.errorText.textContent=e instanceof Error?`${e.name}: ${e.message}\n${e.stack||""}`:String(e);ui.errorPanel.hidden=false;console.error(e)}
function clearError(){ui.errorPanel.hidden=true;ui.errorText.textContent=""}
window.addEventListener("error",e=>showError(e.error||e.message));
window.addEventListener("unhandledrejection",e=>showError(e.reason||"Promise rechazada"));

async function loadModel(url,revoke=false){
  const gltf=await new GLTFLoader().loadAsync(url);if(revoke)URL.revokeObjectURL(url);
  if(modelRoot)scene.remove(modelRoot);modelRoot=gltf.scene;scene.add(modelRoot);prepareModel();frameModel();validateModel();updateReady();
}
ui.modelInput.addEventListener("change",async()=>{
  clearError();try{const f=ui.modelInput.files?.[0];if(f)await loadModel(URL.createObjectURL(f),true)}catch(e){showError(e)}
});
ui.bodyInput.addEventListener("change",async()=>{clearError();try{bodyTake=await readTake(ui.bodyInput.files?.[0],"body");validateBodyTake();updateReady()}catch(e){showError(e)}});
ui.faceInput.addEventListener("change",async()=>{clearError();try{faceTake=await readTake(ui.faceInput.files?.[0],"face");updateReady()}catch(e){showError(e)}});
ui.audioInput.addEventListener("change",()=>{
  const f=ui.audioInput.files?.[0];if(!f)return;if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioUrl=URL.createObjectURL(f);ui.audio.src=audioUrl;ui.audio.load();
});
ui.audio.addEventListener("loadedmetadata",()=>{ui.scrub.max=String(ui.audio.duration||1);updateReady()});
ui.audio.addEventListener("ended",()=>{playing=false;ui.playButton.textContent="▶ Play"});
ui.playButton.addEventListener("click",async()=>{
  if(playing){ui.audio.pause();playing=false;ui.playButton.textContent="▶ Play";return}
  await ui.audio.play();playing=true;ui.playButton.textContent="❚❚ Pausa";
});
ui.scrub.addEventListener("input",()=>{ui.audio.currentTime=Number(ui.scrub.value);applyAt(ui.audio.currentTime)});

async function readTake(file,expected){
  if(!file)return null;const data=JSON.parse(await file.text());assertTake(data);
  if(data.mode!==expected)throw new Error(`Esperaba take ${expected}, recibí ${data.mode}`);return data;
}
function validateBodyTake(){
  if(!bodyTake)return;
  const fmt=bodyTake.capture?.bodyRotationFormat;
  if(bodyTake.specVersion==="1.1"&&fmt!==BODY_ROTATION_FORMAT)throw new Error(`Formato corporal inesperado: ${fmt||"sin formato"}`);
}

function prepareModel(){
  boneMap=new Map();morphMeshes=[];restLocal=new Map();
  modelRoot.traverse(o=>{if(o.isBone)boneMap.set(o.name,o);if(o.isMesh&&o.morphTargetDictionary)morphMeshes.push(o)});
  for(const [name,bone] of boneMap)restLocal.set(name,bone.quaternion.clone());
}
function validateModel(){
  ui.validation.innerHTML="";
  const skinned=[];modelRoot.traverse(o=>{if(o.isSkinnedMesh)skinned.push(o)});
  addCheck("Skinned mesh",skinned.length>0,`${skinned.length} encontrado(s)`);
  let missing=0;for(const name of BODY_BONES){const ok=boneMap.has(name);if(!ok)missing++;addCheck(name,ok,ok?"bone OK":"FALTA")}
  const morphs=new Set();for(const mesh of morphMeshes)for(const name of Object.keys(mesh.morphTargetDictionary))morphs.add(name);
  for(const name of [...HAND_CHANNELS,...MODEL_FACE_SHAPES])addCheck(name,morphs.has(name),morphs.has(name)?"shape OK":"FALTA",true);
  ui.summary.textContent=`${skinned.length?"Rig detectado":"Sin skin"} · ${BODY_BONES.length-missing}/${BODY_BONES.length} bones EM2 · ${morphs.size} morph targets`;
}
function addCheck(name,ok,text,optional=false){
  const row=document.createElement("div");row.className="check";
  row.innerHTML=`<span>${esc(name)}</span><span class="${ok?"ok":optional?"warn":"bad"}">${esc(text)}</span>`;ui.validation.appendChild(row);
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function frameModel(){
  const box=new THREE.Box3().setFromObject(modelRoot),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),m=Math.max(size.x,size.y,size.z,1);
  controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(m*1.5,m*.7,m*2.2));camera.near=m/1000;camera.far=m*50;camera.updateProjectionMatrix();controls.update();
}
function updateReady(){const ready=Boolean(modelRoot&&ui.audio.duration&&bodyTake);ui.playButton.disabled=!ready;ui.scrub.disabled=!ready}

function sample(take,t){
  const frames=take?.timeline?.frames;if(!frames?.length)return null;if(frames.length===1)return{a:frames[0],b:frames[0],alpha:0};
  let lo=0,hi=frames.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].t<t)lo=mid+1;else hi=mid}
  if(lo===0)return{a:frames[0],b:frames[0],alpha:0};
  const a=frames[lo-1],b=frames[lo],span=Math.max(1e-6,b.t-a.t);
  return{a,b,alpha:THREE.MathUtils.clamp((t-a.t)/span,0,1)};
}
function qAt(qa,qb,alpha){
  if(!qa&&!qb)return null;const a=qa||qb,b=qb||qa;
  return new THREE.Quaternion(a[0],a[1],a[2],a[3]).slerp(new THREE.Quaternion(b[0],b[1],b[2],b[3]),alpha);
}
function scalarAt(a,b,alpha,key){const av=a?.[key],bv=b?.[key];if(av==null&&bv==null)return null;if(av==null)return bv;if(bv==null)return av;return THREE.MathUtils.lerp(av,bv,alpha)}

function applyDelta(name,q){
  const bone=boneMap.get(name),rest=restLocal.get(name);if(!bone||!rest||!q)return;
  bone.quaternion.copy(rest).multiply(q).normalize();
}
function applyBody(s){
  if(!s)return;const {a,b,alpha}=s;
  if(a.root?.rotation||b.root?.rotation)applyDelta("Root",qAt(a.root?.rotation,b.root?.rotation,alpha));
  for(const name of BODY_BONES){
    if(name==="Root")continue;
    const qa=a.bones?.[name]?.rotation,qb=b.bones?.[name]?.rotation;
    if(qa||qb)applyDelta(name,qAt(qa,qb,alpha));
  }
  for(const name of HAND_CHANNELS)setMorph(name,scalarAt(a.hands,b.hands,alpha,name));
}
function applyFace(s){
  if(!s)return;const {a,b,alpha}=s;
  const val=k=>scalarAt(a.channels,b.channels,alpha,k);
  setMorph("EM2_Blink_L",val("EM2_Blink_L"));setMorph("EM2_Blink_R",val("EM2_Blink_R"));setMorph("EM2_MouthOpen",val("EM2_MouthOpen"));
  split(val("EM2_Brow_L"),"EM2_BrowDown_L","EM2_BrowUp_L");split(val("EM2_Brow_R"),"EM2_BrowDown_R","EM2_BrowUp_R");
  split(val("EM2_MouthWidth"),"EM2_MouthNarrow","EM2_MouthWide");
  split(val("EM2_MouthCorner_L"),"EM2_MouthFrown_L","EM2_MouthSmile_L");split(val("EM2_MouthCorner_R"),"EM2_MouthFrown_R","EM2_MouthSmile_R");
}
function split(v,low,high){if(v==null)return;setMorph(low,Math.max(0,(.5-v)*2));setMorph(high,Math.max(0,(v-.5)*2))}
function setMorph(name,value){
  if(value==null)return;for(const mesh of morphMeshes){const i=mesh.morphTargetDictionary?.[name];if(i!=null)mesh.morphTargetInfluences[i]=THREE.MathUtils.clamp(value,0,1)}
}
function applyAt(t){if(bodyTake)applyBody(sample(bodyTake,t));if(faceTake)applyFace(sample(faceTake,t))}
function animate(){
  requestAnimationFrame(animate);controls.update();
  if(playing){const t=ui.audio.currentTime;ui.scrub.value=String(t);applyAt(t)}
  const d=ui.audio.duration||0;ui.timeLabel.textContent=`${(ui.audio.currentTime||0).toFixed(2)} / ${d.toFixed(2)}`;renderer.render(scene,camera);
}

resize();animate();
ui.summary.textContent="Cargando castor_em2.glb…";
loadModel("./castor_em2.glb?v=0.5.0").catch(e=>{ui.summary.textContent="No pude cargar el modelo de referencia.";showError(e)});
