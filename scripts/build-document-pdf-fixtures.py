"""Deterministic synthetic PDF evaluation inputs; no live Vault data.

Run with bundled reportlab/Pillow, --output NEW_DIRECTORY --font PATH_TO_KOREAN_TTF.
Generated files are QA intermediates, not production documents. Never executes
embedded source code or opens external links.
"""
import argparse
import hashlib
import json
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--font', required=True)
args = parser.parse_args()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)
pdfmetrics.registerFont(TTFont('FixtureKorean', args.font))
queries = []

def make(name):
    c = Canvas(str(output / name), pagesize=(612, 792), invariant=1, pageCompression=0)
    c.setTitle('MCPVault synthetic evaluation - ' + name)
    c.setAuthor('MCPVault test fixture')
    return c

def line(c, x, y, text, size=12):
    c.setFont('FixtureKorean', size)
    c.drawString(x, y, text)

native = make('native-bilingual.pdf')
line(native, 48, 744, 'NATIVE - verified text and qualifiers', 17)
for i, text in enumerate([
    'native001: Launch requires two independent approvals.',
    'native002: Do not launch when validation fails.',
    'native003: The maximum queue is 3 jobs, not 30.',
    'native004: A warning is not evidence of success.',
    'native005: Recheck the exact source revision before reuse.',
]):
    line(native, 48, 690 - i * 38, text)
    queries.append({'pdf': 'native-bilingual.pdf', 'page': 1, 'query': text.split(':')[0], 'required': text})
native.showPage()
line(native, 48, 744, '네이티브 - 조건 및 부정 표현', 17)
for i, text in enumerate([
    'native006: 검증 없이 실행하지 않는다.',
    'native007: 승인된 경우에만 다음 단계로 이동한다.',
    'native008: 제한은 5개이며 50개가 아니다.',
    'native009: 원본 해시가 변경되면 다시 읽는다.',
    'native010: 실패한 페이지를 성공으로 간주하지 않는다.',
]):
    line(native, 48, 690 - i * 38, text)
    queries.append({'pdf': 'native-bilingual.pdf', 'page': 2, 'query': text.split(':')[0], 'required': text})
native.save()

complex_pdf = make('complex-columns-table.pdf')
line(complex_pdf, 48, 744, 'COMPLEX - columns, table, footnote', 17)
for i, text in enumerate(['column001: Left first.', 'column002: Left second.']):
    line(complex_pdf, 48, 690 - i * 38, text)
for i, text in enumerate(['column003: Right first.', 'column004: Right second.']):
    line(complex_pdf, 325, 690 - i * 38, text)
line(complex_pdf, 48, 550, 'Item')
line(complex_pdf, 280, 550, 'Limit (MB)')
line(complex_pdf, 48, 515, 'table001 - native resource')
line(complex_pdf, 280, 515, '50')
complex_pdf.line(48, 540, 500, 540)
line(complex_pdf, 48, 430, 'footnote001: Estimated capacity [1].')
line(complex_pdf, 48, 110, '[1] Not guaranteed; verify on the same host.', 10)
complex_pdf.save()

scan = Image.new('RGB', (1224, 1584), 'white')
draw = ImageDraw.Draw(scan)
font = ImageFont.truetype(args.font, 29)
scan_lines = [
    'scan001: 검증 없이 실행하지 않는다.',
    'scan002: 승인된 경우에만 다음 단계로 이동한다.',
    'scan003: 제한은 5개이며 50개가 아니다.',
    'scan004: Never treat a failed page as complete.',
    'scan005: Approval is required before deployment.',
]
draw.text((96, 110), 'SCAN - Korean and English', fill='black', font=font)
for i, text in enumerate(scan_lines):
    draw.text((96, 235 + i * 110), text, fill='black', font=font)
    queries.append({'pdf': 'scan-bilingual.pdf', 'page': 1, 'query': text.split(':')[0], 'required': text})
scan.save(output / 'scan-bilingual.png')
scanned = make('scan-bilingual.pdf')
scanned.drawImage(ImageReader(scan), 0, 0, width=612, height=792)
scanned.save()
for key in ['column001', 'column002', 'column003', 'column004', 'table001', 'footnote001']:
    queries.append({'pdf': 'complex-columns-table.pdf', 'page': 1, 'query': key,
                    'required': key, 'requiresLayoutReview': True})
manifest = {'version': 1, 'origin': 'synthetic, authored for this repository; no real user documents',
            'fontSha256': hashlib.sha256(Path(args.font).read_bytes()).hexdigest(), 'queries': queries,
            'files': [{'path': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in sorted(output.glob('*.pdf'))]}
(output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'pdfs': len(manifest['files']), 'queries': len(queries), 'output': str(output)}))
