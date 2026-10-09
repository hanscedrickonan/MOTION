# Randonnée du Cercle — vidéo promo

Vidéo de motion design de 22,5 s (9:16, 1080×1920, 60 fps) pour la randonnée du club **Le Cercle**.

> **Dimanche 08 novembre · départ 08h00 · Parc national du Banco, Abidjan**
> 7 km · 5 000 FCFA · inscriptions WhatsApp **+225 07 08 21 42 54**
> *Entre dans le cercle.*

## Livrables

| Fichier | Description |
|---|---|
| `out/final.mp4` | Master H.264 + AAC, 1080×1920, 60 fps, CRF 17 (Reels, TikTok) |
| `out/final_whatsapp.mp4` | Même vidéo allégée (~5 Mo), pour le partage et les statuts WhatsApp |
| `out/poster.png` | Image de couverture : la signature finale avec toutes les infos |
| `out/contact.png` | Planche contact, une image toutes les 0,5 s |
| `out/styleframes.png` | Images de style validées avant le rendu |
| `out/demos/catalogue.mp4` | Catalogue des 7 transitions et 8 animations proposées (`src/demos.html`) |
| `out/soundtrack.wav` | Bande-son originale seule |

## Structure

```
refs/logo.jpg            logo source
docs/shotlist.md         storyboard plan par plan
docs/style_guide.md      grammaire visuelle (palette, typo, ressorts, transitions)
src/index.html           page de rendu (prévisualisation avec curseur)
src/main.js              moteur : window.seek(t) dessine l'instant t sur un canvas
src/demos.js             catalogue d'effets (même moteur, page src/demos.html)
src/timeline.json        plans + repères sonores, partagés par l'image et le son
assets/fonts/            Anton, Archivo Narrow (OFL)
assets/logo/             logo découpé en calques alpha (anneau / point / texte)
tools/split_logo.py      découpe du logo
tools/soundtrack.py      synthèse de la bande-son (numpy)
tools/render.mjs         rendu image par image Playwright/Chromium → FFmpeg
tools/contact.sh         planche contact
```

## Principes du moteur

- **Déterministe** : chaque image est une fonction pure de `t`. Il n'y a ni timer, ni `requestAnimationFrame`, ni `Math.random()` (un PRNG à graine est utilisé pour les courbes de niveau, le grain et le code-barres), ni transition CSS.
- **Ressorts analytiques** (`spring(t, f, z)`), avec 5 intensités : typo, mots, cartes, UI, caméra.
- **Son synchronisé** : `timeline.json` contient les repères des effets sonores, sur la même grille de 120 BPM que les coupes.

## Refaire le rendu

Prérequis : Node 18+, Python 3 avec numpy, FFmpeg, Chromium pour Playwright.

```bash
npm install                      # playwright (ou NODE_PATH vers une installation existante)
npm run build                    # bande-son → vidéo → planche contact
node tools/render.mjs stills out/stills 1.0 11.5 19.5   # images fixes
```

Prévisualisation interactive : servez la racine du dépôt (`npx serve .`), ouvrez `src/index.html` et utilisez le curseur.

## Modifier les infos

Les textes se trouvent dans `src/main.js` (une fonction par plan : `scenes.hook`, `km`, `map`, `burst`, `date`, `ticket`, `cta`). Les durées des plans et les repères sonores sont dans `src/timeline.json`. Après une modification, relancez `npm run build`.

## Boucle de qualité (résumé)

| Passe | 3 problèmes majeurs | Corrections |
|---|---|---|
| 1 | Boucle de la carte sur « PARC NATIONAL DU » ; temps morts (date ≈ 2 s, 7 KM, fin de carte, ticket) ; petits textes ≤ 34 px | Carte recadrée ; ensō orange autour du « 08 », onde à la fermeture de la boucle, tampon sur le ticket, « DE FORÊT PRIMAIRE » en vertical sur le temps fort ; textes ≥ 38 px, infos du CTA sur 2 lignes |
| 2 | Ouverture de la carte vide (4,0 s) ; ticket vide à l'entrée (13,0 s) ; ensō de la date trop serré | « BANCO » dès la coupe ; contenu du ticket avancé ; ensō élargi et aplati |
| 3 | Silence 16,6 → 18 s (groove calculé par mesure) ; chute du point sans son ; vérification des transitions | Groove calculé par temps, montée avant la chute ; transitions vérifiées image par image |

## Effets retenus (v2)

| Moment | Effet |
|---|---|
| 7 KM → carte | T3 traversée de canopée (feuilles tropicales devant la caméra) |
| Carte | A1 empreintes de pas le long de la boucle |
| Carte → rafale | T4 plongée dans le « O » de BANCO |
| Rafale | A3 « MARCHE. » sautille · A4 « RESPIRE. » respire · A8 randonneurs sous « ENSEMBLE. » |
| Rafale → date | T2 coup de pinceau orange |
| Date → discussion | A6 nouveau plan « Je m'inscris ! » (13,0 → 15,5 s) |
| Ticket → signature | T1 le tampon devient l'ensō du logo |

Les animations sont activées par `FX` en tête de `src/main.js`. Les transitions sont dans `TRANSITIONS`, juste avant `seek()`.

Passe 4 (intégration) : pinceau qui inclinait la date, lettres de « MARCHE. » qui se chevauchaient, bulles trop petites, marcheurs collés au texte, tampon décalé de 80 px au raccord. Tout est corrigé.

## Crédits

Polices Anton et Archivo Narrow : SIL Open Font License. Musique et effets sonores : synthèse originale (`tools/soundtrack.py`), libres de droits.
