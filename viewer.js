import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BODY_BONES, HAND_CHANNELS, assertTake } from "./core/spec.js?v=0.4.0";

const $ = (id)=>document.getElementById(id);
const ui = {
  viewport:$("viewport"), modelInput:$("modelInput"), bodyInput:$("bodyInput"), faceInput:$("faceInput"),
  audioInput:$("audioInput"), audio:$("audio"), playButton:$("playButton"), scrub:$("scrub"),
  timeLabel:$("timeLabel"), summary:$("summary"), validation:$("validation"),
  errorPanel:$("errorPanel"), errorText:$("errorText")
};

const REQUIRED_FACE_SHAPES = [
  "EM2_Blink_L","EM2_Blink_R",
  "EM2_BrowDown_L","EM2_BrowUp_L","EM2_BrowDown_R","EM2_BrowUp_R",
  "EM2_MouthOpen","EM2_MouthNarrow","EM2_MouthWide",
  "EM2_MouthFrown_L","EM2_MouthSmile_L","EM2_MouthFrown_R","EM2_MouthSmile_R"
];

let modelRoot=null, bodyTake=null, faceTake=null, audioUrl=null;
let boneMap=new Map(), morphMeshes=[], restWorld=new Map(), sourceRest=new Map();
let playing=false;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x07090c);
const camera=new THREE.PerspectiveCamera(45,1,.01,100);
camera.position.set(2.4,1.6,3.8);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
ui.viewport.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,1,0);
controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x303846,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.5); key.position.set(3,5,4); scene.add(key);
const grid=new THREE.GridHelper(10,20,0x394454,0x202731); scene.add(grid);

const ro=new ResizeObserver(resize); ro.observe(ui.viewport);
function resize(){
  const w=ui.viewport.clientWidth,h=ui.viewport.clientHeight;
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}

function showError(error){
  ui.errorText.textContent=error instanceof Error ? `${error.name}: ${error.message}\n${error.stack||""}` : String(error);
  ui.errorPanel.hidden=false; console.error(error);
}
function clearError(){ui.errorPanel.hidden=true;ui.errorText.textContent="";}
window.addEventListener("error",(e)=>showError(e.error||e.message));
window.addEventListener("unhandledrejection",(e)=>showError(e.reason||"Promise rechazada"));

ui.modelInput.addEventListener("change",async()=>{
  clearError();
  try{
    const file=ui.modelInput.files?.[0]; if(!file)return;
    const url=URL.createObjectURL(file);
    const gltf=await new GLTFLoader().loadAsync(url);
    URL.revokeObjectURL(url);
    if(modelRoot) scene.remove(modelRoot);
    modelRoot=gltf.scene; scene.add(modelRoot);
    prepareModel();
    frameModel();
    validateModel();
    updateReady();
  }catch(e){showError(e)}
});

ui.bodyInput.addEventListener("change",async()=>{
  try{bodyTake=await readTake(ui.bodyInput.files?.[0],"body");sourceRest.clear();updateReady();}catch(e){showError(e)}
});
ui.faceInput.addEventListener("change",async()=>{
  try{faceTake=await readTake(ui.faceInput.files?.[0],"face");updateReady();}catch(e){showError(e)}
});
ui.audioInput.addEventListener("change",()=>{
  const file=ui.audioInput.files?.[0];if(!file)return;
  if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(file);ui.audio.src=audioUrl;ui.audio.load();
});
ui.audio.addEventListener("loadedmetadata",()=>{ui.scrub.max=String(ui.audio.duration||1);updateReady();});
ui.audio.addEventListener("ended",()=>{playing=false;ui.playButton.textContent="▶ Play";});

ui.playButton.addEventListener("click",async()=>{
  if(playing){ui.audio.pause();playing=false;ui.playButton.textContent="▶ Play";return}
  await ui.audio.play();playing=true;ui.playButton.textContent="❚❚ Pausa";
});
ui.scrub.addEventListener("input",()=>{ui.audio.currentTime=Number(ui.scrub.value);applyAt(ui.audio.currentTime)});

async function readTake(file,expected){
  if(!file) return null;
  const data=JSON.parse(await file.text());assertTake(data);
  if(data.mode!==expected)throw new Error(`Esperaba take ${expected}, recibí ${data.mode}`);
  return data;
}

function prepareModel(){
  boneMap=new Map();morphMeshes=[];restWorld=new Map();
  modelRoot.traverse((o)=>{
    if(o.isBone)boneMap.set(o.name,o);
    if(o.isMesh&&o.morphTargetDictionary)morphMeshes.push(o);
  });
  modelRoot.updateMatrixWorld(true);
  for(const [name,bone] of boneMap){
    restWorld.set(name,bone.getWorldQuaternion(new THREE.Quaternion()).clone());
  }
}

function validateModel(){
  if(!modelRoot)return;
  ui.validation.innerHTML="";
  const skinned=[];modelRoot.traverse(o=>{if(o.isSkinnedMesh)skinned.push(o)});
  addCheck("Skinned mesh",skinned.length>0,`${skinned.length} encontrado(s)`);
  let missingBones=0;
  for(const name of BODY_BONES){
    const ok=boneMap.has(name);if(!ok)missingBones++;
    addCheck(name,ok,ok?"bone OK":"FALTA");
  }
  const availableMorphs=new Set();
  for(const mesh of morphMeshes)for(const name of Object.keys(mesh.morphTargetDictionary))availableMorphs.add(name);
  for(const name of [...HAND_CHANNELS,...REQUIRED_FACE_SHAPES]){
    addCheck(name,availableMorphs.has(name),availableMorphs.has(name)?"shape OK":"FALTA",true);
  }
  ui.summary.textContent=`${skinned.length?"Rig detectado":"Sin skin"} · ${BODY_BONES.length-missingBones}/${BODY_BONES.length} bones EM2 · ${availableMorphs.size} morph targets`;
}
function addCheck(name,ok,text,optional=false){
  const row=document.createElement("div");row.className="check";
  row.innerHTML=`<span>${escapeHtml(name)}</span><span class="${ok?"ok":optional?"warn":"bad"}">${escapeHtml(text)}</span>`;
  ui.validation.appendChild(row);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function frameModel(){
  const box=new THREE.Box3().setFromObject(modelRoot);const size=box.getSize(new THREE.Vector3());const center=box.getCenter(new THREE.Vector3());
  const max=Math.max(size.x,size.y,size.z,1);controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(max*1.5,max*.7,max*2.2));camera.near=max/1000;camera.far=max*50;camera.updateProjectionMatrix();controls.update();
}

function updateReady(){
  const ready=Boolean(modelRoot&&ui.audio.duration&&bodyTake);
  ui.playButton.disabled=!ready;ui.scrub.disabled=!ready;
}

function nearestFrame(take,t){
  const frames=take?.timeline?.frames;if(!frames?.length)return null;
  let lo=0,hi=frames.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(frames[mid].t<t)lo=mid+1;else hi=mid}
  if(lo===0)return frames[0];const a=frames[lo-1],b=frames[lo];return Math.abs(a.t-t)<=Math.abs(b.t-t)?a:b;
}

function sourceVec(v){return new THREE.Vector3(v[0],-v[1],-v[2]).normalize()}

function applyBody(frame){
  if(!frame?.bones)return;
  modelRoot.updateMatrixWorld(true);
  for(const name of BODY_BONES){
    if(name==="Root")continue;
    const bone=boneMap.get(name),data=frame.bones[name];if(!bone||!data?.direction)continue;
    if(!sourceRest.has(name))sourceRest.set(name,sourceVec(data.direction));
    const restSrc=sourceRest.get(name),curSrc=sourceVec(data.direction);
    const delta=new THREE.Quaternion().setFromUnitVectors(restSrc,curSrc);
    const restQ=restWorld.get(name);if(!restQ)continue;
    const targetWorld=delta.multiply(restQ.clone());
    const parentQ=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||new THREE.Quaternion();
    bone.quaternion.copy(parentQ.invert().multiply(targetWorld)).normalize();
    bone.updateMatrixWorld(true);
  }
  for(const [name,value] of Object.entries(frame.hands||{}))if(value!=null)setMorph(name,value);
}

function applyFace(frame){
  const c=frame?.channels;if(!c)return;
  setMorph("EM2_Blink_L",c.EM2_Blink_L);setMorph("EM2_Blink_R",c.EM2_Blink_R);setMorph("EM2_MouthOpen",c.EM2_MouthOpen);
  split(c.EM2_Brow_L,"EM2_BrowDown_L","EM2_BrowUp_L");
  split(c.EM2_Brow_R,"EM2_BrowDown_R","EM2_BrowUp_R");
  split(c.EM2_MouthWidth,"EM2_MouthNarrow","EM2_MouthWide");
  split(c.EM2_MouthCorner_L,"EM2_MouthFrown_L","EM2_MouthSmile_L");
  split(c.EM2_MouthCorner_R,"EM2_MouthFrown_R","EM2_MouthSmile_R");
}
function split(v,low,high){
  if(v==null)return;setMorph(low,Math.max(0,(.5-v)*2));setMorph(high,Math.max(0,(v-.5)*2));
}
function setMorph(name,value){
  if(value==null)return;
  for(const mesh of morphMeshes){
    const i=mesh.morphTargetDictionary?.[name];if(i!=null)mesh.morphTargetInfluences[i]=THREE.MathUtils.clamp(value,0,1);
  }
}

function applyAt(t){
  if(bodyTake)applyBody(nearestFrame(bodyTake,t));
  if(faceTake)applyFace(nearestFrame(faceTake,t));
}

function animate(){
  requestAnimationFrame(animate);controls.update();
  if(playing){const t=ui.audio.currentTime;ui.scrub.value=String(t);applyAt(t)}
  const dur=ui.audio.duration||0;ui.timeLabel.textContent=`${(ui.audio.currentTime||0).toFixed(2)} / ${dur.toFixed(2)}`;
  renderer.render(scene,camera);
}
resize();animate();
