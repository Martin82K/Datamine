"""Tests for the narrow, passive PDF worker protocol."""

import csv
from io import BytesIO
from pathlib import Path
import subprocess
import sys
import unittest

from pypdf import PdfWriter
from pypdf.generic import NameObject, NullObject

from worker.stakeout_pdf import MAX_PAGES, MAX_PDF_BYTES, extract_points, page_points

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "stakeout"


def write_pdf(writer: PdfWriter) -> bytes:
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


class StakeoutPdfTests(unittest.TestCase):
    def test_text_pdf_has_exact_synthetic_points(self) -> None:
        with (FIXTURES / "expected.csv").open(encoding="utf-8-sig", newline="") as expected:
            rows = list(csv.reader(expected))[1:]
        points = extract_points((FIXTURES / "synthetic.pdf").read_bytes())
        self.assertEqual([point["code"] for point in points], [row[0] for row in rows])
        self.assertEqual([point["point"] for point in points], [[float(value) for value in row[1:]] for row in rows])
        self.assertEqual([(point["page"], point["row"]) for point in points], [(1, 4), (1, 5), (1, 6)])

    def test_rejects_non_numeric_and_unlabelled_columns(self) -> None:
        self.assertEqual(list(page_points("BOD N E Z\nP01 1.23 5.20 4.56", 1)), [])
        for row in ("P01 1.0 -inf 2.0", "P01 1e5 2.0 3.0", "=P01 1.0 2.0 3.0", "P01 1.0 2.0"):
            with self.subTest(row=row), self.assertRaisesRegex(ValueError, "invalid survey row"):
                list(page_points("BOD E N Z\n" + row, 1))

    def test_rejects_oversized_and_non_pdf_inputs(self) -> None:
        for data in (b"synthetic input", b"%PDF-" + b"0" * MAX_PDF_BYTES):
            with self.subTest(size=len(data)), self.assertRaisesRegex(ValueError, "unsupported PDF"):
                extract_points(data)

    def test_rejects_active_content_without_resolving_it(self) -> None:
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.root_object[NameObject("/OpenAction")] = NullObject()
        with self.assertRaisesRegex(ValueError, "unsupported document features"):
            extract_points(write_pdf(writer))

    def test_rejects_encryption_empty_tables_and_excess_pages(self) -> None:
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        with self.assertRaisesRegex(ValueError, "no survey table"):
            extract_points(write_pdf(writer))
        for _ in range(MAX_PAGES):
            writer.add_blank_page(width=100, height=100)
        with self.assertRaisesRegex(ValueError, "page limit"):
            extract_points(write_pdf(writer))
        writer.encrypt("synthetic-password")
        with self.assertRaisesRegex(ValueError, "encrypted PDF"):
            extract_points(write_pdf(writer))

    def test_failed_worker_never_echoes_input(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "worker.stakeout_pdf"],
            input=b"synthetic private text",
            capture_output=True,
            check=False,
        )
        self.assertEqual((completed.returncode, completed.stdout, completed.stderr), (2, b"", b""))


if __name__ == "__main__":
    unittest.main()
