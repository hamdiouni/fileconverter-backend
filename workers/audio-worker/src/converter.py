"""
FFmpeg-based audio conversion logic.
Requirements: 8.1, 8.3, 8.4
"""
from __future__ import annotations
import re
from typing import Optional, List

SUPPORTED_FORMATS = {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus", "alac"}

DEFAULT_CODEC_MAP = {
    "mp3":  "libmp3lame",
    "wav":  "pcm_s16le",
    "flac": "flac",
    "aac":  "aac",
    "ogg":  "libvorbis",
    "m4a":  "aac",
    "wma":  "wmav2",
    "opus": "libopus",
    "alac": "alac",
}

# Default bitrates per format
DEFAULT_BITRATE_MAP = {
    "mp3":  "192k",
    "aac":  "192k",
    "ogg":  "192k",
    "wma":  "192k",
    "opus": "128k",
    "m4a":  "192k",
    # Lossless formats don't use bitrate
    "wav":  None,
    "flac": None,
    "alac": None,
}

# Lossless formats (bitrate not applicable)
LOSSLESS_FORMATS = {"wav", "flac", "alac"}


class AudioConversionError(Exception):
    pass

class UnsupportedFormatError(AudioConversionError):
    pass


def build_ffmpeg_audio_command(
    input_path: str,
    output_path: str,
    target_format: str,
    codec: Optional[str] = None,
    bitrate: Optional[str] = None,
    sample_rate: Optional[int] = None,
    channels: Optional[int] = None,
    preserve_metadata: bool = False,
) -> List[str]:
    """
    Build FFmpeg command for audio conversion.
    Requirements: 8.3, 8.4

    Args:
        input_path: Input file path
        output_path: Output file path
        target_format: Target audio format (mp3, wav, etc.)
        codec: Audio codec override
        bitrate: Bitrate string (e.g., "128k", "320k")
        sample_rate: Sample rate in Hz (e.g., 44100, 48000)
        channels: Number of audio channels (1=mono, 2=stereo)
        preserve_metadata: When True, insert -map_metadata 0 to copy metadata

    Returns:
        FFmpeg command as list of arguments
    """
    fmt = target_format.lower().strip()
    if fmt not in SUPPORTED_FORMATS:
        raise UnsupportedFormatError(f"Unsupported audio format: {target_format}")

    audio_codec = codec or DEFAULT_CODEC_MAP.get(fmt, "aac")

    cmd = ["ffmpeg", "-i", input_path, "-c:a", audio_codec, "-vn"]  # -vn = no video

    # Apply bitrate (skip for lossless formats unless explicitly specified)
    effective_bitrate = bitrate or (DEFAULT_BITRATE_MAP.get(fmt) if fmt not in LOSSLESS_FORMATS else None)
    if effective_bitrate:
        cmd.extend(["-b:a", effective_bitrate])

    if sample_rate:
        cmd.extend(["-ar", str(sample_rate)])

    if channels:
        cmd.extend(["-ac", str(channels)])

    if preserve_metadata:
        cmd.extend(["-map_metadata", "0"])

    cmd.extend(["-y", output_path])
    return cmd


def is_lossless(fmt: str) -> bool:
    """Return True if the format is lossless (WAV, FLAC, ALAC)."""
    return fmt.lower() in LOSSLESS_FORMATS


def validate_bitrate(bitrate: str) -> bool:
    """Validate audio bitrate format (e.g., '128k', '320k', '1M')."""
    return bool(re.match(r"^\d+(\.\d+)?[kKmMgG]?$", bitrate))


def validate_sample_rate(sample_rate: int) -> bool:
    """Validate common audio sample rates."""
    VALID_RATES = {8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000}
    return sample_rate in VALID_RATES


def validate_channels(channels: int) -> bool:
    """Validate channel count (1=mono, 2=stereo, up to 8 for surround)."""
    return 1 <= channels <= 8
