const VIEWER_VERSION = "0.1.2";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL="./castor4-skinned.glb?v=0.1.2";
const TAKE_URL="./easymocap-1788892224948.json";

const MP={nose:0,l_shoulder:11,r_shoulder:12,l_elbow:13,r_elbow:14,l_wrist:15,r_wrist:16,l_hip:23,r_hip:24,l_knee:25,r_knee:26,l_ankle:27,r_ankle:28,l_heel:29,r_heel:30,l_toe:31,r_toe:32};
const FIXED_BONES={
 hips:"CC_Base_Pelvis",
 spine:"CC_Base_Spine01",
 chest:"CC_Base_Spine02",
 neck:"CC_Base_NeckTwist01",
 head:"CC_Base_Head",
 l_upper_arm:"CC_Base_L_Upperarm",
 r_upper_arm:"CC_Base_R_Upperarm",
 l_forearm:"CC_Base_L_Forearm",
 r_forearm:"CC_Base_R_Forearm",
 l_hand:"CC_Base_L_Hand",
 r_hand:"CC_Base_R_Hand",
 l_thigh:"CC_Base_L_Thigh",
 r_thigh:"CC_Base_R_Thigh",
 l_shin:"CC_Base_L_Calf",
 r_shin:"CC_Base_R_Calf",
 l_foot:"CC_Base_L_Foot",
 r_foot:"CC_Base_R_Foot",
 l_toe:"CC_Base_L_ToeBase",
 r_toe:"CC_Base_R_ToeBase"
};

const ALIASES={
 hips:["hips","hip","pelvis"],
 spine:["spine","spine1","abdomen"],
 chest:["spine2","chest","upperchest","spine01","spine_01"],
 neck:["neck","neck1"],
 head:["head"],
 l_upper_arm:["leftarm","upperarml","lupperarm","arm_l","upper_arm_l"],
 r_upper_arm:["rightarm","upperarmr","rupperarm","arm_r","upper_arm_r"],
 l_forearm:["leftforearm","lowerarml","lforearm","forearm_l","lower_arm_l"],
 r_forearm:["rightforearm","lowerarmr","rforearm","forearm_r","lower_arm_r"],
 l_hand:["lefthand","handl","lhand","hand_l"],
 r_hand:["righthand","handr","rhand","hand_r"],
 l_thigh:["leftupleg","leftthigh","thighl","upperleg_l","thigh_l"],
 r_thigh:["rightupleg","rightthigh","thighr","upperleg_r","thigh_r"],
 l_shin:["leftleg","leftshin","calfl","lowerleg_l","shin_l"],
 r_shin:["rightleg","rightshin","calfr","lowerleg_r","shin_r"],
 l_foot:["leftfoot","footl","foot_l"],
 r_foot:["rightfoot","footr","foot_r"],
 l_toe:["lefttoebase","lefttoe","toel","toe_l"],
 r_toe:["righttoebase","righttoe","toer","toe_r"]
};

const canvas=document.getElementById("viewer");
const statusEl=document.getElementById("status");
const debugEl=document.getElementById("debug");
const playBtn=document.getElementById("playBtn");
const pauseBtn=document.getElementById("pauseBtn");
const resetBtn=document.getElementById("resetBtn");
const scrubber=document.getElementById("scrubber");
const timeLabel=document.getElementById("timeLabel");
const jsonInput=document.getElementById("jsonInput");

const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x101216);

const camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.01,100);
camera.position.set(2.6,1.7,3.8);

const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,1,0);
controls.enableDamping=true;

scene.add(new THREE.HemisphereLight(0xffffff,0x334455,1.4));
const dl=new THREE.DirectionalLight(0xffffff,1.8);
dl.position.set(3,5,3); dl.castShadow=true; scene.add(dl);
scene.add(new THREE.GridHelper(10,20,0x4a515c,0x242930));

let model=null, skeletonHelper=null, bones={}, rest={}, frames=[], duration=0, playhead=0, playing=false, firstHips=null, rootScale=1;\nlet skinnedMeshCount=0;
const clock=new THREE.Clock();

function norm(name){return name.toLowerCase().replace("mixamorig:","").replace(/[^a-z0-9]/g,"");}
function midpoint(a,b){return a.clone().add(b).multiplyScalar(.5);}
function mpv(frame,key){
 const p=frame.world_landmarks[MP[key]];
 return new THREE.Vector3(p.x,-p.z,-p.y);
}
function pickBone(root,logical){
 const exact=FIXED_BONES[logical];
 if(exact){
  const hit=root.getObjectByName(exact);
  if(hit) return hit;
 }
 const aliases=ALIASES[logical].map(norm);
 let best=null,bestScore=-1;
 root.traverse(o=>{
  const c=norm(o.name||"");
  if(!c)return;
  for(const a of aliases){
   let s=-1;
   if(c===a)s=1000;
   else if(c.endsWith(a))s=500+a.length;
   else if(c.includes(a))s=100+a.length;
   if(s>bestScore){bestScore=s;best=o;}
  }
 });
 return best;
}
function buildMap(root){
 const m={};
 for(const k of Object.keys(ALIASES))m[k]=pickBone(root,k);
 return m;
}
function captureRest(){
 rest={};
 for(const [k,b] of Object.entries(bones)){
  if(!b)continue;
  const child=b.children.find(c=>c && c.position && c.position.lengthSq && c.position.lengthSq()>1e-8);
  let dir;
  if(child&&child.position.lengthSq()>1e-8)dir=child.position.clone().normalize();
  else if(k.includes("arm"))dir=new THREE.Vector3(1,0,0);
  else if(k.includes("thigh")||k.includes("shin"))dir=new THREE.Vector3(0,-1,0);
  else if(k.includes("foot")||k.includes("toe"))dir=new THREE.Vector3(0,0,1);
  else dir=new THREE.Vector3(0,1,0);
  rest[k]={quat:b.quaternion.clone(),dir};
 }
}
function setDirection(key,targetWorld){
 const b=bones[key],r=rest[key];
 if(!b||!r||targetWorld.lengthSq()<1e-8)return;
 const parentQ=new THREE.Quaternion();
 if(b.parent)b.parent.getWorldQuaternion(parentQ); else parentQ.identity();
 const targetLocal=targetWorld.clone().normalize().applyQuaternion(parentQ.invert());
 const delta=new THREE.Quaternion().setFromUnitVectors(r.dir.clone().normalize(),targetLocal);
 b.quaternion.copy(r.quat).multiply(delta);
}
function applyFrame(frame){
 if(!frame)return;
 const lS=mpv(frame,"l_shoulder"),rS=mpv(frame,"r_shoulder"),lH=mpv(frame,"l_hip"),rH=mpv(frame,"r_hip");
 const sMid=midpoint(lS,rS),hMid=midpoint(lH,rH);
 if(bones.hips&&firstHips){
  const d=hMid.clone().sub(firstHips).multiplyScalar(rootScale);
  bones.hips.position.copy(d);
 }
 const nose=mpv(frame,"nose");
 setDirection("spine",sMid.clone().sub(hMid));
 setDirection("chest",sMid.clone().sub(hMid));
 setDirection("neck",nose.clone().sub(sMid));
 setDirection("head",nose.clone().sub(sMid));
 setDirection("l_upper_arm",mpv(frame,"l_elbow").sub(lS));
 setDirection("l_forearm",mpv(frame,"l_wrist").sub(mpv(frame,"l_elbow")));
 setDirection("r_upper_arm",mpv(frame,"r_elbow").sub(rS));
 setDirection("r_forearm",mpv(frame,"r_wrist").sub(mpv(frame,"r_elbow")));
 setDirection("l_thigh",mpv(frame,"l_knee").sub(lH));
 setDirection("l_shin",mpv(frame,"l_ankle").sub(mpv(frame,"l_knee")));
 setDirection("l_foot",mpv(frame,"l_toe").sub(mpv(frame,"l_ankle")));
 setDirection("l_toe",mpv(frame,"l_toe").sub(mpv(frame,"l_heel")));
 setDirection("r_thigh",mpv(frame,"r_knee").sub(rH));
 setDirection("r_shin",mpv(frame,"r_ankle").sub(mpv(frame,"r_knee")));
 setDirection("r_foot",mpv(frame,"r_toe").sub(mpv(frame,"r_ankle")));
 setDirection("r_toe",mpv(frame,"r_toe").sub(mpv(frame,"r_heel")));
}
function validFrames(take){return (take.frames||[]).filter(f=>Array.isArray(f.world_landmarks)&&f.world_landmarks.length>=33);}
function frameAt(t){
 if(!frames.length)return null;
 let lo=0,hi=frames.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].timestamp<t)lo=mid+1;else hi=mid;}
 return frames[lo];
}
function fitCamera(root){
 const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
 const max=Math.max(size.x,size.y,size.z,1);
 controls.target.copy(center);
 camera.position.copy(center).add(new THREE.Vector3(max*1.3,max*.5,max*1.8));
 camera.near=max/1000; camera.far=max*100; camera.updateProjectionMatrix();
 controls.update();
}
function updateDebug(){
 const lines=[];
 for(const k of Object.keys(ALIASES))lines.push(k.padEnd(13)+" -> "+(bones[k]?bones[k].name:"NO ENCONTRADO"));
 debugEl.textContent=lines.join("\n");
}
function loadTakeObject(take){
 frames=validFrames(take);
 if(!frames.length)throw new Error("El JSON no contiene frames 3D completos.");
 duration=Number(take.duration||frames.at(-1).timestamp||0);
 playhead=0;
 const first=frames[0];
 firstHips=midpoint(mpv(first,"l_hip"),mpv(first,"r_hip"));
 const trackedTorso=Math.max(midpoint(mpv(first,"l_shoulder"),mpv(first,"r_shoulder")).distanceTo(firstHips),1e-4);
 let rigRef=1;
 if(bones.hips&&bones.head){
  const a=new THREE.Vector3(),b=new THREE.Vector3();
  bones.hips.getWorldPosition(a); bones.head.getWorldPosition(b);
  rigRef=Math.max(a.distanceTo(b),1e-3);
 }
 rootScale=rigRef/Math.max(trackedTorso*2.2,1e-4);
 applyFrame(first); updateUi();
 statusEl.textContent="Listo · "+frames.length+" frames";
}
async function boot(){
 try{
  statusEl.textContent="Cargando castor4.glb…";
  model=(await new GLTFLoader().loadAsync(MODEL_URL)).scene;
  skinnedMeshCount=0;
  model.traverse(o=>{
   if(o.isMesh){
    o.castShadow=true;
    o.receiveShadow=true;
    o.frustumCulled=false;
   }
   if(o.isSkinnedMesh) skinnedMeshCount++;
  });
  scene.add(model);
  bones=buildMap(model);
  captureRest();
  try{
   skeletonHelper=new THREE.SkeletonHelper(model);
   scene.add(skeletonHelper);
  }catch(e){
   console.warn("SkeletonHelper unavailable for this GLB",e);
  }
  updateDebug(); fitCamera(model);

  statusEl.textContent="Cargando take…";
  const take=await (await fetch(TAKE_URL,{cache:"no-store"})).json();
  loadTakeObject(take);
  statusEl.textContent+=" · SkinnedMesh: "+skinnedMeshCount;
 }catch(e){
  console.error(e); statusEl.textContent="Error: "+(e.message||e);
 }
}
function updateUi(){
 scrubber.value=duration?String(playhead/duration):"0";
 timeLabel.textContent=playhead.toFixed(2)+" / "+duration.toFixed(2);
}
playBtn.onclick=()=>playing=true;
pauseBtn.onclick=()=>playing=false;
resetBtn.onclick=()=>{playing=false;playhead=0;applyFrame(frameAt(0));updateUi();};
scrubber.oninput=()=>{playing=false;playhead=Number(scrubber.value)*duration;applyFrame(frameAt(playhead));updateUi();};
jsonInput.onchange=async()=>{const f=jsonInput.files&&jsonInput.files[0];if(!f)return;try{loadTakeObject(JSON.parse(await f.text()));}catch(e){statusEl.textContent="Error JSON: "+e.message;}};

function animate(){
 requestAnimationFrame(animate);
 const dt=clock.getDelta();
 if(playing&&duration){
  playhead+=dt;
  if(playhead>=duration){playhead=duration;playing=false;}
  applyFrame(frameAt(playhead)); updateUi();
 }
 controls.update(); renderer.render(scene,camera);
}
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
boot(); animate();
