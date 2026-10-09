#!/usr/bin/env bash
# Planche contact : une vignette toutes les 0,5 s, horodatée.
set -euo pipefail
in=${1:-out/final.mp4}; out=${2:-out/contact.png}
ffmpeg -hide_banner -loglevel error -y -i "$in" -vf "fps=2,scale=270:480:flags=lanczos,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,tile=9x5:padding=6:color=0x111111" -frames:v 1 "$out"
echo "planche → $out"
