"""Gera a identidade visual raster do Guardião Zero Pro.

O símbolo combina um escudo com um espaço negativo em forma de zero. A marca
colorida é usada no gerenciador e nas páginas; as versões monocromáticas são
reservadas à barra do navegador para manter contraste em qualquer tema.
"""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"
SIZES = (16, 32, 48, 128)
THEME_SIZES = (16, 32, 48)
INDIGO = (91, 91, 214)
BLUE = (47, 116, 229)


def cubic(p0, p1, p2, p3, count=48):
    points = []
    for index in range(count + 1):
        t = index / count
        inverse = 1 - t
        points.append((
            inverse**3 * p0[0]
            + 3 * inverse * inverse * t * p1[0]
            + 3 * inverse * t * t * p2[0]
            + t**3 * p3[0],
            inverse**3 * p0[1]
            + 3 * inverse * inverse * t * p1[1]
            + 3 * inverse * t * t * p2[1]
            + t**3 * p3[1],
        ))
    return points


def shield_points():
    points = [(12, 22)]
    points += cubic((12, 22), (12, 22), (20, 18), (20, 12))[1:]
    points += [(20, 5), (12, 2), (4, 5), (4, 12)]
    points += cubic((4, 12), (4, 18), (12, 22), (12, 22))[1:]
    return points


def map_points(points, box):
    x0, y0, x1, y1 = box
    scale_x = (x1 - x0) / 24
    scale_y = (y1 - y0) / 24
    return [(x0 + x * scale_x, y0 + y * scale_y) for x, y in points]


def zero_shield_mask(canvas_size, box):
    """Retorna um escudo sólido com um zero vazado no centro."""
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(map_points(shield_points(), box), fill=255)

    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    zero_box = (
        x0 + width * 0.34,
        y0 + height * 0.30,
        x0 + width * 0.66,
        y0 + height * 0.67,
    )
    draw.ellipse(zero_box, fill=0)
    return mask


def diagonal_gradient(size, start, end):
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    denominator = max(1, (size - 1) * 2)
    for y in range(size):
        for x in range(size):
            amount = (x + y) / denominator
            pixels[x, y] = tuple(
                round(start[channel] + (end[channel] - start[channel]) * amount)
                for channel in range(3)
            )
    return image.convert("RGBA")


def make_badge(size, supersampling=8):
    canvas = size * supersampling
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))

    rounded_mask = Image.new("L", (canvas, canvas), 0)
    rounded_draw = ImageDraw.Draw(rounded_mask)
    inset = max(1, round(canvas * 0.025))
    rounded_draw.rounded_rectangle(
        (inset, inset, canvas - inset - 1, canvas - inset - 1),
        radius=round(canvas * 0.245),
        fill=255,
    )
    gradient = diagonal_gradient(canvas, INDIGO, BLUE)
    gradient.putalpha(rounded_mask)
    image = Image.alpha_composite(image, gradient)

    highlight = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight)
    highlight_draw.arc(
        (canvas * 0.08, canvas * 0.08, canvas * 0.92, canvas * 0.92),
        195,
        310,
        fill=(255, 255, 255, 75),
        width=max(1, round(canvas * 0.018)),
    )
    image = Image.alpha_composite(image, highlight)

    padding = canvas * 0.19
    symbol_mask = zero_shield_mask(
        canvas,
        (padding, padding * 0.84, canvas - padding, canvas - padding * 0.92),
    )
    symbol = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 0))
    symbol.putalpha(symbol_mask)
    image = Image.alpha_composite(image, symbol)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def make_monochrome(size, color, supersampling=8):
    canvas = size * supersampling
    padding = canvas * 0.105
    mask = zero_shield_mask(
        canvas,
        (padding, padding * 0.8, canvas - padding, canvas - padding * 0.75),
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
            make_monochrome(size, (23, 25, 33), supersampling).save(
                OUT / f"icon-dark-{size}.png"
            )
        print(f"ok {size}px")


if __name__ == "__main__":
    main()
