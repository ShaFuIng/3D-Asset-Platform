import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath

from .errors import ApiError

IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
MODEL_MEDIA_TYPES = {
    ".glb": "model/gltf-binary",
}
KNOWN_IMAGE_PREFIXES = ("upload", "gpt", "edit", "qwen-front", "qwen-left", "qwen-back")
ASSET_SORTS = {
    "created_at_desc": "created_at DESC, asset_id DESC",
    "created_at_asc": "created_at ASC, asset_id ASC",
    "filename_asc": "filename ASC, asset_id ASC",
    "filename_desc": "filename DESC, asset_id DESC",
    "size_desc": "size_bytes DESC, asset_id DESC",
    "size_asc": "size_bytes ASC, asset_id ASC",
}

# Bump this and add the corresponding step to _MIGRATIONS below whenever the
# `assets` table needs a new column/index on a database that may already
# exist on disk. CREATE TABLE IF NOT EXISTS in initialize() is a no-op once
# the table exists, so that statement alone never applies schema changes to
# an existing assets.db -- this version + migration list is what actually
# does it.
#
# Version numbering (0/1 are historical, not a fresh choice -- see below):
#   0 -- a brand new database that has never run initialize() before
#        (PRAGMA user_version defaults to 0 and nothing has bumped it yet).
#   1 -- the schema every already-deployed assets.db is actually sitting at
#        today: no parent_asset_id column. Pre-migration-mechanism code
#        unconditionally set `PRAGMA user_version = 1` the first time it
#        ever ran initialize() (see git history), so this value is already
#        taken on every real database out there -- it is NOT available to
#        assign to the first real migration step. Treat 1 as a fixed,
#        pre-existing baseline, not as "the first migration".
#   2 -- adds parent_asset_id. This is the first version this migration
#        mechanism itself is responsible for reaching.
SCHEMA_VERSION = 2

# Keyed by the version a step upgrades *to*. Each step is a tuple of SQL
# statements applied in order; initialize() runs every step from the
# database's current PRAGMA user_version up to SCHEMA_VERSION, one version
# at a time, so user_version always reflects exactly how far migration got.
_MIGRATIONS: dict[int, tuple[str, ...]] = {
    2: ("ALTER TABLE assets ADD COLUMN parent_asset_id TEXT",),
}


@dataclass(frozen=True)
class AssetRecord:
    asset_id: str
    asset_type: str
    filename: str
    relative_path: str
    media_type: str
    source: str
    created_at: str
    deleted_at: str | None
    size_bytes: int
    status: str
    parent_image_id: str | None = None
    pipeline: str | None = None
    model_variant: str | None = None
    related_job_id: str | None = None
    reference_image_id: str | None = None
    view_name: str | None = None
    original_filename: str | None = None
    parent_asset_id: str | None = None


class AssetCatalog:
    def __init__(self, storage_root: Path, db_path: Path | None = None) -> None:
        self.storage_root = storage_root.resolve()
        self.db_path = db_path or self.storage_root / "assets.db"
        self._lock = threading.RLock()
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    asset_id TEXT PRIMARY KEY,
                    asset_type TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    relative_path TEXT NOT NULL UNIQUE,
                    media_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    deleted_at TEXT,
                    size_bytes INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    parent_image_id TEXT,
                    pipeline TEXT,
                    model_variant TEXT,
                    related_job_id TEXT,
                    reference_image_id TEXT,
                    view_name TEXT,
                    original_filename TEXT,
                    parent_asset_id TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_assets_type_deleted
                    ON assets(asset_type, deleted_at);
                CREATE INDEX IF NOT EXISTS idx_assets_parent_image_id
                    ON assets(parent_image_id);
                CREATE INDEX IF NOT EXISTS idx_assets_reference_image_id
                    ON assets(reference_image_id);
                CREATE INDEX IF NOT EXISTS idx_assets_related_job_id
                    ON assets(related_job_id);
                """
            )
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            while version < SCHEMA_VERSION:
                next_version = version + 1
                for statement in _MIGRATIONS.get(next_version, ()):
                    _apply_migration_statement(connection, statement)
                # PRAGMA doesn't support parameter binding; next_version is
                # our own int constant from _MIGRATIONS, never user input.
                connection.execute(f"PRAGMA user_version = {next_version}")
                version = next_version

    def reconcile(self, images_dir: Path, models_dir: Path) -> None:
        images_dir.mkdir(parents=True, exist_ok=True)
        models_dir.mkdir(parents=True, exist_ok=True)
        seen: set[str] = set()
        with self._lock:
            for path in self._iter_supported_files(images_dir, IMAGE_MEDIA_TYPES):
                relative_path = self.relative_path_for(path)
                seen.add(relative_path)
                self._reconcile_file(
                    path,
                    relative_path,
                    asset_type="image",
                    media_type=IMAGE_MEDIA_TYPES[path.suffix.lower()],
                    source="legacy",
                )
            for path in self._iter_supported_files(models_dir, MODEL_MEDIA_TYPES):
                relative_path = self.relative_path_for(path)
                seen.add(relative_path)
                self._reconcile_file(
                    path,
                    relative_path,
                    asset_type="model",
                    media_type=MODEL_MEDIA_TYPES[path.suffix.lower()],
                    source="legacy",
                    pipeline="legacy",
                    model_variant="unknown",
                )
            for record in self.list_assets():
                if record.relative_path not in seen:
                    self.mark_missing(record.asset_id)

    def get_asset(self, asset_id: str) -> AssetRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM assets WHERE asset_id = ?", (asset_id,)).fetchone()
        return _record_from_row(row) if row else None

    def get_asset_by_relative_path(self, relative_path: str) -> AssetRecord | None:
        safe_relative_path = self.normalize_relative_path(relative_path)
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM assets WHERE relative_path = ?",
                (safe_relative_path,),
            ).fetchone()
        return _record_from_row(row) if row else None

    def list_assets(
        self,
        *,
        asset_type: str | None = None,
        state: str | None = None,
        status: str | None = None,
        source: str | None = None,
        pipeline: str | None = None,
        search: str | None = None,
        sort: str = "created_at_desc",
        page: int | None = None,
        page_size: int | None = None,
    ) -> list[AssetRecord]:
        sql, params = self._list_query(
            asset_type=asset_type,
            state=state,
            status=status,
            source=source,
            pipeline=pipeline,
            search=search,
            sort=sort,
        )
        if page is not None and page_size is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([str(page_size), str((page - 1) * page_size)])
        with self._lock, self._connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [_record_from_row(row) for row in rows]

    def count_assets(
        self,
        *,
        asset_type: str | None = None,
        state: str | None = None,
        status: str | None = None,
        source: str | None = None,
        pipeline: str | None = None,
        search: str | None = None,
    ) -> int:
        clauses, params = self._filter_clauses(
            asset_type=asset_type,
            state=state,
            status=status,
            source=source,
            pipeline=pipeline,
            search=search,
        )
        sql = "SELECT COUNT(*) FROM assets"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        with self._lock, self._connect() as connection:
            return int(connection.execute(sql, params).fetchone()[0])

    def trash_asset(self, asset_id: str) -> AssetRecord | None:
        current = self.get_asset(asset_id)
        if current is None:
            return None
        if current.deleted_at is None:
            with self._lock, self._connect() as connection:
                connection.execute(
                    "UPDATE assets SET deleted_at = ? WHERE asset_id = ?",
                    (_utc_now(), asset_id),
                )
        return self.get_asset(asset_id)

    def restore_asset(self, asset_id: str) -> AssetRecord | None:
        current = self.get_asset(asset_id)
        if current is None:
            return None
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE assets SET deleted_at = NULL, status = 'available' WHERE asset_id = ?",
                (asset_id,),
            )
        return self.get_asset(asset_id)

    def delete_asset_record(self, asset_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM assets WHERE asset_id = ?", (asset_id,))

    def _list_query(
        self,
        *,
        asset_type: str | None = None,
        state: str | None = None,
        status: str | None = None,
        source: str | None = None,
        pipeline: str | None = None,
        search: str | None = None,
        sort: str = "created_at_desc",
    ) -> tuple[str, list[str]]:
        if sort not in ASSET_SORTS:
            raise ApiError(400, "invalid_sort", "Invalid asset sort.")
        clauses, params = self._filter_clauses(
            asset_type=asset_type,
            state=state,
            status=status,
            source=source,
            pipeline=pipeline,
            search=search,
        )
        sql = "SELECT * FROM assets"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += f" ORDER BY {ASSET_SORTS[sort]}"
        return sql, params

    def _filter_clauses(
        self,
        *,
        asset_type: str | None = None,
        state: str | None = None,
        status: str | None = None,
        source: str | None = None,
        pipeline: str | None = None,
        search: str | None = None,
    ) -> tuple[list[str], list[str]]:
        clauses = []
        params: list[str] = []
        if asset_type is not None:
            clauses.append("asset_type = ?")
            params.append(asset_type)
        if state == "active":
            clauses.append("deleted_at IS NULL")
        elif state == "trash":
            clauses.append("deleted_at IS NOT NULL")
        elif state is not None:
            raise ApiError(400, "invalid_state", "Invalid asset state.")
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        if source is not None:
            clauses.append("source = ?")
            params.append(source)
        if pipeline is not None:
            clauses.append("pipeline = ?")
            params.append(pipeline)
        if search:
            clauses.append("(filename LIKE ? OR original_filename LIKE ?)")
            pattern = f"%{search}%"
            params.extend([pattern, pattern])
        return clauses, params

    def find_children(self, parent_image_id: str) -> list[AssetRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM assets WHERE parent_image_id = ?",
                (parent_image_id,),
            ).fetchall()
        return [_record_from_row(row) for row in rows]

    def find_references(self, reference_image_id: str) -> list[AssetRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM assets WHERE reference_image_id = ?",
                (reference_image_id,),
            ).fetchall()
        return [_record_from_row(row) for row in rows]

    def upsert_asset(self, record: AssetRecord) -> AssetRecord:
        self.normalize_relative_path(record.relative_path)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO assets (
                    asset_id, asset_type, filename, relative_path, media_type, source,
                    created_at, deleted_at, size_bytes, status, parent_image_id,
                    pipeline, model_variant, related_job_id, reference_image_id,
                    view_name, original_filename, parent_asset_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(relative_path) DO UPDATE SET
                    filename = excluded.filename,
                    media_type = excluded.media_type,
                    source = excluded.source,
                    size_bytes = excluded.size_bytes,
                    status = excluded.status,
                    parent_image_id = excluded.parent_image_id,
                    pipeline = excluded.pipeline,
                    model_variant = excluded.model_variant,
                    related_job_id = excluded.related_job_id,
                    reference_image_id = excluded.reference_image_id,
                    view_name = excluded.view_name,
                    original_filename = excluded.original_filename,
                    -- Unlike every other column above, a plain
                    -- `= excluded.parent_asset_id` would clobber an
                    -- already-set value back to NULL on every reconcile()
                    -- upsert that wasn't explicitly told about it (most
                    -- callers construct a fresh AssetRecord() and never
                    -- pass parent_asset_id, so it defaults to None). Keep
                    -- the existing value unless this upsert explicitly
                    -- provides a new one.
                    parent_asset_id = COALESCE(excluded.parent_asset_id, assets.parent_asset_id)
                """,
                _record_values(record),
            )
        return self.get_asset_by_relative_path(record.relative_path) or record

    def mark_missing(self, asset_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE assets SET status = 'missing' WHERE asset_id = ?",
                (asset_id,),
            )

    def mark_deleted(self, asset_id: str, deleted_at: str | None = None) -> None:
        timestamp = deleted_at or _utc_now()
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE assets SET deleted_at = ? WHERE asset_id = ?",
                (timestamp, asset_id),
            )

    def resolve_relative_path(self, relative_path: str) -> Path:
        safe_relative_path = self.normalize_relative_path(relative_path)
        path = (self.storage_root / safe_relative_path).resolve()
        if not path.is_relative_to(self.storage_root):
            raise ApiError(400, "invalid_path", "Invalid asset path.")
        return path

    def relative_path_for(self, path: Path) -> str:
        resolved = path.resolve()
        if not resolved.is_relative_to(self.storage_root):
            raise ApiError(400, "invalid_path", "Invalid asset path.")
        return resolved.relative_to(self.storage_root).as_posix()

    def normalize_relative_path(self, relative_path: str) -> str:
        if not relative_path or Path(relative_path).is_absolute():
            raise ApiError(400, "invalid_path", "Invalid asset path.")
        if PureWindowsPath(relative_path).drive:
            raise ApiError(400, "invalid_path", "Invalid asset path.")
        pure_path = PurePosixPath(relative_path.replace("\\", "/"))
        if pure_path.is_absolute() or any(part in {"", ".", ".."} for part in pure_path.parts):
            raise ApiError(400, "invalid_path", "Invalid asset path.")
        return pure_path.as_posix()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _iter_supported_files(self, directory: Path, media_types: dict[str, str]):
        for path in directory.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in media_types:
                continue
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if not resolved.is_relative_to(self.storage_root):
                continue
            yield path

    def _reconcile_file(
        self,
        path: Path,
        relative_path: str,
        *,
        asset_type: str,
        media_type: str,
        source: str,
        pipeline: str | None = None,
        model_variant: str | None = None,
    ) -> None:
        current = self.get_asset_by_relative_path(relative_path)
        stat = path.stat()
        if current is not None:
            updated = AssetRecord(
                **{
                    **current.__dict__,
                    "filename": path.name,
                    "media_type": media_type,
                    "size_bytes": stat.st_size,
                    "status": "available",
                }
            )
            self.upsert_asset(updated)
            return

        asset_id = self._new_asset_id(path, asset_type)
        record = AssetRecord(
            asset_id=asset_id,
            asset_type=asset_type,
            filename=path.name,
            relative_path=relative_path,
            media_type=media_type,
            source=source,
            created_at=_file_created_at(path),
            deleted_at=None,
            size_bytes=stat.st_size,
            status="available",
            pipeline=pipeline,
            model_variant=model_variant,
        )
        self.upsert_asset(record)

    def _new_asset_id(self, path: Path, asset_type: str) -> str:
        if asset_type == "image":
            asset_id = _known_image_uuid(path.name)
            if asset_id is not None:
                existing = self.get_asset(asset_id)
                if existing is None or existing.relative_path == self.relative_path_for(path):
                    return asset_id
        return str(uuid.uuid4())


def _apply_migration_statement(connection: sqlite3.Connection, statement: str) -> None:
    try:
        connection.execute(statement)
    except sqlite3.OperationalError as exc:
        # Re-running a migration against a DB that already has it applied
        # (e.g. initialize() called again on backend restart) must be a
        # safe no-op, not a crash. SQLite's ALTER TABLE ADD COLUMN raises
        # exactly this message when the column already exists; anything
        # else is a real failure and should still surface.
        if "duplicate column name" not in str(exc):
            raise


def _known_image_uuid(filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix not in IMAGE_MEDIA_TYPES:
        return None
    stem = Path(filename).stem
    for prefix in KNOWN_IMAGE_PREFIXES:
        token = f"{prefix}-"
        if not stem.startswith(token):
            continue
        candidate = stem[len(token) :]
        try:
            return str(uuid.UUID(candidate))
        except ValueError:
            return None
    return None


def _file_created_at(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_ctime, timezone.utc).isoformat()
    except OSError:
        return _utc_now()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_from_row(row: sqlite3.Row) -> AssetRecord:
    return AssetRecord(**{key: row[key] for key in row.keys()})


def _record_values(record: AssetRecord) -> tuple:
    return (
        record.asset_id,
        record.asset_type,
        record.filename,
        record.relative_path,
        record.media_type,
        record.source,
        record.created_at,
        record.deleted_at,
        record.size_bytes,
        record.status,
        record.parent_image_id,
        record.pipeline,
        record.model_variant,
        record.related_job_id,
        record.reference_image_id,
        record.view_name,
        record.original_filename,
        record.parent_asset_id,
    )
