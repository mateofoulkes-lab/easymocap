import {
  FilesetResolver,
  FaceLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function scoreMap(categories=[]) {
  const out = {};
  for (const item of categories) out[item.categoryName] = item.score ?? 0;
  return out;
}

function mapChannels(scores) {
  const inner = scores.browInnerUp ?? 0;
  const browLUp = Math.max(scores.browOuterUpLeft ?? 0, inner);
  const browRUp = Math.max(scores.browOuterUpRight ?? 0, inner);
  const browLDown = scores.browDownLeft ?? 0;
  const browRDown = scores.browDownRight ?? 0;

  const stretch = ((scores.mouthStretchLeft ?? 0) + (scores.mouthStretchRight ?? 0)) / 2;
  const narrow = Math.max(scores.mouthPucker ?? 0, scores.mouthFunnel ?? 0);

  return {
    EM2_Blink_L: clamp01(scores.eyeBlinkLeft ?? 0),
    EM2_Blink_R: clamp01(scores.eyeBlinkRight ?? 0),
    EM2_Brow_L: clamp01(0.5 + 0.5 * (browLUp - browLDown)),
    EM2_Brow_R: clamp01(0.5 + 0.5 * (browRUp - browRDown)),
    EM2_MouthOpen: clamp01(scores.jawOpen ?? 0),
    EM2_MouthWidth: clamp01(0.5 + 0.5 * (stretch - narrow)),
    EM2_MouthCorner_L: clamp01(0.5 + 0.5 * ((scores.mouthSmileLeft ?? 0) - (scores.mouthFrownLeft ?? 0))),
    EM2_MouthCorner_R: clamp01(0.5 + 0.5 * ((scores.mouthSmileRight ?? 0) - (scores.mouthFrownRight ?? 0)))
  };
}

export class FaceTracker {
  constructor() {
    this.face = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    this.face = await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{ modelAssetPath:FACE_MODEL },
      runningMode:"VIDEO",
      numFaces:1,
      minFaceDetectionConfidence:0.5,
      minFacePresenceConfidence:0.5,
      minTrackingConfidence:0.5,
      outputFaceBlendshapes:true
    });
    this.ready = true;
  }

  detect(video,timestampMs) {
    if (!this.ready) throw new Error("FaceTracker no está inicializado.");
    const result = this.face.detectForVideo(video,timestampMs);
    const landmarks = result?.faceLandmarks?.[0];
    const categories = result?.faceBlendshapes?.[0]?.categories;
    if (!landmarks || !categories) return { tracked:false, result, frame:null };
    const scores = scoreMap(categories);
    return {
      tracked:true,
      result,
      frame:{ channels:mapChannels(scores) }
    };
  }

  draw(canvas,video,result,mirror=true) {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,width,height);
    const face = result?.result?.faceLandmarks?.[0];
    if (!face) return;
    ctx.fillStyle = "rgba(112,193,255,.92)";
    const radius = Math.max(1.2,width/850);
    for (let i=0;i<face.length;i+=2) {
      const p = face[i];
      ctx.beginPath();
      ctx.arc((mirror?1-p.x:p.x)*width,p.y*height,radius,0,Math.PI*2);
      ctx.fill();
    }
  }
}
