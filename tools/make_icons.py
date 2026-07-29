"""Gera os ícones raster da identidade Limiar Zero.

O zero representa a meta do produto; a barra vertical representa o limite que
o conteúdo bloqueado não atravessa. A geometria deliberadamente simples
continua reconhecível em 16 px e não depende de glifos ou fontes.
"""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"
SIZES = (16, 32, 48, 128)
THEME_SIZES = (16, 32, 48)
INK = (17, 17, 17)


def limiar_mask(canvas_size, box):
    """Retorna o monograma 0| da marca em uma máscara monocromática."""
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    draw = ImageDraw.Draw(mask)
    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    stroke = max(1, round(width * 0.13))
    zero_box = (
        x0 + width * 0.04,
        y0 + height * 0.08,
        x0 + width * 0.56,
        y0 + height * 0.92,
    )
    draw.ellipse(zero_box, outline=255, width=stroke)
    barrier_x = x0 + width * 0.84
    draw.line(
        (barrier_x, y0 + height * 0.08, barrier_x, y0 + height * 0.92),
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
