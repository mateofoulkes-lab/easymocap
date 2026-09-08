import bpy
from pathlib import Path

ROOT=Path.cwd()
SRC_GLB=ROOT/"castor4.glb"
SRC_FBX=ROOT/"esqueleto-fase2.fbx"
OUT=ROOT/"castor4-skinned.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)

# Import character mesh.
bpy.ops.import_scene.gltf(filepath=str(SRC_GLB))
imported=list(bpy.context.scene.objects)
meshes=[o for o in imported if o.type=="MESH"]
if not meshes:
    raise RuntimeError("castor4.glb contains no mesh")

# Remove non-mesh hierarchy from the GLB; it is not a real glTF skin.
for o in list(imported):
    if o.type!="MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# Import canonical rig.
bpy.ops.import_scene.fbx(filepath=str(SRC_FBX))
arms=[o for o in bpy.context.scene.objects if o.type=="ARMATURE"]
if not arms:
    raise RuntimeError("esqueleto-fase2.fbx contains no armature")
arm=max(arms,key=lambda a: len(a.data.bones))

# Select all character meshes + armature and bind with automatic weights.
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active=arm

try:
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
except Exception as e:
    raise RuntimeError(f"Automatic armature binding failed: {e}")

# Verify skin data exists.
weighted=0
for m in meshes:
    has_arm=any(mod.type=="ARMATURE" and mod.object==arm for mod in m.modifiers)
    groups=len(m.vertex_groups)
    print("MESH",m.name,"ARMATURE_MOD",has_arm,"VERTEX_GROUPS",groups)
    if has_arm and groups:
        weighted+=1
if not weighted:
    raise RuntimeError("Binding produced no weighted meshes")

# Export only model + rig as real skinned GLB.
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
for m in meshes:
    m.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_all_influences=False,
    export_animations=False,
    export_apply=False,
)

print("EASYMOCAP_SKINNED_GLB_OK",OUT)
