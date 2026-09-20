from __future__ import annotations
import io
from typing import Optional
from PIL import Image
import piexif

# Maximum image dimensions for safety
MAX_DIMENSION = 10_000
MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION

# Supported target formats and their PIL mode requirements
FORMAT_PIL_MAP = {
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "png": "PNG",
    "webp": "WEBP",
    "tiff": "TIFF",
    "bmp": "BMP",
    "gif": "GIF",
}

# Formats that support transparency (RGBA mode)
RGBA_FORMATS = {"png", "webp", "gif"}
# Formats that require RGB
RGB_FORMATS = {"jpg", "jpeg", "bmp", "tiff"}


class ImageConversionError(Exception):
    """Raised when image conversion fails."""
    pass


class ImageDimensionError(ImageConversionError):
    """Raised when image exceeds maximum allowed dimensions."""
    pass


class UnsupportedFormatError(ImageConversionError):
    """Raised when target format is not supported."""
    pass


def check_dimensions(img: Image.Image) -> None:
    """
    Validate that image dimensions are within allowed limits.
    Raises ImageDimensionError if dimensions exceed MAX_DIMENSION or MAX_PIXELS.
    Requirements: 7.5
    """
    w, h = img.size
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        raise ImageDimensionError(
            f"Image dimensions {w}x{h} exceed maximum allowed {MAX_DIMENSION}x{MAX_DIMENSION}"
        )
    if w * h > MAX_PIXELS:
        raise ImageDimensionError(
            f"Image pixel count {w * h} exceeds maximum allowed {MAX_PIXELS}"
        )


def resize_image(img: Image.Image, width: Optional[int], height: Optional[int]) -> Image.Image:
    """
    Resize image to target dimensions while preserving aspect ratio
    if only one dimension is specified.
    Requirements: 7.2
    """
    if width is None and height is None:
        return img

    orig_w, orig_h = img.size

    if width and height:
        # Both specified: resize to exact dimensions
        return img.resize((width, height), Image.LANCZOS)
    elif width:
        # Only width: scale height proportionally
        ratio = width / orig_w
        new_h = int(orig_h * ratio)
        return img.resize((width, new_h), Image.LANCZOS)
    else:
        # Only height: scale width proportionally
        ratio = height / orig_h  # type: ignore[operator]
        new_w = int(orig_w * ratio)
        return img.resize((new_w, height), Image.LANCZOS)  # type: ignore[arg-type]


def extract_exif(img: Image.Image) -> Optional[bytes]:
    """Extract raw EXIF bytes from image if available."""
    try:
        exif_data = img.info.get("exif")
        if exif_data:
            return exif_data
        # Try piexif for JPEG
        if hasattr(img, "_getexif") and img._getexif():  # type: ignore[attr-defined]
            return piexif.dump(piexif.load(img.info.get("exif", b"")))
    except Exception:
        pass
    return None


def convert_image(
    image_data: bytes,
    target_format: str,
    quality: Optional[int] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    preserve_metadata: bool = False,
) -> bytes:
    """
    Convert image data to the target format with optional transformations.

    Requirements: 7.1, 7.2, 7.3, 7.4, 7.5

    Args:
        image_data: Raw image bytes
        target_format: Target format string (e.g., "jpg", "png", "webp")
        quality: Output quality 1-100 (for JPEG/WEBP)
        width: Target width in pixels (None = preserve)
        height: Target height in pixels (None = preserve)
        preserve_metadata: Whether to preserve EXIF metadata

    Returns:
        Converted image as bytes

    Raises:
        ImageConversionError: If conversion fails
        ImageDimensionError: If image exceeds size limits
        UnsupportedFormatError: If target format is not supported
    """
    fmt = target_format.lower().strip()
    pil_format = FORMAT_PIL_MAP.get(fmt)
    if not pil_format:
        raise UnsupportedFormatError(f"Unsupported target format: {target_format}")

    # Open image
    img = Image.open(io.BytesIO(image_data))

    # Enforce dimension limits
    check_dimensions(img)

    # Extract EXIF before any transforms (EXIF can be lost on mode conversion)
    exif_bytes = extract_exif(img) if preserve_metadata else None

    # Apply resize
    if width or height:
        img = resize_image(img, width, height)

    # Mode conversion: JPEG/BMP require RGB
    if fmt in RGB_FORMATS and img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = background
    elif fmt in RGBA_FORMATS and img.mode not in ("RGBA", "RGB", "L"):
        img = img.convert("RGBA")

    # Build save kwargs
    save_kwargs: dict = {}
    if pil_format in ("JPEG", "WEBP") and quality is not None:
        save_kwargs["quality"] = max(1, min(100, quality))
    if preserve_metadata and exif_bytes:
        save_kwargs["exif"] = exif_bytes

    # Save to bytes
    output = io.BytesIO()
    img.save(output, format=pil_format, **save_kwargs)
    return output.getvalue()
