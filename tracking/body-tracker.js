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

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a,b,t) => a + (b-a)*t;

function midpoint(a,b) {
  return {
    x:(a.x+b.x)/2, y:(a.y+b.y)/2, z:(a.z+b.z)/2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1)
  };
}

function lerpPoint(a,b,t) {
  return {
    x:mix(a.x,b.x,t), y:mix(a.y,b.y,t), z:mix(a.z,b.z,t),
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1)
  };
}

function vec(a,b) {
  return [b.x-a.x, b.y-a.y, b.z-a.z];
}

function length3(v) {
  return Math.hypot(v[0],v[1],v[2]);
}

function normalize(v) {
  const len = length3(v);
  if (len < 1e-8) return [0,1,0];
  return v.map((n) => n/len);
}

function pointArray(p) {
  return [p.x,p.y,p.z];
}

function dist2(a,b) {
  return Math.hypot(a.x-b.x,a.y-b.y);
}

function angle3(a,b,c) {
  const ba = [a.x-b.x,a.y-b.y,a.z-b.z];
  const bc = [c.x-b.x,c.y-b.y,c.z-b.z];
  const la = length3(ba);
  const lc = length3(bc);
  if (la < 1e-8 || lc < 1e-8) return 0;
  const dot = (ba[0]*bc[0]+ba[1]*bc[1]+ba[2]*bc[2])/(la*lc);
  return Math.acos(Math.max(-1,Math.min(1,dot))) * 180 / Math.PI;
}

function smoothstep(edge0,edge1,x) {
  const t = clamp01((x-edge0)/(edge1-edge0));
  return t*t*(3-2*t);
}

function fingerOpen(hand, ids) {
  const [a,b,c,d] = ids;
  const p1 = angle3(hand[a],hand[b],hand[c]);
  const p2 = angle3(hand[b],hand[c],hand[d]);
  return (smoothstep(95,170,p1) + smoothstep(95,170,p2)) / 2;
}

function thumbOpen(hand) {
  const a = angle3(hand[1],hand[2],hand[3]);
  const b = angle3(hand[2],hand[3],hand[4]);
  return (smoothstep(85,165,a) + smoothstep(100,170,b)) / 2;
}

function handChannels(hand) {
  const index = fingerOpen(hand,[5,6,7,8]);
  const middle = fingerOpen(hand,[9,10,11,12]);
  const ring = fingerOpen(hand,[13,14,15,16]);
  const pinky = fingerOpen(hand,[17,18,19,20]);
  const thumb = thumbOpen(hand);
  return {
    handOpen: clamp01((thumb+middle+ring+pinky)/4),
    indexOpen: clamp01(index)
  };
}

function makeBone(from,to,confidence=1) {
  const delta = vec(from,to);
  return {
    direction: normalize(delta),
    length: length3(delta),
    confidence: clamp01(confidence)
  };
}

function deriveSkeleton(world, image) {
  const hip = midpoint(world[23],world[24]);
  const chest = midpoint(world[11],world[12]);
  const spine = lerpPoint(hip,chest,0.48);
  const ears = midpoint(world[7],world[8]);
  const neck = lerpPoint(chest,ears,0.42);
  const head = ears;

  const imgHip = midpoint(image[23],image[24]);
  const imgChest = midpoint(image[11],image[12]);
  const shoulderWidth = Math.max(0.001, dist2(image[11],image[12]));
  const torsoHeight = Math.max(0.001, dist2(imgHip,imgChest));
  const rootConfidence = Math.min(image[23].visibility ?? 1,image[24].visibility ?? 1);

  const bones = {
    Hips: makeBone(hip,spine,rootConfidence),
    Spine: makeBone(hip,spine,Math.min(world[23].visibility ?? 1,world[24].visibility ?? 1)),
    Chest: makeBone(spine,chest,Math.min(world[11].visibility ?? 1,world[12].visibility ?? 1)),
    Neck: makeBone(chest,neck,Math.min(world[11].visibility ?? 1,world[12].visibility ?? 1)),
    Head: makeBone(neck,head,Math.min(world[7].visibility ?? 1,world[8].visibility ?? 1)),
    Shoulder_L: makeBone(chest,world[11],world[11].visibility ?? 1),
    UpperArm_L: makeBone(world[11],world[13],Math.min(world[11].visibility ?? 1,world[13].visibility ?? 1)),
    LowerArm_L: makeBone(world[13],world[15],Math.min(world[13].visibility ?? 1,world[15].visibility ?? 1)),
    Hand_L: makeBone(world[15],midpoint(world[19],world[21]),world[15].visibility ?? 1),
    Shoulder_R: makeBone(chest,world[12],world[12].visibility ?? 1),
    UpperArm_R: makeBone(world[12],world[14],Math.min(world[12].visibility ?? 1,world[14].visibility ?? 1)),
    LowerArm_R: makeBone(world[14],world[16],Math.min(world[14].visibility ?? 1,world[16].visibility ?? 1)),
    Hand_R: makeBone(world[16],midpoint(world[20],world[22]),world[16].visibility ?? 1),
    UpperLeg_L: makeBone(world[23],world[25],Math.min(world[23].visibility ?? 1,world[25].visibility ?? 1)),
    LowerLeg_L: makeBone(world[25],world[27],Math.min(world[25].visibility ?? 1,world[27].visibility ?? 1)),
    Foot_L: makeBone(world[27],world[31],Math.min(world[27].visibility ?? 1,world[31].visibility ?? 1)),
    UpperLeg_R: makeBone(world[24],world[26],Math.min(world[24].visibility ?? 1,world[26].visibility ?? 1)),
    LowerLeg_R: makeBone(world[26],world[28],Math.min(world[26].visibility ?? 1,world[28].visibility ?? 1)),
    Foot_R: makeBone(world[28],world[32],Math.min(world[28].visibility ?? 1,world[32].visibility ?? 1))
  };

  return {
    root: {
      screen: [imgHip.x,imgHip.y],
      apparentScale: shoulderWidth,
      torsoScale: torsoHeight,
      confidence: clamp01(rootConfidence)
    },
    landmarks: {
      Hips: pointArray(hip),
      Spine: pointArray(spine),
      Chest: pointArray(chest),
      Neck: pointArray(neck),
      Head: pointArray(head)
    },
    bones
  };
}

function assignHands(handResult, poseImage) {
  const assigned = { left:null, right:null };
  if (!handResult?.landmarks?.length || !poseImage?.length) return assigned;

  const leftWrist = poseImage[15];
  const rightWrist = poseImage[16];

  for (const hand of handResult.landmarks) {
    const wrist = hand[0];
    const dl = dist2(wrist,leftWrist);
    const dr = dist2(wrist,rightWrist);
    const side = dl <= dr ? "left" : "right";
    const score = Math.min(dl,dr);
    if (!assigned[side] || score < assigned[side].score) {
      assigned[side] = { hand, score };
    }
  }
  return assigned;
}

export class BodyTracker {
  constructor() {
    this.pose = null;
    this.hands = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    const [pose,hands] = await Promise.all([
      PoseLandmarker.createFromOptions(vision,{
        baseOptions:{ modelAssetPath:POSE_MODEL },
        runningMode:"VIDEO",
        numPoses:1,
        minPoseDetectionConfidence:0.55,
        minPosePresenceConfidence:0.55,
        minTrackingConfidence:0.55
      }),
      HandLandmarker.createFromOptions(vision,{
        baseOptions:{ modelAssetPath:HAND_MODEL },
        runningMode:"VIDEO",
        numHands:2,
        minHandDetectionConfidence:0.45,
        minHandPresenceConfidence:0.45,
        minTrackingConfidence:0.45
      })
    ]);
    this.pose = pose;
    this.hands = hands;
    this.ready = true;
  }

  detect(video,timestampMs) {
    if (!this.ready) throw new Error("BodyTracker no está inicializado.");
    const poseResult = this.pose.detectForVideo(video,timestampMs);
    const handResult = this.hands.detectForVideo(video,timestampMs);
    const image = poseResult?.landmarks?.[0];
    const world = poseResult?.worldLandmarks?.[0];
    if (!image || !world) {
      return { tracked:false, poseResult, handResult, frame:null };
    }

    const skeleton = deriveSkeleton(world,image);
    const assigned = assignHands(handResult,image);
    const left = assigned.left ? handChannels(assigned.left.hand) : null;
    const right = assigned.right ? handChannels(assigned.right.hand) : null;

    return {
      tracked:true,
      poseResult,
      handResult,
      frame:{
        root:skeleton.root,
        bones:skeleton.bones,
        hands:{
          EM2_HandOpen_L:left?.handOpen ?? null,
          EM2_IndexOpen_L:left?.indexOpen ?? null,
          EM2_HandOpen_R:right?.handOpen ?? null,
          EM2_IndexOpen_R:right?.indexOpen ?? null
        }
      }
    };
  }

  draw(canvas, video, result) {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,width,height);
    if (!result?.tracked) return;

    const pose = result.poseResult.landmarks?.[0];
    if (pose) {
      ctx.lineWidth = Math.max(2,width/400);
      ctx.strokeStyle = "rgba(92,255,178,.95)";
      ctx.fillStyle = "rgba(255,255,255,.95)";
      for (const [a,b] of POSE_CONNECTIONS) {
        const pa=pose[a], pb=pose[b];
        if ((pa.visibility ?? 1)<0.35 || (pb.visibility ?? 1)<0.35) continue;
        ctx.beginPath();
        ctx.moveTo((1-pa.x)*width,pa.y*height);
        ctx.lineTo((1-pb.x)*width,pb.y*height);
        ctx.stroke();
      }
      for (const p of pose) {
        if ((p.visibility ?? 1)<0.5) continue;
        ctx.beginPath();
        ctx.arc((1-p.x)*width,p.y*height,Math.max(2,width/300),0,Math.PI*2);
        ctx.fill();
      }
    }

    const handSets = result.handResult?.landmarks || [];
    ctx.strokeStyle = "rgba(255,205,86,.95)";
    ctx.fillStyle = "rgba(255,225,145,.95)";
    for (const hand of handSets) {
      for (const [a,b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo((1-hand[a].x)*width,hand[a].y*height);
        ctx.lineTo((1-hand[b].x)*width,hand[b].y*height);
        ctx.stroke();
      }
      for (const p of hand) {
        ctx.beginPath();
        ctx.arc((1-p.x)*width,p.y*height,Math.max(2,width/360),0,Math.PI*2);
        ctx.fill();
      }
    }
  }
}
