"""Turn raw Codex generations (art/raw/*.png) into game-ready assets (assets/...) + assets/manifest.json.

Sprite sheets are chroma-keyed (magenta), split into frames along empty-column gaps, downscaled to a
retro pixel size with premultiplied box filtering, and given a 1-bit alpha. Textures are shrunk to 64x64 and
seam-blended; skies become 1024x512 equirectangular panoramas.
"""
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art", "raw")
FRAMES = os.path.join(ROOT, "art", "frames")  # individual sprite frames (packed into assets/atlas_N.png)
OUT = os.path.join(ROOT, "assets")
ATLAS_W, ATLAS_MAX_H, PAD = 1024, 1024, 1

CHARS = ["cultist", "marine", "ranger", "butcher"]
WEAPONS = ["axe", "shotgun", "sshotgun", "tommy", "grenade", "rocket", "tesla"]
TEXTURES = ["stone", "runic", "woodwall", "brick", "tech", "grass", "cobble", "mars", "lava", "slime",
            "flagstone", "woodfloor", "grate", "crate", "cliff", "marble"]
SKIES = ["moon", "storm", "hell"]

# name -> (frame count, mode, params)
#   mode 'ref':  every frame scaled by the factor that makes frame `ref` exactly `h` px tall (keeps relative sizes)
#   mode 'each': frame i scaled to heights[i] px tall (or widths[i] px wide)
SHEETS = {}
for c in CHARS:
    SHEETS[f"char_{c}_a"] = (4, "ref", {"ref": 0, "h": 80, "anchor": "legs"})
    SHEETS[f"char_{c}_b"] = (4, "ref", {"ref": 2, "h": 80, "anchor": "legs"})
    SHEETS[f"char_{c}_c"] = (4, "ref", {"ref": 0, "h": 78, "anchor": "legs"})
for w in WEAPONS:
    SHEETS[f"wpn_{w}"] = (3, "ref", {"ref": 0, "h": 112, "anchor": "hands"})
SHEETS["pick_weapons"] = (6, "each", {"widths": [48, 40, 44, 38, 52, 44]})
SHEETS["pick_items1"] = (5, "each", {"heights": [14, 22, 32, 30, 32]})
SHEETS["pick_items2"] = (5, "each", {"heights": [16, 16, 20, 18, 30]})
SHEETS["decor"] = (6, "each", {"heights": [150, 56, 40, 64, 88, 44]})
SHEETS["fx_explosion"] = (5, "ref", {"ref": 2, "h": 64, "anchor": "center"})
SHEETS["face"] = (6, "each", {"heights": [34] * 6})


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx or dy:
                out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def erode(m, r):
    return ~dilate(~m, r)


def keyed(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    key = (r > 140) & (b > 140) & (g < 120) & (np.abs(r - b) < 110)
    fringe = dilate(key, 3) & (r - g > 45) & (b - g > 45)
    alpha = ~(key | fringe)
    alpha = dilate(erode(alpha, 1), 1)  # drop isolated specks
    lab, n = ndimage.label(alpha)  # drop stray blobs far smaller than any real frame
    if n:
        sizes = ndimage.sum(alpha, lab, range(1, n + 1))
        alpha &= np.isin(lab, np.where(sizes >= max(60, sizes.max() * 0.004))[0] + 1)
    return rgb.astype(np.uint8), alpha


def segments(alpha, n):
    cols = alpha.sum(0) > 0
    segs, x = [], 0
    W = len(cols)
    while x < W:
        if cols[x]:
            s = x
            while x < W and cols[x]:
                x += 1
            segs.append([s, x])
        x += 1
    segs = [s for s in segs if s[1] - s[0] > 3]
    while len(segs) > n:  # merge across the smallest gap
        gaps = [segs[i + 1][0] - segs[i][1] for i in range(len(segs) - 1)]
        i = int(np.argmin(gaps))
        segs[i] = [segs[i][0], segs[i + 1][1]]
        del segs[i + 1]
    while len(segs) < n:  # split the widest segment at its emptiest middle column
        i = int(np.argmax([s[1] - s[0] for s in segs]))
        s0, s1 = segs[i]
        lo, hi = s0 + (s1 - s0) // 4, s1 - (s1 - s0) // 4
        cut = lo + int(np.argmin(alpha[:, lo:hi].sum(0)))
        segs[i:i + 1] = [[s0, cut], [cut, s1]]
    return segs


def crop(rgb, alpha, x0, x1):
    a = alpha[:, x0:x1]
    rows = np.where(a.any(1))[0]
    colsx = np.where(a.any(0))[0]
    y0, y1 = rows[0], rows[-1] + 1
    cx0, cx1 = x0 + colsx[0], x0 + colsx[-1] + 1
    return rgb[y0:y1, cx0:cx1], alpha[y0:y1, cx0:cx1]


def shrink(rgb, alpha, w, h):
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    af = alpha.astype(np.float32)
    pm = rgb.astype(np.float32) * af[..., None]
    ch = [np.asarray(Image.fromarray(pm[..., i]).resize((w, h), Image.BOX)) for i in range(3)]
    A = np.asarray(Image.fromarray(af).resize((w, h), Image.BOX))
    out = np.stack(ch, -1) / np.maximum(A, 1e-4)[..., None]
    a = A > 0.5
    img = np.zeros((h, w, 4), np.uint8)
    img[..., :3] = np.clip(out, 0, 255).astype(np.uint8) * a[..., None]
    img[..., 3] = a * 255
    return img


def anchor_x(img, mode):
    a = img[..., 3] > 0
    h = a.shape[0]
    if mode == "legs":
        part = a[int(h * 0.6):]
    elif mode == "hands":
        part = a[int(h * 0.85):]
    else:
        part = a
    xs = np.where(part)[1]
    return float(xs.mean()) if len(xs) else a.shape[1] / 2


def do_sheet(name, n, mode, p, manifest):
    path = os.path.join(RAW, name + ".png")
    if not os.path.exists(path):
        print("missing", name)
        return
    rgb, alpha = keyed(path)
    frames = [crop(rgb, alpha, s0, s1) for s0, s1 in segments(alpha, n)]
    out = []
    for i, (fr, fa) in enumerate(frames):
        h0, w0 = fa.shape
        if mode == "ref":
            f = p["h"] / frames[p["ref"]][1].shape[0]
        elif "widths" in p:
            f = p["widths"][i] / w0
        else:
            f = p["heights"][i] / h0
        img = shrink(fr, fa, w0 * f, h0 * f)
        fn = f"{name}_{i}.png"
        Image.fromarray(img, "RGBA").save(os.path.join(FRAMES, fn))
        ax = anchor_x(img, p.get("anchor", "center"))
        out.append({"f": fn, "w": img.shape[1], "h": img.shape[0], "ax": round(ax, 1)})
    manifest["sprites"][name] = out
    print(name, [(o["w"], o["h"]) for o in out])


# ---------- muzzle flashes: the generated art's flashes are scaled down when the atlas is packed ----------
FLASH_SCALE = 0.5
FLASH_WEAPONS = {"wpn_shotgun": [1], "wpn_sshotgun": [1], "wpn_tommy": [1, 2], "wpn_grenade": [1], "wpn_rocket": [1]}


def _flash_colour(a):
    r, g, b = [a[..., i].astype(int) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b)
    warm = ((r > 170) & (r >= g) & (b < r * 0.85)) | ((r > 120) & (g < r * 0.55) & (b < r * 0.55))
    white = (mx > 225) & (np.abs(r - b) < 70)
    return (warm | white) & (a[..., 3] > 0)


def _paste_scaled(base, flash, mask, ax, ay):
    """Composite `flash` (pixels under mask) onto `base`, scaled by FLASH_SCALE about (ax, ay)."""
    ys, xs = np.where(mask)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    fl = Image.fromarray(flash).crop((x0, y0, x1, y1))
    sm = np.asarray(fl.resize((max(1, round((x1 - x0) * FLASH_SCALE)), max(1, round((y1 - y0) * FLASH_SCALE))), Image.BOX)).copy()
    sm[..., 3] = np.where(sm[..., 3] > 100, 255, 0)  # keep the 1-bit alpha
    out = Image.fromarray(base)
    out.alpha_composite(Image.fromarray(sm), (int(round(ax - (ax - x0) * FLASH_SCALE)), int(round(ay - (ay - y0) * FLASH_SCALE))))
    return out


def shrink_weapon_flash(fire, rest, dx, band=22):
    """First-person firing frame: everything above the resting gun's top, plus fire-coloured or off-silhouette pixels just
    below it, is the flash. It shrinks toward the muzzle."""
    a = np.asarray(fire).copy()
    H, W = a.shape[:2]
    cut = H - rest.height
    ra = np.zeros((H, W), bool)
    rr = np.asarray(rest)[..., 3] > 0
    for y in range(rest.height):
        xs = np.where(rr[y])[0] + dx
        xs = xs[(xs >= 0) & (xs < W)]
        if cut + y >= 0: ra[cut + y, xs] = True
    sil = dilate(ra, 1)
    ys = np.arange(H)[:, None]
    mask = (a[..., 3] > 0) & ((ys < cut) | ((ys < cut + band) & (_flash_colour(a) | ~sil)))
    if not mask.any():
        return fire
    flash = np.zeros_like(a); flash[mask] = a[mask]
    gun = a.copy(); gun[mask] = 0
    rows = np.where(gun[..., 3].any(1))[0]
    rows = rows[rows >= max(0, cut - 4)]
    top = rows[0] if len(rows) else cut
    gx = np.where(gun[top:top + 6, :, 3].any(0))[0]
    return _paste_scaled(gun, flash, mask, int(gx.mean()) if len(gx) else W // 2, top + 2)


def shrink_char_flash(fire, grow=3):
    """Third-person firing frame: the flash is the biggest bright cluster plus its connected fire-coloured rim."""
    a = np.asarray(fire).copy()
    r, g, b = [a[..., i].astype(int) for i in range(3)]
    core = (a[..., 3] > 0) & (r > 215) & (g > 150)
    if core.sum() < 3:
        return fire
    lab, n = ndimage.label(core, structure=np.ones((3, 3)))
    core = lab == (1 + int(np.argmax(ndimage.sum(core, lab, range(1, n + 1)))))
    ys, xs = np.where(core)
    H, W = core.shape
    cx0, cx1, cy0, cy1 = xs.min(), xs.max(), ys.min(), ys.max()
    body_left = a[..., 3][:, :cx0].sum() > a[..., 3][:, cx1 + 1:].sum()  # the flash grows away from the body
    box = np.zeros_like(core)
    if body_left: box[max(0, cy0 - 4):cy1 + 5, max(0, cx0 - 1):min(W, cx1 + 9)] = True
    else: box[max(0, cy0 - 4):cy1 + 5, max(0, cx0 - 8):cx1 + 2] = True
    fire_px = (a[..., 3] > 0) & (((r > 200) & (g > 90) & (b < 140)) | ((r > 130) & (g < r * 0.65) & (b < r * 0.6)))
    mask = core.copy()
    for _ in range(grow):
        mask |= dilate(mask, 1) & fire_px & box
    flash = np.zeros_like(a); flash[mask] = a[mask]
    body = a.copy(); body[mask] = 0
    ax = cx0 if body_left else cx1
    return _paste_scaled(body, flash, mask, ax, int(round(ys.mean())))


def shrink_flashes(manifest, imgs):
    S = manifest["sprites"]
    for name, idxs in FLASH_WEAPONS.items():
        rest = imgs[id(S[name][0])]
        for i in idxs:
            fr = S[name][i]
            imgs[id(fr)] = shrink_weapon_flash(imgs[id(fr)], rest, round(fr["ax"] - S[name][0]["ax"]))
    for c in CHARS:
        fr = S[f"char_{c}_a"][2]  # the "firing" pose
        imgs[id(fr)] = shrink_char_flash(imgs[id(fr)])


def pack_atlases(manifest):
    """Shelf-pack every frame into a few atlas PNGs (keeps the hosted build far under 100 files).
    Each frame entry becomes {a: atlas index, x, y, w, h, ax}; the client slices them back out at load time."""
    for f in os.listdir(OUT):
        if f.startswith("atlas_") and f.endswith(".png"):
            os.remove(os.path.join(OUT, f))
    frames = [fr for frs in manifest["sprites"].values() for fr in frs]
    imgs = {id(fr): Image.open(os.path.join(FRAMES, fr.pop("f") if "f" in fr else fr["src"])).convert("RGBA") for fr in frames}
    shrink_flashes(manifest, imgs)
    order = sorted(frames, key=lambda fr: -fr["h"])
    atlases, cur = [], None
    for fr in order:
        w, h = fr["w"] + PAD, fr["h"] + PAD
        if cur is not None and cur["x"] + w > ATLAS_W:  # next shelf
            cur["x"], cur["y"], cur["row"] = 0, cur["y"] + cur["row"], 0
        if cur is None or cur["y"] + h > ATLAS_MAX_H:  # next atlas
            cur = {"x": 0, "y": 0, "row": 0, "items": []}
            atlases.append(cur)
        fr["a"], fr["x"], fr["y"] = len(atlases) - 1, cur["x"], cur["y"]
        cur["items"].append(fr)
        cur["x"] += w
        cur["row"] = max(cur["row"], h)
    manifest["atlases"] = []
    for i, at in enumerate(atlases):
        H = at["y"] + at["row"]
        sheet = Image.new("RGBA", (ATLAS_W, H), (0, 0, 0, 0))
        for fr in at["items"]:
            sheet.paste(imgs[id(fr)], (fr["x"], fr["y"]))
        fn = f"atlas_{i}.png"
        sheet.save(os.path.join(OUT, fn), optimize=True)
        manifest["atlases"].append(fn)
    for frs in manifest["sprites"].values():
        for fr in frs:
            fr.pop("src", None)
    print("atlases", [(f, Image.open(os.path.join(OUT, f)).size) for f in manifest["atlases"]])


def seam_blend(img, band=4):
    a = img.astype(np.float32)
    H, W = a.shape[:2]
    for k in range(band):
        t = 0.5 * (1 - k / band)
        l, r = a[:, k].copy(), a[:, W - 1 - k].copy()
        a[:, k], a[:, W - 1 - k] = l * (1 - t) + r * t, r * (1 - t) + l * t
        tp, bt = a[k].copy(), a[H - 1 - k].copy()
        a[k], a[H - 1 - k] = tp * (1 - t) + bt * t, bt * (1 - t) + tp * t
    return a.clip(0, 255).astype(np.uint8)


def do_texture(t, manifest):
    path = os.path.join(RAW, f"tex_{t}.png")
    if not os.path.exists(path):
        print("missing tex", t)
        return
    im = Image.open(path).convert("RGB")
    W, H = im.size
    m = int(min(W, H) * 0.04)
    s = min(W, H) - 2 * m
    im = im.crop(((W - s) // 2, (H - s) // 2, (W - s) // 2 + s, (H - s) // 2 + s)).resize((64, 64), Image.BOX)
    img = seam_blend(np.asarray(im))
    fn = f"tex/{t}.png"
    Image.fromarray(img).save(os.path.join(OUT, fn))
    manifest["textures"][t] = fn


def do_sky(s, manifest):
    path = os.path.join(RAW, f"sky_{s}.png")
    if not os.path.exists(path):
        print("missing sky", s)
        return
    im = Image.open(path).convert("RGB")
    W, H = im.size
    pano = np.asarray(im.resize((560, 220), Image.BOX)).astype(np.float32)
    band = 48  # make the panorama wrap: fold the right edge into the left edge
    t = np.linspace(0, 1, band)[None, :, None]
    pano[:, :band] = pano[:, :band] * t + pano[:, -band:] * (1 - t)
    pano = pano[:, :-band]  # 512 wide
    out = np.zeros((512, 1024, 3), np.float32)
    top = pano[:6].mean((0, 1))
    bottom = pano[-4:].mean((0, 1))
    y0 = 256 - 220  # panorama spans from ~zenith-ish down to the horizon row
    for y in range(y0):
        out[y] = top * (0.55 + 0.45 * y / y0)
    out[y0:256, :512] = pano
    out[y0:256, 512:] = pano
    for y in range(256, 512):
        out[y] = bottom * max(0.15, 1 - (y - 256) / 64)
    fn = f"sky/{s}.png"
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(os.path.join(OUT, fn))
    manifest["skies"][s] = fn


def repack():
    """Rebuild only the atlases from art/frames + the existing manifest (no raw art needed)."""
    path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(path))
    for name, frs in manifest["sprites"].items():
        for i, fr in enumerate(frs):
            fr.pop("f", None)
            for k in ("a", "x", "y"):
                fr.pop(k, None)
            fr["src"] = f"{name}_{i}.png"
    pack_atlases(manifest)
    with open(path, "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print("manifest written")


def main():
    os.makedirs(FRAMES, exist_ok=True)
    for d in ["tex", "sky"]:
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    manifest = {"sprites": {}, "textures": {}, "skies": {}}
    for name, (n, mode, p) in SHEETS.items():
        do_sheet(name, n, mode, p, manifest)
    for t in TEXTURES:
        do_texture(t, manifest)
    for s in SKIES:
        do_sky(s, manifest)
    tp = os.path.join(RAW, "title.png")
    if os.path.exists(tp):
        im = Image.open(tp).convert("RGB")
        W, H = im.size
        th = int(W * 9 / 16)
        im = im.crop((0, (H - th) // 2, W, (H - th) // 2 + th)).resize((427, 240), Image.BOX)
        im.save(os.path.join(OUT, "title.png"))
        manifest["title"] = "title.png"
    pack_atlases(manifest)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print("manifest written")


if __name__ == "__main__":
    import sys
    repack() if sys.argv[1:] == ["pack"] else main()
