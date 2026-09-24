"""
Unit tests for CAD and font conversion routing logic.
Requirements: 10.2, 10.3
"""
from __future__ import annotations
import pytest

from src.converter import (
    CAD_SOURCE_FORMATS,
    CAD_TARGET_FORMATS,
    FONT_FORMATS,
    ConversionError,
    InvalidConversionError,
    UnsupportedFormatError,
    build_fonttools_command,
    build_freecad_command,
    classify_job,
    estimate_font_conversion_complexity,
    get_font_family,
    is_cad_format,
    is_font_format,
    validate_cad_conversion,
    validate_font_conversion,
)


# ─── TestIsCADFormat ──────────────────────────────────────────────────────────

class TestIsCADFormat:
    """Requirements: 10.2 — CAD format recognition."""

    def test_dwg_is_cad(self):
        assert is_cad_format("dwg") is True

    def test_dxf_is_cad(self):
        assert is_cad_format("dxf") is True

    def test_step_is_cad(self):
        assert is_cad_format("step") is True

    def test_stl_is_cad(self):
        assert is_cad_format("stl") is True

    def test_pdf_is_cad_target(self):
        assert is_cad_format("pdf") is True

    def test_svg_is_cad_target(self):
        assert is_cad_format("svg") is True

    def test_mp3_is_not_cad(self):
        assert is_cad_format("mp3") is False

    def test_docx_is_not_cad(self):
        assert is_cad_format("docx") is False

    def test_case_insensitive(self):
        assert is_cad_format("DWG") is True
        assert is_cad_format("DXF") is True

    def test_whitespace_stripped(self):
        assert is_cad_format("  dwg  ") is True


# ─── TestIsFontFormat ─────────────────────────────────────────────────────────

class TestIsFontFormat:
    """Requirements: 10.3 — font format recognition."""

    def test_ttf_is_font(self):
        assert is_font_format("ttf") is True

    def test_otf_is_font(self):
        assert is_font_format("otf") is True

    def test_woff_is_font(self):
        assert is_font_format("woff") is True

    def test_woff2_is_font(self):
        assert is_font_format("woff2") is True

    def test_eot_is_font(self):
        assert is_font_format("eot") is True

    def test_svg_is_font(self):
        assert is_font_format("svg") is True

    def test_mp3_is_not_font(self):
        assert is_font_format("mp3") is False

    def test_pdf_is_not_font(self):
        assert is_font_format("pdf") is False

    def test_case_insensitive(self):
        assert is_font_format("TTF") is True
        assert is_font_format("OTF") is True

    def test_whitespace_stripped(self):
        assert is_font_format("  ttf  ") is True


# ─── TestClassifyJob ─────────────────────────────────────────────────────────

class TestClassifyJob:
    """Requirements: 10.2, 10.3 — job type classification."""

    def test_dwg_to_pdf_is_cad(self):
        assert classify_job("dwg", "pdf") == "cad"

    def test_dxf_to_svg_is_cad(self):
        assert classify_job("dxf", "svg") == "cad"

    def test_stl_to_obj_is_cad(self):
        assert classify_job("stl", "obj") == "cad"

    def test_step_to_stl_is_cad(self):
        assert classify_job("step", "stl") == "cad"

    def test_ttf_to_woff_is_font(self):
        assert classify_job("ttf", "woff") == "font"

    def test_otf_to_woff2_is_font(self):
        assert classify_job("otf", "woff2") == "font"

    def test_woff_to_ttf_is_font(self):
        assert classify_job("woff", "ttf") == "font"

    def test_ttf_to_svg_is_font(self):
        assert classify_job("ttf", "svg") == "font"

    def test_cad_to_invalid_target_raises(self):
        with pytest.raises(InvalidConversionError):
            classify_job("dwg", "mp3")

    def test_font_to_invalid_target_raises(self):
        with pytest.raises(InvalidConversionError):
            classify_job("ttf", "pdf")

    def test_unknown_source_raises_unsupported(self):
        with pytest.raises(UnsupportedFormatError):
            classify_job("xyz_unknown", "pdf")

    def test_classification_is_case_insensitive(self):
        assert classify_job("DWG", "PDF") == "cad"
        assert classify_job("TTF", "WOFF") == "font"

    def test_invalid_conversion_is_subclass_of_conversion_error(self):
        with pytest.raises(ConversionError):
            classify_job("dwg", "mp3")


# ─── TestBuildFreecadCommand ──────────────────────────────────────────────────

class TestBuildFreecadCommand:
    """Requirements: 10.2 — FreeCAD command construction."""

    def test_basic_command_structure(self):
        cmd = build_freecad_command("/in/model.dwg", "/out/model.pdf", "dwg", "pdf")
        assert cmd[0] == "freecad"

    def test_console_flag_present(self):
        cmd = build_freecad_command("/in/model.dwg", "/out/model.pdf", "dwg", "pdf")
        assert "--console" in cmd

    def test_input_path_in_script(self):
        cmd = build_freecad_command("/in/model.dwg", "/out/model.pdf", "dwg", "pdf")
        script = cmd[-1]
        assert "/in/model.dwg" in script

    def test_output_path_in_script(self):
        cmd = build_freecad_command("/in/model.dwg", "/out/model.pdf", "dwg", "pdf")
        script = cmd[-1]
        assert "/out/model.pdf" in script

    def test_dxf_to_svg_produces_command(self):
        cmd = build_freecad_command("/in/model.dxf", "/out/model.svg", "dxf", "svg")
        assert cmd[0] == "freecad"

    def test_unsupported_source_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            build_freecad_command("/in/audio.mp3", "/out/model.pdf", "mp3", "pdf")

    def test_unsupported_target_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            build_freecad_command("/in/model.dwg", "/out/audio.mp3", "dwg", "mp3")

    def test_case_insensitive_formats(self):
        cmd = build_freecad_command("/in/model.DWG", "/out/model.PDF", "DWG", "PDF")
        assert cmd[0] == "freecad"


# ─── TestBuildFonttoolsCommand ────────────────────────────────────────────────

class TestBuildFonttoolsCommand:
    """Requirements: 10.3 — fonttools command construction."""

    def test_basic_command_structure(self):
        cmd = build_fonttools_command("/in/font.ttf", "/out/font.woff", "ttf", "woff")
        assert cmd[0] == "python"

    def test_fonttools_module_invoked(self):
        cmd = build_fonttools_command("/in/font.ttf", "/out/font.woff", "ttf", "woff")
        assert "-m" in cmd
        idx = cmd.index("-m")
        assert cmd[idx + 1] == "fonttools"

    def test_output_file_flag_present(self):
        cmd = build_fonttools_command("/in/font.ttf", "/out/font.woff", "ttf", "woff")
        assert "--output-file" in cmd
        idx = cmd.index("--output-file")
        assert cmd[idx + 1] == "/out/font.woff"

    def test_input_path_in_command(self):
        cmd = build_fonttools_command("/in/font.ttf", "/out/font.woff", "ttf", "woff")
        assert "/in/font.ttf" in cmd

    def test_otf_to_woff2_produces_command(self):
        cmd = build_fonttools_command("/in/font.otf", "/out/font.woff2", "otf", "woff2")
        assert cmd[0] == "python"

    def test_unsupported_source_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            build_fonttools_command("/in/audio.mp3", "/out/font.woff", "mp3", "woff")

    def test_unsupported_target_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            build_fonttools_command("/in/font.ttf", "/out/audio.mp3", "ttf", "mp3")

    def test_case_insensitive_formats(self):
        cmd = build_fonttools_command("/in/font.TTF", "/out/font.WOFF", "TTF", "WOFF")
        assert cmd[0] == "python"


# ─── TestValidateCADConversion ────────────────────────────────────────────────

class TestValidateCADConversion:
    """Requirements: 10.2 — CAD conversion pair validation."""

    def test_dwg_to_pdf_valid(self):
        assert validate_cad_conversion("dwg", "pdf") is True

    def test_dxf_to_svg_valid(self):
        assert validate_cad_conversion("dxf", "svg") is True

    def test_stl_to_obj_valid(self):
        assert validate_cad_conversion("stl", "obj") is True

    def test_step_to_stl_valid(self):
        assert validate_cad_conversion("step", "stl") is True

    def test_dwg_to_mp3_invalid(self):
        assert validate_cad_conversion("dwg", "mp3") is False

    def test_mp3_to_pdf_invalid(self):
        assert validate_cad_conversion("mp3", "pdf") is False

    def test_all_cad_source_formats_to_pdf_valid(self):
        for src in CAD_SOURCE_FORMATS:
            assert validate_cad_conversion(src, "pdf") is True

    def test_case_insensitive(self):
        assert validate_cad_conversion("DWG", "PDF") is True


# ─── TestValidateFontConversion ───────────────────────────────────────────────

class TestValidateFontConversion:
    """Requirements: 10.3 — font conversion pair validation."""

    def test_ttf_to_woff_valid(self):
        assert validate_font_conversion("ttf", "woff") is True

    def test_otf_to_woff2_valid(self):
        assert validate_font_conversion("otf", "woff2") is True

    def test_woff_to_ttf_valid(self):
        assert validate_font_conversion("woff", "ttf") is True

    def test_ttf_to_svg_valid(self):
        assert validate_font_conversion("ttf", "svg") is True

    def test_ttf_to_pdf_invalid(self):
        assert validate_font_conversion("ttf", "pdf") is False

    def test_mp3_to_ttf_invalid(self):
        assert validate_font_conversion("mp3", "ttf") is False

    def test_all_font_formats_to_ttf_valid(self):
        for src in FONT_FORMATS:
            assert validate_font_conversion(src, "ttf") is True

    def test_case_insensitive(self):
        assert validate_font_conversion("TTF", "WOFF") is True


# ─── TestGetFontFamily ────────────────────────────────────────────────────────

class TestGetFontFamily:
    """Requirements: 10.3 — font family classification."""

    def test_woff_is_web(self):
        assert get_font_family("woff") == "web"

    def test_woff2_is_web(self):
        assert get_font_family("woff2") == "web"

    def test_eot_is_web(self):
        assert get_font_family("eot") == "web"

    def test_ttf_is_desktop(self):
        assert get_font_family("ttf") == "desktop"

    def test_otf_is_desktop(self):
        assert get_font_family("otf") == "desktop"

    def test_svg_is_vector(self):
        assert get_font_family("svg") == "vector"

    def test_unknown_raises_error(self):
        with pytest.raises(UnsupportedFormatError):
            get_font_family("mp3")

    def test_case_insensitive(self):
        assert get_font_family("TTF") == "desktop"
        assert get_font_family("WOFF") == "web"


# ─── TestEstimateFontConversionComplexity ─────────────────────────────────────

class TestEstimateFontConversionComplexity:
    """Requirements: 10.3 — font conversion complexity."""

    def test_ttf_to_otf_same_family_is_simple(self):
        assert estimate_font_conversion_complexity("ttf", "otf") == "simple"

    def test_woff_to_woff2_same_family_is_simple(self):
        assert estimate_font_conversion_complexity("woff", "woff2") == "simple"

    def test_ttf_to_woff_cross_family_is_moderate(self):
        assert estimate_font_conversion_complexity("ttf", "woff") == "moderate"

    def test_otf_to_woff2_cross_family_is_moderate(self):
        assert estimate_font_conversion_complexity("otf", "woff2") == "moderate"

    def test_ttf_to_svg_involves_vector_is_complex(self):
        assert estimate_font_conversion_complexity("ttf", "svg") == "complex"

    def test_svg_to_ttf_involves_vector_is_complex(self):
        assert estimate_font_conversion_complexity("svg", "ttf") == "complex"

    def test_woff_to_svg_involves_vector_is_complex(self):
        assert estimate_font_conversion_complexity("woff", "svg") == "complex"


# ─── TestModels ───────────────────────────────────────────────────────────────

class TestModels:
    def test_conversion_job_cad(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j1", user_id="u1", source_file_id="f1",
            source_format="dwg", target_format="pdf", status=JobStatus.QUEUED
        )
        assert job.source_format == "dwg"

    def test_conversion_job_font(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j2", user_id="u2", source_file_id="f2",
            source_format="ttf", target_format="woff2", status=JobStatus.PROCESSING
        )
        assert job.target_format == "woff2"

    def test_job_status_values(self):
        from src.models import JobStatus
        assert JobStatus.QUEUED == "queued"
        assert JobStatus.COMPLETED == "completed"

    def test_conversion_options_defaults(self):
        from src.models import ConversionOptions
        opts = ConversionOptions()
        assert opts.quality is None
        assert opts.preserve_metadata is False


# ─── TestConvertMeshStlObj & TestConvertCAD ───────────────────────────────────

class TestConvertCAD:
    def test_mesh_stl_to_obj_and_back(self, tmp_path):
        from src.converter import convert_mesh_stl_obj, convert_cad

        stl_ascii = (
            "solid test\n"
            "  facet normal 0.0 0.0 1.0\n"
            "    outer loop\n"
            "      vertex 0.0 0.0 0.0\n"
            "      vertex 1.0 0.0 0.0\n"
            "      vertex 0.0 1.0 0.0\n"
            "    endloop\n"
            "  endfacet\n"
            "endsolid test\n"
        )
        in_stl = tmp_path / "model.stl"
        out_obj = tmp_path / "model.obj"
        in_stl.write_text(stl_ascii)

        convert_cad(str(in_stl), str(out_obj), "stl", "obj")
        assert out_obj.exists()
        obj_content = out_obj.read_text()
        assert "v " in obj_content
        assert "f " in obj_content

        # Roundtrip back to binary STL
        out_stl = tmp_path / "model_out.stl"
        convert_cad(str(out_obj), str(out_stl), "obj", "stl")
        assert out_stl.exists()
        # Binary STL header (80) + count (4) + 1 triangle (50) = 134 bytes
        assert out_stl.stat().st_size == 134

    def test_invalid_cad_target_raises(self, tmp_path):
        from src.converter import convert_cad, InvalidConversionError

        in_f = tmp_path / "in.dwg"
        out_f = tmp_path / "out.mp3"
        in_f.write_text("dummy")

        with pytest.raises(InvalidConversionError):
            convert_cad(str(in_f), str(out_f), "dwg", "mp3")

    def test_freecad_missing_raises_informative_error(self, tmp_path, monkeypatch):
        import shutil
        from src.converter import convert_cad, ConversionError

        monkeypatch.setattr(shutil, "which", lambda cmd: None)

        in_f = tmp_path / "in.dwg"
        out_f = tmp_path / "out.pdf"
        in_f.write_text("dummy")

        with pytest.raises(ConversionError) as exc_info:
            convert_cad(str(in_f), str(out_f), "dwg", "pdf")
        assert "FreeCAD" in str(exc_info.value)

    def test_freecad_execution_mocked(self, tmp_path, monkeypatch):
        import shutil
        import subprocess
        from src.converter import convert_cad

        monkeypatch.setattr(shutil, "which", lambda cmd: "/usr/bin/freecad")

        in_f = tmp_path / "in.dwg"
        out_f = tmp_path / "out.pdf"
        in_f.write_text("dummy")

        def fake_run(cmd, *args, **kwargs):
            out_f.write_text("%PDF-1.4 dummy pdf")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        monkeypatch.setattr(subprocess, "run", fake_run)

        convert_cad(str(in_f), str(out_f), "dwg", "pdf")
        assert out_f.exists()
        assert out_f.read_text().startswith("%PDF")


class TestWorkerProcessJob:
    def test_process_job_cad_stl_to_obj(self, tmp_path, monkeypatch):
        import sys
        from unittest.mock import MagicMock
        if "redis" not in sys.modules:
            sys.modules["redis"] = MagicMock()

        from src.worker import process_job

        stl_ascii = (
            "solid test\n"
            "  facet normal 0.0 0.0 1.0\n"
            "    outer loop\n"
            "      vertex 0.0 0.0 0.0\n"
            "      vertex 1.0 0.0 0.0\n"
            "      vertex 0.0 1.0 0.0\n"
            "    endloop\n"
            "  endfacet\n"
            "endsolid test\n"
        )
        src_file = tmp_path / "source.stl"
        src_file.write_text(stl_ascii)

        uploaded = {}
        statuses = []

        class FakeS3:
            def download_file(self, bucket, key, filename):
                with open(filename, "wb") as f_out:
                    f_out.write(src_file.read_bytes())

            def upload_file(self, filename, bucket, key, ExtraArgs=None):
                with open(filename, "rb") as f_in:
                    uploaded[key] = f_in.read()

        import src.worker as worker_mod
        monkeypatch.setattr(worker_mod, "make_s3", lambda: FakeS3())
        monkeypatch.setattr(worker_mod, "post_status", lambda url, p: statuses.append(p))

        job_data = {
            "jobId": "test-job-cad-123",
            "sourceFileId": "uploads/source.stl",
            "sourceFormat": "stl",
            "targetFormat": "obj",
            "sourceBucket": "fileconverter-uploads",
            "resultBucket": "fileconverter-results",
            "callbackUrl": "http://localhost:8080/callback",
        }

        process_job(job_data)

        assert any(s.get("status") == "completed" for s in statuses)
        assert len(uploaded) == 1
        result_content = list(uploaded.values())[0].decode()
        assert "v " in result_content
        assert "f " in result_content


