"""
Unit tests for FFmpeg audio conversion logic.
Requirements: 8.3, 8.4
"""
import pytest

from src.converter import (
    build_ffmpeg_audio_command,
    is_lossless,
    validate_bitrate,
    validate_sample_rate,
    validate_channels,
    AudioConversionError,
    UnsupportedFormatError,
    DEFAULT_CODEC_MAP,
    DEFAULT_BITRATE_MAP,
    SUPPORTED_FORMATS,
    LOSSLESS_FORMATS,
)


# ─── build_ffmpeg_audio_command ───────────────────────────────────────────────

class TestBuildFFmpegAudioCommand:
    """Requirements: 8.3, 8.4 — FFmpeg audio command building."""

    def test_basic_mp3_command_structure(self):
        cmd = build_ffmpeg_audio_command("/in/audio.wav", "/out/audio.mp3", "mp3")
        assert cmd[0] == "ffmpeg"
        assert "-i" in cmd
        assert "/in/audio.wav" in cmd
        assert "-c:a" in cmd
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "libmp3lame"
        assert cmd[-1] == "/out/audio.mp3"

    def test_wav_uses_pcm_s16le_codec(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.wav", "wav")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "pcm_s16le"

    def test_flac_uses_flac_codec(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.flac", "flac")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "flac"

    def test_ogg_uses_libvorbis_codec(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.ogg", "ogg")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "libvorbis"

    def test_aac_uses_aac_codec(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.aac", "aac")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "aac"

    def test_m4a_uses_aac_codec(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.m4a", "m4a")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "aac"

    def test_opus_uses_libopus_codec(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.opus", "opus")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "libopus"

    def test_custom_codec_overrides_default(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3", codec="libshine")
        idx = cmd.index("-c:a")
        assert cmd[idx + 1] == "libshine"

    def test_bitrate_included_when_specified(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3", bitrate="320k")
        assert "-b:a" in cmd
        idx = cmd.index("-b:a")
        assert cmd[idx + 1] == "320k"

    def test_default_bitrate_used_for_lossy_mp3(self):
        cmd = build_ffmpeg_audio_command("/in/audio.wav", "/out/audio.mp3", "mp3")
        assert "-b:a" in cmd
        idx = cmd.index("-b:a")
        assert cmd[idx + 1] == "192k"

    def test_default_bitrate_used_for_lossy_aac(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.aac", "aac")
        assert "-b:a" in cmd
        idx = cmd.index("-b:a")
        assert cmd[idx + 1] == "192k"

    def test_bitrate_not_included_for_wav_lossless(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.wav", "wav")
        assert "-b:a" not in cmd

    def test_bitrate_not_included_for_flac_lossless(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.flac", "flac")
        assert "-b:a" not in cmd

    def test_bitrate_not_included_for_alac_lossless(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.alac", "alac")
        assert "-b:a" not in cmd

    def test_explicit_bitrate_overrides_lossless_default(self):
        # Even for lossless, if user explicitly sets bitrate, it should be honoured
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.wav", "wav", bitrate="256k")
        assert "-b:a" in cmd
        idx = cmd.index("-b:a")
        assert cmd[idx + 1] == "256k"

    def test_sample_rate_included_when_specified(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3", sample_rate=44100)
        assert "-ar" in cmd
        idx = cmd.index("-ar")
        assert cmd[idx + 1] == "44100"

    def test_sample_rate_not_included_when_not_specified(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3")
        assert "-ar" not in cmd

    def test_channels_included_when_specified(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3", channels=2)
        assert "-ac" in cmd
        idx = cmd.index("-ac")
        assert cmd[idx + 1] == "2"

    def test_channels_mono(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3", channels=1)
        assert "-ac" in cmd
        idx = cmd.index("-ac")
        assert cmd[idx + 1] == "1"

    def test_channels_not_included_when_not_specified(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3")
        assert "-ac" not in cmd

    def test_vn_flag_present(self):
        """Ensures no video stream is written (-vn flag)."""
        cmd = build_ffmpeg_audio_command("/in/video.mp4", "/out/audio.mp3", "mp3")
        assert "-vn" in cmd

    def test_overwrite_flag_present(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3")
        assert "-y" in cmd

    def test_unsupported_format_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.xyz", "xyz_unknown")

    def test_unsupported_format_is_subclass_of_audio_conversion_error(self):
        with pytest.raises(AudioConversionError):
            build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.xyz", "xyz_unknown")

    def test_all_supported_formats_produce_valid_commands(self):
        for fmt in SUPPORTED_FORMATS:
            cmd = build_ffmpeg_audio_command("/in/audio.mp3", f"/out/audio.{fmt}", fmt)
            assert cmd[0] == "ffmpeg"
            assert cmd[-1] == f"/out/audio.{fmt}"

    def test_format_is_case_insensitive(self):
        cmd_lower = build_ffmpeg_audio_command("/in/audio.wav", "/out/audio.mp3", "mp3")
        cmd_upper = build_ffmpeg_audio_command("/in/audio.wav", "/out/audio.mp3", "MP3")
        idx_l = cmd_lower.index("-c:a")
        idx_u = cmd_upper.index("-c:a")
        assert cmd_lower[idx_l + 1] == cmd_upper[idx_u + 1]

    def test_format_with_leading_trailing_whitespace(self):
        cmd = build_ffmpeg_audio_command("/in/audio.wav", "/out/audio.mp3", "  mp3  ")
        assert "-c:a" in cmd

    def test_output_path_is_last_argument(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.flac", "flac")
        assert cmd[-1] == "/out/audio.flac"


# ─── TestMetadataPreservation ─────────────────────────────────────────────────

class TestMetadataPreservation:
    """Requirements: 8.4 — metadata preservation in audio conversion."""

    def test_preserve_metadata_flag_adds_map_metadata(self):
        cmd = build_ffmpeg_audio_command(
            "/in/audio.mp3", "/out/audio.mp3", "mp3", preserve_metadata=True
        )
        assert "-map_metadata" in cmd
        idx = cmd.index("-map_metadata")
        assert cmd[idx + 1] == "0"

    def test_no_preserve_metadata_by_default(self):
        cmd = build_ffmpeg_audio_command("/in/audio.mp3", "/out/audio.mp3", "mp3")
        assert "-map_metadata" not in cmd

    def test_preserve_metadata_false_does_not_add_flag(self):
        cmd = build_ffmpeg_audio_command(
            "/in/audio.mp3", "/out/audio.mp3", "mp3", preserve_metadata=False
        )
        assert "-map_metadata" not in cmd

    def test_preserve_metadata_works_with_lossless_format(self):
        cmd = build_ffmpeg_audio_command(
            "/in/audio.mp3", "/out/audio.flac", "flac", preserve_metadata=True
        )
        assert "-map_metadata" in cmd
        idx = cmd.index("-map_metadata")
        assert cmd[idx + 1] == "0"


# ─── validate_bitrate ─────────────────────────────────────────────────────────

class TestValidateBitrate:
    """Requirements: 8.4 — bitrate validation."""

    def test_valid_megabits(self):
        assert validate_bitrate("2M") is True
        assert validate_bitrate("1.5M") is True

    def test_valid_kilobits_lowercase(self):
        assert validate_bitrate("128k") is True
        assert validate_bitrate("320k") is True
        assert validate_bitrate("500k") is True

    def test_valid_kilobits_uppercase(self):
        assert validate_bitrate("128K") is True
        assert validate_bitrate("1500K") is True

    def test_valid_no_suffix(self):
        assert validate_bitrate("500000") is True

    def test_invalid_bitrate_with_unit_suffix(self):
        assert validate_bitrate("2MB") is False

    def test_invalid_empty_string(self):
        assert validate_bitrate("") is False

    def test_invalid_alphabetic(self):
        assert validate_bitrate("abc") is False

    def test_invalid_negative(self):
        assert validate_bitrate("-100k") is False


# ─── TestValidateSampleRate ───────────────────────────────────────────────────

class TestValidateSampleRate:
    """Requirements: 8.4 — sample rate validation."""

    def test_44100_is_valid(self):
        assert validate_sample_rate(44100) is True

    def test_48000_is_valid(self):
        assert validate_sample_rate(48000) is True

    def test_192000_is_valid(self):
        assert validate_sample_rate(192000) is True

    def test_8000_is_valid(self):
        assert validate_sample_rate(8000) is True

    def test_96000_is_valid(self):
        assert validate_sample_rate(96000) is True

    def test_22050_is_valid(self):
        assert validate_sample_rate(22050) is True

    def test_non_standard_rate_is_invalid(self):
        assert validate_sample_rate(12345) is False

    def test_zero_is_invalid(self):
        assert validate_sample_rate(0) is False

    def test_negative_is_invalid(self):
        assert validate_sample_rate(-44100) is False


# ─── TestValidateChannels ─────────────────────────────────────────────────────

class TestValidateChannels:
    """Requirements: 8.4 — audio channel count validation."""

    def test_mono_is_valid(self):
        assert validate_channels(1) is True

    def test_stereo_is_valid(self):
        assert validate_channels(2) is True

    def test_surround_8_is_valid(self):
        assert validate_channels(8) is True

    def test_quad_is_valid(self):
        assert validate_channels(4) is True

    def test_zero_is_invalid(self):
        assert validate_channels(0) is False

    def test_nine_is_invalid(self):
        assert validate_channels(9) is False

    def test_negative_is_invalid(self):
        assert validate_channels(-1) is False


# ─── TestIsLossless ───────────────────────────────────────────────────────────

class TestIsLossless:
    """Requirements: 8.3 — lossless format detection."""

    def test_wav_is_lossless(self):
        assert is_lossless("wav") is True

    def test_flac_is_lossless(self):
        assert is_lossless("flac") is True

    def test_alac_is_lossless(self):
        assert is_lossless("alac") is True

    def test_mp3_is_not_lossless(self):
        assert is_lossless("mp3") is False

    def test_aac_is_not_lossless(self):
        assert is_lossless("aac") is False

    def test_ogg_is_not_lossless(self):
        assert is_lossless("ogg") is False

    def test_case_insensitive_wav(self):
        assert is_lossless("WAV") is True

    def test_case_insensitive_flac(self):
        assert is_lossless("FLAC") is True


# ─── TestModels ───────────────────────────────────────────────────────────────

class TestModels:
    def test_conversion_job_model(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j1", user_id="u1", source_file_id="f1",
            source_format="mp3", target_format="flac", status=JobStatus.QUEUED
        )
        assert job.target_format == "flac"
        assert job.status == JobStatus.QUEUED

    def test_conversion_options_defaults(self):
        from src.models import ConversionOptions
        opts = ConversionOptions()
        assert opts.codec is None
        assert opts.bitrate is None
        assert opts.preserve_metadata is False

    def test_job_status_enum_values(self):
        from src.models import JobStatus
        assert JobStatus.QUEUED == "queued"
        assert JobStatus.PROCESSING == "processing"
        assert JobStatus.COMPLETED == "completed"
        assert JobStatus.FAILED == "failed"

    def test_job_result_model(self):
        from src.models import JobResult
        result = JobResult(
            job_id="j1", result_file_id="f2",
            output_size=1024, processing_time_ms=500
        )
        assert result.job_id == "j1"
        assert result.output_size == 1024
