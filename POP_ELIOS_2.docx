#!/usr/bin/env python3
"""
docx_to_json.py — Converte um documento Word (.docx) no padrão XD4Solutions
(capítulos "# 1. TÍTULO", subseções "## 1.1 Título", sub-subseções "### 1.1.1 Título",
tabelas, e caixas de aviso) para o formato JSON usado pelo Portal de Operações (Blue Book).

Uso:
    python3 docx_to_json.py entrada.docx saida.json

Requisitos: pandoc instalado no sistema, biblioteca beautifulsoup4 (pip install beautifulsoup4)
"""
import sys
import re
import json
import subprocess
import tempfile
import os
from bs4 import BeautifulSoup


def docx_to_html(docx_path, html_path):
    """Usa o pandoc para converter o .docx em HTML bruto."""
    subprocess.run(
        ["pandoc", "-f", "docx", "-t", "html", docx_path, "-o", html_path, "--wrap=none"],
        check=True, capture_output=True
    )


def clean_html_fragment(el):
    """Remove atributos supérfluos gerados pelo pandoc, preservando apenas a estrutura."""
    for tag in el.find_all(True):
        attrs = dict(tag.attrs)
        for a in list(attrs.keys()):
            if a not in ("colspan", "rowspan"):
                del tag.attrs[a]
    return str(el)


def convert_callouts(html):
    """Converte tabelas de célula única (caixas de aviso do Word) em blocos de destaque (callout)."""
    pattern = re.compile(
        r"<table>\s*<colgroup>\s*<col/>\s*</colgroup>\s*<thead>\s*<tr>\s*<th>(.*?)</th>\s*</tr>\s*</thead>\s*<tbody>\s*</tbody>\s*</table>",
        re.S,
    )

    def repl(m):
        inner = m.group(1).strip()
        inner_clean = re.sub(r"</p>\s*<p>", " ", inner)
        inner_clean = re.sub(r"^<p>|</p>$", "", inner_clean).strip()
        is_crit = bool(re.search(r"CR[ÍI]TICA|ATEN[ÇC][ÃA]O", inner_clean, re.I))
        cls = "crit" if is_crit else "note"
        icon = "⚠" if is_crit else "ℹ"
        # extrai o texto em negrito inicial (se houver) como rótulo do callout
        label_match = re.match(r"^<strong>(.*?)</strong>\s*(.*)$", inner_clean, re.S)
        if label_match:
            label, resto = label_match.groups()
            return f'<div class="callout {cls}"><div class="ci">{icon}</div><div><b>{label}</b>{resto}</div></div>'
        return f'<div class="callout {cls}"><div class="ci">{icon}</div><div>{inner_clean}</div></div>'

    return pattern.sub(repl, html)


def parse_docx_to_chapters(docx_path):
    with tempfile.TemporaryDirectory() as tmp:
        html_path = os.path.join(tmp, "out.html")
        docx_to_html(docx_path, html_path)
        with open(html_path, encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")

    body = soup.body if soup.body else soup
    elements = list(body.find_all(["h1", "h2", "p", "ul", "ol", "table"], recursive=False))

    # pula o Sumário (TOC) — cabeçalhos vazios ou antes do primeiro "1. ALGUMTITULO"
    start_idx = 0
    for i, el in enumerate(elements):
        if el.name in ("h1", "h2") and el.get_text(strip=True):
            txt = el.get_text(strip=True)
            if re.match(r"^\d+\.", txt):
                start_idx = i
                break
    elements = elements[start_idx:]

    heading_re = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$")

    chapters = []
    cur_chapter = None
    cur_section_html = []
    cur_section_num = None
    cur_section_title = None

    def flush_section():
        nonlocal cur_section_html
        if cur_chapter is not None and cur_section_num is not None:
            html = "".join(cur_section_html)
            html = convert_callouts(html)
            cur_chapter["sections"].append(
                {"num": cur_section_num, "title": cur_section_title, "html": html}
            )
        cur_section_html = []

    for el in elements:
        if el.name in ("h1", "h2"):
            text = el.get_text(strip=True)
            if not text:
                continue
            m = heading_re.match(text)
            if not m:
                continue
            num, title = m.group(1), m.group(2).strip()
            title = re.sub(r"^\*+|\*+$", "", title).strip()
            parts = num.split(".")
            if len(parts) == 1:
                flush_section()
                cur_chapter = {"num": num, "title": title, "sections": []}
                chapters.append(cur_chapter)
                cur_section_num, cur_section_title = num + ".0", title
            else:
                flush_section()
                cur_section_num, cur_section_title = num, title
        else:
            if cur_chapter is None:
                continue
            cur_section_html.append(clean_html_fragment(el))

    flush_section()
    return chapters


def main():
    if len(sys.argv) != 3:
        print("Uso: python3 docx_to_json.py entrada.docx saida.json")
        sys.exit(1)

    docx_path, json_path = sys.argv[1], sys.argv[2]
    chapters = parse_docx_to_chapters(docx_path)

    total_sections = sum(len(c["sections"]) for c in chapters)
    if not chapters or total_sections == 0:
        print(f"AVISO: nenhum capítulo reconhecido em {docx_path}. "
              f"Verifique se os títulos seguem o padrão '1. TÍTULO', '1.1 Subtítulo' etc.")
        sys.exit(2)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(chapters, f, ensure_ascii=False)

    print(f"OK: {docx_path} -> {json_path} ({len(chapters)} capítulos, {total_sections} seções)")


if __name__ == "__main__":
    main()
