"""
Unit tests for FFmpeg video conversion logic.
Requirements: 8.2, 8.3, 8.4
"""
import pytest
from unittest.mock import patch, MagicMock

from src.converter import (
    build_ffmpeg_command,
    parse_progress,
    parse_duration_from_stderr,
    compute_progress_percent,
    validate_bitrate,
    validate_resolution,
    VideoConversionError,
    UnsupportedFormatError,
    DEFAULT_CODEC_MAP,
    DEFAULT_AUDIO_CODEC,
    SUPPORTED_FORMATS,
)


# ─── build_ffmpeg_command ─────────────────────────────────────────────────────

class TestBuildFFmpegCommand:
    """Requirements: 8.2 — FFmpeg command building."""

    def test_basic_mp4_command(self):
        cmd = build_ffmpeg_command("/in/video.avi", "/out/video.mp4", "mp4")
        assert cmd[0] == "ffmpeg"
        assert "-i" in cmd
        assert "/in/video.avi" in cmd
        assert "-c:v" in cmd
        assert "libx264" in cmd
        assert "/out/video.mp4" == cmd[-1]

    def test_webm_uses_vp9_codec(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.webm", "webm")
        idx = cmd.index("-c:v")
        assert cmd[idx + 1] == "libvpx-vp9"

    def test_custom_codec_overrides_default(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4", codec="libx265")
        idx = cmd.index("-c:v")
        assert cmd[idx + 1] == "libx265"

    def test_bitrate_included_when_specified(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4", bitrate="2M")
        assert "-b:v" in cmd
        idx = cmd.index("-b:v")
        assert cmd[idx + 1] == "2M"

    def test_bitrate_not_included_when_not_specified(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4")
        assert "-b:v" not in cmd

    def test_resolution_included_when_specified(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4", resolution="1280x720")
        assert "-s" in cmd
        idx = cmd.index("-s")
        assert cmd[idx + 1] == "1280x720"

    def test_resolution_not_included_when_not_specified(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4")
        assert "-s" not in cmd

    def test_audio_codec_included(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4")
        assert "-c:a" in cmd
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "aac"

    def test_custom_audio_codec(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.webm", "webm", audio_codec="libvorbis")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "libvorbis"

    def test_audio_bitrate_included(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4", audio_bitrate="192k")
        assert "-b:a" in cmd
        idx = cmd.index("-b:a")
        assert cmd[idx + 1] == "192k"

    def test_overwrite_flag_present(self):
        cmd = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4")
        assert "-y" in cmd

    def test_unsupported_format_raises(self):
        with pytest.raises(UnsupportedFormatError):
            build_ffmpeg_command("/in/v.mp4", "/out/v.xyz", "xyz_unknown")

    def test_all_supported_formats_produce_commands(self):
        for fmt in SUPPORTED_FORMATS:
            cmd = build_ffmpeg_command("/in/v.mp4", f"/out/v.{fmt}", fmt)
            assert cmd[-1] == f"/out/v.{fmt}"

    def test_format_is_case_insensitive(self):
        cmd_lower = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "mp4")
        cmd_upper = build_ffmpeg_command("/in/v.mp4", "/out/v.mp4", "MP4")
        # Both should use same codec
        idx_l = cmd_lower.index("-c:v")
        idx_u = cmd_upper.index("-c:v")
        assert cmd_lower[idx_l + 1] == cmd_upper[idx_u + 1]


# ─── parse_progress ────────────────────────────────────────────────────────────

class TestParseProgress:
    """Requirements: 8.3 — progress tracking parsing."""

    def test_parses_time_field(self):
        line = "frame=  120 fps= 25 q=28.0 size=    1024kB time=00:00:05.00 bitrate=1678.0kbits/s"
        ms = parse_progress(line)
        assert ms == 5000  # 5 seconds = 5000ms

    def test_parses_one_minute(self):
        line = "frame= 1500 fps= 25 q=28.0 size=   15360kB time=00:01:00.00 bitrate= 200kbits/s"
        ms = parse_progress(line)
        assert ms == 60000  # 60 seconds = 60000ms

    def test_parses_hours(self):
        line = "frame=90000 fps= 25 q=28.0 size=  900000kB time=01:00:00.00 bitrate= 200kbits/s"
        ms = parse_progress(line)
        assert ms == 3_600_000  # 1 hour = 3600000ms

    def test_parses_out_time_ms_field(self):
        line = "out_time_ms=5000000"
        ms = parse_progress(line)
        assert ms == 5000  # 5,000,000 us = 5000ms

    def test_returns_none_for_unrelated_line(self):
        line = "libavcodec 60.3.100 / 60.3.100"
        result = parse_progress(line)
        assert result is None

    def test_returns_none_for_empty_line(self):
        result = parse_progress("")
        assert result is None

    def test_returns_none_for_error_line(self):
        line = "Error while decoding stream #0:0: Invalid data found when processing input"
        result = parse_progress(line)
        assert result is None


# ─── parse_duration_from_stderr ───────────────────────────────────────────────

class TestParseDuration:
    """Requirements: 8.3 — duration extraction."""

    def test_extracts_duration_from_ffmpeg_output(self):
        stderr = (
            "  Duration: 00:01:30.00, start: 0.000000, bitrate: 5000 kb/s\n"
            "    Stream #0:0: Video: h264, yuv420p, 1920x1080, 5000 kb/s, 25 fps\n"
        )
        ms = parse_duration_from_stderr(stderr)
        assert ms == 90_000  # 90 seconds

    def test_extracts_hours_duration(self):
        stderr = "  Duration: 02:00:00.00, start: 0.000000, bitrate: 1000 kb/s"
        ms = parse_duration_from_stderr(stderr)
        assert ms == 7_200_000  # 2 hours

    def test_returns_none_for_missing_duration(self):
        stderr = "Input #0, matroska, from 'video.mkv':\n  Stream #0:0: Video: h264"
        result = parse_duration_from_stderr(stderr)
        assert result is None


# ─── compute_progress_percent ────────────────────────────────────────────────

class TestComputeProgressPercent:
    """Requirements: 8.3 — progress percentage computation."""

    def test_zero_elapsed(self):
        assert compute_progress_percent(0, 60_000) == 0

    def test_half_elapsed(self):
        assert compute_progress_percent(30_000, 60_000) == 50

    def test_clamped_to_99_at_full_duration(self):
        # 100% is reserved for completion signal
        assert compute_progress_percent(60_000, 60_000) == 99

    def test_clamped_to_0_when_total_is_zero(self):
        assert compute_progress_percent(1000, 0) == 0

    def test_clamped_to_99_when_elapsed_exceeds_total(self):
        # Should not exceed 99
        assert compute_progress_percent(90_000, 60_000) == 99

    def test_quarter_elapsed(self):
        assert compute_progress_percent(15_000, 60_000) == 25


# ─── validate_bitrate ─────────────────────────────────────────────────────────

class TestValidateBitrate:
    """Requirements: 8.4 — bitrate validation."""

    def test_valid_megabits(self):
        assert validate_bitrate("2M") is True
        assert validate_bitrate("1.5M") is True

    def test_valid_kilobits(self):
        assert validate_bitrate("500k") is True
        assert validate_bitrate("128k") is True
        assert validate_bitrate("1500K") is True

    def test_valid_no_suffix(self):
        assert validate_bitrate("500000") is True

    def test_invalid_bitrate(self):
        assert validate_bitrate("2MB") is False
        assert validate_bitrate("") is False
        assert validate_bitrate("abc") is False
        assert validate_bitrate("-100k") is False


# ─── validate_resolution ─────────────────────────────────────────────────────

class TestValidateResolution:
    """Requirements: 8.4 — resolution validation."""

    def test_valid_1080p(self):
        assert validate_resolution("1920x1080") is True

    def test_valid_720p(self):
        assert validate_resolution("1280x720") is True

    def test_valid_4k(self):
        assert validate_resolution("3840x2160") is True

    def test_case_insensitive(self):
        assert validate_resolution("1920X1080") is True

    def test_invalid_format(self):
        assert validate_resolution("1920*1080") is False
        assert validate_resolution("1920") is False
        assert validate_resolution("") is False
        assert validate_resolution("1920x") is False
        assert validate_resolution("x1080") is False


# ─── Models ──────────────────────────────────────────────────────────────────

class TestModels:
    def test_conversion_job_model(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j1", user_id="u1", source_file_id="f1",
            source_format="mp4", target_format="webm", status=JobStatus.QUEUED
        )
        assert job.target_format == "webm"

    def test_conversion_options_defaults(self):
        from src.models import ConversionOptions
        opts = ConversionOptions()
        assert opts.codec is None
        assert opts.bitrate is None


# ─── Streaming S3 / Memory Safety (MAJ-04) ───────────────────────────────────

class TestStreamingS3:
    def test_process_job_streams_via_download_and_upload_file(self):
        import sys
        for mod in ["redis", "structlog", "boto3"]:
            if mod not in sys.modules:
                sys.modules[mod] = MagicMock()

        import src.worker as worker

        mock_s3 = MagicMock()
        with patch.object(worker, "make_s3", return_value=mock_s3), \
             patch.object(worker, "post_status"), \
             patch("subprocess.run", return_value=MagicMock(returncode=0)):

            job_data = {
                "jobId": "test-job-123",
                "sourceFileId": "uploads/video-123.mp4",
                "sourceFormat": "mp4",
                "targetFormat": "webm",
                "sourceBucket": "test-uploads",
                "resultBucket": "test-results",
                "callbackUrl": "http://localhost:3000/callback",
            }

            worker.process_job(job_data)

            # Verify streaming download to file (not in-memory get_object)
            assert mock_s3.download_file.called
            assert mock_s3.download_file.call_args[0][0] == "test-uploads"
            assert mock_s3.download_file.call_args[0][1] == "uploads/video-123.mp4"
            assert not mock_s3.get_object.called

            # Verify streaming upload from file (not in-memory put_object)
            assert mock_s3.upload_file.called
            assert mock_s3.upload_file.call_args[0][1] == "test-results"
            assert not mock_s3.put_object.called

