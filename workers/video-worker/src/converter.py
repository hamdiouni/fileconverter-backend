"""
FFmpeg-based video conversion logic.
Requirements: 8.1, 8.2, 8.3, 8.4, 8.6
"""
from __future__ import annotations
import re
import subprocess
import shlex
from typing import Optional, List


# Supported video formats
SUPPORTED_FORMATS = {"mp4", "avi", "mov", "mkv", "webm", "flv", "wmv", "m4v"}

# Default codec mapping per output format
DEFAULT_CODEC_MAP = {
    "mp4": "libx264",
    "webm": "libvpx-vp9",
    "mkv": "libx264",
    "avi": "libxvid",
    "mov": "libx264",
    "flv": "flv",
    "wmv": "wmv2",
    "m4v": "libx264",
}

# Default audio codec per format
DEFAULT_AUDIO_CODEC = {
    "mp4": "aac",
    "webm": "libopus",
    "mkv": "aac",
    "avi": "mp3",
    "mov": "aac",
    "flv": "mp3",
    "wmv": "wmav2",
    "m4v": "aac",
}


class VideoConversionError(Exception):
    """Raised when video conversion fails."""
    pass


class UnsupportedFormatError(VideoConversionError):
    """Raised when source or target format is not supported."""
    pass


def build_ffmpeg_command(
    input_path: str,
    output_path: str,
    target_format: str,
    codec: Optional[str] = None,
    bitrate: Optional[str] = None,
    resolution: Optional[str] = None,
    audio_codec: Optional[str] = None,
    audio_bitrate: Optional[str] = None,
) -> List[str]:
    """
    Build FFmpeg command for video conversion.
    Requirements: 8.2

    Args:
        input_path: Path to input file
        output_path: Path to output file
        target_format: Target container format (mp4, webm, etc.)
        codec: Video codec override (default: per format)
        bitrate: Video bitrate (e.g., "2M", "500k")
        resolution: Target resolution (e.g., "1920x1080", "1280x720")
        audio_codec: Audio codec override
        audio_bitrate: Audio bitrate (e.g., "128k", "192k")

    Returns:
        List of command arguments
    """
    fmt = target_format.lower().strip()
    if fmt not in SUPPORTED_FORMATS:
        raise UnsupportedFormatError(f"Unsupported target format: {target_format}")

    video_codec = codec or DEFAULT_CODEC_MAP.get(fmt, "libx264")
    aud_codec = audio_codec or DEFAULT_AUDIO_CODEC.get(fmt, "aac")

    cmd = [
        "ffmpeg",
        "-i", input_path,
        "-c:v", video_codec,
        "-c:a", aud_codec,
    ]

    if bitrate:
        cmd.extend(["-b:v", bitrate])

    if audio_bitrate:
        cmd.extend(["-b:a", audio_bitrate])

    if resolution:
        # resolution format: "WIDTHxHEIGHT"
        cmd.extend(["-s", resolution])

    # Output options
    cmd.extend([
        "-y",          # overwrite output
        "-movflags", "+faststart",  # optimize for streaming (MP4)
        output_path,
    ])

    return cmd


def parse_progress(line: str) -> Optional[int]:
    """
    Parse FFmpeg stderr progress output and extract progress percentage.
    Requirements: 8.3

    FFmpeg outputs lines like:
      frame=  120 fps= 25 q=28.0 size=    1024kB time=00:00:05.00 bitrate=1678.0kbits/s
    or
      out_time_ms=5000000

    We extract time= and compare against total_duration_ms if available,
    otherwise return None.

    Args:
        line: Single line from FFmpeg stderr

    Returns:
        Progress percentage 0-100, or None if not parseable
    """
    # Try to extract time= field (HH:MM:SS.ss)
    time_match = re.search(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})", line)
    if time_match:
        h, m, s, cs = time_match.groups()
        ms = (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(cs) * 10
        return ms  # return raw milliseconds (caller computes percentage)

    # Try out_time_ms= field (progress pipe format)
    ms_match = re.search(r"out_time_ms=(\d+)", line)
    if ms_match:
        return int(ms_match.group(1)) // 1000  # convert to ms

    return None


def compute_progress_percent(elapsed_ms: int, total_duration_ms: int) -> int:
    """
    Compute progress percentage from elapsed and total milliseconds.
    Clamps result to 0-99 (100% is only set on completion).
    Requirements: 8.3
    """
    if total_duration_ms <= 0:
        return 0
    pct = int((elapsed_ms / total_duration_ms) * 100)
    return max(0, min(99, pct))


def parse_duration_from_stderr(stderr_output: str) -> Optional[int]:
    """
    Extract total video duration in milliseconds from FFmpeg stderr output.
    FFmpeg prints: Duration: HH:MM:SS.ss, ...
    Requirements: 8.3
    """
    match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})", stderr_output)
    if match:
        h, m, s, cs = match.groups()
        ms = (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(cs) * 10
        return ms
    return None


def validate_bitrate(bitrate: str) -> bool:
    """
    Validate bitrate string format (e.g., "2M", "500k", "1500k").
    Requirements: 8.4
    """
    return bool(re.match(r"^\d+(\.\d+)?[kKmMgG]?$", bitrate))


def validate_resolution(resolution: str) -> bool:
    """
    Validate resolution string format (e.g., "1920x1080", "1280x720").
    Requirements: 8.4
    """
    return bool(re.match(r"^\d+x\d+$", resolution, re.IGNORECASE))
