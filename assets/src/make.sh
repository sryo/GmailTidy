#!/bin/sh
# Rebuilds the README GIFs and the social preview. Needs python3 with playwright (chromium) and ffmpeg.
set -e
cd "$(dirname "$0")"
gif() {
  python3 render.py frames "$1.html" ".frames/$1" 800 500 15
  ffmpeg -v error -y -framerate 15 -i ".frames/$1/f_%04d.png" \
    -vf "scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
    -loop 0 "../$2.gif"
}
gif scene1 hot-meh-ping
gif scene2 burndown
python3 render.py still social.html ../social-preview.png 1280 640 1
rm -rf .frames
