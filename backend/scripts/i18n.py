"""
Backend translations without GNU gettext.

  python scripts/i18n.py extract   -> add new msgids to locale/ar/LC_MESSAGES/django.po (keeps translations)
  python scripts/i18n.py compile   -> write django.mo from django.po
  python scripts/i18n.py check     -> exit 1 if any msgid used in code has no Arabic translation

Msgids are the first string argument of _(), gettext(), gettext_lazy(), ngettext() and Msg() calls.
"""
import ast
import pathlib
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PO = ROOT / "locale" / "ar" / "LC_MESSAGES" / "django.po"
MO = PO.with_suffix(".mo")
FUNCS = {"_", "gettext", "gettext_lazy", "Msg"}


def extract():
    ids = {}
    for path in sorted(ROOT.glob("**/*.py")):
        rel = path.relative_to(ROOT)
        if rel.parts[0] in (".venv", "scripts") or "migrations" in rel.parts or "tests" in rel.parts or rel.name == "tests.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and node.args:
                name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", None)
                arg = node.args[0]
                if name in FUNCS and isinstance(arg, ast.Constant) and isinstance(arg.value, str) and arg.value.strip():
                    ids.setdefault(arg.value, f"{rel}:{node.lineno}")
    return ids


def unquote(s):
    return ast.literal_eval(s)


def read_po():
    entries, msgid, msgstr, target = {}, None, None, None
    if not PO.exists():
        return entries
    for line in PO.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("msgid "):
            if msgid is not None:
                entries[msgid] = msgstr
            msgid, msgstr, target = unquote(line[6:]), "", "id"
        elif line.startswith("msgstr "):
            msgstr, target = unquote(line[7:]), "str"
        elif line.startswith('"'):
            if target == "id":
                msgid += unquote(line)
            elif target == "str":
                msgstr += unquote(line)
    if msgid is not None:
        entries[msgid] = msgstr
    return entries


def q(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def write_po(entries, refs):
    out = ['msgid ""', 'msgstr ""', q("Content-Type: text/plain; charset=UTF-8\\n").replace("\\\\n", "\\n"),
           q("Language: ar\\n").replace("\\\\n", "\\n"),
           q("Plural-Forms: nplurals=6; plural=n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5;\\n").replace("\\\\n", "\\n"), ""]
    for msgid in sorted(k for k in entries if k):
        if msgid in refs:
            out.append(f"#: {refs[msgid]}")
        out.append(f"msgid {q(msgid)}")
        out.append(f"msgstr {q(entries[msgid])}")
        out.append("")
    PO.parent.mkdir(parents=True, exist_ok=True)
    PO.write_text("\n".join(out), encoding="utf-8")


def compile_mo(entries):
    items = sorted((k, v) for k, v in entries.items() if v or k == "")
    if not any(k == "" for k, _ in items):
        items.insert(0, ("", "Content-Type: text/plain; charset=UTF-8\n"))
    ids = b"".join(k.encode() + b"\0" for k, _ in items)
    strs = b"".join(v.encode() + b"\0" for _, v in items)
    n = len(items)
    keystart = 7 * 4 + 16 * n
    valuestart = keystart + len(ids)
    koffsets, voffsets, ko, vo = [], [], 0, 0
    for k, v in items:
        kb, vb = k.encode(), v.encode()
        koffsets += [len(kb), keystart + ko]
        voffsets += [len(vb), valuestart + vo]
        ko += len(kb) + 1
        vo += len(vb) + 1
    header = struct.pack("Iiiiiii", 0x950412DE, 0, n, 7 * 4, 7 * 4 + 8 * n, 0, 0)
    MO.write_bytes(header + struct.pack(f"{len(koffsets)}i", *koffsets) + struct.pack(f"{len(voffsets)}i", *voffsets) + ids + strs)


def main(cmd):
    used = extract()
    entries = read_po()
    entries[""] = entries.get("", "")
    if cmd == "extract":
        for msgid in used:
            entries.setdefault(msgid, "")
        entries = {k: v for k, v in entries.items() if k in used or k == ""}
        write_po(entries, used)
        missing = [k for k in used if not entries.get(k)]
        print(f"{len(used)} msgids, {len(missing)} without translation")
    elif cmd == "compile":
        compile_mo(entries)
        print(f"compiled {sum(1 for v in entries.values() if v)} translations -> {MO.relative_to(ROOT)}")
    elif cmd == "check":
        missing = [k for k in used if not entries.get(k)]
        print(f"{len(used)} msgids, {len(missing)} missing")
        for k in missing[:50]:
            print("  -", k)
        sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "check")
