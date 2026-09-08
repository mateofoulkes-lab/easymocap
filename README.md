# EasyMocap 2

EasyMocap 2 es una web mobile-first para capturar actuaciones por capas sincronizadas contra un mismo audio.

## EM2 Spec v1

### Body bones (20)
Root, Hips, Spine, Chest, Neck, Head, Shoulder_L, UpperArm_L, LowerArm_L, Hand_L, Shoulder_R, UpperArm_R, LowerArm_R, Hand_R, UpperLeg_L, LowerLeg_L, Foot_L, UpperLeg_R, LowerLeg_R, Foot_R.

### Hand channels
- EM2_HandOpen_L
- EM2_IndexOpen_L
- EM2_HandOpen_R
- EM2_IndexOpen_R

### Face channels
- EM2_Blink_L / EM2_Blink_R
- EM2_Brow_L / EM2_Brow_R (0=down, 0.5=neutral, 1=up)
- EM2_MouthOpen
- EM2_MouthWidth (0=narrow, 0.5=neutral, 1=wide)
- EM2_MouthCorner_L / EM2_MouthCorner_R (0=frown, 0.5=neutral, 1=smile)

## Arquitectura

- `core/`: contrato y utilidades independientes del tracker.
- recorder Body y Face comparten audio/timeline, pero generan takes separados.
- Viewer combinará audio + body take + face take + personaje GLB.
- La versión EasyMocap anterior está preservada en `old/`.

## Estado

v0.1.0: base limpia, mobile-first, audio, cámara, countdown, timeline exportable y manejo visible de errores. Sin service worker durante esta etapa para evitar caché obsoleta.
