"""
Document conversion logic using LibreOffice and Pandoc.
Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
"""
from __future__ import annotations
from typing import Optional, List


# Formats handled by LibreOffice
LIBREOFFICE_FORMATS = {
    "doc", "docx", "odt", "rtf", "txt", "html", "pdf",
    "ppt", "pptx", "odp", "xls", "xlsx", "ods", "csv",
}

# Formats handled by Pandoc
PANDOC_FORMATS = {
    "md", "markdown", "rst", "tex", "latex",
    "epub", "html", "txt", "docx", "odt", "pdf",
}

# Formats that require LibreOffice (not Pandoc)
LIBREOFFICE_ONLY = {"doc", "rtf", "ppt", "pptx", "odp", "xls", "xlsx", "ods", "csv"}

# Pandoc-preferred lightweight markup formats
PANDOC_PREFERRED_SOURCES = {"md", "markdown", "rst", "tex", "latex", "epub"}
PANDOC_PREFERRED_TARGETS = {"md", "markdown", "rst", "tex", "latex", "epub", "html"}


class DocumentConversionError(Exception):
    pass


class UnsupportedFormatError(DocumentConversionError):
    pass


class ConversionTimeoutError(DocumentConversionError):
    pass


def select_engine(source_format: str, target_format: str) -> str:
    """
    Select the best conversion engine for a source->target format pair.
    Returns 'libreoffice' or 'pandoc'.
    Requirements: 9.1, 9.2, 9.3
    """
    src = source_format.lower().strip()
    tgt = target_format.lower().strip()

    # LibreOffice-only formats must use LibreOffice
    if src in LIBREOFFICE_ONLY or tgt in LIBREOFFICE_ONLY:
        return "libreoffice"

    # Pandoc-preferred lightweight markup
    if src in PANDOC_PREFERRED_SOURCES or tgt in PANDOC_PREFERRED_TARGETS:
        return "pandoc"

    # Default: LibreOffice for office formats
    if src in LIBREOFFICE_FORMATS:
        return "libreoffice"

    if src in PANDOC_FORMATS:
        return "pandoc"

    raise UnsupportedFormatError(f"No engine available for {source_format} -> {target_format}")


def build_libreoffice_command(
    input_path: str,
    output_dir: str,
    target_format: str,
) -> List[str]:
    """
    Build LibreOffice headless conversion command.
    Requirements: 9.2, 9.4

    Args:
        input_path: Path to source document
        output_dir: Directory to write converted file
        target_format: Target format (pdf, docx, html, etc.)

    Returns:
        Command as list of arguments
    """
    fmt = target_format.lower().strip()
    return [
        "libreoffice",
        "--headless",
        "--norestore",
        "--convert-to", fmt,
        "--outdir", output_dir,
        input_path,
    ]


def build_pandoc_command(
    input_path: str,
    output_path: str,
    source_format: str,
    target_format: str,
    standalone: bool = False,
    preserve_structure: bool = True,
) -> List[str]:
    """
    Build Pandoc conversion command.
    Requirements: 9.3, 9.5

    Args:
        input_path: Path to source document
        output_path: Path to output file
        source_format: Source format string
        target_format: Target format string
        standalone: When True, produces a complete document (--standalone)
        preserve_structure: When True, preserves headings, lists, tables

    Returns:
        Command as list of arguments
    """
    src_fmt = source_format.lower().strip()
    tgt_fmt = target_format.lower().strip()

    cmd = [
        "pandoc",
        input_path,
        "--from", src_fmt,
        "--to", tgt_fmt,
        "--output", output_path,
    ]

    if standalone:
        cmd.append("--standalone")

    if preserve_structure:
        cmd.extend(["--wrap", "preserve"])

    return cmd


def validate_document_format(fmt: str) -> bool:
    """Check if format is supported by any available engine."""
    f = fmt.lower().strip()
    return f in LIBREOFFICE_FORMATS or f in PANDOC_FORMATS


def estimate_conversion_time_seconds(
    source_format: str,
    target_format: str,
    file_size_bytes: int,
    page_count: Optional[int] = None,
) -> int:
    """
    Estimate conversion time in seconds based on format pair and document size.
    Requirements: 9.6

    LibreOffice is slower (~0.5s/page), Pandoc is faster (~0.1s/MB).
    """
    engine = select_engine(source_format, target_format)

    if engine == "libreoffice":
        pages = page_count or max(1, file_size_bytes // 50_000)
        return max(1, pages // 2)
    else:
        mb = max(1, file_size_bytes // (1024 * 1024))
        return max(1, mb)
