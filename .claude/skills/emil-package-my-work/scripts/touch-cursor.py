"""Draw Chrome's touch-emulation cursor (a translucent grey disc) onto a screen
phone screen recording, following gestures you work out from the footage.

  python3 touch-cursor.py sheet  in.mov sheet.png [fps]   timestamped sheets -> sheet-01.png…
  python3 touch-cursor.py render in.mov gestures.json out.mp4 [--preview]

gestures.json: t in seconds, x/y in points (source px / scale; iPhone
recordings are scale 3). Here: rest, move, finger down, drag, finger up.
  {"scale": 3, "keys": [
    {"t": 0.00, "x": 292, "y": 770},
    {"t": 0.80, "x": 240, "y": 700},
    {"t": 0.88, "x": 240, "y": 700, "press": true},
    {"t": 1.08, "x": 232, "y": 560, "press": true},
    {"t": 1.10, "x": 232, "y": 560}
  ]}

Between two pressed keys the dot moves linearly, so dense keys from tracking
follow content exactly. Every other move eases in-out cubic. The press state
at time t is the latest key's "press". Audio and the source colour range are kept.
"""
import json, subprocess, sys
import numpy as np

RADIUS_PT = 16  # Chrome uses 12.7pt; that reads too small at timeline size


def probe(src):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate,color_range,color_space,color_transfer,color_primaries",
         "-show_entries", "format=duration", "-of", "json", src],
        capture_output=True, text=True, check=True).stdout
    j = json.loads(out); s = j["streams"][0]
    n, d = s["r_frame_rate"].split("/")
    return s, float(n) / float(d), float(j["format"]["duration"])


def sheet(src, out, fps="4"):
    """One or more sheets (8 s each at 4fps) covering the whole recording: out-01.png, out-02.png…"""
    vf = (f"fps={fps},scale=360:-1,drawtext=text='%{{pts\\:hms}}':x=8:y=8:fontsize=22:"
          "fontcolor=red:box=1:boxcolor=white@0.7,tile=8x4")
    pattern = out[:-4] + "-%02d.png" if out.endswith(".png") else out + "-%02d.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, pattern], check=True)
    print(pattern)


def ease(t):
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def track(keys, n, fps):
    keys = sorted(keys, key=lambda k: k["t"])
    X = np.zeros(n); Y = np.zeros(n); P = np.zeros(n)
    for f in range(n):
        t = f / fps
        i = max([k for k, key in enumerate(keys) if key["t"] <= t] or [0])
        a = keys[i]; b = keys[min(i + 1, len(keys) - 1)]
        if b is a or t <= a["t"]:
            X[f], Y[f] = a["x"], a["y"]
        else:
            u = (t - a["t"]) / (b["t"] - a["t"])
            if not (a.get("press") and b.get("press")):
                u = ease(u)
            X[f] = a["x"] + (b["x"] - a["x"]) * u
            Y[f] = a["y"] + (b["y"] - a["y"]) * u
        P[f] = 1.0 if a.get("press") else 0.0
    pr = np.zeros(n); v = 0.0
    for f in range(n):  # press eases over ~5 frames
        v += (P[f] - v) * 0.45
        pr[f] = v
    return X, Y, pr


def render(src, gestures, out, preview=False):
    g = json.load(open(gestures))
    s, fps, dur = probe(src)
    W, H = s["width"], s["height"]
    S = float(g.get("scale", 3))
    n = int(round(dur * fps)) + 2
    X, Y, pr = track(g["keys"], n, fps)
    R0 = RADIUS_PT * S
    pad = int(R0 + 8)
    yy, xx = np.mgrid[-pad:pad + 1, -pad:pad + 1].astype(np.float32)

    def patch(cx, cy, p):
        r = R0 * (1 - 0.14 * p)  # a little smaller while pressed
        d = np.sqrt((xx - (cx - np.floor(cx))) ** 2 + (yy - (cy - np.floor(cy))) ** 2)
        disc = np.clip(r - d + 0.5, 0, 1)
        ring = np.clip(1 - np.abs(d - (r - 1.75)) + 1.0, 0, 1) * disc
        a = disc * (0.30 + 0.22 * p)
        a = a + ring * (0.55 + 0.2 * p) * (1 - a)
        return a, 200 + 30 * p  # light grey, brighter while pressed

    full = s.get("color_range") == "pc"
    color = []
    for key, flag in (("color_space", "-colorspace"), ("color_primaries", "-color_primaries"),
                      ("color_transfer", "-color_trc")):
        if s.get(key) and s[key] != "unknown":
            color += [flag, s[key]]
    if preview:
        enc_args = ["-vf", "scale=480:-2", "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-an"]
    else:
        enc_args = ["-c:v", "libx264", "-preset", "slow", "-crf", "14",
                    "-pix_fmt", "yuvj420p" if full else "yuv420p",
                    "-color_range", "pc" if full else "tv", *color,
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-s", f"{W}x{H}", "-r", f"{fps}", "-i", "-", "-i", src,
                            "-map", "0:v", "-map", "1:a?", *enc_args, out], stdin=subprocess.PIPE)
    size = W * H * 3
    f = 0
    while True:
        buf = dec.stdout.read(size)
        if len(buf) < size:
            break
        img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)
        k = min(f, n - 1)
        cx, cy = X[k] * S, Y[k] * S
        a, col = patch(cx, cy, pr[k])
        x0, y0 = int(np.floor(cx)) - pad, int(np.floor(cy)) - pad
        sx0, sy0 = max(0, -x0), max(0, -y0)
        sx1 = (2 * pad + 1) - max(0, x0 + 2 * pad + 1 - W)
        sy1 = (2 * pad + 1) - max(0, y0 + 2 * pad + 1 - H)
        if sx1 > sx0 and sy1 > sy0:
            reg = img[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1]
            aa = a[sy0:sy1, sx0:sx1, None]
            reg[:] = reg * (1 - aa) + col * aa
        enc.stdin.write(img.clip(0, 255).astype(np.uint8).tobytes())
        f += 1
    enc.stdin.close(); enc.wait(); dec.wait()
    if enc.returncode:
        sys.exit("ffmpeg encode failed")
    print(out, f"{W}x{H}", f"{fps:g}fps", f"{f} frames")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["sheet"]:
        sheet(*a[1:4])
    elif a[:1] == ["render"]:
        render(a[1], a[2], a[3], "--preview" in a)
    else:
        sys.exit(__doc__)
