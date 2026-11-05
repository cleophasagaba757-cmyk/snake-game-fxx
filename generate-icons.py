#!/usr/bin/env python3
"""Regenerates every PNG icon and iOS splash image used by the PWA.

Requires Pillow (pip install pillow). Run from the project root:

    python3 tools/generate-icons.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = ROOT
SPLASH_DIR = os.path.join(ROOT, "splash")
os.makedirs(SPLASH_DIR, exist_ok=True)

BG_TOP = (21, 32, 74)
BG_BOTTOM = (7, 10, 20)
GREEN = (57, 255, 136)
GREEN_DARK = (23, 194, 95)
RED = (255, 77, 109)
RED_DARK = (193, 18, 58)

S = 1024  # master canvas


def gradient_bg(size):
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return img


def bezier(p0, p1, p2, p3, n=60):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def artwork():
    """Snake + food on transparent 1024x1024 layer, content inside the central ~66%."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # S-shaped path (tail -> head), kept inside the maskable safe zone
    path = []
    path += bezier((330, 690), (330, 560), (470, 590), (560, 520))
    path += bezier((560, 520), (700, 420), (330, 450), (400, 330))[1:]
    path += bezier((400, 330), (430, 260), (560, 250), (640, 300))[1:]

    # glow
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (x, y) in path:
        gd.ellipse((x - 62, y - 62, x + 62, y + 62), fill=GREEN + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(34))
    layer = Image.alpha_composite(layer, glow)

    d = ImageDraw.Draw(layer)
    n = len(path)
    for i, (x, y) in enumerate(path):
        t = i / (n - 1)
        r = 44 + 22 * t  # thicker towards the head
        col = tuple(int(GREEN_DARK[k] + (GREEN[k] - GREEN_DARK[k]) * t) for k in range(3))
        d.ellipse((x - r, y - r, x + r, y + r), fill=col + (255,))

    # head
    hx, hy = path[-1]
    d.ellipse((hx - 78, hy - 70, hx + 78, hy + 70), fill=(157, 255, 196, 255))
    d.ellipse((hx - 66, hy - 58, hx + 66, hy + 58), fill=(34, 224, 122, 255))
    for ey in (-26, 26):
        ex = hx + 20
        d.ellipse((ex - 19, hy + ey - 19, ex + 19, hy + ey + 19), fill=(255, 255, 255, 255))
        d.ellipse((ex - 6, hy + ey - 9, ex + 14, hy + ey + 11), fill=(4, 32, 15, 255))

    # food ball (bottom-right of the head)
    fx, fy = 700, 410
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(fg).ellipse((fx - 70, fy - 70, fx + 70, fy + 70), fill=RED + (200,))
    layer = Image.alpha_composite(layer, fg.filter(ImageFilter.GaussianBlur(24)))
    d = ImageDraw.Draw(layer)
    d.ellipse((fx - 52, fy - 52, fx + 52, fy + 52), fill=RED_DARK + (255,))
    d.ellipse((fx - 46, fy - 46, fx + 40, fy + 40), fill=RED + (255,))
    d.ellipse((fx - 28, fy - 34, fx - 4, fy - 10), fill=(255, 208, 217, 255))
    return layer


def make_icon(kind):
    bg = gradient_bg(S).convert("RGBA")
    art = artwork()
    if kind == "maskable":
        return Image.alpha_composite(bg, art)  # full bleed, OS applies the mask
    if kind == "apple":
        return Image.alpha_composite(bg, art)  # iOS rounds corners itself, must be opaque
    # "any": rounded square on transparent background, art scaled slightly larger
    base = Image.alpha_composite(bg, art)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(ICON_DIR, name), optimize=True)


any_icon = make_icon("any")
mask_icon = make_icon("maskable")
apple_icon = make_icon("apple")

save(any_icon, "icon-192.png", 192)
save(any_icon, "icon-512.png", 512)
save(mask_icon, "icon-maskable-192.png", 192)
save(mask_icon, "icon-maskable-512.png", 512)
save(apple_icon, "apple-touch-icon.png", 180)
save(any_icon, "favicon-32.png", 32)


def load_font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


# iOS launch ("splash") images: width x height in device pixels
SPLASHES = [
    (640, 1136), (750, 1334), (828, 1792), (1125, 2436), (1170, 2532),
    (1179, 2556), (1242, 2208), (1242, 2688), (1284, 2778), (1290, 2796),
]
for w, h in SPLASHES:
    img = Image.new("RGB", (w, h), BG_BOTTOM)
    top = Image.new("RGB", (w, h), BG_TOP)
    mask = Image.linear_gradient("L").resize((w, h))
    img = Image.composite(img, top, mask)
    icon_size = int(min(w, h) * 0.42)
    icon = any_icon.resize((icon_size, icon_size), Image.LANCZOS)
    ix, iy = (w - icon_size) // 2, int(h * 0.5 - icon_size * 0.75)
    img.paste(icon, (ix, iy), icon)
    d = ImageDraw.Draw(img)
    font = load_font(int(min(w, h) * 0.09))
    text = "SNAKE 50"
    box = d.textbbox((0, 0), text, font=font)
    d.text(((w - (box[2] - box[0])) / 2, iy + icon_size + int(h * 0.03)), text, font=font, fill=GREEN)
    img.save(os.path.join(SPLASH_DIR, "splash-%dx%d.png" % (w, h)), optimize=True)

print("Icons and splash images written to", ICON_DIR)
