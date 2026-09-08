"""
Run by Blender:
blender --background --factory-startup --python blender_export.py -- input.fbx take.json output.fbx
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


MP = {
    "nose": 0,
    "l_shoulder": 11,
    "r_shoulder": 12,
    "l_elbow": 13,
    "r_elbow": 14,
    "l_wrist": 15,
    "r_wrist": 16,
    "l_hip": 23,
    "r_hip": 24,
    "l_knee": 25,
    "r_knee": 26,
    "l_ankle": 27,
    "r_ankle": 28,
    "l_heel": 29,
    "r_heel": 30,
    "l_toe": 31,
    "r_toe": 32,
}

ALIASES = {
    "hips": ["hips", "hip", "pelvis"],
    "spine": ["spine", "spine1", "abdomen"],
    "chest": ["spine2", "chest", "upperchest", "spine01", "spine_01"],
    "neck": ["neck", "neck1"],
    "head": ["head"],
    "l_upper_arm": ["leftarm", "upperarml", "lupperarm", "arm_l", "upper_arm_l"],
    "r_upper_arm": ["rightarm", "upperarmr", "rupperarm", "arm_r", "upper_arm_r"],
    "l_forearm": ["leftforearm", "lowerarml", "lforearm", "forearm_l", "lower_arm_l"],
    "r_forearm": ["rightforearm", "lowerarmr", "rforearm", "forearm_r", "lower_arm_r"],
    "l_hand": ["lefthand", "handl", "lhand", "hand_l"],
    "r_hand": ["righthand", "handr", "rhand", "hand_r"],
    "l_thigh": ["leftupleg", "leftthigh", "thighl", "upperleg_l", "thigh_l"],
    "r_thigh": ["rightupleg", "rightthigh", "thighr", "upperleg_r", "thigh_r"],
    "l_shin": ["leftleg", "leftshin", "calfl", "lowerleg_l", "shin_l"],
    "r_shin": ["rightleg", "rightshin", "calfr", "lowerleg_r", "shin_r"],
    "l_foot": ["leftfoot", "footl", "foot_l"],
    "r_foot": ["rightfoot", "footr", "foot_r"],
    "l_toe": ["lefttoebase", "lefttoe", "toel", "toe_l"],
    "r_toe": ["righttoebase", "righttoe", "toer", "toe_r"],
}


def norm(name: str) -> str:
    name = name.lower().replace("mixamorig:", "")
    return re.sub(r"[^a-z0-9]", "", name)


def pick_bone(armature, logical_name: str):
    aliases = [norm(x) for x in ALIASES[logical_name]]
    ranked = []
    for pose_bone in armature.pose.bones:
        candidate = norm(pose_bone.name)
        score = -1
        for alias in aliases:
            if candidate == alias:
                score = 1000
                break
            if candidate.endswith(alias):
                score = max(score, 500 + len(alias))
            elif alias in candidate:
                score = max(score, 100 + len(alias))
        if score >= 0:
            ranked.append((score, pose_bone))
    return max(ranked, key=lambda item: item[0])[1] if ranked else None


def mpv(frame: dict, key: str) -> Vector:
    p = frame["world_landmarks"][MP[key]]
    # MediaPipe: +X right, +Y down, Z camera-depth.
    # Blender: +X right, +Y forward/back, +Z up.
    return Vector((p["x"], -p["z"], -p["y"]))


def midpoint(a: Vector, b: Vector) -> Vector:
    return (a + b) * 0.5


def set_direction(pose_bone, target_armature_space: Vector) -> None:
    """Rotate a pose bone so its rest head->tail axis aims at target."""
    if pose_bone is None or target_armature_space.length < 1e-6:
        return

    target = target_armature_space.normalized()
    rest = pose_bone.bone.tail_local - pose_bone.bone.head_local
    if rest.length < 1e-6:
        return

    if pose_bone.parent:
        parent_matrix = pose_bone.parent.bone.matrix_local.to_3x3()
        target = parent_matrix.inverted() @ target
        rest = parent_matrix.inverted() @ rest

    target.normalize()
    rest.normalize()

    pose_bone.rotation_mode = "QUATERNION"
    pose_bone.rotation_quaternion = rest.rotation_difference(target)
    pose_bone.keyframe_insert(data_path="rotation_quaternion")


def apply_frame(bones: dict, frame: dict, first_hips: Vector, root_scale: float) -> None:
    l_shoulder = mpv(frame, "l_shoulder")
    r_shoulder = mpv(frame, "r_shoulder")
    l_hip = mpv(frame, "l_hip")
    r_hip = mpv(frame, "r_hip")
    shoulder_mid = midpoint(l_shoulder, r_shoulder)
    hip_mid = midpoint(l_hip, r_hip)

    hips = bones["hips"]
    if hips:
        hips.location = (hip_mid - first_hips) * root_scale
        hips.keyframe_insert(data_path="location")

    torso = shoulder_mid - hip_mid
    set_direction(bones["spine"], torso)
    set_direction(bones["chest"], torso)
    set_direction(bones["neck"], mpv(frame, "nose") - shoulder_mid)
    set_direction(bones["head"], mpv(frame, "nose") - shoulder_mid)

    set_direction(bones["l_upper_arm"], mpv(frame, "l_elbow") - l_shoulder)
    set_direction(bones["l_forearm"], mpv(frame, "l_wrist") - mpv(frame, "l_elbow"))
    set_direction(bones["r_upper_arm"], mpv(frame, "r_elbow") - r_shoulder)
    set_direction(bones["r_forearm"], mpv(frame, "r_wrist") - mpv(frame, "r_elbow"))

    set_direction(bones["l_thigh"], mpv(frame, "l_knee") - l_hip)
    set_direction(bones["l_shin"], mpv(frame, "l_ankle") - mpv(frame, "l_knee"))
    set_direction(bones["l_foot"], mpv(frame, "l_toe") - mpv(frame, "l_ankle"))
    set_direction(bones["l_toe"], mpv(frame, "l_toe") - mpv(frame, "l_heel"))

    set_direction(bones["r_thigh"], mpv(frame, "r_knee") - r_hip)
    set_direction(bones["r_shin"], mpv(frame, "r_ankle") - mpv(frame, "r_knee"))
    set_direction(bones["r_foot"], mpv(frame, "r_toe") - mpv(frame, "r_ankle"))
    set_direction(bones["r_toe"], mpv(frame, "r_toe") - mpv(frame, "r_heel"))


def main() -> None:
    if "--" not in sys.argv:
        raise RuntimeError("Missing EasyMocap exporter arguments.")

    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) < 3:
        raise RuntimeError("Expected: input.fbx take.json output.fbx")

    source_fbx, take_path, output_fbx = map(Path, args[:3])
    take = json.loads(take_path.read_text(encoding="utf-8"))
    frames = [f for f in take.get("frames", []) if len(f.get("world_landmarks", [])) >= 33]
    if not frames:
        raise RuntimeError("The take contains no complete 3D pose frames.")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source_fbx))

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("The source FBX contains no armature.")

    armature = max(armatures, key=lambda obj: len(obj.data.bones))
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)

    bones = {logical: pick_bone(armature, logical) for logical in ALIASES}
    if not bones["hips"]:
        raise RuntimeError("Could not identify a hips/pelvis bone in this rig.")

    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions.new("EasyMocap_Take")

    fps = 30
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = max(2, math.ceil(frames[-1]["timestamp"] * fps) + 1)

    first = frames[0]
    first_hips = midpoint(mpv(first, "l_hip"), mpv(first, "r_hip"))
    first_shoulders = midpoint(mpv(first, "l_shoulder"), mpv(first, "r_shoulder"))
    tracked_torso = max((first_shoulders - first_hips).length, 1e-4)

    hips_head = bones["hips"].bone.head_local
    rig_reference = 1.0
    if bones["head"]:
        rig_reference = max((bones["head"].bone.head_local - hips_head).length, 1e-3)
    root_scale = rig_reference / max(tracked_torso * 2.2, 1e-4)

    used_frames = set()
    for frame in frames:
        frame_number = 1 + round(float(frame["timestamp"]) * fps)
        if frame_number in used_frames:
            continue
        used_frames.add(frame_number)
        scene.frame_set(frame_number)
        apply_frame(bones, frame, first_hips, root_scale)

    # Avoid Bezier overshoot between noisy samples.
    action = armature.animation_data.action
    if action and hasattr(action, "fcurves"):
        for fcurve in action.fcurves:
            for point in fcurve.keyframe_points:
                point.interpolation = "LINEAR"

    output_fbx.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(output_fbx),
        use_selection=False,
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=False,
        bake_anim_force_startend_keying=True,
        bake_anim_simplify_factor=0.0,
    )
    print("EASYMOCAP_EXPORT_OK", output_fbx)


if __name__ == "__main__":
    main()
