"""
Archive conversion logic supporting ZIP, TAR, TAR.GZ.
Uses Python stdlib only (zipfile, tarfile) — no system dependencies needed.
Requirements: 10.1, 10.4, 10.5, 10.6
"""
from __future__ import annotations
import io
import tarfile
import time
import zipfile
from typing import Any, Dict, List, Optional, Tuple

# Maximum uncompressed size: 10 GB
MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024

# Supported archive formats
SUPPORTED_FORMATS = {"zip", "tar", "tar.gz", "tgz", "gz"}
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


def validate_format(fmt: str) -> bool:
    """Return True if fmt is a supported archive format."""
    return fmt.lower().strip() in SUPPORTED_FORMATS


def _open_tar(data: bytes, fmt: str) -> tarfile.TarFile:
    mode = "r:gz" if fmt in ("tar.gz", "tgz", "gz") else "r:"
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


def repack_archive(source_data: bytes, source_format: str, target_format: str) -> bytes:
    """
    Extract all files from source archive and repack into target format.
    Validates size limit before extraction.
    Requirements: 10.1
    """
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if not validate_format(src):
        raise UnsupportedFormatError(f"Unsupported source format: {source_format}")
    if tgt not in WRITABLE_FORMATS:
        raise UnsupportedFormatError(f"Cannot write format: {target_format}")

    uncompressed = estimate_uncompressed_size(source_data, src)
    check_size_limit(uncompressed)

    entries: List[Tuple[str, bytes]] = []
    if src == "zip":
        with zipfile.ZipFile(io.BytesIO(source_data)) as zf:
            for name in zf.namelist():
                if not name.endswith("/"):
                    entries.append((name, zf.read(name)))
    elif src in ("tar", "tar.gz", "tgz", "gz"):
        with _open_tar(source_data, src) as tf:
            for m in tf.getmembers():
                if m.isfile():
                    f = tf.extractfile(m)
                    if f:
                        entries.append((m.name, f.read()))

    if tgt == "zip":
        return create_zip_from_entries(entries)
    elif tgt in ("tar", "tar.gz", "tgz"):
        return create_tar_from_entries(entries, compress=tgt in ("tar.gz", "tgz"))
    raise UnsupportedFormatError(f"Cannot write format: {target_format}")
