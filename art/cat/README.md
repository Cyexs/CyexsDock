# CyexsDock 3D cat

Procedural Blender model of the brand cat (`public/cyexsdock.png`).

## Rebuild and re-render

From the repo root:

```sh
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup --python art/cat/build_cat.py -- --turntable
```

- Rebuilds `cat.blend` from scratch, renders `preview.png` (512x512, transparent) and `turntable.gif` (32 frames, 256 px).
- `--no-render`: only save `cat.blend`. Without `--turntable` only the preview is rendered.
- Needs `ffmpeg` on PATH for the GIF. Delete `cat.blend1` if Blender leaves one.
- Render: Cycles, GPU (OptiX), 96 samples + denoise for the still, 48 for the turntable. About 7 s for the preview, about 35 s total with the turntable on an RTX 5070 Laptop.

## Rig

Armature `CatRig`, bones: `Root`, `Body`, `Head`, `Ear.L`, `Ear.R`, `Arm.L`, `Arm.R`, `Leg.L`, `Leg.R`, `Tail`.
Each mesh part is bone-parented (rigid), so posing a bone moves its part:

- `Head`: head, eyes, eye shines, cheeks, mouth
- `Ear.L/R`: ear and pink inner ear
- `Body`, `Arm.L/R`, `Leg.L/R` (feet), `Tail`

Face shape and proportions are constants at the top of `build_cat.py` (`HEAD_C`, `HEAD_S`, `BODY_C`, `BODY_S`). Edit the script, not the .blend, then rebuild.
