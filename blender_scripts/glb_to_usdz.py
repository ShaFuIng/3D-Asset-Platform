# Runs inside Blender's embedded Python (bpy), not a normal interpreter.
# Invoked by backend/app/services/blender_client.py as:
#   blender --background --factory-startup --python glb_to_usdz.py -- <input.glb> <output.usdz>
#
# Gotcha (verified empirically, 2026-08-08): Blender does NOT turn an
# unhandled exception in a --python script into a non-zero process exit
# code by default -- it prints the traceback and still exits 0. The
# try/except + explicit sys.exit(1) below is required for the caller to be
# able to detect a failed conversion from the subprocess return code.
import sys

import bpy


def main() -> None:
    argv = sys.argv
    separator_index = argv.index("--")
    input_path, output_path = argv[separator_index + 1 :]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=input_path)
    bpy.ops.wm.usd_export(
        filepath=output_path,
        export_materials=True,
        export_textures_mode="NEW",
        overwrite_textures=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - must reach Blender's process exit code
        print(f"glb_to_usdz failed: {exc}", file=sys.stderr)
        sys.exit(1)
