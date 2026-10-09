"""Découpe refs/logo.jpg en calques alpha blancs : anneau (ensō), point, texte."""
import sys
import numpy as np
from PIL import Image

src, outdir = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("L")).astype(np.float32)
# fond ~ #F2F2F2 → alpha 0 ; encre → alpha 1
alpha = np.clip((235.0 - im) / (235.0 - 30.0), 0, 1)
h, w = alpha.shape
yy, xx = np.mgrid[0:h, 0:w]

# centre du point : barycentre des pixels sombres dans la zone centrale
core = (alpha > 0.5) & (abs(xx - 640) < 140) & (yy > 480) & (yy < 760)
dcy, dcx = yy[core].mean(), xx[core].mean()
# centre de l'anneau : barycentre des pixels éloignés
# centre de l'anneau : centre de sa boîte englobante (le trait est plus épais à gauche)
ringzone = (alpha > 0.5) & (np.hypot(xx - 640, yy - 640) > 400)
ys, xs = np.nonzero(ringzone)
rcx, rcy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
print("dot center", dcx, dcy, "ring center", rcx, rcy)

r_ring = np.hypot(xx - rcx, yy - rcy)
r_dot = np.hypot(xx - dcx, yy - dcy)
ring = alpha * (r_ring > 375)
dot = alpha * (r_dot < 125) * (r_ring <= 375)
text = alpha * (r_ring <= 375) * (r_dot >= 125)

def save(a, name):
    ys, xs = np.nonzero(a > 0.02)
    print(name, "bbox", xs.min(), ys.min(), xs.max(), ys.max())
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (a * 255).astype(np.uint8)
    Image.fromarray(rgba).save(f"{outdir}/{name}.png")

save(ring, "ring"); save(dot, "dot"); save(text, "text"); save(alpha, "full")
