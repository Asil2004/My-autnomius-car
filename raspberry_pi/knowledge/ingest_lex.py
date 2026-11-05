"""
lex.uz hujjatlarini yuklab, modda bo'yicha bo'laklarga ajratadi va knowledge/lex_chunks.json ga yozadi.

Ishlatish:
  python knowledge/ingest_lex.py                      # sources.json dagi barcha havolalar
  python knowledge/ingest_lex.py --url https://lex.uz/docs/-12345 --title "Hujjat nomi"
  python knowledge/ingest_lex.py --html fayl.html --url https://lex.uz/docs/-12345 --title "Hujjat nomi"   # saqlangan HTML dan

Eslatma: lex.uz da ommaviy API yo'q. Skript har so'rov orasida pauza qiladi va o'zini aniq nomlaydi.
Hujjatlardan foydalanish shartlarini Adliya vazirligidan aniqlashtirish tavsiya etiladi.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
USER_AGENT = "QalqonKnowledgeBot/1.0 (lex.uz hujjatlarini o'qish, past tezlikda)"
MAX_CHUNK = 1200

BLOCK_TAGS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article"}
SKIP_TAGS = {"script", "style", "noscript", "head", "nav", "footer"}

# "12-modda. Nomi", "12-модда. Номи", "12-statya", "Статья 12"
ARTICLE_RE = re.compile(r"^\s*(\d+(?:-\d+)?)\s*[-\u2013]\s*(modda|модда)\b[.:]?\s*(.*)$", re.IGNORECASE)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS and tag != "head":
            self.skip += 1
        if tag == "title":
            self._in_title = True
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and tag != "head" and self.skip:
            self.skip -= 1
        if tag == "title":
            self._in_title = False
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.parts.append(data)


def html_to_lines(html: str):
    p = _TextExtractor()
    p.feed(html)
    text = "".join(p.parts).replace("\xa0", " ")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n")]
    return p.title.strip(), [ln for ln in lines if ln]


# lex.uz sahifasidagi interfeys matnlari (hujjatning o'ziga kirmaydi)
_UI_INLINE = re.compile(
    r"Hujjatga taklif yuborish|Audioni tinglash|Hujjat elementidan havola olish|"
    r"Ҳужжатга таклиф юбориш|Аудиони тинглаш|Ҳужжат элементидан ҳавола олиш"
)
_UI_LINES = {
    "Hammasi", "Keyingi tahrirga havola", "Oldingi tahrirga havola", "QTUK bo‘yicha indekslash",
    "QMQ bo‘yicha indekslash", "O‘zgartirishlar manbasi", "Rasmiy nashr manbasi", "A",
}
_DATE_ONLY = re.compile(r"^\d{2}\.\d{2}\.\d{4}( \d{2})?$")
_CLASSIFIER = re.compile(r"^\d\.\d{2}\.\d{2}\.\d{2}\.\d{2}\s")
_NOISE_START = ("Олдинги таҳрирга қаранг", "LexUZ шарҳи", "[ОКОЗ", "Keyingi tahrirga", "Oldingi tahrirga")
# Bob/bo'lim sarlavhalari: moddani tugatadi, modda matniga qo'shilmaydi
_CHAPTER_RE = re.compile(r"^\s*(?:[IVXLC]+|\d+(?:-\d+)?)\s*[-–]?\s*(боб|бўлим|қисм\.?\s*$|bob|bo.lim)", re.IGNORECASE)


def clean_lines(lines: List[str]) -> List[str]:
    out: List[str] = []
    for ln in lines:
        ln = _UI_INLINE.sub("", ln).strip()
        if not ln or ln in _UI_LINES or _DATE_ONLY.match(ln) or _CLASSIFIER.match(ln) or ln.startswith(_NOISE_START):
            continue
        out.append(ln)
    return out


def split_articles(lines: List[str], title: str, url: str) -> List[Dict[str, Any]]:
    """Qatorlarni modda bo'yicha bo'laklarga ajratadi. Modda topilmasa butun matn paragraflar bo'yicha bo'linadi"""
    chunks: List[Dict[str, Any]] = []
    cur_label, cur_lines = "", []

    def flush():
        if not cur_lines:
            return
        deduped = [ln for i, ln in enumerate(cur_lines) if i == 0 or ln != cur_lines[i - 1]]  # modda nomi ikki marta takrorlanadi
        text = " ".join(deduped).strip()
        if not cur_label and len(text) < 80:
            return  # modda boshlanishidan oldingi qisqa sarlavha/bob nomlari bo'lak bo'lmaydi
        if cur_label and len(cur_lines) <= 1 and len(text) < 160:
            return  # mundarija (faqat modda nomi) qatorlari: matni yo'q, bo'lak bo'lmaydi
        parts = [text[i:i + MAX_CHUNK] for i in range(0, len(text), MAX_CHUNK)] if len(text) > MAX_CHUNK else [text]
        for n, part in enumerate(parts):
            label = cur_label or "Matn"
            if n:
                label += f" (davomi {n + 1})"
            chunks.append({"title": title, "article": label, "url": url, "text": part})

    pending_name = False
    for ln in clean_lines(lines):
        if _CHAPTER_RE.match(ln):
            flush()
            cur_label, cur_lines, pending_name = "", [], False
            continue
        m = ARTICLE_RE.match(ln)
        if pending_name and not m and len(ln) < 160 and not re.match(r"^\d+[.)]", ln):
            cur_label += f". {ln}"
            pending_name = False
            continue
        pending_name = False
        if m:
            flush()
            cur_label = f"{m.group(1)}-modda" + (f". {m.group(3)}" if m.group(3) else "")
            cur_lines = []
            if m.group(3):
                cur_lines.append(m.group(3))
            else:
                pending_name = True  # modda nomi keyingi qatorda bo'lishi mumkin
        else:
            cur_lines.append(ln)
    flush()
    for i, c in enumerate(chunks):
        c["id"] = f"{hashlib.md5(url.encode()).hexdigest()[:8]}-{i}"
    return chunks


def fetch_cached(url: str, cache_dir: str = "") -> str:
    if not cache_dir:
        return fetch(url)
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, hashlib.md5(url.encode()).hexdigest()[:12] + ".html")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    html = fetch(url)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return html


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read(8_000_000)
        charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def ingest_one(url: str, title: str = "", html: str = "", cache_dir: str = "") -> List[Dict[str, Any]]:
    html = html or fetch_cached(url, cache_dir)
    page_title, lines = html_to_lines(html)
    return split_articles(lines, title or page_title or url, url)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="lex.uz hujjatlarini bilim bazasiga yuklash")
    ap.add_argument("--sources", default=os.path.join(HERE, "sources.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "lex_chunks.json"))
    ap.add_argument("--url", help="Bitta hujjat havolasi (sources.json o'rniga)")
    ap.add_argument("--title", default="")
    ap.add_argument("--html", help="Saqlangan HTML fayl (tarmoqsiz)")
    ap.add_argument("--cache-dir", default="", help="Yuklangan HTML ni shu papkada saqlash (qayta yuklamaslik uchun)")
    ap.add_argument("--delay", type=float, default=2.0, help="So'rovlar orasidagi pauza (soniya)")
    args = ap.parse_args(argv)

    if args.url:
        todo = [{"url": args.url, "title": args.title}]
    else:
        with open(args.sources, encoding="utf-8") as f:
            todo = json.load(f).get("sources", [])
    if not todo:
        print("Havolalar yo'q. knowledge/sources.json ga lex.uz havolalarini qo'shing.")
        return 1

    try:
        with open(args.out, encoding="utf-8") as f:
            existing = json.load(f)
    except (FileNotFoundError, ValueError):
        existing = []

    urls = {s["url"] for s in todo}
    kept = [c for c in existing if c.get("url") not in urls]
    new: List[Dict[str, Any]] = []
    for i, s in enumerate(todo):
        try:
            html = open(args.html, encoding="utf-8").read() if args.html else ""
            got = ingest_one(s["url"], s.get("title", ""), html, args.cache_dir)
            print(f"[{i + 1}/{len(todo)}] {s['url']}: {len(got)} bo'lak")
            new.extend(got)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i + 1}/{len(todo)}] XATO {s['url']}: {exc}")
        if not args.html and i < len(todo) - 1:
            time.sleep(args.delay)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(kept + new, f, ensure_ascii=False, indent=1)
    print(f"Yozildi: {args.out} ({len(kept) + len(new)} bo'lak)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
