"""
Unit tests for archive conversion logic.
Requirements: 10.1, 10.4, 10.6
"""
from __future__ import annotations
import io
import tarfile
import time
import zipfile

import pytest

from src.converter import (
    MAX_UNCOMPRESSED_BYTES,
    SUPPORTED_FORMATS,
    ArchiveIntegrityError,
    ArchiveTooLargeError,
    UnsupportedFormatError,
    check_size_limit,
    create_tar_from_entries,
    create_zip_from_entries,
    estimate_uncompressed_size,
    list_archive_entries,
    repack_archive,
    validate_format,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def make_tar(entries: list[tuple[str, bytes]], compress: bool = False) -> bytes:
    buf = io.BytesIO()
    mode = "w:gz" if compress else "w:"
    with tarfile.open(fileobj=buf, mode=mode) as tf:
        for name, data in entries:
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


SAMPLE_ENTRIES = [
    ("file1.txt", b"Hello, World!"),
    ("dir/file2.txt", b"Nested file content"),
    ("data.json", b'{"key": "value"}'),
]


# ─── TestValidateFormat ───────────────────────────────────────────────────────

class TestValidateFormat:
    """Requirements: 10.1 — supported format checking."""

    def test_zip_is_supported(self):
        assert validate_format("zip") is True

    def test_tar_is_supported(self):
        assert validate_format("tar") is True

    def test_tar_gz_is_supported(self):
        assert validate_format("tar.gz") is True

    def test_tgz_is_supported(self):
        assert validate_format("tgz") is True

    def test_gz_is_supported(self):
        assert validate_format("gz") is True

    def test_mp4_is_not_supported(self):
        assert validate_format("mp4") is False

    def test_jpg_is_not_supported(self):
        assert validate_format("jpg") is False

    def test_empty_string_is_not_supported(self):
        assert validate_format("") is False

    def test_unknown_format_is_not_supported(self):
        assert validate_format("xyz_unknown") is False

    def test_case_insensitive_zip(self):
        assert validate_format("ZIP") is True

    def test_case_insensitive_tar(self):
        assert validate_format("TAR") is True

    def test_whitespace_stripped(self):
        assert validate_format("  zip  ") is True


# ─── TestEstimateUncompressedSize ─────────────────────────────────────────────

class TestEstimateUncompressedSize:
    """Requirements: 10.4 — size validation before extraction."""

    def test_zip_size_matches_total_content(self):
        data = make_zip(SAMPLE_ENTRIES)
        total = sum(len(c) for _, c in SAMPLE_ENTRIES)
        assert estimate_uncompressed_size(data, "zip") == total

    def test_tar_size_matches_total_content(self):
        data = make_tar(SAMPLE_ENTRIES)
        total = sum(len(c) for _, c in SAMPLE_ENTRIES)
        assert estimate_uncompressed_size(data, "tar") == total

    def test_tar_gz_size_matches_total_content(self):
        data = make_tar(SAMPLE_ENTRIES, compress=True)
        total = sum(len(c) for _, c in SAMPLE_ENTRIES)
        assert estimate_uncompressed_size(data, "tar.gz") == total

    def test_tgz_matches_tar_gz(self):
        data = make_tar(SAMPLE_ENTRIES, compress=True)
        total = sum(len(c) for _, c in SAMPLE_ENTRIES)
        assert estimate_uncompressed_size(data, "tgz") == total

    def test_empty_zip_returns_zero(self):
        data = make_zip([])
        assert estimate_uncompressed_size(data, "zip") == 0

    def test_empty_tar_returns_zero(self):
        data = make_tar([])
        assert estimate_uncompressed_size(data, "tar") == 0

    def test_corrupt_zip_raises_integrity_error(self):
        with pytest.raises(ArchiveIntegrityError):
            estimate_uncompressed_size(b"not a zip file", "zip")

    def test_corrupt_tar_raises_integrity_error(self):
        with pytest.raises(ArchiveIntegrityError):
            estimate_uncompressed_size(b"not a tar file", "tar")

    def test_integrity_error_is_subclass_of_archive_conversion_error(self):
        from src.converter import ArchiveConversionError
        with pytest.raises(ArchiveConversionError):
            estimate_uncompressed_size(b"garbage", "zip")


# ─── TestCheckSizeLimit ────────────────────────────────────────────────────────

class TestCheckSizeLimit:
    """Requirements: 10.4 — 10 GB uncompressed size limit."""

    def test_size_under_limit_passes(self):
        check_size_limit(1 * 1024 * 1024 * 1024)  # 1 GB — should not raise

    def test_size_at_limit_minus_one_passes(self):
        check_size_limit(MAX_UNCOMPRESSED_BYTES - 1)  # just under 10 GB

    def test_size_over_limit_raises_too_large(self):
        with pytest.raises(ArchiveTooLargeError):
            check_size_limit(MAX_UNCOMPRESSED_BYTES + 1)

    def test_error_message_mentions_gb(self):
        with pytest.raises(ArchiveTooLargeError, match="GB"):
            check_size_limit(MAX_UNCOMPRESSED_BYTES + 1024)

    def test_zero_size_passes(self):
        check_size_limit(0)  # empty archive — should not raise

    def test_too_large_is_subclass_of_archive_conversion_error(self):
        from src.converter import ArchiveConversionError
        with pytest.raises(ArchiveConversionError):
            check_size_limit(MAX_UNCOMPRESSED_BYTES + 1)


# ─── TestListArchiveEntries ───────────────────────────────────────────────────

class TestListArchiveEntries:
    """Requirements: 10.6 — file metadata preservation."""

    def test_zip_entries_have_correct_names(self):
        data = make_zip(SAMPLE_ENTRIES)
        entries = list_archive_entries(data, "zip")
        names = {e["name"] for e in entries}
        for name, _ in SAMPLE_ENTRIES:
            assert name in names

    def test_zip_entries_have_correct_sizes(self):
        data = make_zip(SAMPLE_ENTRIES)
        entries = list_archive_entries(data, "zip")
        size_map = {e["name"]: e["size"] for e in entries}
        for name, content in SAMPLE_ENTRIES:
            assert size_map[name] == len(content)

    def test_tar_entries_have_correct_names(self):
        data = make_tar(SAMPLE_ENTRIES)
        entries = list_archive_entries(data, "tar")
        names = {e["name"] for e in entries}
        for name, _ in SAMPLE_ENTRIES:
            assert name in names

    def test_tar_entries_have_correct_sizes(self):
        data = make_tar(SAMPLE_ENTRIES)
        entries = list_archive_entries(data, "tar")
        size_map = {e["name"]: e["size"] for e in entries}
        for name, content in SAMPLE_ENTRIES:
            assert size_map[name] == len(content)

    def test_tar_file_entries_are_not_dirs(self):
        data = make_tar(SAMPLE_ENTRIES)
        entries = list_archive_entries(data, "tar")
        for e in entries:
            assert e["is_dir"] is False

    def test_tar_mode_field_present(self):
        data = make_tar(SAMPLE_ENTRIES)
        entries = list_archive_entries(data, "tar")
        for e in entries:
            assert "mode" in e

    def test_tar_gz_entries_correct(self):
        data = make_tar(SAMPLE_ENTRIES, compress=True)
        entries = list_archive_entries(data, "tar.gz")
        assert len(entries) == len(SAMPLE_ENTRIES)

    def test_corrupt_zip_raises_integrity_error(self):
        with pytest.raises(ArchiveIntegrityError):
            list_archive_entries(b"garbage", "zip")

    def test_corrupt_tar_raises_integrity_error(self):
        with pytest.raises(ArchiveIntegrityError):
            list_archive_entries(b"garbage", "tar")

    def test_empty_zip_returns_empty_list(self):
        data = make_zip([])
        assert list_archive_entries(data, "zip") == []


# ─── TestCreateZipFromEntries ─────────────────────────────────────────────────

class TestCreateZipFromEntries:
    """Requirements: 10.1 — ZIP creation."""

    def test_creates_readable_zip(self):
        result = create_zip_from_entries(SAMPLE_ENTRIES)
        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            assert zf.testzip() is None  # no bad files

    def test_all_entries_present(self):
        result = create_zip_from_entries(SAMPLE_ENTRIES)
        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            names = zf.namelist()
        for name, _ in SAMPLE_ENTRIES:
            assert name in names

    def test_entry_content_preserved(self):
        result = create_zip_from_entries(SAMPLE_ENTRIES)
        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            for name, expected in SAMPLE_ENTRIES:
                assert zf.read(name) == expected

    def test_empty_entries_creates_empty_zip(self):
        result = create_zip_from_entries([])
        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            assert zf.namelist() == []


# ─── TestCreateTarFromEntries ─────────────────────────────────────────────────

class TestCreateTarFromEntries:
    """Requirements: 10.1 — TAR creation."""

    def test_creates_readable_tar(self):
        result = create_tar_from_entries(SAMPLE_ENTRIES)
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:") as tf:
            assert len(tf.getmembers()) == len(SAMPLE_ENTRIES)

    def test_entry_content_preserved(self):
        result = create_tar_from_entries(SAMPLE_ENTRIES)
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:") as tf:
            for name, expected in SAMPLE_ENTRIES:
                member = tf.getmember(name)
                f = tf.extractfile(member)
                assert f is not None
                assert f.read() == expected

    def test_compress_true_creates_gzipped_tar(self):
        result = create_tar_from_entries(SAMPLE_ENTRIES, compress=True)
        # Should be readable as tar.gz
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:gz") as tf:
            assert len(tf.getmembers()) == len(SAMPLE_ENTRIES)

    def test_empty_entries_creates_empty_tar(self):
        result = create_tar_from_entries([])
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:") as tf:
            assert tf.getmembers() == []


# ─── TestRepackArchive ────────────────────────────────────────────────────────

class TestRepackArchive:
    """Requirements: 10.1 — format conversion."""

    def test_zip_to_tar(self):
        source = make_zip(SAMPLE_ENTRIES)
        result = repack_archive(source, "zip", "tar")
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:") as tf:
            names = {m.name for m in tf.getmembers()}
        for name, _ in SAMPLE_ENTRIES:
            assert name in names

    def test_zip_to_tar_gz(self):
        source = make_zip(SAMPLE_ENTRIES)
        result = repack_archive(source, "zip", "tar.gz")
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:gz") as tf:
            assert len(tf.getmembers()) == len(SAMPLE_ENTRIES)

    def test_tar_to_zip(self):
        source = make_tar(SAMPLE_ENTRIES)
        result = repack_archive(source, "tar", "zip")
        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            for name, expected in SAMPLE_ENTRIES:
                assert zf.read(name) == expected

    def test_tar_gz_to_zip(self):
        source = make_tar(SAMPLE_ENTRIES, compress=True)
        result = repack_archive(source, "tar.gz", "zip")
        with zipfile.ZipFile(io.BytesIO(result)) as zf:
            assert len(zf.namelist()) == len(SAMPLE_ENTRIES)

    def test_content_preserved_during_repack(self):
        source = make_zip(SAMPLE_ENTRIES)
        result = repack_archive(source, "zip", "tar")
        with tarfile.open(fileobj=io.BytesIO(result), mode="r:") as tf:
            for name, expected in SAMPLE_ENTRIES:
                f = tf.extractfile(tf.getmember(name))
                assert f is not None and f.read() == expected

    def test_unsupported_source_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            repack_archive(b"data", "mp4", "zip")

    def test_unsupported_target_raises_error(self):
        source = make_zip(SAMPLE_ENTRIES)
        with pytest.raises(UnsupportedFormatError):
            repack_archive(source, "zip", "rar")

    def test_size_limit_enforced_during_repack(self, monkeypatch):
        """Monkeypatch estimate_uncompressed_size to return oversized value."""
        import src.converter as conv
        monkeypatch.setattr(conv, "estimate_uncompressed_size",
                            lambda *args: MAX_UNCOMPRESSED_BYTES + 1)
        source = make_zip(SAMPLE_ENTRIES)
        with pytest.raises(ArchiveTooLargeError):
            repack_archive(source, "zip", "tar")


# ─── TestModels ───────────────────────────────────────────────────────────────

class TestModels:
    def test_conversion_job_model(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j1", user_id="u1", source_file_id="f1",
            source_format="zip", target_format="tar", status=JobStatus.QUEUED
        )
        assert job.target_format == "tar"

    def test_job_status_values(self):
        from src.models import JobStatus
        assert JobStatus.QUEUED == "queued"
        assert JobStatus.FAILED == "failed"

    def test_conversion_options_defaults(self):
        from src.models import ConversionOptions
        opts = ConversionOptions()
        assert opts.quality is None
        assert opts.preserve_metadata is False
