import asyncio
from pathlib import Path

from ..config import Settings
from ..errors import ApiError


class BlenderClientError(Exception):
    pass


class BlenderClient:
    """Runs Blender headless as a subprocess to convert GLB to USDZ.

    Mirrors ComfyClient's shape (settings-driven client, a dedicated
    ...ClientError for low-level failures, ensure_available() wraps it into
    an ApiError for request-handling call sites) even though this talks to
    a local subprocess instead of an HTTP API.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def health(self) -> None:
        if not self.settings.blender_executable:
            raise BlenderClientError("BLENDER_EXECUTABLE is not configured.")
        try:
            process = await asyncio.create_subprocess_exec(
                self.settings.blender_executable,
                "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(process.communicate(), timeout=10.0)
        except (OSError, asyncio.TimeoutError) as exc:
            raise BlenderClientError("Blender executable is not runnable.") from exc
        if process.returncode != 0:
            raise BlenderClientError("Blender executable is not runnable.")

    async def ensure_available(self) -> None:
        try:
            await self.health()
        except BlenderClientError as exc:
            raise ApiError(
                503,
                "blender_unavailable",
                "Blender is not available for GLB to USDZ conversion.",
            ) from exc

    async def convert_glb_to_usdz(self, glb_path: Path, destination: Path) -> None:
        if not self.settings.blender_executable:
            raise BlenderClientError("BLENDER_EXECUTABLE is not configured.")
        if not glb_path.exists():
            raise BlenderClientError("Input GLB file does not exist.")

        destination.parent.mkdir(parents=True, exist_ok=True)
        command = [
            self.settings.blender_executable,
            "--background",
            "--factory-startup",
            "--python",
            str(self.settings.blender_glb_to_usdz_script_path),
            "--",
            str(glb_path),
            str(destination),
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            raise BlenderClientError("Failed to launch Blender.") from exc

        try:
            _stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.settings.blender_conversion_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            raise BlenderClientError("Timed out converting GLB to USDZ.") from exc

        # Blender does not turn an unhandled exception in a --python script
        # into a non-zero exit code by default; glb_to_usdz.py explicitly
        # calls sys.exit(1) on failure so this check is meaningful. See
        # blender_scripts/glb_to_usdz.py for the verified gotcha.
        if process.returncode != 0:
            detail_lines = stderr.decode("utf-8", errors="replace").strip().splitlines()
            detail = detail_lines[-1] if detail_lines else "Blender exited with an error."
            raise BlenderClientError(f"Blender GLB to USDZ conversion failed: {detail}")

        if not self._is_valid_usdz(destination):
            raise BlenderClientError("Blender did not produce a valid USDZ file.")

    @staticmethod
    def _is_valid_usdz(path: Path) -> bool:
        try:
            if not path.exists() or path.stat().st_size == 0:
                return False
            with path.open("rb") as file:
                magic = file.read(4)
        except OSError:
            return False
        # USDZ is a zip archive with its entries stored uncompressed; a
        # standard zip local-file-header magic is enough to catch an
        # empty/garbage output without re-implementing zip parsing here.
        return magic == b"PK\x03\x04"
