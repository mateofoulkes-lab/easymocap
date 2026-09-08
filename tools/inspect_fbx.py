import bpy
from pathlib import Path

src = Path("esqueleto-fase2.fbx").resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(src))

print("=== EASYMOCAP FBX REPORT ===")
print("FILE", src.name)

armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
print("ARMATURE_COUNT", len(armatures))

for arm in armatures:
    print("ARMATURE", arm.name)
    print("SCALE", tuple(round(v, 6) for v in arm.scale))
    print("ROTATION_EULER", tuple(round(v, 6) for v in arm.rotation_euler))
    print("LOCATION", tuple(round(v, 6) for v in arm.location))
    print("BONE_COUNT", len(arm.data.bones))
    for b in arm.data.bones:
        parent = b.parent.name if b.parent else "<ROOT>"
        head = tuple(round(v, 6) for v in b.head_local)
        tail = tuple(round(v, 6) for v in b.tail_local)
        print(f"BONE|{b.name}|PARENT={parent}|HEAD={head}|TAIL={tail}|ROLL={round(b.roll,6)}|DEFORM={b.use_deform}")

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print("MESH_COUNT", len(meshes))
for obj in meshes:
    print("MESH", obj.name, "VERTS", len(obj.data.vertices), "POLYS", len(obj.data.polygons))
    mods = [m.type for m in obj.modifiers]
    print("MODIFIERS", obj.name, mods)

actions = list(bpy.data.actions)
print("ACTION_COUNT", len(actions))
for a in actions:
    print("ACTION", a.name, "FRAME_RANGE", tuple(round(v,3) for v in a.frame_range))

print("=== END REPORT ===")
