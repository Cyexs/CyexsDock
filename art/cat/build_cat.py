"""Build the CyexsDock 3D cat mascot procedurally and render previews.

Usage (from repo root):
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup \
      --python art/cat/build_cat.py -- [--no-render] [--turntable]

Writes art/cat/cat.blend, art/cat/preview.png and (with --turntable)
art/cat/turntable.gif (needs ffmpeg on PATH).
"""
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

# ---------------------------------------------------------------- dimensions
# Cat faces -Y (toward camera). Z up. Units are arbitrary, ~1 = head radius.
HEAD_C = Vector((0.0, 0.0, 1.55))
HEAD_S = Vector((1.26, 0.98, 0.92))  # wide, slightly squashed head
BODY_C = Vector((0.0, 0.05, 0.50))
BODY_S = Vector((0.74, 0.64, 0.64))


def head_surface(x, z, out=0.0):
    """Point on the front of the head ellipsoid at local (x, z) offsets, pushed out by `out`."""
    sx, sy, sz = HEAD_S
    k = max(0.0, 1.0 - (x / sx) ** 2 - (z / sz) ** 2)
    y = -sy * math.sqrt(k)
    n = Vector((x / sx ** 2, y / sy ** 2, z / sz ** 2)).normalized()
    return HEAD_C + Vector((x, y, z)) + n * out, n


# ---------------------------------------------------------------- helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, rough=0.5, sss=0.0, sheen=0.0, emit=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1.0)
    p.inputs["Roughness"].default_value = rough
    if sss:
        p.inputs["Subsurface Weight"].default_value = sss
        p.inputs["Subsurface Radius"].default_value = (1.0, 0.6, 0.45)
        p.inputs["Subsurface Scale"].default_value = 0.08
    if sheen:
        p.inputs["Sheen Weight"].default_value = sheen
        p.inputs["Sheen Roughness"].default_value = 0.4
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.03
    if emit:
        p.inputs["Emission Color"].default_value = (*color, 1.0)
        p.inputs["Emission Strength"].default_value = emit
    return m


def finish(obj, mat, subd=2):
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if subd:
        mod = obj.modifiers.new("Subdivision", "SUBSURF")
        mod.levels = subd
        mod.render_levels = subd
    return obj


def blob(name, loc, scale, mat, rot=(0, 0, 0), subd=2, segs=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=1.0, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    return finish(o, mat, subd)


def cone(name, loc, r, depth, mat, rot):
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=r, radius2=r * 0.12, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return finish(o, mat, 3)


def tube(name, pts, radius, mat):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


# ---------------------------------------------------------------- build
def build():
    reset()
    fur = material("Fur", (0.93, 0.92, 0.90), rough=0.6, sss=0.25, sheen=0.6)
    ear_in = material("EarInner", (1.0, 0.70, 0.72), rough=0.6, sss=0.2)
    cheek = material("Cheek", (1.0, 0.55, 0.60), rough=0.7, sss=0.2)
    eye = material("Eye", (0.012, 0.012, 0.015), rough=0.15, coat=1.0)
    shine = material("EyeShine", (1.0, 1.0, 1.0), rough=0.2, emit=4.0)
    ink = material("Mouth", (0.03, 0.025, 0.03), rough=0.5)

    parts = {}

    # body + head
    parts["Body"] = [blob("Body", BODY_C, BODY_S, fur)]
    head = blob("Head", HEAD_C, HEAD_S, fur)
    parts["Head"] = [head]

    # ears: rounded cones on top, tilted outward, inner pink cone in front
    for side, sx in (("L", 1), ("R", -1)):
        tilt = math.radians(-15 * sx)
        base, _ = head_surface(0.60 * sx, 0.62, -0.14)
        base.y += 0.02
        e = cone(f"Ear.{side}", base + Vector((0.06 * sx, 0, 0.30)), 0.42, 0.72, fur, (math.radians(-4), tilt, 0))
        e.scale = (1.0, 0.55, 1.0)
        i = cone(f"EarInner.{side}", base + Vector((0.055 * sx, -0.155, 0.26)), 0.28, 0.50, ear_in, (math.radians(-4), tilt, 0))
        i.scale = (1.0, 0.30, 1.0)
        parts[f"Ear.{side}"] = [e, i]

    # face (parented to Head bone)
    face = []
    for side, sx in (("L", 1), ("R", -1)):
        p, n = head_surface(0.40 * sx, -0.02, -0.035)
        ey = blob(f"Eye.{side}", p, (0.125, 0.065, 0.148), eye, subd=2)
        ey.rotation_euler = (Vector((0, -1, 0)).rotation_difference(-n)).to_euler()
        hp, _ = head_surface(0.40 * sx + 0.05, 0.05, 0.02)
        face.append(ey)
        face.append(blob(f"EyeShine.{side}", hp, (0.032, 0.02, 0.032), shine, subd=1, segs=12))
        cp, cn = head_surface(0.72 * sx, -0.26, -0.045)
        ch = blob(f"Cheek.{side}", cp, (0.16, 0.05, 0.10), cheek, subd=2)
        ch.rotation_euler = (Vector((0, -1, 0)).rotation_difference(-cn)).to_euler()
        face.append(ch)

    # ":3" mouth: w-shaped tube lying on the face
    w = [(-0.15, -0.20), (-0.075, -0.275), (0.0, -0.21), (0.075, -0.275), (0.15, -0.20)]
    mouth = tube("Mouth", [head_surface(x, z, 0.005)[0] for x, z in w], 0.021, ink)
    face.append(mouth)
    parts["Head"] += face

    # arms: short chubby ovals hugging the body front
    for side, sx in (("L", 1), ("R", -1)):
        a = blob(f"Arm.{side}", (0.52 * sx, -0.30, 0.46), (0.18, 0.19, 0.25), fur, rot=(math.radians(15), math.radians(-18 * sx), 0))
        parts[f"Arm.{side}"] = [a]
        f = blob(f"Foot.{side}", (0.30 * sx, -0.38, 0.09), (0.21, 0.25, 0.13), fur)
        parts[f"Leg.{side}"] = [f]

    # tail: curls up behind the body
    tail = tube("Tail", [Vector(p) for p in [(0.30, 0.45, 0.20), (0.78, 0.52, 0.28), (0.98, 0.40, 0.62), (0.90, 0.28, 0.88)]], 0.115, fur)
    parts["Tail"] = [tail]

    rig = build_rig(parts)
    return rig


def build_rig(parts):
    arm = bpy.data.armatures.new("CatRig")
    rig = bpy.data.objects.new("CatRig", arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = eb[parent]
        return b

    bone("Root", (0, 0, 0), (0, 0.5, 0))
    bone("Body", (0, 0.05, 0.1), (0, 0.05, 0.9), "Root")
    bone("Head", (0, 0.0, 0.95), (0, 0.0, 2.2), "Body")
    for side, sx in (("L", 1), ("R", -1)):
        bone(f"Ear.{side}", (0.62 * sx, 0.1, 2.2), (0.85 * sx, 0.1, 2.75), "Head")
        bone(f"Arm.{side}", (0.48 * sx, -0.2, 0.72), (0.52 * sx, -0.35, 0.25), "Body")
        bone(f"Leg.{side}", (0.30 * sx, -0.2, 0.30), (0.30 * sx, -0.45, 0.06), "Root")
    bone("Tail", (0.30, 0.45, 0.20), (0.90, 0.28, 0.88), "Body")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    for bname, objs in parts.items():
        for o in objs:
            mw = o.matrix_world.copy()
            o.parent = rig
            o.parent_type = "BONE"
            o.parent_bone = bname
            o.matrix_world = mw
    return rig


# ---------------------------------------------------------------- scene
def scene_setup():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"
        sc.cycles.device = "GPU"
    except Exception as e:  # shortcut: falls back to CPU silently-ish, fine for a 512px still
        print("GPU setup failed, using CPU:", e)
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.35

    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.58, 0.65, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    sc.world = world

    def area(name, loc, energy, size, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.size, d.color = energy, size, color
        o = bpy.data.objects.new(name, d)
        o.location = loc
        sc.collection.objects.link(o)
        aim(o, Vector((0, 0, 1.1)))

    area("Key", (-3.5, -4.5, 4.5), 900, 4.0, (1.0, 0.97, 0.93))
    area("Fill", (4.5, -3.5, 1.5), 300, 5.0, (0.92, 0.95, 1.0))
    area("Rim", (2.5, 4.5, 4.0), 700, 3.0)

    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 85
    cam.location = (2.7, -7.8, 2.7)
    sc.collection.objects.link(cam)
    aim(cam, Vector((0.05, 0.0, 1.30)))
    sc.camera = cam


def aim(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


# ---------------------------------------------------------------- render
def render_still(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_turntable(rig, gif_path, frames=32, size=256):
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.cycles.samples = 48
    tmp = tempfile.mkdtemp(prefix="cat_tt_")
    for i in range(frames):
        rig.rotation_euler = (0, 0, math.radians(360 * i / frames))
        render_still(os.path.join(tmp, f"f{i:03d}.png"))
    rig.rotation_euler = (0, 0, 0)
    ff = shutil.which("ffmpeg")
    if not ff:
        print("ffmpeg not found; turntable frames left in", tmp)
        return
    pal = os.path.join(tmp, "pal.png")
    src = os.path.join(tmp, "f%03d.png")
    subprocess.run([ff, "-y", "-v", "error", "-i", src, "-vf", "palettegen=reserve_transparent=1", pal], check=True)
    subprocess.run([ff, "-y", "-v", "error", "-framerate", "12", "-i", src, "-i", pal,
                    "-lavfi", "paletteuse=alpha_threshold=128", "-loop", "0", gif_path], check=True)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    rig = build()
    scene_setup()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "cat.blend"))
    assert {"Head", "Body", "Ear.L", "Ear.R", "Tail"} <= set(rig.data.bones.keys())
    if "--no-render" not in ARGS:
        render_still(os.path.join(HERE, "preview.png"))
    if "--turntable" in ARGS:
        render_turntable(rig, os.path.join(HERE, "turntable.gif"))
