"""Generate placeholder icons for the Chrome extension."""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (17, 24, 39, 255)        # gray-900
SHIELD = (34, 197, 94, 255)   # green-500
CHECK = (255, 255, 255, 255)

def shield(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = max(1, size // 10)
    top = pad
    bottom = size - pad
    left = pad + size // 10
    right = size - pad - size // 10
    mid_x = size // 2
    shoulder_y = top + (bottom - top) // 3
    points = [
        (mid_x, top),
        (right, shoulder_y - size // 12),
        (right, shoulder_y + (bottom - shoulder_y) // 3),
        (mid_x, bottom),
        (left, shoulder_y + (bottom - shoulder_y) // 3),
        (left, shoulder_y - size // 12),
    ]
    d.polygon(points, fill=SHIELD)

    cw = max(1, size // 14)
    c1 = (mid_x - size // 6, size // 2 + size // 20)
    c2 = (mid_x - size // 40, size // 2 + size // 5)
    c3 = (mid_x + size // 4, size // 2 - size // 8)
    d.line([c1, c2], fill=CHECK, width=cw)
    d.line([c2, c3], fill=CHECK, width=cw)
    return img

for s in (16, 48, 128):
    shield(s).save(OUT / f"icon{s}.png")
    print(f"wrote icon{s}.png")
