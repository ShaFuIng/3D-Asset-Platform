import asyncio

import pytest

from app.errors import ApiError
from app.services import blender_client as blender_client_module
from app.services.blender_client import BlenderClient, BlenderClientError


VALID_USDZ_BYTES = b"PK\x03\x04" + b"\x00" * 16


def configured_settings(settings, **overrides):
    return settings.__class__(
        **{**settings.__dict__, "blender_executable": "/opt/blender/blender", **overrides}
    )


class FakeProcess:
    def __init__(self, returncode: int, stdout: bytes = b"", stderr: bytes = b""):
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr
        self.killed = False
        self.waited = False

    async def communicate(self):
        return self._stdout, self._stderr

    def kill(self):
        self.killed = True

    async def wait(self):
        self.waited = True


def test_convert_glb_to_usdz_without_blender_configured_raises_error(settings, tmp_path):
    client = BlenderClient(settings)
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")

    with pytest.raises(BlenderClientError, match="BLENDER_EXECUTABLE is not configured"):
        asyncio.run(client.convert_glb_to_usdz(glb_path, tmp_path / "model.usdz"))


def test_convert_glb_to_usdz_missing_input_raises_error(settings, tmp_path):
    client = BlenderClient(configured_settings(settings))

    with pytest.raises(BlenderClientError, match="Input GLB file does not exist"):
        asyncio.run(
            client.convert_glb_to_usdz(tmp_path / "missing.glb", tmp_path / "model.usdz")
        )


def test_convert_glb_to_usdz_success_writes_valid_usdz(settings, tmp_path, monkeypatch):
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")
    destination = tmp_path / "out" / "model.usdz"

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(VALID_USDZ_BYTES)
        return FakeProcess(returncode=0)

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    asyncio.run(client.convert_glb_to_usdz(glb_path, destination))

    assert destination.read_bytes() == VALID_USDZ_BYTES


def test_convert_glb_to_usdz_nonzero_exit_raises_with_stderr_detail(settings, tmp_path, monkeypatch):
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeProcess(returncode=1, stderr=b"Traceback...\nglb_to_usdz failed: boom\n")

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    with pytest.raises(BlenderClientError, match="glb_to_usdz failed: boom"):
        asyncio.run(client.convert_glb_to_usdz(glb_path, tmp_path / "model.usdz"))


def test_convert_glb_to_usdz_invalid_output_raises_error(settings, tmp_path, monkeypatch):
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        # Exits 0 but never wrote anything to the destination -- this is
        # the scenario the exit-code check alone cannot catch, see
        # blender_scripts/glb_to_usdz.py's header comment.
        return FakeProcess(returncode=0)

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    with pytest.raises(BlenderClientError, match="did not produce a valid USDZ file"):
        asyncio.run(client.convert_glb_to_usdz(glb_path, tmp_path / "model.usdz"))


def test_convert_glb_to_usdz_timeout_raises_error(settings, tmp_path, monkeypatch):
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")
    fake_process = FakeProcess(returncode=0)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return fake_process

    async def fake_wait_for(awaitable, timeout):
        awaitable.close()  # avoid a "coroutine was never awaited" warning
        raise asyncio.TimeoutError()

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    monkeypatch.setattr(blender_client_module.asyncio, "wait_for", fake_wait_for)
    client = BlenderClient(configured_settings(settings, blender_conversion_timeout_seconds=0.01))

    with pytest.raises(BlenderClientError, match="Timed out converting GLB to USDZ"):
        asyncio.run(client.convert_glb_to_usdz(glb_path, tmp_path / "model.usdz"))

    assert fake_process.killed
    assert fake_process.waited


def test_ensure_available_without_blender_configured_returns_503(settings):
    client = BlenderClient(settings)

    with pytest.raises(ApiError) as exc_info:
        asyncio.run(client.ensure_available())

    assert exc_info.value.status_code == 503
    assert exc_info.value.code == "blender_unavailable"


def test_health_passes_when_version_check_succeeds(settings, monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeProcess(returncode=0, stdout=b"Blender 5.2.0 LTS\n")

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    asyncio.run(client.health())


def test_health_raises_when_version_check_exits_nonzero(settings, monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeProcess(returncode=1)

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    with pytest.raises(BlenderClientError, match="Blender executable is not runnable"):
        asyncio.run(client.health())


def test_convert_or_raise_skips_conversion_on_cache_hit(settings, tmp_path):
    destination = tmp_path / "cached.usdz"
    destination.write_bytes(VALID_USDZ_BYTES)
    # Deliberately unconfigured -- if convert_or_raise tried to convert
    # instead of returning early on the cache hit, this would raise.
    client = BlenderClient(settings)

    asyncio.run(client.convert_or_raise(tmp_path / "model.glb", destination))


def test_convert_or_raise_without_blender_configured_returns_api_error(settings, tmp_path):
    client = BlenderClient(settings)

    with pytest.raises(ApiError) as exc_info:
        asyncio.run(
            client.convert_or_raise(tmp_path / "model.glb", tmp_path / "out.usdz")
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.code == "blender_not_configured"


def test_convert_or_raise_success_writes_destination(settings, tmp_path, monkeypatch):
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")
    destination = tmp_path / "out.usdz"

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        destination.write_bytes(VALID_USDZ_BYTES)
        return FakeProcess(returncode=0)

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    asyncio.run(client.convert_or_raise(glb_path, destination))

    assert destination.read_bytes() == VALID_USDZ_BYTES


def test_convert_or_raise_conversion_failure_returns_api_error(settings, tmp_path, monkeypatch):
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(b"glTF-stub")

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeProcess(returncode=1, stderr=b"glb_to_usdz failed: boom\n")

    monkeypatch.setattr(
        blender_client_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    client = BlenderClient(configured_settings(settings))

    with pytest.raises(ApiError) as exc_info:
        asyncio.run(client.convert_or_raise(glb_path, tmp_path / "out.usdz"))

    assert exc_info.value.status_code == 502
    assert exc_info.value.code == "usdz_conversion_failed"
