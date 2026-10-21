from PIL import Image, ImageDraw, ImageFilter
import os, math

ROOT = r"F:\[DSH]\Sotto"
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)
S = 2048
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# rounded square background
pad = int(S * 0.055)
radius = int(S * 0.235)
bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / S
    r = int(15 + (10 - 15) * t)
    g = int(19 + (13 - 19) * t)
    b = int(27 + (20 - 27) * t)
    bd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius=radius, fill=255)
img.paste(bg, (0, 0), mask)

# inner soft border
border = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(border).rounded_rectangle(
    [pad, pad, S - pad, S - pad], radius=radius, outline=(255, 255, 255, 34), width=max(2, int(S * 0.0018))
)
img = Image.alpha_composite(img, border)

# subtle accent glow behind bars
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([int(S*0.18), int(S*0.29), int(S*0.82), int(S*0.82)], fill=(86, 140, 255, 55))
glow = glow.filter(ImageFilter.GaussianBlur(int(S * 0.075)))
img = Image.alpha_composite(img, glow)

# three rounded whisper bars
def lerp(a, b, t):
    return int(a + (b - a) * t)

bar_w = int(S * 0.105)
gap = int(S * 0.062)
heights = [int(S * 0.315), int(S * 0.455), int(S * 0.25)]
cx = S // 2
total_w = bar_w * 3 + gap * 2
left = cx - total_w // 2
bottom = int(S * 0.675)
for i, h in enumerate(heights):
    x0 = left + i * (bar_w + gap)
    x1 = x0 + bar_w
    top = bottom - h
    bar = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bdr = ImageDraw.Draw(bar)
    bdr.rounded_rectangle([x0, top, x1, bottom], radius=bar_w // 2, fill=(255, 255, 255, 255))
    # vertical gradient clipped to bar
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd2 = ImageDraw.Draw(grad)
    for y in range(top, bottom + 1):
        t = (y - top) / max(1, (bottom - top))
        r = lerp(122, 150, t)
        g = lerp(176, 126, t)
        b = lerp(255, 255, t)
        gd2.line([(x0, y), (x1, y)], fill=(r, g, b, 255))
    bmask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(bmask).rounded_rectangle([x0, top, x1, bottom], radius=bar_w // 2, fill=255)
    img.paste(grad, (0, 0), Image.composite(bmask, Image.new("L", (S, S), 0), bar.split()[3]))

# small dot / breath mark under bars
dot_r = int(S * 0.018)
dcx, dcy = cx, int(S * 0.735)
dd = ImageDraw.Draw(img)
dd.ellipse([dcx - dot_r, dcy - dot_r, dcx + dot_r, dcy + dot_r], fill=(178, 196, 235, 190))

# top-left specular highlight
spec = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(spec)
sd.ellipse([int(S*0.10), int(S*0.06), int(S*0.62), int(S*0.38)], fill=(255, 255, 255, 16))
spec = spec.filter(ImageFilter.GaussianBlur(int(S * 0.05)))
img = Image.alpha_composite(img, spec)

# clip result to rounded square again
final = Image.new("RGBA", (S, S), (0, 0, 0, 0))
final.paste(img, (0, 0), mask)
final = final.resize((1024, 1024), Image.LANCZOS)
final.save(os.path.join(BUILD, "icon.png"))

ico_sizes = [16, 24, 32, 48, 64, 128, 256]
final.save(os.path.join(BUILD, "icon.ico"), format="ICO", sizes=[(s, s) for s in ico_sizes])

# portable logo for README / UI mock use
logo = final.resize((256, 256), Image.LANCZOS)
logo.save(os.path.join(BUILD, "logo-256.png"))
print("icon written")
