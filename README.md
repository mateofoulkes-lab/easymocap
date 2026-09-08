# EasyMocap

Lightweight desktop motion capture for one specific workflow: **perform to an audio track and export an animated FBX for Unity**.

## What it does

1. Load an `.mp3` or `.ogg`.
2. Load a rigged `.fbx`.
3. Open the webcam.
4. MediaPipe tracks the body and shows a live skeleton overlay.
5. Optional **Foot Lock IK** reduces foot sliding.
6. Press **Record**.
7. EasyMocap shows **3… 2… 1…**, starts the audio and records the tracked pose.
8. Recording stops automatically when the audio ends.
9. Export the take as an animated FBX.

## Tech

- Python 3.11
- PySide6 for the desktop UI and audio playback
- OpenCV for webcam capture
- MediaPipe Pose for body tracking
- NumPy for motion processing
- Blender 4.x as a silent/headless FBX import-retarget-export backend

Blender does not stay open while recording. It is only called when exporting FBX.

## Windows quick start

```bat
setup.bat
run.bat
```

Manual equivalent:

```bat
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -U pip
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py
```

## FBX export

EasyMocap automatically checks the PATH and common Blender Foundation folders for `blender.exe`. If Blender is not found, the app lets you locate it manually.

Every recording is first stored under `captures/` as an EasyMocap JSON take. This means an FBX retarget/export problem never destroys the captured performance.

## Rig support

The first version auto-detects common humanoid naming conventions, including many Mixamo, Unity and Blender-style rigs. It maps:

- hips / pelvis
- spine / chest / neck / head
- upper arms / forearms
- thighs / shins
- feet / toes

Custom non-standard rigs can be supported later with an explicit bone-map UI without changing the capture format.

## Foot Lock IK

The current foot lock is lightweight post-processing. It detects low-speed foot contact and pins ankle/heel/toe targets until lift-off. The raw tracking frames remain untouched.

## Current limitations

- Single RGB webcam: depth is inferred and will not match multi-camera or depth-camera mocap precision.
- No fingers or face yet.
- The MVP retargeter is humanoid-focused.
- Blender is currently required for final FBX I/O.

## Development

A GitHub Actions syntax smoke test compiles all Python sources on every push.
