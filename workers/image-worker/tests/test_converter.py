"""
Unit tests for image converter module.
Requirements: 7.2, 7.3, 7.4, 7.5
"""
import io
import pytest
from PIL import Image
import piexif

from src.converter import (
    convert_image,
    resize_image,
    check_dimensions,
    ImageDimensionError,
    UnsupportedFormatError,
    MAX_DIMENSION,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_image(width: int, height: int, mode: str = "RGB", color=(255, 0, 0)) -> bytes:
    """Create a minimal in-memory image and return its PNG bytes."""
    img = Image.new(mode, (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_jpeg(width: int, height: int, quality: int = 90) -> bytes:
    """Create a JPEG with EXIF metadata."""
    img = Image.new("RGB", (width, height), (100, 150, 200))
    # Embed minimal EXIF
    exif_dict = {"0th": {piexif.ImageIFD.Make: b"TestCamera"}}
    exif_bytes = piexif.dump(exif_dict)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, exif=exif_bytes)
    return buf.getvalue()


def open_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


# ─── Dimension limits ─────────────────────────────────────────────────────────

class TestDimensionLimits:
    """Requirements: 7.5 — memory limit enforcement for large images."""

    def test_check_dimensions_passes_for_normal_image(self):
        img = Image.new("RGB", (1920, 1080))
        check_dimensions(img)  # should not raise

    def test_check_dimensions_passes_for_max_allowed(self):
        img = Image.new("RGB", (MAX_DIMENSION, 1))
        check_dimensions(img)  # exactly at limit — OK

    def test_check_dimensions_raises_when_width_exceeds_max(self):
        img = Image.new("RGB", (MAX_DIMENSION + 1, 100))
        with pytest.raises(ImageDimensionError, match="exceed maximum"):
            check_dimensions(img)

    def test_check_dimensions_raises_when_height_exceeds_max(self):
        img = Image.new("RGB", (100, MAX_DIMENSION + 1))
        with pytest.raises(ImageDimensionError, match="exceed maximum"):
            check_dimensions(img)

    def test_convert_raises_for_oversized_image(self):
        """convert_image should enforce dimension limits."""
        # Create a large image that exceeds limits
        img = Image.new("RGB", (MAX_DIMENSION + 1, 100), (0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        oversized_data = buf.getvalue()

        with pytest.raises(ImageDimensionError):
            convert_image(oversized_data, "jpg")


# ─── Format conversion ────────────────────────────────────────────────────────

class TestFormatConversion:
    """Requirements: 7.1 — format conversion."""

    def test_convert_png_to_jpg(self):
        source = make_image(100, 100)
        result = convert_image(source, "jpg")
        out = open_image(result)
        assert out.format == "JPEG"

    def test_convert_png_to_webp(self):
        source = make_image(100, 100)
        result = convert_image(source, "webp")
        out = open_image(result)
        assert out.format == "WEBP"

    def test_convert_png_to_bmp(self):
        source = make_image(100, 100)
        result = convert_image(source, "bmp")
        out = open_image(result)
        assert out.format == "BMP"

    def test_convert_png_to_tiff(self):
        source = make_image(100, 100)
        result = convert_image(source, "tiff")
        out = open_image(result)
        assert out.format == "TIFF"

    def test_convert_jpg_to_png(self):
        source = make_jpeg(100, 100)
        result = convert_image(source, "png")
        out = open_image(result)
        assert out.format == "PNG"

    def test_convert_rgba_png_to_jpg_flattens_transparency(self):
        """JPEG does not support transparency — converter should flatten to white."""
        source = make_image(100, 100, mode="RGBA", color=(255, 0, 0, 128))
        result = convert_image(source, "jpg")
        out = open_image(result)
        assert out.format == "JPEG"
        assert out.mode == "RGB"

    def test_unsupported_format_raises_error(self):
        source = make_image(50, 50)
        with pytest.raises(UnsupportedFormatError):
            convert_image(source, "xyz_unknown")

    def test_target_format_is_case_insensitive(self):
        source = make_image(50, 50)
        result_lower = convert_image(source, "jpg")
        result_upper = convert_image(source, "JPG")
        # Both should produce valid JPEG data
        assert open_image(result_lower).format == "JPEG"
        assert open_image(result_upper).format == "JPEG"


# ─── Resizing ─────────────────────────────────────────────────────────────────

class TestResizing:
    """Requirements: 7.2 — image resizing."""

    def test_resize_to_exact_dimensions(self):
        source = make_image(400, 300)
        result = convert_image(source, "png", width=200, height=150)
        out = open_image(result)
        assert out.size == (200, 150)

    def test_resize_by_width_only_preserves_aspect_ratio(self):
        source = make_image(400, 200)  # 2:1 aspect ratio
        result = convert_image(source, "png", width=200)
        out = open_image(result)
        assert out.size[0] == 200
        assert out.size[1] == 100  # height scaled proportionally

    def test_resize_by_height_only_preserves_aspect_ratio(self):
        source = make_image(400, 200)  # 2:1 aspect ratio
        result = convert_image(source, "png", height=100)
        out = open_image(result)
        assert out.size[0] == 200  # width scaled proportionally
        assert out.size[1] == 100

    def test_no_resize_when_dimensions_not_specified(self):
        source = make_image(300, 200)
        result = convert_image(source, "png")
        out = open_image(result)
        assert out.size == (300, 200)

    def test_resize_image_helper_both_dimensions(self):
        img = Image.new("RGB", (400, 300))
        resized = resize_image(img, 200, 150)
        assert resized.size == (200, 150)

    def test_resize_image_helper_width_only(self):
        img = Image.new("RGB", (400, 200))
        resized = resize_image(img, 200, None)
        assert resized.size == (200, 100)

    def test_resize_image_helper_height_only(self):
        img = Image.new("RGB", (400, 200))
        resized = resize_image(img, None, 100)
        assert resized.size == (200, 100)

    def test_resize_image_helper_no_op(self):
        img = Image.new("RGB", (400, 200))
        resized = resize_image(img, None, None)
        assert resized.size == (400, 200)


# ─── Quality adjustment ────────────────────────────────────────────────────────

class TestQualityAdjustment:
    """Requirements: 7.3 — quality setting."""

    def test_lower_quality_produces_smaller_file(self):
        source = make_image(500, 500)
        high_q = convert_image(source, "jpg", quality=95)
        low_q = convert_image(source, "jpg", quality=10)
        # Lower quality JPEG should be smaller
        assert len(low_q) < len(high_q)

    def test_webp_quality_setting(self):
        # Use a noisy image so quality differences produce measurable size differences
        import random
        img = Image.new("RGB", (200, 200))
        pixels = [(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
                  for _ in range(200 * 200)]
        img.putdata(pixels)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        source = buf.getvalue()

        high_q = convert_image(source, "webp", quality=90)
        low_q = convert_image(source, "webp", quality=10)
        assert len(low_q) < len(high_q)

    def test_quality_clamped_to_100(self):
        source = make_image(100, 100)
        # Should not raise even with out-of-range quality
        result = convert_image(source, "jpg", quality=150)
        out = open_image(result)
        assert out.format == "JPEG"

    def test_quality_clamped_to_1(self):
        source = make_image(100, 100)
        result = convert_image(source, "jpg", quality=0)
        out = open_image(result)
        assert out.format == "JPEG"

    def test_no_quality_uses_default(self):
        source = make_image(100, 100)
        result = convert_image(source, "jpg")  # no quality specified
        out = open_image(result)
        assert out.format == "JPEG"


# ─── EXIF metadata preservation ───────────────────────────────────────────────

class TestExifMetadata:
    """Requirements: 7.4 — EXIF metadata preservation."""

    def test_preserve_metadata_true_keeps_exif_in_jpeg(self):
        source = make_jpeg(100, 100)
        result = convert_image(source, "jpg", preserve_metadata=True)
        out_img = Image.open(io.BytesIO(result))
        exif_data = out_img.info.get("exif")
        assert exif_data is not None, "EXIF data should be preserved"
        exif_dict = piexif.load(exif_data)
        assert exif_dict["0th"].get(piexif.ImageIFD.Make) == b"TestCamera"

    def test_preserve_metadata_false_drops_exif(self):
        source = make_jpeg(100, 100)
        result = convert_image(source, "jpg", preserve_metadata=False)
        out_img = Image.open(io.BytesIO(result))
        # When not preserving, exif should be absent or empty
        exif_data = out_img.info.get("exif")
        if exif_data:
            exif_dict = piexif.load(exif_data)
            # Camera make should not be present
            assert piexif.ImageIFD.Make not in exif_dict.get("0th", {})

    def test_image_without_exif_does_not_error_with_preserve_true(self):
        """Non-JPEG images typically have no EXIF — should not raise."""
        source = make_image(100, 100, mode="RGB")  # PNG, no EXIF
        result = convert_image(source, "png", preserve_metadata=True)
        out = open_image(result)
        assert out.format == "PNG"


# ─── Models ──────────────────────────────────────────────────────────────────

class TestModels:
    """Test Pydantic models."""

    def test_conversion_job_valid(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="job-1",
            user_id="user-1",
            source_file_id="file-1",
            source_format="png",
            target_format="jpg",
            status=JobStatus.QUEUED,
        )
        assert job.id == "job-1"
        assert job.status == JobStatus.QUEUED

    def test_conversion_options_defaults(self):
        from src.models import ConversionOptions
        opts = ConversionOptions()
        assert opts.quality is None
        assert opts.width is None
        assert opts.preserve_metadata is False

    def test_conversion_options_with_values(self):
        from src.models import ConversionOptions
        opts = ConversionOptions(quality=80, width=1920, height=1080, preserve_metadata=True)
        assert opts.quality == 80
        assert opts.width == 1920
        assert opts.preserve_metadata is True
