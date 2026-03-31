"""
Photorealistic synthetic camera frame renderer using PIL.
Produces a 640×640 top-down drone camera view with projected flower clusters.
"""

from __future__ import annotations
import math
import io
import base64
import hashlib
from typing import Any

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
    import numpy as np
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

IMG_SIZE = 640
# 90-degree downward FOV → focal length = IMG_SIZE / 2
FX = FY = IMG_SIZE / 2
CX = CY = IMG_SIZE / 2

# ──────────────────────────────────────────────────────────────────────────────

def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

def _darken(rgb: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, int(c * factor)) for c in rgb)  # type: ignore

def _lighten(rgb: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(min(255, int(c + (255 - c) * factor)) for c in rgb)  # type: ignore

def _blend(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore


def _project(flower: dict[str, Any], drone: dict[str, Any]) -> dict[str, Any] | None:
    """Project a flower from garden space into camera pixel coordinates."""
    alt = max(0.1, drone['z'])
    rel_x = flower['x'] - drone['x']
    rel_y = flower['y'] - drone['y']

    # Apply drone yaw rotation (clockwise from north = +y axis)
    yaw_rad = math.radians(drone.get('yaw', 0))
    cos_y, sin_y = math.cos(yaw_rad), math.sin(yaw_rad)
    cam_x = rel_x * cos_y + rel_y * sin_y
    cam_y = -rel_x * sin_y + rel_y * cos_y

    u = int(FX * cam_x / alt + CX)
    v = int(FY * cam_y / alt + CY)
    radius_px = max(3, int(flower['radius'] / alt * FX))

    if u < -radius_px * 2 or u > IMG_SIZE + radius_px * 2:
        return None
    if v < -radius_px * 2 or v > IMG_SIZE + radius_px * 2:
        return None

    return {'u': u, 'v': v, 'radius': radius_px, 'dist': alt}


def _draw_flower(draw: 'ImageDraw.ImageDraw', proj: dict[str, Any],
                 flower: dict[str, Any], seed: int) -> None:
    u, v, r = proj['u'], proj['v'], proj['radius']
    r = max(4, r)
    color = _hex_to_rgb(flower.get('color', '#c084fc'))
    accent = _darken(color, 0.6)
    stem_color = (45, 100, 55)
    leaf_color = (55, 130, 60)

    # Deterministic per-flower RNG from seed
    def prng(n: int) -> float:
        h = int(hashlib.md5(f'{seed}-{n}'.encode()).hexdigest(), 16)
        return (h % 10000) / 10000.0

    petal_count = 6
    petal_w = max(2, int(r * 0.55))
    petal_h = max(3, int(r * 0.90))
    pistil_r = max(2, int(r * 0.30))
    rot_offset = prng(0) * 360

    # Ground shadow
    shadow_r = int(r * 1.35)
    draw.ellipse(
        [u - shadow_r, v - shadow_r, u + shadow_r, v + shadow_r],
        fill=(28, 60, 28, 140),  # type: ignore
    )

    # Grass patch beneath flower
    patch_r = int(r * 1.1)
    draw.ellipse(
        [u - patch_r, v - patch_r, u + patch_r, v + patch_r],
        fill=(58 + int(prng(1) * 20), 98 + int(prng(2) * 20), 48 + int(prng(3) * 15)),
    )

    # Stem (only visible when flower is large enough)
    if r > 8:
        stem_len = int(r * 1.2)
        stem_angle_rad = math.radians(prng(4) * 30 - 15)
        stem_ex = u + int(math.sin(stem_angle_rad) * stem_len)
        stem_ey = v + stem_len
        draw.line([u, v, stem_ex, stem_ey], fill=stem_color, width=max(1, r // 5))

        # Leaves
        if r > 12:
            for side in (-1, 1):
                lx = u + side * int(r * 0.6)
                ly = v + int(r * 0.5)
                draw.ellipse([lx - r // 3, ly - r // 6, lx + r // 3, ly + r // 6],
                             fill=leaf_color)

    # Petals
    for pi in range(petal_count):
        angle = rot_offset + (360 / petal_count) * pi
        ang_rad = math.radians(angle)
        irr = 0.8 + prng(10 + pi) * 0.4  # petal irregularity
        cx_p = u + int(math.sin(ang_rad) * petal_h * 0.55)
        cy_p = v - int(math.cos(ang_rad) * petal_h * 0.55)
        pw = int(petal_w * irr)
        ph = int(petal_h * irr * 0.7)
        petal_color = _blend(color, _lighten(color, 0.3), prng(20 + pi) * 0.4)
        draw.ellipse([cx_p - pw, cy_p - ph, cx_p + pw, cy_p + ph], fill=petal_color)

    # Pistil centre
    pistil_light = _lighten(accent, 0.3)
    draw.ellipse([u - pistil_r, v - pistil_r, u + pistil_r, v + pistil_r],
                 fill=pistil_light)
    # Pistil inner dot
    i_r = max(1, pistil_r // 2)
    draw.ellipse([u - i_r, v - i_r, u + i_r, v + i_r], fill=accent)


def render_frame(drone: dict[str, Any], flowers: list[dict[str, Any]]) -> 'np.ndarray':
    """Render a 640×640 synthetic camera frame. Returns float32 numpy array [0,1]."""
    if not PIL_AVAILABLE:
        import numpy as np  # type: ignore
        return np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.float32)

    import numpy as np  # type: ignore

    # ── Background ─────────────────────────────────────────────────────────
    img = Image.new('RGB', (IMG_SIZE, IMG_SIZE))
    pixels = np.array(img, dtype=np.int16)

    # Grass base colour with per-pixel noise for natural texture
    rng = np.random.default_rng(42)
    noise = rng.integers(-18, 18, (IMG_SIZE, IMG_SIZE, 3), dtype=np.int16)
    base = np.array([72, 108, 52], dtype=np.int16)
    pixels[:] = np.clip(base + noise, 0, 255)

    # Subtle darker soil patches
    for i in range(12):
        cx_ = int(rng.integers(50, IMG_SIZE - 50))
        cy_ = int(rng.integers(50, IMG_SIZE - 50))
        r_  = int(rng.integers(20, 70))
        for dx in range(-r_, r_ + 1):
            for dy in range(-r_, r_ + 1):
                if dx * dx + dy * dy <= r_ * r_:
                    px, py = cx_ + dx, cy_ + dy
                    if 0 <= px < IMG_SIZE and 0 <= py < IMG_SIZE:
                        pixels[py, px] = np.clip(pixels[py, px] - 12, 0, 255)

    img = Image.fromarray(pixels.astype(np.uint8), 'RGB')
    draw = ImageDraw.Draw(img, 'RGBA')

    # ── Draw flowers ────────────────────────────────────────────────────────
    projected = []
    for flower in flowers:
        proj = _project(flower, drone)
        if proj is not None:
            projected.append((proj, flower))

    # Sort back-to-front (largest distance first so close flowers render on top)
    projected.sort(key=lambda t: t[0]['dist'], reverse=True)

    for proj, flower in projected:
        seed = abs(hash(flower['id'])) % 100000
        _draw_flower(draw, proj, flower, seed)

    # ── Post-processing ─────────────────────────────────────────────────────
    alt = drone.get('z', 1.0)

    # Depth-of-field blur — stronger at high altitude
    if alt > 2.0:
        blur_r = min(3.0, alt / 3.5)
        img = img.filter(ImageFilter.GaussianBlur(radius=blur_r))

    # Slight vignette
    vig = Image.new('L', (IMG_SIZE, IMG_SIZE), 255)
    vig_draw = ImageDraw.Draw(vig)
    for margin, opacity in [(0, 0), (40, 60), (80, 140), (120, 200)]:
        vig_draw.rectangle([margin, margin, IMG_SIZE - margin, IMG_SIZE - margin],
                           fill=None, outline=None)
    # Simple gradient vignette via multiply
    vig_arr = np.array(vig, dtype=np.float32) / 255.0
    img_arr = np.array(img, dtype=np.float32)
    cx_v = cy_v = IMG_SIZE / 2
    y_idx, x_idx = np.mgrid[0:IMG_SIZE, 0:IMG_SIZE]
    dist_arr = np.sqrt((x_idx - cx_v) ** 2 + (y_idx - cy_v) ** 2)
    vig_factor = np.clip(1.0 - dist_arr / (IMG_SIZE * 0.72), 0.65, 1.0)
    img_arr *= vig_factor[:, :, np.newaxis]
    img = Image.fromarray(np.clip(img_arr, 0, 255).astype(np.uint8))

    return np.array(img, dtype=np.float32) / 255.0


def frame_to_base64(frame_array: 'np.ndarray') -> str:
    """Encode a float32 [H,W,3] numpy array as a base64 JPEG string."""
    if not PIL_AVAILABLE:
        return ''
    import numpy as np  # type: ignore
    img = Image.fromarray((frame_array * 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=82)
    return base64.b64encode(buf.getvalue()).decode('utf-8')
