# Guide de style — Randonnée du Cercle

## Source analysée

`refs/` ne contient qu'une référence : **le logo du club** (`refs/logo.jpg`). Il n'y a pas de vidéo de référence, donc ce guide part de la grammaire du logo.

| Élément du logo | Lecture | Traduction en mouvement |
|---|---|---|
| Ensō au pinceau (cercle ouvert, trait sec, éclaboussures) | Geste humain, rythme, boucle | Révélation par **balayage angulaire** du vrai trait (aucune redessin vectoriel lisse). Sert d'accroche, d'entourage de la date, de tampon et de signature finale. |
| Point plein décentré vers le haut | « Vous êtes ici », un repère | Le point **tombe** (gravité et écrasement amorti), devient le marqueur du sentier, puis le **portail** de transition (plongée dans le point). |
| Script « le cercle » | Convivialité | Utilisé tel quel, uniquement dans la signature finale. Jamais imité. |
| Noir sur fond clair, sans couleur | Sobriété | Palette réduite à 3 couleurs + 1 accent. |

Le logo est découpé en 3 calques alpha (`tools/split_logo.py` → `assets/logo/`) pour animer l'anneau, le point et le texte séparément.

## Palette « forêt profonde »

| Jeton | Hex | Usage |
|---|---|---|
| `forest` | `#0B2318` | fond dominant (forêt primaire du Banco) |
| `paper` | `#F1ECDF` | texte clair, fond éditorial (date), ticket |
| `orange` | `#FF5B1F` | **accent rare** : tracé, point, chiffres-clés, CTA — orange balise de sentier |
| `canopy` | `#143B2B` | réserve |

Règles : aucun dégradé, aucune lueur. Les aplats sont francs. L'orange n'occupe jamais plus d'un plan plein (P2, P4 « PARTAGE. »).

## Typographie

- **Anton** (display) : capitales condensées très grasses, ajustées à la largeur (`fitSize`) pour remplir le cadre. Elles sont parfois coupées par le bord (« 7 ») ou posées à la verticale (« DE FORÊT PRIMAIRE »).
- **Archivo Narrow 700** (texte) : petites capitales espacées (+4 à +12 px) pour les étiquettes, les coordonnées et les infos. Minimum **38 px** à 1080 px de large.
- Ferré à gauche sur une marge de 70 px. Le centrage est réservé à la signature finale.

## Mouvement

Toutes les entrées utilisent un **ressort analytique** (oscillateur amorti), avec 5 intensités :

| Famille | Fréquence / amortissement | Sensation |
|---|---|---|
| `type` grande typo | 1,5 Hz / 0,62 | masse lourde, léger dépassement |
| `word` mots de la rafale | 3,2 Hz / 0,72 | sec, nerveux |
| `card` blocs, ticket | 2,2 Hz / 0,68 | objet physique |
| `ui` étiquettes | 4,0 Hz / 0,85 | presque sans rebond |
| `cam` caméra | 0,9 Hz / 1,0 | critique, jamais de rebond |

Les révélations se font **par masque** (le texte monte depuis sa ligne de base), jamais par fondu. Les coupes sont accompagnées d'une micro-secousse amortie de 6 à 9 px.

## Transitions

Chaque transition est motivée par le motif du cercle ou par le rythme :
plongée dans le point (P1→P2) · coupe sèche sur le temps (P2→P3, P4→P5, P6→P7) · volet papier (P3→P4) · coupes au temps (rafale) · **iris circulaire** depuis l'horloge (P5→P6).

## Rythme

120 BPM. Chaque plan commence sur un temps fort, et un évènement visuel tombe au minimum toutes les 2 s (voir `docs/shotlist.md`). Le grain de film (7 %, `overlay`) est déterministe et change à chaque image.
