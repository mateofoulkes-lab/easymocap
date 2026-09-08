import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,31],
  [24,26],[26,28],[28,32]
];

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];

const PARENT = Object.freeze({
  Root:null,Hips:"Root",Spine:"Hips",Chest:"Spine",Neck:"Chest",Head:"Neck",
  Shoulder_L:"Chest",UpperArm_L:"Shoulder_L",LowerArm_L:"UpperArm_L",Hand_L:"LowerArm_L",
  Shoulder_R:"Chest",UpperArm_R:"Shoulder_R",LowerArm_R:"UpperArm_R",Hand_R:"LowerArm_R",
  UpperLeg_L:"Hips",LowerLeg_L:"UpperLeg_L",Foot_L:"LowerLeg_L",
  UpperLeg_R:"Hips",LowerLeg_R:"UpperLeg_R",Foot_R:"LowerLeg_R"
});

const clamp01=(v)=>Math.max(0,Math.min(1,v));
const mix=(a,b,t)=>a+(b-a)*t;
const v=(p)=>[p.x,-p.y,-p.z];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=(a)=>Math.hypot(a[0],a[1],a[2]);
const norm=(a,fallback=[0,1,0])=>{const l=len(a);return l<1e-8?[...fallback]:scale(a,1/l)};

function midpoint(a,b){
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2,visibility:Math.min(a.visibility??1,b.visibility??1)};
}
function lerpPoint(a,b,t){
  return {x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),z:mix(a.z,b.z,t),visibility:Math.min(a.visibility??1,b.visibility??1)};
}
function dist2(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function angle3(a,b,c){
  const ba=[a.x-b.x,a.y-b.y,a.z-b.z],bc=[c.x-b.x,c.y-b.y,c.z-b.z];
  const la=len(ba),lb=len(bc);if(la<1e-8||lb<1e-8)return 0;
  return Math.acos(Math.max(-1,Math.min(1,dot(ba,bc)/(la*lb))))*180/Math.PI;
}
function smoothstep(a,b,x){const t=clamp01((x-a)/(b-a));return t*t*(3-2*t)}
function fingerOpen(hand,ids){
  const [a,b,c,d]=ids;
  return (smoothstep(95,170,angle3(hand[a],hand[b],hand[c]))+smoothstep(95,170,angle3(hand[b],hand[c],hand[d])))/2;
}
function thumbOpen(hand){
  return (smoothstep(85,165,angle3(hand[1],hand[2],hand[3]))+smoothstep(100,170,angle3(hand[2],hand[3],hand[4])))/2;
}
function handChannels(hand){
  return {
    handOpen:clamp01((thumbOpen(hand)+fingerOpen(hand,[9,10,11,12])+fingerOpen(hand,[13,14,15,16])+fingerOpen(hand,[17,18,19,20]))/4),
    indexOpen:clamp01(fingerOpen(hand,[5,6,7,8]))
  };
}

function qNorm(q){
  const l=Math.hypot(q[0],q[1],q[2],q[3])||1;
  return q.map(n=>n/l);
}
function qInv(q){return [-q[0],-q[1],-q[2],q[3]]}
function qMul(a,b){
  const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;
  return qNorm([
    aw*bx+ax*bw+ay*bz-az*by,
    aw*by-ax*bz+ay*bw+az*bx,
    aw*bz+ax*by-ay*bx+az*bw,
    aw*bw-ax*bx-ay*by-az*bz
  ]);
}
function qFromBasis(x,y,z){
  const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2];
  const tr=m00+m11+m22;let q;
  if(tr>0){
    const s=Math.sqrt(tr+1)*2;
    q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,.25*s];
  }else if(m00>m11&&m00>m22){
    const s=Math.sqrt(1+m00-m11-m22)*2;
    q=[.25*s,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];
  }else if(m11>m22){
    const s=Math.sqrt(1+m11-m00-m22)*2;
    q=[(m01+m10)/s,.25*s,(m12+m21)/s,(m02-m20)/s];
  }else{
    const s=Math.sqrt(1+m22-m00-m11)*2;
    q=[(m02+m20)/s,(m12+m21)/s,.25*s,(m10-m01)/s];
  }
  return qNorm(q);
}
function frameQuat(primary,xHint){
  const y=norm(primary);
  let xp=sub(xHint,scale(y,dot(xHint,y)));
  if(len(xp)<1e-5){
    const fallback=Math.abs(y[0])<.8?[1,0,0]:[0,0,1];
    xp=sub(fallback,scale(y,dot(fallback,y)));
  }
  const x=norm(xp,[1,0,0]);
  const z=norm(cross(x,y),[0,0,1]);
  const x2=norm(cross(y,z),x);
  return qFromBasis(x2,y,z);
}

function restWorldFrames(){
  const up=[0,1,0],bodyX=[1,0,0],forward=[0,0,1];
  const frames={
    Root:frameQuat(up,bodyX),Hips:frameQuat(up,bodyX),Spine:frameQuat(up,bodyX),
    Chest:frameQuat(up,bodyX),Neck:frameQuat(up,bodyX),Head:frameQuat(up,bodyX),
    Shoulder_L:frameQuat([.09,.14,0],forward),
    UpperArm_L:frameQuat([1,0,0],forward),LowerArm_L:frameQuat([1,0,0],forward),Hand_L:frameQuat([1,0,0],forward),
    Shoulder_R:frameQuat([-.09,.14,0],forward),
    UpperArm_R:frameQuat([-1,0,0],forward),LowerArm_R:frameQuat([-1,0,0],forward),Hand_R:frameQuat([-1,0,0],forward),
    UpperLeg_L:frameQuat([.10,-.08,0],forward),LowerLeg_L:frameQuat([0,-1,0],forward),Foot_L:frameQuat([0,-.25,1],bodyX),
    UpperLeg_R:frameQuat([-.10,-.08,0],forward),LowerLeg_R:frameQuat([0,-1,0],forward),Foot_R:frameQuat([0,-.25,1],bodyX)
  };
  return frames;
}
const REST_WORLD=restWorldFrames();
const REST_LOCAL={};
for(const [name,q] of Object.entries(REST_WORLD)){
  const parent=PARENT[name];
  REST_LOCAL[name]=parent?qMul(qInv(REST_WORLD[parent]),q):q;
}

function localDeltas(frames){
  const out={};
  for(const [name,q] of Object.entries(frames)){
    const parent=PARENT[name];
    const currentLocal=parent?qMul(qInv(frames[parent]),q):q;
    out[name]=qMul(qInv(REST_LOCAL[name]),currentLocal);
  }
  return out;
}

function deriveSkeleton(world,image){
  const hipP=midpoint(world[23],world[24]),chestP=midpoint(world[11],world[12]);
  const spineP=lerpPoint(hipP,chestP,.48),earsP=midpoint(world[7],world[8]);
  const neckP=lerpPoint(chestP,earsP,.42);

  const hip=v(hipP),spine=v(spineP),chest=v(chestP),neck=v(neckP),head=v(earsP);
  const lShoulder=v(world[11]),rShoulder=v(world[12]),lElbow=v(world[13]),rElbow=v(world[14]);
  const lWrist=v(world[15]),rWrist=v(world[16]);
  const lHand=scale(add(v(world[19]),v(world[21])),.5),rHand=scale(add(v(world[20]),v(world[22])),.5);
  const lHip=v(world[23]),rHip=v(world[24]),lKnee=v(world[25]),rKnee=v(world[26]);
  const lAnkle=v(world[27]),rAnkle=v(world[28]),lFoot=v(world[31]),rFoot=v(world[32]);

  const bodyX=norm(sub(lShoulder,rShoulder),[1,0,0]);
  const bodyY=norm(sub(chest,hip),[0,1,0]);
  const bodyZ=norm(cross(bodyX,bodyY),[0,0,1]);
  const headX=norm(sub(v(world[7]),v(world[8])),bodyX);

  const frames={
    Root:frameQuat(bodyY,bodyX),
    Hips:frameQuat(sub(spine,hip),bodyX),
    Spine:frameQuat(sub(spine,hip),bodyX),
    Chest:frameQuat(sub(chest,spine),bodyX),
    Neck:frameQuat(sub(neck,chest),bodyX),
    Head:frameQuat(sub(head,neck),headX),
    Shoulder_L:frameQuat(sub(lShoulder,chest),bodyZ),
    UpperArm_L:frameQuat(sub(lElbow,lShoulder),bodyZ),
    LowerArm_L:frameQuat(sub(lWrist,lElbow),bodyZ),
    Hand_L:frameQuat(sub(lHand,lWrist),bodyZ),
    Shoulder_R:frameQuat(sub(rShoulder,chest),bodyZ),
    UpperArm_R:frameQuat(sub(rElbow,rShoulder),bodyZ),
    LowerArm_R:frameQuat(sub(rWrist,rElbow),bodyZ),
    Hand_R:frameQuat(sub(rHand,rWrist),bodyZ),
    UpperLeg_L:frameQuat(sub(lKnee,lHip),bodyZ),
    LowerLeg_L:frameQuat(sub(lAnkle,lKnee),bodyZ),
    Foot_L:frameQuat(sub(lFoot,lAnkle),bodyX),
    UpperLeg_R:frameQuat(sub(rKnee,rHip),bodyZ),
    LowerLeg_R:frameQuat(sub(rAnkle,rKnee),bodyZ),
    Foot_R:frameQuat(sub(rFoot,rAnkle),bodyX)
  };
  const rotations=localDeltas(frames);

  const imgHip=midpoint(image[23],image[24]),imgChest=midpoint(image[11],image[12]);
  const shoulderWidth=Math.max(.001,dist2(image[11],image[12]));
  const torsoHeight=Math.max(.001,dist2(imgHip,imgChest));
  const conf=(...ids)=>clamp01(Math.min(...ids.map(i=>world[i].visibility??1)));

  const defs={
    Hips:[hip,spine,conf(23,24)],Spine:[hip,spine,conf(23,24)],Chest:[spine,chest,conf(11,12)],
    Neck:[chest,neck,conf(11,12)],Head:[neck,head,conf(7,8)],
    Shoulder_L:[chest,lShoulder,conf(11)],UpperArm_L:[lShoulder,lElbow,conf(11,13)],
    LowerArm_L:[lElbow,lWrist,conf(13,15)],Hand_L:[lWrist,lHand,conf(15,19,21)],
    Shoulder_R:[chest,rShoulder,conf(12)],UpperArm_R:[rShoulder,rElbow,conf(12,14)],
    LowerArm_R:[rElbow,rWrist,conf(14,16)],Hand_R:[rWrist,rHand,conf(16,20,22)],
    UpperLeg_L:[lHip,lKnee,conf(23,25)],LowerLeg_L:[lKnee,lAnkle,conf(25,27)],Foot_L:[lAnkle,lFoot,conf(27,31)],
    UpperLeg_R:[rHip,rKnee,conf(24,26)],LowerLeg_R:[rKnee,rAnkle,conf(26,28)],Foot_R:[rAnkle,rFoot,conf(28,32)]
  };
  const bones={};
  for(const [name,[a,b,confidence]] of Object.entries(defs)){
    bones[name]={rotation:rotations[name],length:len(sub(b,a)),confidence};
  }

  return {
    root:{
      screen:[imgHip.x,imgHip.y],apparentScale:shoulderWidth,torsoScale:torsoHeight,
      confidence:conf(23,24),rotation:rotations.Root
    },
    bones
  };
}

function assignHands(handResult,poseImage){
  const assigned={left:null,right:null};
  if(!handResult?.landmarks?.length||!poseImage?.length)return assigned;
  const leftWrist=poseImage[15],rightWrist=poseImage[16];
  for(const hand of handResult.landmarks){
    const wrist=hand[0],dl=dist2(wrist,leftWrist),dr=dist2(wrist,rightWrist);
    const side=dl<=dr?"left":"right",score=Math.min(dl,dr);
    if(!assigned[side]||score<assigned[side].score)assigned[side]={hand,score};
  }
  return assigned;
}

export class BodyTracker{
  constructor(){this.pose=null;this.hands=null;this.ready=false}
  async init(){
    if(this.ready)return;
    const vision=await FilesetResolver.forVisionTasks(WASM_ROOT);
    [this.pose,this.hands]=await Promise.all([
      PoseLandmarker.createFromOptions(vision,{
        baseOptions:{modelAssetPath:POSE_MODEL},runningMode:"VIDEO",numPoses:1,
        minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55,minTrackingConfidence:.55
      }),
      HandLandmarker.createFromOptions(vision,{
        baseOptions:{modelAssetPath:HAND_MODEL},runningMode:"VIDEO",numHands:2,
        minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.45
      })
    ]);
    this.ready=true;
  }
  detect(video,timestampMs){
    if(!this.ready)throw new Error("BodyTracker no está inicializado.");
    const poseResult=this.pose.detectForVideo(video,timestampMs);
    const handResult=this.hands.detectForVideo(video,timestampMs);
    const image=poseResult?.landmarks?.[0],world=poseResult?.worldLandmarks?.[0];
    if(!image||!world)return{tracked:false,poseResult,handResult,frame:null};

    const skeleton=deriveSkeleton(world,image),assigned=assignHands(handResult,image);
    const left=assigned.left?handChannels(assigned.left.hand):null;
    const right=assigned.right?handChannels(assigned.right.hand):null;
    return{
      tracked:true,poseResult,handResult,
      frame:{
        root:skeleton.root,bones:skeleton.bones,
        hands:{
          EM2_HandOpen_L:left?.handOpen??null,EM2_IndexOpen_L:left?.indexOpen??null,
          EM2_HandOpen_R:right?.handOpen??null,EM2_IndexOpen_R:right?.indexOpen??null
        }
      }
    };
  }
  draw(canvas,video,result){
    const width=video.videoWidth||1280,height=video.videoHeight||720;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    const ctx=canvas.getContext("2d");ctx.clearRect(0,0,width,height);
    if(!result?.tracked)return;
    const pose=result.poseResult.landmarks?.[0];
    if(pose){
      ctx.lineWidth=Math.max(2,width/400);ctx.strokeStyle="rgba(92,255,178,.95)";ctx.fillStyle="rgba(255,255,255,.95)";
      for(const [a,b] of POSE_CONNECTIONS){
        const pa=pose[a],pb=pose[b];if((pa.visibility??1)<.35||(pb.visibility??1)<.35)continue;
        ctx.beginPath();ctx.moveTo((1-pa.x)*width,pa.y*height);ctx.lineTo((1-pb.x)*width,pb.y*height);ctx.stroke();
      }
      for(const p of pose){
        if((p.visibility??1)<.5)continue;
        ctx.beginPath();ctx.arc((1-p.x)*width,p.y*height,Math.max(2,width/300),0,Math.PI*2);ctx.fill();
      }
    }
    ctx.strokeStyle="rgba(255,205,86,.95)";ctx.fillStyle="rgba(255,225,145,.95)";
    for(const hand of result.handResult?.landmarks||[]){
      for(const [a,b] of HAND_CONNECTIONS){
        ctx.beginPath();ctx.moveTo((1-hand[a].x)*width,hand[a].y*height);ctx.lineTo((1-hand[b].x)*width,hand[b].y*height);ctx.stroke();
      }
      for(const p of hand){ctx.beginPath();ctx.arc((1-p.x)*width,p.y*height,Math.max(2,width/360),0,Math.PI*2);ctx.fill()}
    }
  }
}
