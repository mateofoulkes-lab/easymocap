# EasyMocap 2

Web mobile-first para capturar actuaciones por capas sincronizadas contra un mismo audio.

## EM2 Spec v1.1
### Body bones (20)
Root, Hips, Spine, Chest, Neck, Head, Shoulder_L, UpperArm_L, LowerArm_L, Hand_L, Shoulder_R, UpperArm_R, LowerArm_R, Hand_R, UpperLeg_L, LowerLeg_L, Foot_L, UpperLeg_R, LowerLeg_R, Foot_R.

### Transporte corporal
Body v1.1 exporta deltas de rotación locales por hueso como quaternion `[x,y,z,w]`, independientes de las proporciones del personaje. El viewer los aplica sobre la pose de reposo del rig destino. Se conservan longitud y confianza como metadata por frame.

### Hand channels
EM2_HandOpen_L, EM2_IndexOpen_L, EM2_HandOpen_R, EM2_IndexOpen_R.

### Face capture channels
EM2_Blink_L/R, EM2_Brow_L/R, EM2_MouthOpen, EM2_MouthWidth, EM2_MouthCorner_L/R.

### Model face shape keys
Blink L/R; BrowDown/Up L/R; MouthOpen; MouthNarrow/Wide; MouthFrown/Smile L/R.

## Arquitectura
- `core/`: contrato EM2 independiente del tracker.
- `tracking/`: adaptadores MediaPipe.
- Body y Face generan takes separados sobre el mismo audio.
- Viewer combina audio + body + face + GLB.
- `castor_em2.glb` es el personaje oficial de prueba.
- EasyMocap v1 está preservado en `old/`.

## Estado
v0.5.0: Body/Hands/Face, transporte corporal por quaternion local, smoothing de captura, interpolación de playback, Viewer con castor_em2 precargado, validación de rig/morphs y errores visibles. Sin service worker durante desarrollo.
