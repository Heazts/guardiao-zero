"""Gera os ícones raster da identidade Limiar Orbital.

A órbita aberta reúne o zero e o G de Guardião. O braço central registra a
interceptação, enquanto a haste vertical representa o limiar local. A
geometria continua reconhecível em 16 px e não depende de glifos ou fontes.
"""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"
SIZES = (16, 32, 48, 128)
THEME_SIZES = (16, 32, 48)
INK = (17, 17, 17)


def limiar_mask(canvas_size, box):
    """Retorna o símbolo Limiar Orbital em uma máscara monocromática."""
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    draw = ImageDraw.Draw(mask)
    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    stroke = max(1, round(width * 0.13))
    orbit_box = (
        x0 + width * 0.02,
        y0 + height * 0.06,
        x0 + width * 0.67,
        y0 + height * 0.94,
    )
    draw.arc(orbit_box, start=42, end=318, fill=255, width=stroke)
    center_y = y0 + height * 0.50
    barrier_x = x0 + width * 0.84
    draw.line(
        (x0 + width * 0.49, center_y, barrier_x, center_y),
        fill=255,
        width=stroke,
    )
    draw.line(
        (barrier_x, y0 + height * 0.03, barrier_x, y0 + height * 0.97),
        fill=255,
        width=stroke,
    )
    return mask


def make_badge(size, supersampling=8):
    canvas = size * supersampling
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))

    rounded_mask = Image.new("L", (canvas, canvas), 0)
    rounded_draw = ImageDraw.Draw(rounded_mask)
    inset = max(1, round(canvas * 0.025))
    rounded_draw.rounded_rectangle(
        (inset, inset, canvas - inset - 1, canvas - inset - 1),
        radius=round(canvas * 0.15),
        fill=255,
    )
    badge = Image.new("RGBA", (canvas, canvas), (*INK, 0))
    badge.putalpha(rounded_mask)
    image = Image.alpha_composite(image, badge)

    padding = canvas * 0.19
    symbol_mask = limiar_mask(
        canvas,
        (padding, padding, canvas - padding, canvas - padding),
    )
    symbol = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 0))
    symbol.putalpha(symbol_mask)
    image = Image.alpha_composite(image, symbol)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def make_monochrome(size, color, supersampling=8):
    canvas = size * supersampling
    padding = canvas * 0.10
    mask = limiar_mask(
        canvas,
        (padding, padding, canvas - padding, canvas - padding),
    )
    image = Image.new("RGBA", (canvas, canvas), (*color, 0))
    image.putalpha(mask)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        supersampling = max(8, 1024 // size)
        make_badge(size, supersampling).save(OUT / f"icon-{size}.png")
        if size in THEME_SIZES:
            make_monochrome(size, (255, 255, 255), supersampling).save(
                OUT / f"icon-light-{size}.png"
            )
            make_monochrome(size, INK, supersampling).save(
                OUT / f"icon-dark-{size}.png"
            )
        print(f"ok {size}px")


if __name__ == "__main__":
    main()
