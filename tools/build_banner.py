#!/usr/bin/env python3
"""Draw the animated pixel-art banner at the top of the README.

    python3 tools/build_banner.py

writes assets/banner-dark.svg and assets/banner-light.svg: Claude calls the vault through the
five-tool gate. An orient call lights the first lamp, a search scans the linked Markdown notes and
finds one, the note travels back to Claude, a call revises it (its revision goes from 3 to 4),
a Git commit lands on the history line and a new link joins the graph. The pixel helpers,
palettes, font and the Claude sprite come from the profile map (Song-Seng-Hun/Song-Seng-Hun
tools/build_worldmap.py), so the banners look alike. 160x90 grid, 4 px per cell, SMIL animation
(GitHub plays it in README images). Standard library only.
"""

import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"

P = 4                 # px per grid cell
W, H = 160, 90        # grid size

# ---------------------------------------------------------------- palettes (from build_worldmap.py)

COMMON = {
    "skin": "#F1C9A5", "hair": "#3B2A22", "glass": "#1A1A2A",
    "coat": "#4A6FA5", "coat_d": "#38598A", "pants": "#2E3A55", "scarf": "#E8C468",
    "orange": "#D97757", "yellow": "#E3B341", "teal": "#4FA3A5",
    "green": "#6DBE73", "blue": "#5E8FD6", "red": "#E5566B",
    "white": "#F7F5EE", "paper": "#FFFDF6", "ink": "#4A5070",
    "flower1": "#E8A0B4", "flower2": "#E8D27A",
}

PALETTES = {
    "dark": {
        **COMMON,
        "K": "#0B0E1C", "frame": "#B89B5E", "frame_d": "#5E4C2C",
        "sky0": "#0C1026", "sky1": "#111735", "sky2": "#171F45", "sky3": "#1D2855", "sky4": "#253366",
        "star": "#F4EBD9", "star_d": "#7F88B5", "cloud": "#2A3566", "cloud_d": "#222C58",
        "mtn_far": "#1A2350", "g0": "#1F3B35", "g1": "#264840", "g2": "#19312C", "tuft": "#2F5A4D",
        "path": "#5C4B3F", "path_e": "#3F332B", "path_h": "#6E5A4B",
        "wall": "#8B8FA8", "wall_m": "#6C7192", "wall_d": "#4C5172",
        "roof": "#7B4A57", "roof_d": "#5A3442", "wood": "#6B4E3A", "wood_d": "#4A3527",
        "metal": "#9AA3B5", "metal_d": "#5F6880", "win": "#262E4D",
        "lit": "#FFD27A", "glow": ("#FFB85C", 0.32), "smoke": ("#9AA3B5", 0.7),
        "text": "#F4EBD9", "sub": "#8E96C2", "shadow": "#0B0E1C",
    },
    "light": {
        **COMMON,
        "K": "#2B2F45", "frame": "#C9A86A", "frame_d": "#8A6E3E",
        "sky0": "#B9D8EA", "sky1": "#C6E0EE", "sky2": "#D2E7F0", "sky3": "#DDEDF1", "sky4": "#E8F2EF",
        "star": "#FFFFFF", "star_d": "#FFFFFF", "cloud": "#FFFFFF", "cloud_d": "#E3ECF2",
        "mtn_far": "#A9C2D4", "g0": "#B4CE98", "g1": "#C1D8A6", "g2": "#A2BE87", "tuft": "#8CB072",
        "path": "#E2D2AE", "path_e": "#C9B48C", "path_h": "#EEE2C6",
        "wall": "#F2EEE6", "wall_m": "#DAD3C6", "wall_d": "#B9B0A1",
        "roof": "#C97E6C", "roof_d": "#A8655A", "wood": "#A47C5B", "wood_d": "#86624A",
        "metal": "#C6CDD6", "metal_d": "#8E97A6", "win": "#7F95AA",
        "lit": "#FFE08A", "glow": ("#FFC94A", 0.38), "smoke": ("#8E97A6", 0.55),
        "text": "#2B2F45", "sub": "#6A7192", "shadow": "#F7F3E8",
    },
}

# sprite characters -> palette keys
CHARS = {
    "K": "K", "h": "hair", "f": "skin", "G": "glass", "c": "coat", "C": "coat_d",
    "n": "pants", "s": "scarf", "o": "orange", "w": "white", "p": "paper", "i": "ink",
    "y": "yellow", "m": "metal", "M": "metal_d", "l": "lit", "r": "red", "g": "green",
    "W": "wood_d", "v": "wood", "R": "roof", "x": "text", "u": "sub",
}

# ---------------------------------------------------------------- canvas (from build_worldmap.py)


class Canvas:
    def __init__(self):
        self.px = {}

    def set(self, x, y, col):
        self.px[(x, y)] = col

    def rect(self, x, y, w, h, col):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.px[(i, j)] = col

    def box(self, x, y, w, h, fill, edge="K"):
        self.rect(x, y, w, h, edge)
        if w > 2 and h > 2:
            self.rect(x + 1, y + 1, w - 2, h - 2, fill)

    def sprite(self, rows, x, y):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != ".":
                    self.px[(x + i, y + j)] = CHARS[ch]

    def merge(self, other):
        self.px.update(other.px)


def outlined(c, col="K"):
    out = Canvas()
    for (x, y) in c.px:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in c.px:
                out.px[(x + dx, y + dy)] = col
    out.px.update(c.px)
    return out


def rects(cells):
    """Cover a set of cells with few rectangles (row runs merged downwards)."""
    rows = {}
    for x, y in cells:
        rows.setdefault(y, []).append(x)
    out, open_ = [], {}
    for y in sorted(rows):
        xs = sorted(rows[y])
        runs, start, prev = [], xs[0], xs[0]
        for x in xs[1:]:
            if x != prev + 1:
                runs.append((start, prev - start + 1))
                start = x
            prev = x
        runs.append((start, prev - start + 1))
        nxt = {}
        for key in runs:
            if key in open_ and sum(open_[key]) == y:
                y0, h = open_.pop(key)
                nxt[key] = (y0, h + 1)
            else:
                nxt[key] = (y, 1)
        out += [(k[0], y0, k[1], h) for k, (y0, h) in open_.items()]
        open_ = nxt
    out += [(k[0], y0, k[1], h) for k, (y0, h) in open_.items()]
    return out


def svg_paths(c, pal, unit=P, ox=0, oy=0):
    by_col = {}
    for xy, col in c.px.items():
        by_col.setdefault(col, set()).add(xy)
    out = []
    for col in sorted(by_col):
        d = "".join(f"M{x*unit+ox} {y*unit+oy}h{w*unit}v{h*unit}h{-w*unit}z"
                    for x, y, w, h in sorted(rects(by_col[col]), key=lambda r: (r[1], r[0])))
        fill = pal[col]
        if isinstance(fill, tuple):
            out.append(f'<path fill="{fill[0]}" fill-opacity="{fill[1]}" d="{d}"/>')
        else:
            out.append(f'<path fill="{fill}" d="{d}"/>')
    return "".join(out)

# ---------------------------------------------------------------- animation helpers (from build_worldmap.py)

T = 12.0              # loop length in seconds
DT = 1 / 16           # timeline step in seconds
TICKS = [k * DT for k in range(int(T / DT))]
FADE = T - 1.0        # lights go out and everything resets from here


def _kt(t):
    return f"{t / T:.4f}".rstrip("0").rstrip(".")


def _steps(changes):
    ts, vs = [], []
    for t, v in changes:
        if vs and vs[-1] == v:
            continue
        if ts and abs(t - ts[-1]) < 1e-9:
            vs[-1] = v
            continue
        ts.append(t)
        vs.append(v)
    ts[0] = 0.0
    return ";".join(_kt(t) or "0" for t in ts), ";".join(str(v) for v in vs)


def timeline(attr, changes):
    """Discrete animation on the shared T-second loop."""
    k, v = _steps(changes)
    if attr == "translate":
        return (f'<animateTransform attributeName="transform" type="translate" dur="{T}s" '
                f'repeatCount="indefinite" calcMode="discrete" keyTimes="{k}" values="{v}"/>')
    return (f'<animate attributeName="{attr}" dur="{T}s" repeatCount="indefinite" '
            f'calcMode="discrete" keyTimes="{k}" values="{v}"/>')


def loop(attr, dur, values, keytimes=None, begin=0.0, discrete=True, translate=False):
    """Free-running ambient animation with its own period."""
    kt = f' keyTimes="{keytimes}"' if keytimes else ""
    mode = ' calcMode="discrete"' if discrete else ""
    beg = f' begin="{begin:.2f}s"' if begin else ""
    if translate:
        return (f'<animateTransform attributeName="transform" type="translate" dur="{dur}s"'
                f'{beg} repeatCount="indefinite"{mode}{kt} values="{values}"/>')
    return f'<animate attributeName="{attr}" dur="{dur}s"{beg} repeatCount="indefinite"{mode}{kt} values="{values}"/>'


def group(inner, anim="", opacity=None, transform=None):
    attrs = ""
    if opacity is not None:
        attrs += f' opacity="{opacity}"'
    if transform:
        attrs += f' transform="{transform}"'
    return f"<g{attrs}>{inner}{anim}</g>"


def shown(inner, t_on, t_off):
    """Visible from t_on to t_off on the loop."""
    return group(inner, timeline("opacity", [(0, 0), (t_on, 1), (t_off, 0)]), opacity=0)


def sparkle(pal, x, y, t_on):
    small, big = Canvas(), Canvas()
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        small.set(x + dx, y + dy, "lit")
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        big.set(x + dx, y + dy, "lit" if abs(dx) + abs(dy) < 2 else "white")
    return (group(svg_paths(small, pal), timeline("opacity", [(0, 0), (t_on, 1), (t_on + 0.2, 0),
                                                            (t_on + 0.45, 1), (t_on + 0.65, 0)]), opacity=0)
            + group(svg_paths(big, pal), timeline("opacity", [(0, 0), (t_on + 0.2, 1), (t_on + 0.45, 0)]),
                    opacity=0))

# ---------------------------------------------------------------- font 5x7 (from build_worldmap.py)


FONT_SRC = """
A .###. #...# #...# ##### #...# #...# #...#
B ####. #...# #...# ####. #...# #...# ####.
C .###. #...# #.... #.... #.... #...# .###.
D ####. #...# #...# #...# #...# #...# ####.
E ##### #.... #.... ####. #.... #.... #####
F ##### #.... #.... ####. #.... #.... #....
G .###. #...# #.... #.### #...# #...# .####
H #...# #...# #...# ##### #...# #...# #...#
I ### .#. .#. .#. .#. .#. ###
J ..### ...#. ...#. ...#. ...#. #..#. .##..
K #...# #..#. #.#.. ##... #.#.. #..#. #...#
L #.... #.... #.... #.... #.... #.... #####
M #...# ##.## #.#.# #.#.# #...# #...# #...#
N #...# #...# ##..# #.#.# #..## #...# #...#
O .###. #...# #...# #...# #...# #...# .###.
P ####. #...# #...# ####. #.... #.... #....
Q .###. #...# #...# #...# #.#.# #..#. .##.#
R ####. #...# #...# ####. #.#.. #..#. #...#
S .#### #.... #.... .###. ....# ....# ####.
T ##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
U #...# #...# #...# #...# #...# #...# .###.
V #...# #...# #...# #...# #...# .#.#. ..#..
W #...# #...# #...# #.#.# #.#.# #.#.# .#.#.
X #...# #...# .#.#. ..#.. .#.#. #...# #...#
Y #...# #...# .#.#. ..#.. ..#.. ..#.. ..#..
Z ##### ....# ...#. ..#.. .#... #.... #####
0 .###. #...# #..## #.#.# ##..# #...# .###.
1 .#. ##. .#. .#. .#. .#. ###
2 .###. #...# ....# ...#. ..#.. .#... #####
3 ####. ....# ....# .###. ....# ....# ####.
4 ...#. ..##. .#.#. #..#. ##### ...#. ...#.
5 ##### #.... ####. ....# ....# #...# .###.
6 .###. #.... #.... ####. #...# #...# .###.
. . . . . . . #
· . . . # . . .
- ... ... ... ### ... ... ...
m ..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#
"""

FONT = {" ": ["..."] * 7}
for line in FONT_SRC.strip().splitlines():
    ch, *rows = line.split()
    FONT[ch] = rows


def text_width(s):
    return sum(len(FONT[ch][0]) + 1 for ch in s) - 1


def draw_text(c, s, x, y, col, shadow="shadow"):
    for pass_col, dy in ((shadow, 1), (col, 0)):
        if pass_col is None:
            continue
        cx = x
        for ch in s:
            for j, row in enumerate(FONT[ch]):
                for i, v in enumerate(row):
                    if v == "#":
                        c.set(cx + i, y + j + dy, pass_col)
            cx += len(FONT[ch][0]) + 1
    return x + text_width(s)

# ---------------------------------------------------------------- sprites (traveler and Claude from build_worldmap.py)


# Claude: body = cols 1-11 x rows 0-7 from the body's top-left, arms beside it, legs on rows 8-9.
CLAUDE_EYES = {
    "happy": [(2, 2), (3, 3), (2, 4), (10, 2), (9, 3), (10, 4)],   # > <
    "dot": [(3, 2), (3, 3), (9, 2), (9, 3)],
    "blink": [(2, 3), (3, 3), (9, 3), (10, 3)],
    "right": [(4, 2), (4, 3), (10, 2), (10, 3)],
    "left": [(2, 2), (2, 3), (8, 2), (8, 3)],
}
_ARM_L, _ARM_R = [(0, 3), (0, 4), (0, 5)], [(12, 3), (12, 4), (12, 5)]
_UP_L, _UP_R = [(0, -2), (0, -1), (0, 0)], [(12, -2), (12, -1), (12, 0)]
CLAUDE_ARMS = {
    "down": _ARM_L + _ARM_R,
    "up": _UP_L + _UP_R,
    "wave1": _UP_L + _ARM_R,
    "wave2": [(0, 1), (-1, 0), (-1, -1)] + _ARM_R,
}
CLAUDE_LEGS = {
    "stand": [(x, y) for x in (2, 4, 8, 10) for y in (8, 9)],
    "stepA": [(2, 8), (2, 9), (8, 8), (8, 9), (4, 8), (10, 8)],
    "stepB": [(4, 8), (4, 9), (10, 8), (10, 9), (2, 8), (8, 8)],
}


def claude_frame(eyes, arms, legs, bob):
    c = Canvas()
    ox, oy = 1, 3 - bob          # two spare rows on top for raised arms
    c.rect(ox + 1, oy, 11, 8, "orange")
    for x, y in CLAUDE_ARMS[arms] + CLAUDE_LEGS[legs]:
        c.set(ox + x, oy + y, "orange")
    for x, y in CLAUDE_EYES[eyes]:
        c.set(ox + x, oy + y, "K")
    return outlined(c)


# ---------------------------------------------------------------- scene

THEME = {
    "dark": {"vault": "#161B30", "vault_e": "#2A3150", "rivet": "#5F6880", "bar": "#7C5CD6", "line": "#9AA3B5",
             "link": "#343C60", "link_hot": "#B98CF0", "scan": "#6CC4E8", "led": "#232A45", "commit": "#F05133",
             "new": "#FFD27A"},
    "light": {"vault": "#ECE8DE", "vault_e": "#C9C2B2", "rivet": "#8E97A6", "bar": "#7C5CD6", "line": "#8E97A6",
              "link": "#CFC8DA", "link_hot": "#7C5CD6", "scan": "#2F8FC4", "led": "#D8D3C6", "commit": "#E0452A",
              "new": "#D98A1E"},
}

FLOOR = 81
VAULT = (58, 13, 98, 66)
GATE = (46, 27, 9, 38)
LAMPS = [GATE[1] + 3 + 7 * k for k in range(5)]          # y of the five tool lamps
CLAUDE_AT = (24, FLOOR - 1)
NOTE_W, NOTE_H = 14, 10
NOTES = [(68, 18), (94, 16), (126, 19), (64, 36), (94, 35), (126, 37), (76, 53), (108, 54)]
EDGES = [(0, 1), (1, 2), (0, 3), (3, 4), (4, 5), (1, 4), (4, 6), (6, 7), (5, 7)]
NEW_EDGE = (2, 4)
TARGET = 4
GIT_Y = 72
COMMITS = [70, 82, 94, 106]
NEW_COMMIT = 118

ORIENT, SEARCH, SCAN_END, RETURN, CALL, REVISED, COMMIT_AT, LINK_AT, HAPPY = (
    0.5, 1.6, 3.2, 3.7, 5.0, 6.6, 7.1, 8.0, 9.0)
TRAVEL = 0.5


def snap(x, y):
    return f"{round(x) * P} {round(y) * P}"


def lerp(a, b, u):
    return a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u


def moving(art, path, t_on, t_off):
    pos = [(t, snap(*path(t))) for t in TICKS]
    return group(group(art, timeline("opacity", [(0, 0), (t_on, 1), (t_off, 0)]), opacity=0),
                 timeline("translate", pos))


def centre(n):
    x, y = NOTES[n]
    return x + NOTE_W // 2, y + NOTE_H // 2


def under_note(cell):
    return any(x - 1 <= cell[0] <= x + NOTE_W and y - 1 <= cell[1] <= y + NOTE_H for x, y in NOTES)


def line_cells(a, b, dotted=True):
    """Cells of a (dotted) line between two note centres, leaving out the parts hidden by notes."""
    (x0, y0), (x1, y1) = a, b
    n = max(abs(x1 - x0), abs(y1 - y0))
    cells = [(round(x0 + (x1 - x0) * k / n), round(y0 + (y1 - y0) * k / n)) for k in range(n + 1)
             if not dotted or k % 2 == 0]
    return [c for c in cells if not under_note(c)]


def note_canvas(lines=3, x=0, y=0):
    c = Canvas()
    c.box(x, y, NOTE_W, NOTE_H, "paper")
    c.rect(x + 1, y + 1, NOTE_W - 2, 2, "bar")
    for k in range(lines):
        c.rect(x + 2, y + 4 + 2 * k, NOTE_W - 4 - 3 * (k % 2), 1, "line")
    return c


def draw_room(c):
    bands = ["sky0", "sky1", "sky2", "sky3", "sky4"]
    for y in range(2, FLOOR):
        k = min(4, (y - 2) * 5 // (FLOOR - 2))
        for x in range(2, W - 2):
            c.set(x, y, bands[k])
    for y in range(FLOOR, H - 2):
        for x in range(2, W - 2):
            c.set(x, y, "wood_d" if (y - FLOOR) % 3 == 0 or (x + 7 * ((y - FLOOR) // 3)) % 23 == 0 else "wood")


def draw_vault(c):
    x, y, w, h = VAULT
    c.rect(x, y, w, h, "vault_e")
    c.rect(x + 2, y + 2, w - 4, h - 4, "vault")
    for i in range(x + 3, x + w - 2, 8):                  # rivets
        c.set(i, y + 1, "rivet"), c.set(i, y + h - 2, "rivet")
    for (a, b) in EDGES:
        for cell in line_cells(centre(a), centre(b)):
            c.set(*cell, "link")
    for n, (nx, ny) in enumerate(NOTES):
        c.merge(note_canvas(3, nx, ny))
    c.rect(x + 8, GIT_Y, NEW_COMMIT - x - 6, 1, "metal_d")
    for cx in COMMITS:
        c.rect(cx - 1, GIT_Y - 1, 3, 3, "commit")
    gx, gy, gw, gh = GATE                                  # the five-tool gate
    c.box(gx, gy, gw, gh, "metal_d")
    for ly in LAMPS:
        c.rect(gx + 2, ly, gw - 4, 4, "led")
    c.rect(gx + gw, gy + gh // 2, VAULT[0] - gx - gw, 1, "metal_d")


def labels(c):
    draw_text(c, "5 TOOLS", (GATE[0] + GATE[2] // 2) * 2 - text_width("5 TOOLS") // 2, (GATE[1] - 5) * 2, "text",
              shadow=None)
    draw_text(c, "GIT", (VAULT[0] + 3) * 2 - 1, (GIT_Y - 1) * 2 - 1, "sub", shadow=None)


def packet(pal, start, end, t0, col):
    p = Canvas()
    p.rect(0, 0, 4, 3, col)
    p.set(1, 1, "K"), p.set(2, 1, "K")

    def path(t):
        u = min(1.0, max(0.0, (t - t0) / TRAVEL))
        x, y = lerp(start, end, u)
        return x, y - 5 * math.sin(math.pi * u)
    return moving(svg_paths(outlined(p), pal), path, t0, t0 + TRAVEL)


def call_layer(pal):
    out = ""
    hand = (CLAUDE_AT[0] + 7, CLAUDE_AT[1] - 14)
    gate_in = (GATE[0] - 4, GATE[1] + GATE[2] // 2)
    for t0, lamp, col in ((ORIENT, 0, "teal"), (SEARCH, 3, "scan"), (CALL, 4, "new")):
        out += packet(pal, hand, gate_in, t0, col)
        led = Canvas()
        led.rect(GATE[0] + 2, LAMPS[lamp], GATE[2] - 4, 4, col)
        flash = Canvas()
        flash.rect(GATE[0] + 3, LAMPS[lamp] + 1, GATE[2] - 6, 2, "white")
        out += shown(svg_paths(led, pal), t0 + TRAVEL, FADE) + shown(svg_paths(flash, pal), t0 + TRAVEL, t0 + TRAVEL + 0.2)
    return out


def search_layer(pal):
    """A scan line sweeps the notes, then the found note and its links light up."""
    out = ""
    x, y, w, h = VAULT
    beam = Canvas()
    beam.rect(0, y + 3, 1, GIT_Y - y - 6, "scan")
    t0 = SEARCH + TRAVEL
    out += moving(group(svg_paths(beam, pal), opacity=0.7),
                  lambda t: (x + 3 + (w - 6) * min(1.0, max(0.0, (t - t0) / (SCAN_END - t0))), 0), t0, SCAN_END)
    hot = Canvas()
    for a, b in EDGES:
        if TARGET in (a, b):
            for cell in line_cells(centre(a), centre(b)):
                hot.set(*cell, "link_hot")
    nx, ny = NOTES[TARGET]
    ring = Canvas()
    ring.rect(nx - 1, ny - 1, NOTE_W + 2, NOTE_H + 2, "link_hot")
    ring.merge(note_canvas(3, nx, ny))
    out += shown(svg_paths(hot, pal) + svg_paths(ring, pal), SCAN_END, FADE)
    out += sparkle(pal, nx + NOTE_W - 1, ny, SCAN_END)
    return out


def read_revise_layer(pal):
    out = ""
    nx, ny = NOTES[TARGET]
    copy = note_canvas(3)                                  # a copy of the note flies to Claude
    hand = (CLAUDE_AT[0] + 1, CLAUDE_AT[1] - 22)

    def path(t):
        u = min(1.0, max(0.0, (t - RETURN) / 0.8))
        x, y = lerp((nx, ny), hand, u)
        return x, y - 8 * math.sin(math.pi * u)
    out += moving(svg_paths(copy, pal), path, RETURN, CALL)
    # the call revises the note: lines are rewritten one by one, a fourth line is added
    t0 = CALL + TRAVEL + 0.2
    for k in range(4):
        ln = Canvas()
        ln.rect(nx + 2, ny + 4 + 2 * k if k < 3 else ny + NOTE_H - 1, NOTE_W - 4 - 2 * (k % 2), 1, "new")
        if k == 3:
            grow = Canvas()
            grow.box(nx, ny + NOTE_H - 1, NOTE_W, 3, "paper")
            grow.rect(nx - 1, ny + NOTE_H - 1, 1, 3, "link_hot")
            grow.rect(nx + NOTE_W, ny + NOTE_H - 1, 1, 3, "link_hot")
            grow.rect(nx - 1, ny + NOTE_H + 2, NOTE_W + 2, 1, "link_hot")
            grow.rect(nx + 2, ny + NOTE_H, NOTE_W - 6, 1, "new")
            out += shown(svg_paths(grow, pal), t0 + 0.3 * k, FADE)
        else:
            out += shown(svg_paths(ln, pal), t0 + 0.3 * k, FADE)
    for text, t_on, t_off, col in (("REV 3", SCAN_END, REVISED, "sub"), ("REV 4", REVISED, FADE, "new")):
        lab = Canvas()
        draw_text(lab, text, (nx + NOTE_W + 2) * 2, (ny - 1) * 2, col, shadow=None)
        out += shown(svg_paths(lab, pal, unit=2), t_on, t_off)
    out += sparkle(pal, nx + NOTE_W + 6, ny, REVISED)
    return out


def git_layer(pal):
    out = ""
    seg = Canvas()
    seg.rect(COMMITS[-1] + 1, GIT_Y, NEW_COMMIT - COMMITS[-1], 1, "metal_d")
    dot = Canvas()
    dot.rect(NEW_COMMIT - 1, GIT_Y - 1, 3, 3, "commit")
    out += shown(svg_paths(dot, pal), COMMIT_AT, FADE)
    out += sparkle(pal, NEW_COMMIT, GIT_Y, COMMIT_AT)
    edge = line_cells(centre(NEW_EDGE[0]), centre(NEW_EDGE[1]))   # a new link grows
    for k, cell in enumerate(edge):
        c = Canvas()
        c.set(*cell, "link_hot")
        out += shown(svg_paths(c, pal), LINK_AT + 0.6 * k / len(edge), FADE)
    return out


def claude_pose(t):
    if HAPPY <= t < FADE or RETURN + 0.8 <= t < CALL - 0.3:
        return ("happy", "up", 0)
    for t0 in (ORIENT, SEARCH, CALL):
        if t0 - 0.3 <= t < t0 + 0.2:
            return ("dot", "wave1", 0)
    blink = any(a <= t < a + 0.125 for a in (0.15, 2.6, FADE + 0.4))
    return ("blink" if blink else "right", "down", 1 if SEARCH + TRAVEL <= t < SCAN_END and int(t * 4) % 2 else 0)


def claude_layer(pal):
    seq = [(t, claude_pose(t)) for t in TICKS]
    frames = {pose: claude_frame(pose[0], pose[1], "stand", pose[2]) for pose in dict.fromkeys(p for _, p in seq)}
    ox, oy = (CLAUDE_AT[0] - 7) * P, (CLAUDE_AT[1] - 13) * P
    return "".join(group(svg_paths(fc, pal, ox=ox, oy=oy),
                         timeline("opacity", [(t, 1 if p == pose else 0) for t, p in seq]),
                         opacity=1 if pose == seq[0][1] else 0)
                   for pose, fc in frames.items())


def frame_border():
    f = Canvas()
    f.rect(0, 0, W, H, "frame_d")
    f.rect(1, 1, W - 2, H - 2, "frame")
    for y in range(2, H - 2):
        for x in range(2, W - 2):
            f.px.pop((x, y), None)
    for x, y in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
        f.px.pop((x, y), None)
    for x, y in ((1, 1), (W - 2, 1), (1, H - 2), (W - 2, H - 2)):
        f.set(x, y, "frame_d")
    return f


def build(theme):
    pal = {**PALETTES[theme], **THEME[theme]}
    bg = Canvas()
    draw_room(bg)
    draw_vault(bg)
    lab = Canvas()
    labels(lab)
    title = Canvas()                                      # unit 3 px
    draw_text(title, "MCPVAULT", W * P // 6 - text_width("MCPVAULT") // 2, 4, "text")
    desc = ("Pixel-art banner: Claude calls a vault of linked Markdown notes through a gate of five tool lamps. "
            "An orient call lights the first lamp; a search lights another, a scan line sweeps the notes and one "
            "note and its links light up; a copy of the note flies back to Claude; a third call revises the note, "
            "its lines are rewritten and its revision goes from REV 3 to REV 4; a commit lands on the GIT line "
            "and a new link joins two notes.")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * P} {H * P}" width="{W * P}" '
        f'height="{H * P}" shape-rendering="crispEdges" role="img" aria-labelledby="t d">'
        f'<title id="t">MCPVault</title><desc id="d">{desc}</desc>'
        + svg_paths(bg, pal) + svg_paths(lab, pal, unit=2) + git_layer(pal) + search_layer(pal)
        + read_revise_layer(pal) + call_layer(pal) + claude_layer(pal)
        + svg_paths(title, pal, unit=3) + svg_paths(frame_border(), pal)
        + "</svg>\n"
    )


def main():
    OUT.mkdir(exist_ok=True)
    for theme in PALETTES:
        path = OUT / f"banner-{theme}.svg"
        path.write_text(build(theme), encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
