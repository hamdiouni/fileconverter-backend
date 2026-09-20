"""
CAD and font conversion routing logic.
Requirements: 10.2, 10.3

Note: Actual conversion uses FreeCAD (CAD) and fonttools/FontForge (fonts).
This module provides pure-logic routing, validation, and command-building
that can be unit-tested without system dependencies.
"""
from __future__ import annotations
from typing import List

# ─── CAD formats ─────────────────────────────────────────────────────────────

CAD_SOURCE_FORMATS = {"dwg", "dxf", "step", "stp", "iges", "igs", "stl", "obj"}
CAD_TARGET_FORMATS = {"pdf", "svg", "dxf", "stl", "obj", "step", "stp"}

# ─── Font formats ─────────────────────────────────────────────────────────────

FONT_FORMATS = {"ttf", "otf", "woff", "woff2", "eot", "svg", "afm", "pfb", "pfm"}

# Font format families
WEB_FONTS = {"woff", "woff2", "eot"}
DESKTOP_FONTS = {"ttf", "otf", "afm", "pfb", "pfm"}
VECTOR_FONTS = {"svg"}

# ─── Exceptions ───────────────────────────────────────────────────────────────

class ConversionError(Exception):
    pass


class UnsupportedFormatError(ConversionError):
    pass


class InvalidConversionError(ConversionError):
    """Raised when source→target pair is not supported."""
    pass


# ─── CAD helpers ─────────────────────────────────────────────────────────────

def is_cad_format(fmt: str) -> bool:
    """Return True if fmt is a recognised CAD format."""
    f = fmt.lower().strip()
    return f in CAD_SOURCE_FORMATS or f in CAD_TARGET_FORMATS


def is_font_format(fmt: str) -> bool:
    """Return True if fmt is a recognised font format."""
    return fmt.lower().strip() in FONT_FORMATS


def classify_job(source_format: str, target_format: str) -> str:
    """
    Return 'cad' or 'font' based on source format.
    Raises InvalidConversionError if pair is not supported.
    Requirements: 10.2, 10.3
    """
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if src in CAD_SOURCE_FORMATS:
        if tgt not in CAD_TARGET_FORMATS:
            raise InvalidConversionError(
                f"CAD format '{src}' cannot be converted to '{tgt}'"
            )
        return "cad"

    if src in FONT_FORMATS:
        if tgt not in FONT_FORMATS:
            raise InvalidConversionError(
                f"Font format '{src}' cannot be converted to '{tgt}'"
            )
        return "font"

    raise UnsupportedFormatError(f"Unknown format: {source_format}")


def build_freecad_command(
    input_path: str,
    output_path: str,
    source_format: str,
    target_format: str,
) -> List[str]:
    """
    Build FreeCAD CLI command for CAD conversion.
    Requirements: 10.2
    Uses FreeCAD's Python scripting interface.
    """
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if src not in CAD_SOURCE_FORMATS:
        raise UnsupportedFormatError(f"Unsupported CAD source: {source_format}")
    if tgt not in CAD_TARGET_FORMATS:
        raise UnsupportedFormatError(f"Unsupported CAD target: {target_format}")

    # FreeCAD Python script approach
    script = (
        f"import FreeCAD, importDXF, importSVG; "
        f"doc = FreeCAD.openDocument('{input_path}'); "
        f"doc.saveAs('{output_path}')"
    )

    return [
        "freecad",
        "--console",
        "-c",
        script,
    ]


def build_fonttools_command(
    input_path: str,
    output_path: str,
    source_format: str,
    target_format: str,
) -> List[str]:
    """
    Build fonttools (ttx) command for font conversion.
    Requirements: 10.3
    fonttools supports TTF, OTF, WOFF, WOFF2 conversion.
    """
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if src not in FONT_FORMATS:
        raise UnsupportedFormatError(f"Unsupported font source: {source_format}")
    if tgt not in FONT_FORMATS:
        raise UnsupportedFormatError(f"Unsupported font target: {target_format}")

    # fonttools pyftsubset / pyftmerge or direct conversion
    return [
        "python",
        "-m", "fonttools",
        "convert",
        "--output-file", output_path,
        input_path,
    ]


def validate_cad_conversion(source_format: str, target_format: str) -> bool:
    """Return True if the CAD source→target pair is valid. Requirements: 10.2"""
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()
    return src in CAD_SOURCE_FORMATS and tgt in CAD_TARGET_FORMATS


def validate_font_conversion(source_format: str, target_format: str) -> bool:
    """Return True if the font source→target pair is valid. Requirements: 10.3"""
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()
    return src in FONT_FORMATS and tgt in FONT_FORMATS


def get_font_family(fmt: str) -> str:
    """
    Classify font format into 'web', 'desktop', or 'vector'.
    Requirements: 10.3
    """
    f = fmt.lower().strip()
    if f in WEB_FONTS:
        return "web"
    if f in DESKTOP_FONTS:
        return "desktop"
    if f in VECTOR_FONTS:
        return "vector"
    raise UnsupportedFormatError(f"Unknown font format: {fmt}")


def estimate_font_conversion_complexity(
    source_format: str,
    target_format: str,
) -> str:
    """
    Estimate conversion complexity: 'simple', 'moderate', or 'complex'.
    Requirements: 10.3

    - same family → simple
    - desktop ↔ web → moderate
    - any ↔ vector (svg) → complex
    """
    src_family = get_font_family(source_format)
    tgt_family = get_font_family(target_format)

    if src_family == tgt_family:
        return "simple"
    if "vector" in (src_family, tgt_family):
        return "complex"
    return "moderate"
