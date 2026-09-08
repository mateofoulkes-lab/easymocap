import bpy
from pathlib import Path
from mathutils import Vector

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

# Remove the fake/non-skinned bone-node hierarchy that came in the source GLB.
for o in list(imported):
    if o.type!="MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# Import canonical rig.
bpy.ops.import_scene.fbx(filepath=str(SRC_FBX))
arms=[o for o in bpy.context.scene.objects if o.type=="ARMATURE"]
if not arms:
    raise RuntimeError("esqueleto-fase2.fbx contains no armature")
arm=max(arms,key=lambda a: len(a.data.bones))

# Ensure transforms are evaluated before spatial weighting.
bpy.context.view_layer.update()

deform_bones=[b for b in arm.data.bones if b.use_deform]
if not deform_bones:
    raise RuntimeError("Canonical rig has no deform bones")

# Build world-space bone segments.
segments=[]
for b in deform_bones:
    a=arm.matrix_world @ b.head_local
    z=arm.matrix_world @ b.tail_local
    segments.append((b.name,a,z))

def point_segment_distance_sq(p,a,b):
    ab=b-a
    d=ab.length_squared
    if d<=1e-12:
        return (p-a).length_squared
    t=max(0.0,min(1.0,(p-a).dot(ab)/d))
    q=a+ab*t
    return (p-q).length_squared

# Deterministic fallback skinning:
# each vertex gets normalized inverse-distance weights to its 4 nearest deform bones.
for m in meshes:
    # Remove any stale armature modifiers/groups.
    for mod in list(m.modifiers):
        if mod.type=="ARMATURE":
            m.modifiers.remove(mod)
    m.vertex_groups.clear()

    groups={name:m.vertex_groups.new(name=name) for name,_,_ in segments}

    assigned=0
    for v in m.data.vertices:
        p=m.matrix_world @ v.co
        nearest=[]
        for name,a,b in segments:
            d2=point_segment_distance_sq(p,a,b)
            nearest.append((d2,name))
        nearest.sort(key=lambda x:x[0])
        chosen=nearest[:4]

        # Inverse-distance with epsilon. Strong enough to keep limbs coherent,
        # smooth enough not to look like rigid pieces.
        vals=[]
        total=0.0
        for d2,name in chosen:
            w=1.0/max(d2,1e-8)
            vals.append((name,w))
            total+=w
        if total<=0:
            continue
        for name,w in vals:
            groups[name].add([v.index],w/total,"REPLACE")
        assigned+=1

    if assigned != len(m.data.vertices):
        raise RuntimeError(f"Only weighted {assigned}/{len(m.data.vertices)} vertices on {m.name}")

    mod=m.modifiers.new(name="Armature",type="ARMATURE")
    mod.object=arm
    m.parent=arm
    m.matrix_parent_inverse=arm.matrix_world.inverted()

    # Confirm actual nonzero assignments.
    weighted_links=sum(len(v.groups) for v in m.data.vertices)
    print("MESH",m.name,"VERTICES",len(m.data.vertices),"WEIGHT_LINKS",weighted_links,
          "ARMATURE_MOD",mod.object==arm,"VERTEX_GROUPS",len(m.vertex_groups))
    if weighted_links==0:
        raise RuntimeError("No vertex weights were generated")

# Export model + rig.
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active=arm

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_all_influences=False,
    export_animations=False,
    export_apply=False,
)

if not OUT.exists():
    raise RuntimeError("GLB export did not create output file")

print("EASYMOCAP_SKINNED_GLB_OK",OUT)
