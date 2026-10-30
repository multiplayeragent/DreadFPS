"""Batch-generate DREAD art through the Codex CLI's built-in image generation tool.

Usage: python gen_art.py [phase] [--only name1,name2]
  phase 1: everything without references (incl. character sheet A)
  phase 2: character sheets B/C, which use sheet A as a reference image
Outputs land in art/raw/<name>.png. Existing files are skipped, so re-runs only fill gaps.
"""
import os, sys, subprocess, concurrent.futures as cf, time

CODEX = r"C:\Users\nate\AppData\Local\OpenAI\Codex\bin\896a0166b774037a\codex.exe"
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
WORKERS = 6

STYLE = ("1990s retro first-person-shooter game art in the combined spirit of Quake (1996), Blood (1997) and DOOM (1993), "
         "but an ORIGINAL design that does not copy any existing character, logo or asset. Chunky hand-pixeled look, gritty dark "
         "palette (browns, rust, bone, blood red, gunmetal), hard dark outlines, crisp pixels, no smooth gradients, no soft glow, "
         "no text, no letters, no watermark, no border, no frame.")
KEY = ("Flat solid pure magenta #FF00FF background filling everything behind the subjects. Subjects never touch or overlap each "
       "other and have generous magenta space between them. No ground shadows, no floor, no scenery.")
ROW4 = ("Show the SAME character four times in ONE horizontal row, evenly spaced, all full body at exactly the same scale, "
        "feet on the same baseline. Wide 3:2 landscape image.")
TEX = ("Seamless tileable square game texture, viewed perfectly flat and straight-on with no perspective, even lighting with no "
       "vignette or lighting gradient, the pattern fills the entire image edge to edge. Pixel-art texture like a 1990s FPS, "
       "64x64-texel feel scaled up. ")
SKY = ("Seamless horizontally-wrapping panoramic game skybox, wide 3:2 landscape, horizon line near the bottom quarter, "
       "distant silhouettes along the horizon, painted in a 1990s pixel-art FPS style. No text, no foreground objects. ")
WPN = ("Three panels side by side in ONE horizontal row showing the SAME first-person weapon view three times (animation frames). "
       "In each panel the weapon is held by the player's gloved hands, seen from behind in first-person view, pointing straight "
       "forward into the screen, placed at the bottom center of its panel, and the bottom of the weapon and the arms are cut off "
       "by the bottom edge of the image. Wide 3:2 landscape image. ")

CHARS = {
    "cultist": "a hooded cultist gunman in a tattered dark-brown robe with a red sash, glowing orange eyes under the hood, holding a drum-fed tommy gun",
    "marine": "an armored mercenary soldier in battered gunmetal-blue and rust-orange armor plates, a rounded helmet with a glowing red visor slit, heavy boots, holding a pump shotgun",
    "ranger": "a grim warrior in rusty riveted iron plate armor over chainmail, a leather hood with round brass goggles, a tattered cape, holding a bulky rocket launcher",
    "butcher": "a hulking undead brute with grey-green rotting skin, a blood-stained butcher's apron, a rusted iron face mask, holding a heavy double-barrel shotgun",
}

JOBS = {}  # name -> (phase, prompt, [reference names])

for c, desc in CHARS.items():
    JOBS[f"char_{c}_a"] = (1, f"Game sprite sheet: {desc}. {ROW4} Poses left to right: (1) standing facing the viewer, "
        f"(2) facing the viewer mid-stride with the left foot forward, (3) facing the viewer firing the weapon toward the viewer with a "
        f"bright muzzle flash, (4) seen from directly behind walking away. {KEY} {STYLE}", [])
    JOBS[f"char_{c}_b"] = (2, f"Game sprite sheet of the exact same character as in the attached reference image ({desc}); keep "
        f"identical design, colors, proportions, scale and pixel style. {ROW4} Poses left to right: (1) seen from the side facing "
        f"RIGHT, walking, left leg forward, (2) seen from the side facing RIGHT, walking, right leg forward, (3) facing the viewer "
        f"mid-stride with the right foot forward, (4) seen from directly behind walking away with the opposite leg forward. {KEY} {STYLE}",
        [f"char_{c}_a"])
    JOBS[f"char_{c}_c"] = (2, f"Game sprite sheet of the exact same character as in the attached reference image ({desc}); keep "
        f"identical design, colors, proportions, scale and pixel style. Four frames in ONE horizontal row, evenly spaced, same scale, "
        f"on the same baseline: (1) facing the viewer flinching in pain with blood spurting from the chest, (2) facing the viewer "
        f"blasted and falling backward with blood spraying, weapon flying, (3) collapsing onto the knees, slumped forward, (4) the "
        f"corpse lying flat on the ground in a pool of blood, seen from the front at a low angle, short and wide. Wide 3:2 landscape "
        f"image. {KEY} {STYLE}", [f"char_{c}_a"])

WEAPONS = {
    "axe": ("a rusty, notched iron war axe with a wrapped wooden haft held in the right hand", "(1) axe raised at rest on the right side, (2) axe pulled back winding up for a swing, (3) axe mid-swing sweeping across the center with motion streaks"),
    "shotgun": ("a pump-action shotgun with a scarred wooden pump and stock", "(1) at rest, (2) firing with a big bright yellow-orange muzzle flash at the barrel tip, (3) the pump pulled back to rack a new shell"),
    "sshotgun": ("a sawed-off double-barrel shotgun with two short side-by-side barrels", "(1) at rest, (2) firing both barrels with a huge muzzle flash, (3) the gun broken open at the hinge with smoking empty shells ejecting"),
    "tommy": ("a 1920s drum-magazine tommy gun with a wooden foregrip", "(1) at rest, (2) firing with a bright muzzle flash, (3) firing with a differently shaped muzzle flash and the gun kicked slightly up"),
    "grenade": ("a stubby, chunky revolver-drum grenade launcher made of riveted iron with a fat short barrel", "(1) at rest, (2) firing with a puff of flame and smoke at the muzzle, (3) recoiling upward with smoke drifting"),
    "rocket": ("a heavy shoulder-carried rocket launcher made of riveted dark iron with a wide tube and a rocket tip visible inside", "(1) at rest, (2) firing with a blast of fire and smoke from the tube, (3) recoiling with smoke"),
    "tesla": ("an arcane electric tesla gun with copper coils, glass vacuum tubes and crackling blue sparks", "(1) idle with small blue sparks on the coils, (2) firing a thick jagged blue-white lightning bolt straight forward, (3) firing a differently shaped lightning bolt"),
}
for w, (desc, frames) in WEAPONS.items():
    JOBS[f"wpn_{w}"] = (1, f"First-person weapon sprite frames: {desc}. {WPN}Frames: {frames}. {KEY} {STYLE}", [])

JOBS["pick_weapons"] = (1, "Game pickup sprites: six different weapons lying on the ground, each seen from the side, in ONE horizontal row, "
    "evenly spaced, same scale: (1) a pump-action shotgun, (2) a sawed-off double-barrel shotgun, (3) a drum-magazine tommy gun, "
    "(4) a stubby riveted-iron revolver-drum grenade launcher, (5) a heavy riveted iron rocket launcher, (6) an arcane copper-coil tesla "
    "gun with glass tubes. Wide 3:2 landscape image. " + KEY + " " + STYLE, [])
JOBS["pick_items1"] = (1, "Game pickup item sprites, five items in ONE horizontal row, evenly spaced, same scale, front view: (1) a small "
    "white first-aid kit with a red cross, (2) a large battered metal medical case with a red cross, (3) a glowing red pulsing heart sealed "
    "in a glass orb on a small iron stand, (4) a light armor vest of stitched green-brown leather, (5) a heavy armor cuirass of riveted "
    "blood-red iron plates. Wide 3:2 landscape image. " + KEY + " " + STYLE, [])
JOBS["pick_items2"] = (1, "Game pickup item sprites, five items in ONE horizontal row, evenly spaced, same scale, front view: (1) an "
    "open cardboard box of red shotgun shells, (2) a round tommy-gun drum magazine of bullets, (3) a wooden crate holding three rockets "
    "with red tips, (4) a glowing blue electric battery cell pack with copper terminals, (5) a floating glowing purple horned skull rune "
    "(a rage power-up). Wide 3:2 landscape image. " + KEY + " " + STYLE, [])
JOBS["decor"] = (1, "Game scenery sprites, six objects in ONE horizontal row, evenly spaced, each standing upright on its own, front view: "
    "(1) a dead twisted leafless tree, (2) a weathered stone cross tombstone, (3) a cracked rounded stone headstone with moss, (4) a tall "
    "iron brazier on legs with roaring orange flames, (5) a stone pillar topped with a horned skull and candles, (6) a rusty steel barrel "
    "leaking glowing green toxic sludge. Wide 3:2 landscape image. " + KEY + " " + STYLE, [])
JOBS["fx_explosion"] = (1, "Game sprite animation frames of one fiery explosion, five frames in ONE horizontal row, evenly spaced, each "
    "frame separate: (1) a small white-yellow flash, (2) a growing yellow-orange fireball, (3) a big orange-red fireball with dark smoke "
    "edges, (4) a breaking-up fireball turning to smoke with embers, (5) a fading dark grey smoke puff. Wide 3:2 landscape image. "
    + KEY + " " + STYLE, [])
JOBS["face"] = (1, "Game HUD portrait sprites of the same ORIGINAL grizzled player character (a scarred mercenary with short dark hair, "
    "stubble and a cold stare), head and shoulders, front view, six portraits in ONE horizontal row, evenly spaced, same scale: (1) healthy "
    "and determined, (2) lightly bruised and gritting teeth, (3) bloodied with a cut brow, (4) badly beaten and covered in blood, (5) an evil "
    "grin, (6) dead, grey-skinned with eyes rolled back. Wide 3:2 landscape image. " + KEY + " " + STYLE, [])
JOBS["title"] = (1, "Dark key art for a retro 1990s FPS title screen (NO text, NO logo): silhouetted hooded cultists and armored "
    "mercenaries locked in a brutal gunfight in a foggy graveyard beneath a huge blood-red moon, a gothic chapel and a burning castle "
    "behind them, muzzle flashes and rockets lighting the night. Wide 3:2 landscape, painted in a gritty pixel-art style. " + STYLE, [])

TEXTURES = {
    "stone": "grey-brown castle stone blocks of uneven sizes with dark mortar, chipped edges and grime",
    "runic": "rusty riveted iron wall panels with faint carved runes and orange rust streaks",
    "woodwall": "dark weathered vertical wooden wall planks with nails and blood stains",
    "brick": "gothic red-brown brick wall with soot, grime and a few cracked bricks",
    "tech": "grey-blue industrial sci-fi metal wall panels with vents, bolts and a thin yellow-black hazard stripe band",
    "grass": "dark night-time ground of patchy dead grass and dirt with small stones, seen from directly above",
    "cobble": "worn dark cobblestone road seen from directly above",
    "mars": "rocky reddish-brown alien dirt and gravel ground seen from directly above",
    "lava": "molten glowing orange-red lava with darker cooling crust patches, seen from directly above",
    "slime": "bubbling glowing toxic green slime liquid seen from directly above",
    "flagstone": "dark stone flagstone floor tiles with dirty grout, seen from directly above",
    "woodfloor": "old dark wooden floorboards with gaps and scuffs, seen from directly above",
    "grate": "dark steel diamond-plate floor with a rusty grating section, seen from directly above",
    "crate": "the face of a heavy wooden supply crate with iron corner brackets and a stenciled-looking pattern (no letters)",
    "cliff": "rough craggy grey-brown rock cliff face with cracks",
    "marble": "dark green-black carved marble wall with skull reliefs in a repeating gothic pattern",
}
for t, desc in TEXTURES.items():
    JOBS[f"tex_{t}"] = (1, TEX + f"Subject: {desc}. Square 1:1 image. " + STYLE, [])

JOBS["sky_moon"] = (1, SKY + "A blood-red night sky with a huge pale moon, tattered dark clouds and a silhouette of dead trees and church "
                    "spires on the horizon. " + STYLE, [])
JOBS["sky_storm"] = (1, SKY + "A stormy purple and orange dusk sky with lightning, heavy clouds and jagged mountain and castle silhouettes "
                     "on the horizon. " + STYLE, [])
JOBS["sky_hell"] = (1, SKY + "A hellish burning orange-red sky with ash clouds, distant volcanoes and jagged rock spires on the horizon. "
                    + STYLE, [])


def run(name):
    phase, prompt, refs = JOBS[name]
    out = os.path.join(RAW, name + ".png")
    if os.path.exists(out):
        return name, "skip"
    instr = (f"Use your built-in image generation tool to create exactly ONE image from the spec below, then copy the generated PNG "
             f"into the current working directory with the filename {name}.png. Do not create any other files. Reply with just the filename.\n\n"
             f"Image spec: {prompt}")
    cmd = [CODEX, "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", RAW, "--ephemeral"]
    for r in refs:
        cmd += ["-i", os.path.join(RAW, r + ".png")]
    cmd.append("-")
    for attempt in range(3):
        t0 = time.time()
        try:
            subprocess.run(cmd, input=instr, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
        except subprocess.TimeoutExpired:
            pass
        if os.path.exists(out):
            return name, f"ok {time.time() - t0:.0f}s (try {attempt + 1})"
    return name, "FAILED"


if __name__ == "__main__":
    phase = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    names = [n for n, j in JOBS.items() if j[0] == phase and (only is None or n in only)]
    os.makedirs(RAW, exist_ok=True)
    print(f"phase {phase}: {len(names)} jobs", flush=True)
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for name, status in ex.map(run, names):
            print(f"{name}: {status}", flush=True)
