"""Extract only explicitly ordered survey tables from a text PDF on stdin."""

from __future__ import annotations

from collections.abc import Iterator
from io import BytesIO
import json
import re
import sys
from typing import TypedDict

from pypdf import PdfReader

MAX_PDF_BYTES = 2 * 1024 * 1024
MAX_POINTS = 1000
MAX_PAGES = 20
MAX_PAGE_TEXT = 100_000
CODE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,39}")
COORDINATE = re.compile(r"[+-]?[0-9]{1,9}(?:[.,][0-9]{1,6})?")
HEADER = ["BOD", "E", "N", "Z"]


class Point(TypedDict):
    code: str
    name: str
    point: list[float]
    kind: str
    page: int
    row: int


def page_points(text: str, page: int) -> Iterator[Point]:
    if len(text) > MAX_PAGE_TEXT:
        raise ValueError("unsupported PDF")

    in_table = False
    for row, line in enumerate(text.splitlines(), start=1):
        columns = line.split()
        if [column.upper() for column in columns] == HEADER:
            in_table = True
            continue
        if not columns:
            in_table = False
            continue
        if not in_table:
            continue
        if (
            len(columns) != 4
            or not CODE.fullmatch(columns[0])
            or not all(COORDINATE.fullmatch(value) for value in columns[1:])
        ):
            raise ValueError("invalid survey row")
        code = columns[0]
        yield {
            "code": code,
            "name": code,
            "point": [float(value.replace(",", ".")) for value in columns[1:]],
            "kind": "Vytyčovací body",
            "page": page,
            "row": row,
        }


def extract_points(data: bytes) -> list[Point]:
    if not data.startswith(b"%PDF-") or len(data) > MAX_PDF_BYTES:
        raise ValueError("unsupported PDF")
    reader = PdfReader(BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError("encrypted PDF")
    catalog = reader.root_object
    if any(key in catalog for key in ("/OpenAction", "/AA", "/AcroForm", "/Names")):
        raise ValueError("unsupported document features")
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        raise ValueError("page limit")

    points: list[Point] = []
    seen: set[str] = set()
    for page_number, page in enumerate(reader.pages, start=1):
        if "/AA" in page or "/Annots" in page:
            raise ValueError("unsupported page features")
        for point in page_points(page.extract_text(), page_number):
            code = point["code"].upper()
            if code in seen or len(points) >= MAX_POINTS:
                raise ValueError("duplicate point or point limit")
            seen.add(code)
            points.append(point)
    if not points:
        raise ValueError("no survey table")
    return points


def main() -> int:
    try:
        data = sys.stdin.buffer.read(MAX_PDF_BYTES + 1)
        payload = json.dumps({"points": extract_points(data)}, ensure_ascii=True, allow_nan=False)
    except Exception:
        # Parse errors never contain document contents or local paths on either output pipe.
        return 2
    sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
