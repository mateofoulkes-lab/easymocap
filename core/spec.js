export const EM2_VERSION = "1.1";
export const SUPPORTED_EM2_VERSIONS = Object.freeze(["1.0","1.1"]);

export const BODY_ROTATION_FORMAT = "local-delta-quaternion-v1";

export const BODY_BONES = Object.freeze([
  "Root","Hips","Spine","Chest","Neck","Head",
  "Shoulder_L","UpperArm_L","LowerArm_L","Hand_L",
  "Shoulder_R","UpperArm_R","LowerArm_R","Hand_R",
  "UpperLeg_L","LowerLeg_L","Foot_L",
  "UpperLeg_R","LowerLeg_R","Foot_R"
]);

export const HAND_CHANNELS = Object.freeze([
  "EM2_HandOpen_L","EM2_IndexOpen_L",
  "EM2_HandOpen_R","EM2_IndexOpen_R"
]);

export const FACE_CHANNELS = Object.freeze([
  "EM2_Blink_L","EM2_Blink_R",
  "EM2_Brow_L","EM2_Brow_R",
  "EM2_MouthOpen","EM2_MouthWidth",
  "EM2_MouthCorner_L","EM2_MouthCorner_R"
]);

export const MODEL_FACE_SHAPES = Object.freeze([
  "EM2_Blink_L","EM2_Blink_R",
  "EM2_BrowDown_L","EM2_BrowUp_L",
  "EM2_BrowDown_R","EM2_BrowUp_R",
  "EM2_MouthOpen","EM2_MouthNarrow","EM2_MouthWide",
  "EM2_MouthFrown_L","EM2_MouthSmile_L",
  "EM2_MouthFrown_R","EM2_MouthSmile_R"
]);

export function createTake({mode,audioName,audioDuration}) {
  if (!["body","face"].includes(mode)) throw new Error(`Modo EM2 inválido: ${mode}`);
  return {
    format:"EasyMocap2",
    specVersion:EM2_VERSION,
    mode,
    createdAt:new Date().toISOString(),
    audio:{
      name:audioName || null,
      duration:Number.isFinite(audioDuration) ? audioDuration : null
    },
    timeline:{timebase:"seconds",frames:[]}
  };
}

export function assertTake(take) {
  if (!take || take.format !== "EasyMocap2") throw new Error("No es un archivo EasyMocap2");
  if (!SUPPORTED_EM2_VERSIONS.includes(take.specVersion)) {
    throw new Error(`Spec no compatible: ${take.specVersion}`);
  }
  if (!["body","face"].includes(take.mode)) throw new Error("Take sin modo válido");
  if (!take.timeline || !Array.isArray(take.timeline.frames)) throw new Error("Timeline inválida");
  return true;
}
