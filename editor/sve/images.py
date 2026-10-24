"""Photo handling. Photos are only resized and re-saved as JPEG: colours are never adjusted,
because the product is the shade itself."""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_SIDE = 2000  # pixels; the website makes its own smaller copies from this
MAX_UPLOAD = 40 * 1024 * 1024


class PhotoError(Exception):
    pass


def prepare(data: bytes) -> dict:
    """Turn an uploaded photo into a website-ready JPEG. Returns bytes, size and a suggested swatch colour."""
    if len(data) > MAX_UPLOAD:
        raise PhotoError('That photo is too large (over 40 MB). Choose a smaller one.')
    try:
        im = Image.open(BytesIO(data))
        im.load()
    except (UnidentifiedImageError, OSError):
        raise PhotoError('That file is not a photo the editor can read. Choose a JPG or PNG photo.')
    icc = im.info.get('icc_profile')
    im = ImageOps.exif_transpose(im)  # phones store rotation separately; apply it
    if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        flat = Image.new('RGB', im.size, (255, 255, 255))
        flat.paste(im, mask=im.getchannel('A'))
        im = flat
    else:
        im = im.convert('RGB')
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    out = BytesIO()
    im.save(out, 'JPEG', quality=90, optimize=True, **({'icc_profile': icc} if icc else {}))
    return {'jpeg': out.getvalue(), 'width': im.width, 'height': im.height, 'hex': centre_colour(im)}


def centre_colour(im: Image.Image) -> str:
    """Median colour of the middle of the photo. Only a suggestion for the small colour dot and swatch."""
    w, h = im.size
    box = im.crop((w // 4, h // 4, w * 3 // 4, h * 3 // 4)).resize((64, 64))
    pixels = list(box.getdata())
    channels = [sorted(p[i] for p in pixels) for i in range(3)]
    r, g, b = (c[len(c) // 2] for c in channels)
    return f'#{r:02X}{g:02X}{b:02X}'


def thumbnail(data: bytes, size: int = 480) -> bytes:
    """Small JPEG for showing existing website photos inside the editor."""
    im = ImageOps.exif_transpose(Image.open(BytesIO(data)))
    im = im.convert('RGB')
    im.thumbnail((size, size), Image.LANCZOS)
    out = BytesIO()
    im.save(out, 'JPEG', quality=82)
    return out.getvalue()
