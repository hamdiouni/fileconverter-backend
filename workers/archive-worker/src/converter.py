"""
Archive conversion logic supporting ZIP, TAR, TAR.GZ.
Uses Python stdlib only (zipfile, tarfile) — no system dependencies needed.
Requirements: 10.1, 10.4, 10.5, 10.6
"""
from __future__ import annotations
import io
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
import zipfile
from typing import Any, Dict, List, Optional, Tuple

# Maximum uncompressed size: 10 GB
MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024
# Maximum file count in a single archive to prevent inode/memory exhaustion
MAX_FILE_COUNT = 50_000
# Maximum compression ratio (uncompressed : compressed) to detect zip bombs
MAX_COMPRESSION_RATIO = 200

# Supported archive formats
SUPPORTED_FORMATS = {"zip", "tar", "tar.gz", "tgz", "gz", "bz2", "tar.bz2", "xz", "tar.xz", "7z", "rar"}
WRITABLE_FORMATS = {"zip", "tar", "tar.gz", "tgz"}


class ArchiveConversionError(Exception):
    pass

class UnsupportedFormatError(ArchiveConversionError):
    pass

class ArchiveTooLargeError(ArchiveConversionError):
    """Raised when uncompressed size exceeds MAX_UNCOMPRESSED_BYTES."""
    pass

class ArchiveIntegrityError(ArchiveConversionError):
    """Raised when archive is corrupted or unreadable."""
    pass

class ArchiveSecurityError(ArchiveConversionError):
    """Raised when an archive security check fails (path traversal, zip bomb ratio, etc)."""
    pass


def sanitize_entry_name(name: str) -> str:
    """
    Sanitize archive member path to prevent path traversal / Zip Slip.
    Rejects absolute paths, drive letters, and '..' path components.
    """
    clean = name.replace("\\", "/").strip()
    if len(clean) >= 2 and clean[1] == ":":
        clean = clean[2:]
    clean = clean.lstrip("/")

    parts = [p for p in clean.split("/") if p and p != "."]
    for p in parts:
        if p == "..":
            raise ArchiveSecurityError(f"Path traversal detected in archive entry: {name}")

    if not parts:
        raise ArchiveSecurityError(f"Invalid empty archive entry name: {name}")

    return "/".join(parts)


def validate_archive_safety(archive_size: int, total_uncompressed: int, file_count: int) -> None:
    """Validate archive against zip bomb thresholds."""
    if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
        gb = total_uncompressed / (1024 ** 3)
        raise ArchiveTooLargeError(
            f"Uncompressed size {gb:.2f} GB exceeds maximum allowed 10 GB"
        )
    if file_count > MAX_FILE_COUNT:
        raise ArchiveSecurityError(
            f"Archive file count {file_count} exceeds maximum allowed {MAX_FILE_COUNT}"
        )
    if archive_size > 0 and (total_uncompressed / archive_size) > MAX_COMPRESSION_RATIO:
        ratio = total_uncompressed / archive_size
        raise ArchiveSecurityError(
            f"Suspicious compression ratio {ratio:.1f}:1 exceeds maximum allowed {MAX_COMPRESSION_RATIO}:1"
        )


def validate_format(fmt: str) -> bool:
    """Return True if fmt is a supported archive format."""
    return fmt.lower().strip() in SUPPORTED_FORMATS


def _open_tar(data: bytes, fmt: str) -> tarfile.TarFile:
    if fmt in ("tar.gz", "tgz", "gz"):
        mode = "r:gz"
    elif fmt in ("tar.bz2", "bz2"):
        mode = "r:bz2"
    elif fmt in ("tar.xz", "xz"):
        mode = "r:xz"
    else:
        mode = "r:*"
    return tarfile.open(fileobj=io.BytesIO(data), mode=mode)


def estimate_uncompressed_size(archive_data: bytes, source_format: str) -> int:
    """
    Return total uncompressed byte count of all entries.
    Requirements: 10.4
    """
    fmt = source_format.lower().strip()
    try:
        if fmt == "zip":
            with zipfile.ZipFile(io.BytesIO(archive_data)) as zf:
                return sum(i.file_size for i in zf.infolist())
        elif fmt in ("tar", "tar.gz", "tgz", "gz"):
            with _open_tar(archive_data, fmt) as tf:
                return sum(m.size for m in tf.getmembers())
        return 0
    except zipfile.BadZipFile as e:
        raise ArchiveIntegrityError(f"Bad ZIP: {e}") from e
    except tarfile.TarError as e:
        raise ArchiveIntegrityError(f"Bad TAR: {e}") from e


def check_size_limit(uncompressed_bytes: int) -> None:
    """
    Raise ArchiveTooLargeError if size exceeds MAX_UNCOMPRESSED_BYTES (10 GB).
    Requirements: 10.4
    """
    if uncompressed_bytes > MAX_UNCOMPRESSED_BYTES:
        gb = uncompressed_bytes / (1024 ** 3)
        raise ArchiveTooLargeError(
            f"Uncompressed size {gb:.2f} GB exceeds maximum allowed 10 GB"
        )


def list_archive_entries(archive_data: bytes, source_format: str) -> List[Dict[str, Any]]:
    """
    List entries with metadata: name, size, is_dir, modified_time, mode.
    Requirements: 10.6
    """
    fmt = source_format.lower().strip()
    entries: List[Dict[str, Any]] = []
    try:
        if fmt == "zip":
            with zipfile.ZipFile(io.BytesIO(archive_data)) as zf:
                for info in zf.infolist():
                    entries.append({
                        "name": info.filename,
                        "size": info.file_size,
                        "modified_time": time.mktime(info.date_time + (0, 0, -1)),
                        "is_dir": info.filename.endswith("/"),
                        "mode": None,
                    })
        elif fmt in ("tar", "tar.gz", "tgz", "gz"):
            with _open_tar(archive_data, fmt) as tf:
                for m in tf.getmembers():
                    entries.append({
                        "name": m.name,
                        "size": m.size,
                        "modified_time": m.mtime,
                        "is_dir": m.isdir(),
                        "mode": m.mode,
                    })
    except zipfile.BadZipFile as e:
        raise ArchiveIntegrityError(f"Bad ZIP: {e}") from e
    except tarfile.TarError as e:
        raise ArchiveIntegrityError(f"Bad TAR: {e}") from e
    return entries


def create_zip_from_entries(entries: List[Tuple[str, bytes]]) -> bytes:
    """Create a ZIP archive from (name, data) tuples. Requirements: 10.1"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def create_tar_from_entries(entries: List[Tuple[str, bytes]], compress: bool = False) -> bytes:
    """Create a TAR (optionally gzipped) from (name, data) tuples. Requirements: 10.1"""
    buf = io.BytesIO()
    mode = "w:gz" if compress else "w:"
    with tarfile.open(fileobj=buf, mode=mode) as tf:
        for name, data in entries:
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def extract_7z_or_rar(source_data: bytes, fmt: str) -> List[Tuple[str, bytes]]:
    """Extract files from 7z or rar archive using system 7z/unar utility."""
    cmd = shutil.which("7z") or shutil.which("unar")
    if not cmd:
        raise UnsupportedFormatError(
            f"Extraction of format '{fmt}' requires '7z' or 'unar' CLI tool which is not installed"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        input_file = os.path.join(tmpdir, f"input.{fmt}")
        with open(input_file, "wb") as f:
            f.write(source_data)

        out_dir = os.path.join(tmpdir, "extracted")
        os.makedirs(out_dir, exist_ok=True)

        if "7z" in os.path.basename(cmd):
            res = subprocess.run(
                [cmd, "x", "-y", f"-o{out_dir}", input_file],
                capture_output=True, timeout=120
            )
        else:
            res = subprocess.run(
                [cmd, "-o", out_dir, "-f", input_file],
                capture_output=True, timeout=120
            )

        if res.returncode != 0:
            raise ArchiveIntegrityError(f"Failed to extract {fmt} archive: {res.stderr.decode()[:300]}")

        entries: List[Tuple[str, bytes]] = []
        total_size = 0
        file_count = 0

        for root, _, filenames in os.walk(out_dir):
            for fname in filenames:
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, out_dir).replace("\\", "/")
                safe_name = sanitize_entry_name(rel_path)
                with open(full_path, "rb") as ef:
                    data = ef.read()
                total_size += len(data)
                file_count += 1
                validate_archive_safety(len(source_data), total_size, file_count)
                entries.append((safe_name, data))

        return entries


def repack_archive(source_data: bytes, source_format: str, target_format: str) -> bytes:
    """
    Extract all files from source archive and repack into target format.
    Validates size limit and path safety before and during extraction.
    Requirements: 10.1, 10.4
    """
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if not validate_format(src):
        raise UnsupportedFormatError(f"Unsupported source format: {source_format}")
    if tgt not in WRITABLE_FORMATS:
        raise UnsupportedFormatError(f"Cannot write format: {target_format}")

    uncompressed = estimate_uncompressed_size(source_data, src)
    if uncompressed > 0:
        check_size_limit(uncompressed)

    entries: List[Tuple[str, bytes]] = []
    total_size = 0
    if src == "zip":
        with zipfile.ZipFile(io.BytesIO(source_data)) as zf:
            for info in zf.infolist():
                if not info.filename.endswith("/"):
                    safe_name = sanitize_entry_name(info.filename)
                    data = zf.read(info)
                    total_size += len(data)
                    validate_archive_safety(len(source_data), total_size, len(entries) + 1)
                    entries.append((safe_name, data))
    elif src in ("tar", "tar.gz", "tgz", "gz", "bz2", "tar.bz2", "xz", "tar.xz"):
        with _open_tar(source_data, src) as tf:
            for m in tf.getmembers():
                if m.isfile():
                    safe_name = sanitize_entry_name(m.name)
                    f = tf.extractfile(m)
                    if f:
                        data = f.read()
                        total_size += len(data)
                        validate_archive_safety(len(source_data), total_size, len(entries) + 1)
                        entries.append((safe_name, data))
    elif src in ("7z", "rar"):
        entries = extract_7z_or_rar(source_data, src)

    if tgt == "zip":
        return create_zip_from_entries(entries)
    elif tgt in ("tar", "tar.gz", "tgz"):
        return create_tar_from_entries(entries, compress=tgt in ("tar.gz", "tgz"))
    raise UnsupportedFormatError(f"Cannot write format: {target_format}")
