"""
Unit tests for document conversion logic.
Requirements: 9.2, 9.3, 9.4, 9.5
"""
import pytest

from src.converter import (
    select_engine,
    build_libreoffice_command,
    build_pandoc_command,
    validate_document_format,
    estimate_conversion_time_seconds,
    DocumentConversionError,
    UnsupportedFormatError,
    LIBREOFFICE_FORMATS,
    PANDOC_FORMATS,
    LIBREOFFICE_ONLY,
    PANDOC_PREFERRED_SOURCES,
    PANDOC_PREFERRED_TARGETS,
)


# ─── TestSelectEngine ─────────────────────────────────────────────────────────

class TestSelectEngine:
    """Requirements: 9.1, 9.2, 9.3 — engine selection logic."""

    def test_docx_to_pdf_uses_libreoffice(self):
        assert select_engine("docx", "pdf") == "libreoffice"

    def test_md_to_html_uses_pandoc(self):
        assert select_engine("md", "html") == "pandoc"

    def test_rst_to_docx_uses_pandoc(self):
        # rst is pandoc-preferred source
        assert select_engine("rst", "docx") == "pandoc"

    def test_pptx_to_pdf_uses_libreoffice(self):
        # pptx is libreoffice-only
        assert select_engine("pptx", "pdf") == "libreoffice"

    def test_xls_to_csv_uses_libreoffice(self):
        # xls is libreoffice-only
        assert select_engine("xls", "csv") == "libreoffice"

    def test_doc_to_html_uses_libreoffice(self):
        # doc is libreoffice-only
        assert select_engine("doc", "html") == "libreoffice"

    def test_txt_to_pdf_uses_libreoffice(self):
        # txt falls back to LibreOffice (not pandoc-preferred source)
        assert select_engine("txt", "pdf") == "libreoffice"

    def test_md_to_pdf_uses_pandoc(self):
        # md is pandoc-preferred source
        assert select_engine("md", "pdf") == "pandoc"

    def test_unsupported_pair_raises_unsupported_format_error(self):
        with pytest.raises(UnsupportedFormatError):
            select_engine("mp4", "xyz_unknown")

    def test_unsupported_format_error_is_subclass_of_document_conversion_error(self):
        with pytest.raises(DocumentConversionError):
            select_engine("xyz", "abc")

    def test_engine_selection_is_case_insensitive_upper(self):
        assert select_engine("DOCX", "PDF") == "libreoffice"

    def test_engine_selection_is_case_insensitive_mixed(self):
        assert select_engine("Md", "Html") == "pandoc"

    def test_engine_selection_strips_whitespace(self):
        assert select_engine("  docx  ", "  pdf  ") == "libreoffice"

    def test_epub_to_html_uses_pandoc(self):
        # epub is pandoc-preferred source, html is pandoc-preferred target
        assert select_engine("epub", "html") == "pandoc"

    def test_latex_to_md_uses_pandoc(self):
        # tex is pandoc-preferred source
        assert select_engine("latex", "md") == "pandoc"

    def test_odt_to_docx_uses_libreoffice(self):
        # odt is in libreoffice_formats and not libreoffice_only so falls through to libreoffice default
        assert select_engine("odt", "docx") == "libreoffice"

    def test_docx_to_md_uses_pandoc(self):
        # md is pandoc-preferred target
        assert select_engine("docx", "md") == "pandoc"

    def test_rtf_to_pdf_uses_libreoffice(self):
        # rtf is libreoffice-only
        assert select_engine("rtf", "pdf") == "libreoffice"

    def test_xlsx_to_pdf_uses_libreoffice(self):
        # xlsx is libreoffice-only
        assert select_engine("xlsx", "pdf") == "libreoffice"

    def test_ods_to_csv_uses_libreoffice(self):
        # ods is libreoffice-only
        assert select_engine("ods", "csv") == "libreoffice"


# ─── TestBuildLibreOfficeCommand ──────────────────────────────────────────────

class TestBuildLibreOfficeCommand:
    """Requirements: 9.2, 9.4 — LibreOffice headless command construction."""

    def test_basic_command_structure(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "pdf")
        assert cmd[0] == "libreoffice"

    def test_headless_flag_present(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "pdf")
        assert "--headless" in cmd

    def test_norestore_flag_present(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "pdf")
        assert "--norestore" in cmd

    def test_convert_to_flag_with_correct_format(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "pdf")
        assert "--convert-to" in cmd
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "pdf"

    def test_outdir_flag_with_correct_directory(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out/dir", "pdf")
        assert "--outdir" in cmd
        idx = cmd.index("--outdir")
        assert cmd[idx + 1] == "/out/dir"

    def test_input_path_is_last_argument(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "pdf")
        assert cmd[-1] == "/in/doc.docx"

    def test_target_format_is_lowercased(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "PDF")
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "pdf"

    def test_target_format_whitespace_stripped(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "  docx  ")
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "docx"

    def test_html_target_produces_valid_command(self):
        cmd = build_libreoffice_command("/in/doc.odt", "/out", "html")
        assert "--convert-to" in cmd
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "html"

    def test_docx_target_produces_valid_command(self):
        cmd = build_libreoffice_command("/in/doc.odt", "/out", "docx")
        assert "--convert-to" in cmd
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "docx"

    def test_odt_target_produces_valid_command(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "odt")
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "odt"

    def test_txt_target_produces_valid_command(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "txt")
        idx = cmd.index("--convert-to")
        assert cmd[idx + 1] == "txt"

    def test_all_office_targets_produce_libreoffice_commands(self):
        for fmt in ["pdf", "docx", "odt", "html", "txt", "csv"]:
            cmd = build_libreoffice_command("/in/doc.docx", "/out", fmt)
            assert cmd[0] == "libreoffice"
            assert cmd[-1] == "/in/doc.docx"

    def test_command_order_headless_before_convert(self):
        cmd = build_libreoffice_command("/in/doc.docx", "/out", "pdf")
        assert cmd.index("--headless") < cmd.index("--convert-to")


# ─── TestBuildPandocCommand ───────────────────────────────────────────────────

class TestBuildPandocCommand:
    """Requirements: 9.3, 9.5 — Pandoc command construction."""

    def test_basic_command_structure(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html")
        assert cmd[0] == "pandoc"

    def test_input_path_present(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html")
        assert "input.md" in cmd

    def test_from_flag_with_correct_source_format(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html")
        assert "--from" in cmd
        idx = cmd.index("--from")
        assert cmd[idx + 1] == "md"

    def test_to_flag_with_correct_target_format(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html")
        assert "--to" in cmd
        idx = cmd.index("--to")
        assert cmd[idx + 1] == "html"

    def test_output_flag_with_correct_path(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html")
        assert "--output" in cmd
        idx = cmd.index("--output")
        assert cmd[idx + 1] == "output.html"

    def test_standalone_flag_included_when_true(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html", standalone=True)
        assert "--standalone" in cmd

    def test_standalone_flag_not_included_when_false(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html", standalone=False)
        assert "--standalone" not in cmd

    def test_standalone_flag_not_included_by_default(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html")
        assert "--standalone" not in cmd

    def test_wrap_preserve_included_when_preserve_structure_true(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html", preserve_structure=True)
        assert "--wrap" in cmd
        idx = cmd.index("--wrap")
        assert cmd[idx + 1] == "preserve"

    def test_wrap_preserve_not_included_when_preserve_structure_false(self):
        cmd = build_pandoc_command("input.md", "output.html", "md", "html", preserve_structure=False)
        assert "--wrap" not in cmd

    def test_source_format_is_lowercased(self):
        cmd = build_pandoc_command("input.md", "output.html", "MD", "HTML")
        idx = cmd.index("--from")
        assert cmd[idx + 1] == "md"

    def test_target_format_is_lowercased(self):
        cmd = build_pandoc_command("input.md", "output.html", "MD", "HTML")
        idx = cmd.index("--to")
        assert cmd[idx + 1] == "html"

    def test_formats_are_whitespace_stripped(self):
        cmd = build_pandoc_command("input.md", "output.html", " rst ", " docx ")
        assert cmd[cmd.index("--from") + 1] == "rst"
        assert cmd[cmd.index("--to") + 1] == "docx"

    def test_rst_to_html_produces_valid_command(self):
        cmd = build_pandoc_command("input.rst", "output.html", "rst", "html")
        assert cmd[0] == "pandoc"
        assert cmd[cmd.index("--from") + 1] == "rst"

    def test_md_to_docx_produces_valid_command(self):
        cmd = build_pandoc_command("input.md", "output.docx", "md", "docx")
        assert "--from" in cmd
        assert cmd[cmd.index("--to") + 1] == "docx"

    def test_tex_to_md_produces_valid_command(self):
        cmd = build_pandoc_command("input.tex", "output.md", "tex", "md")
        assert cmd[0] == "pandoc"

    def test_epub_to_html_produces_valid_command(self):
        cmd = build_pandoc_command("input.epub", "output.html", "epub", "html")
        assert cmd[0] == "pandoc"

    def test_both_flags_present_together(self):
        cmd = build_pandoc_command(
            "input.md", "output.html", "md", "html",
            standalone=True, preserve_structure=True
        )
        assert "--standalone" in cmd
        assert "--wrap" in cmd


# ─── TestValidateDocumentFormat ───────────────────────────────────────────────

class TestValidateDocumentFormat:
    """Format validation for supported document types."""

    def test_pdf_is_valid(self):
        assert validate_document_format("pdf") is True

    def test_docx_is_valid(self):
        assert validate_document_format("docx") is True

    def test_md_is_valid(self):
        assert validate_document_format("md") is True

    def test_html_is_valid(self):
        assert validate_document_format("html") is True

    def test_odt_is_valid(self):
        assert validate_document_format("odt") is True

    def test_txt_is_valid(self):
        assert validate_document_format("txt") is True

    def test_rst_is_valid(self):
        assert validate_document_format("rst") is True

    def test_epub_is_valid(self):
        assert validate_document_format("epub") is True

    def test_mp4_is_not_valid(self):
        assert validate_document_format("mp4") is False

    def test_mp3_is_not_valid(self):
        assert validate_document_format("mp3") is False

    def test_jpg_is_not_valid(self):
        assert validate_document_format("jpg") is False

    def test_empty_string_is_not_valid(self):
        assert validate_document_format("") is False

    def test_unknown_format_is_not_valid(self):
        assert validate_document_format("xyz_unknown") is False

    def test_validation_is_case_insensitive(self):
        assert validate_document_format("PDF") is True
        assert validate_document_format("DOCX") is True
        assert validate_document_format("MD") is True


# ─── TestEstimateConversionTime ───────────────────────────────────────────────

class TestEstimateConversionTime:
    """Requirements: 9.6 — conversion time estimation."""

    def test_libreoffice_path_returns_at_least_one_second(self):
        t = estimate_conversion_time_seconds("docx", "pdf", 1024)
        assert t >= 1

    def test_small_file_returns_minimum_one_second(self):
        t = estimate_conversion_time_seconds("docx", "pdf", 100)
        assert t == 1

    def test_large_file_with_many_pages_takes_longer(self):
        small = estimate_conversion_time_seconds("docx", "pdf", 50_000, page_count=2)
        large = estimate_conversion_time_seconds("docx", "pdf", 50_000, page_count=100)
        assert large > small

    def test_pandoc_path_returns_at_least_one_second(self):
        t = estimate_conversion_time_seconds("md", "html", 1024)
        assert t >= 1

    def test_pandoc_path_faster_than_libreoffice_for_same_size(self):
        # LibreOffice: estimate pages, Pandoc: estimate by MB
        # 10MB file: LibreOffice = max(1, 200//2) = 100s, Pandoc = max(1, 10) = 10s
        lo_time = estimate_conversion_time_seconds("docx", "pdf", 10 * 1024 * 1024)
        pd_time = estimate_conversion_time_seconds("md", "html", 10 * 1024 * 1024)
        assert pd_time < lo_time

    def test_page_count_used_when_provided(self):
        t_with_pages = estimate_conversion_time_seconds("docx", "pdf", 1024, page_count=20)
        t_no_pages = estimate_conversion_time_seconds("docx", "pdf", 1024)
        # 20 pages -> max(1, 20//2) = 10, while 1024 bytes -> max(1,1//50000)=1 page -> 1
        assert t_with_pages > t_no_pages

    def test_large_file_many_pages_libreoffice_scales(self):
        t = estimate_conversion_time_seconds("docx", "pdf", 500_000, page_count=100)
        assert t == 50  # max(1, 100//2) = 50

    def test_pandoc_large_file_scales_with_mb(self):
        t = estimate_conversion_time_seconds("md", "html", 5 * 1024 * 1024)
        assert t == 5  # max(1, 5) = 5


# ─── TestModels ───────────────────────────────────────────────────────────────

class TestModels:
    """ConversionJob, ConversionOptions, JobResult, JobStatus model validation."""

    def test_conversion_job_model_creation(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j1", user_id="u1", source_file_id="f1",
            source_format="docx", target_format="pdf", status=JobStatus.QUEUED
        )
        assert job.target_format == "pdf"
        assert job.status == JobStatus.QUEUED

    def test_conversion_options_defaults(self):
        from src.models import ConversionOptions
        opts = ConversionOptions()
        assert opts.codec is None
        assert opts.bitrate is None
        assert opts.preserve_metadata is False
        assert opts.standalone is False
        assert opts.preserve_structure is True

    def test_job_status_enum_queued(self):
        from src.models import JobStatus
        assert JobStatus.QUEUED == "queued"

    def test_job_status_enum_processing(self):
        from src.models import JobStatus
        assert JobStatus.PROCESSING == "processing"

    def test_job_status_enum_completed(self):
        from src.models import JobStatus
        assert JobStatus.COMPLETED == "completed"

    def test_job_status_enum_failed(self):
        from src.models import JobStatus
        assert JobStatus.FAILED == "failed"

    def test_job_result_model_creation(self):
        from src.models import JobResult
        result = JobResult(
            job_id="j1", result_file_id="f2",
            output_size=2048, processing_time_ms=800
        )
        assert result.job_id == "j1"
        assert result.output_size == 2048
        assert result.processing_time_ms == 800

    def test_conversion_job_optional_options(self):
        from src.models import ConversionJob, JobStatus
        job = ConversionJob(
            id="j2", user_id="u2", source_file_id="f2",
            source_format="md", target_format="html", status=JobStatus.PROCESSING
        )
        assert job.options is None

    def test_conversion_options_with_standalone(self):
        from src.models import ConversionOptions
        opts = ConversionOptions(standalone=True, preserve_structure=False)
        assert opts.standalone is True
        assert opts.preserve_structure is False
