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


# ─── CAD Mesh Conversion (STL <-> OBJ) ────────────────────────────────────────

def _parse_stl(file_path: str) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
    """
    Parses an STL file (ASCII or binary).
    Returns list of triangles: ((x1,y1,z1), (x2,y2,z2), (x3,y3,z3))
    """
    import struct

    with open(file_path, "rb") as f:
        header = f.read(80)
        is_ascii = False
        if header.strip().startswith(b"solid"):
            sample = f.read(1024)
            if b"facet" in sample and b"vertex" in sample:
                is_ascii = True

    triangles = []
    if is_ascii:
        with open(file_path, "r", errors="ignore") as f:
            curr = []
            for line in f:
                parts = line.strip().split()
                if parts and parts[0] == "vertex" and len(parts) >= 4:
                    curr.append((float(parts[1]), float(parts[2]), float(parts[3])))
                    if len(curr) == 3:
                        triangles.append(tuple(curr))
                        curr = []
    else:
        with open(file_path, "rb") as f:
            f.seek(80)
            count_bytes = f.read(4)
            if len(count_bytes) >= 4:
                num_triangles = struct.unpack("<I", count_bytes)[0]
                for _ in range(num_triangles):
                    data = f.read(50)
                    if len(data) < 50:
                        break
                    floats = struct.unpack("<12fH", data)
                    v1 = (floats[3], floats[4], floats[5])
                    v2 = (floats[6], floats[7], floats[8])
                    v3 = (floats[9], floats[10], floats[11])
                    triangles.append((v1, v2, v3))
    return triangles


def _write_obj(triangles: list, output_path: str) -> None:
    """Writes triangles to a Wavefront OBJ file."""
    with open(output_path, "w") as f:
        f.write("# Exported by FileConverter CAD Worker\n")
        vertex_map = {}
        vertices = []
        faces = []
        for tri in triangles:
            face_indices = []
            for v in tri:
                v_rounded = (round(v[0], 6), round(v[1], 6), round(v[2], 6))
                if v_rounded not in vertex_map:
                    vertex_map[v_rounded] = len(vertices) + 1
                    vertices.append(v_rounded)
                face_indices.append(vertex_map[v_rounded])
            faces.append(face_indices)

        for v in vertices:
            f.write(f"v {v[0]} {v[1]} {v[2]}\n")
        for face in faces:
            f.write(f"f {face[0]} {face[1]} {face[2]}\n")


def _parse_obj(file_path: str) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
    """Parses a Wavefront OBJ file into triangles."""
    vertices = []
    triangles = []
    with open(file_path, "r", errors="ignore") as f:
        for line in f:
            parts = line.strip().split()
            if not parts:
                continue
            if parts[0] == "v" and len(parts) >= 4:
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif parts[0] == "f" and len(parts) >= 4:
                indices = []
                for p in parts[1:]:
                    v_str = p.split("/")[0]
                    v_idx = int(v_str)
                    if v_idx < 0:
                        v_idx = len(vertices) + v_idx + 1
                    indices.append(v_idx - 1)
                for i in range(1, len(indices) - 1):
                    if 0 <= indices[0] < len(vertices) and 0 <= indices[i] < len(vertices) and 0 <= indices[i+1] < len(vertices):
                        triangles.append((vertices[indices[0]], vertices[indices[i]], vertices[indices[i+1]]))
    return triangles


def _write_stl(triangles: list, output_path: str) -> None:
    """Writes triangles to a binary STL file."""
    import math
    import struct

    with open(output_path, "wb") as f:
        header = b"Binary STL exported by FileConverter CAD Worker"
        header = header + b"\0" * max(0, 80 - len(header))
        f.write(header[:80])
        f.write(struct.pack("<I", len(triangles)))
        for tri in triangles:
            v1, v2, v3 = tri
            ax, ay, az = v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]
            bx, by, bz = v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]
            nx = ay * bz - az * by
            ny = az * bx - ax * bz
            nz = ax * by - ay * bx
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            if length > 0:
                nx, ny, nz = nx / length, ny / length, nz / length
            else:
                nx, ny, nz = 0.0, 0.0, 0.0

            data = struct.pack(
                "<12fH",
                nx, ny, nz,
                v1[0], v1[1], v1[2],
                v2[0], v2[1], v2[2],
                v3[0], v3[1], v3[2],
                0
            )
            f.write(data)


def convert_mesh_stl_obj(
    input_path: str,
    output_path: str,
    source_format: str,
    target_format: str,
) -> None:
    """Converts 3D meshes between STL and OBJ formats without external dependencies."""
    import shutil

    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if src == "stl" and tgt == "obj":
        triangles = _parse_stl(input_path)
        _write_obj(triangles, output_path)
    elif src == "obj" and tgt == "stl":
        triangles = _parse_obj(input_path)
        _write_stl(triangles, output_path)
    elif src == tgt:
        shutil.copyfile(input_path, output_path)
    else:
        raise InvalidConversionError(f"Unsupported mesh conversion: '{src}' to '{tgt}'")


def convert_cad(
    input_path: str,
    output_path: str,
    source_format: str,
    target_format: str,
) -> None:
    """
    Execute CAD conversion.
    Supports STL <-> OBJ via built-in mesh converter,
    and DWG/DXF/STEP/IGES via FreeCAD CLI when installed.
    """
    import os
    import shutil
    import subprocess

    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    if not validate_cad_conversion(src, tgt):
        raise InvalidConversionError(f"CAD format '{src}' cannot be converted to '{tgt}'")

    if src in ("stl", "obj") and tgt in ("stl", "obj"):
        convert_mesh_stl_obj(input_path, output_path, src, tgt)
        return

    freecad_bin = (
        shutil.which("freecad")
        or shutil.which("FreeCAD")
        or shutil.which("freecadcmd")
        or shutil.which("FreeCADCmd")
    )

    if freecad_bin:
        cmd = build_freecad_command(input_path, output_path, src, tgt)
        cmd[0] = freecad_bin
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise ConversionError(f"FreeCAD conversion failed (code {proc.returncode}): {proc.stderr or proc.stdout}")
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            raise ConversionError("FreeCAD completed without producing an output file")
        return

    raise ConversionError(
        f"CAD engine (FreeCAD) is required for '{src}' to '{tgt}' conversion but is not installed on this system."
    )

