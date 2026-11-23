#!/bin/sh
# Map 004 prefabs from the artist's raw exports in "E:\game\Parkout\Asset map 4" (copied to devtools/out/raw4real,
# renamed named_<id>.glb; the chocolate river was modelled standing up and is laid flat first by rotate.mjs).
# Walkable props keep a dense collision mesh (simplifying it opens holes in flat tops).
set -e
R=devtools/out/raw4real; O=packs/map004/assets/map004; mkdir -p $O
m() { node devtools/pipeline/prefab.mjs "$R/named_$1.glb" $O $1 1024 $2 | grep -E "size|cut|lod1" | head -2; }
# the raspberries on the cookie's corners would be 1.7 m stepping stones next to every zone start: cut them off
CUT="0.88,1.45,0.7,1.1,0.88,1.45;-1.45,-0.88,0.7,1.1,0.88,1.45;0.88,1.45,0.7,1.1,-1.45,-0.88;-1.45,-0.88,0.7,1.1,-1.45,-0.88" m cookie_floor_tile 12000
m donut_platform 12000
m cupcake_small 10000
m cupcake_tower 10000
m wafer_bridge 8000
m chocolate_bar 10000
m lollipop_platform 8000
m lollipop_arm 6000
m carousel_base 12000
m candy_cane_bar 4000
m macaron_platform 10000
m jelly_block 6000
m gummy_platform 10000
m candy_mushroom 8000
m chocolate_slope 10000
m chocolate_river_segment 10000
m cotton_candy_cloud 8000
m gumball 2000
m castle_wall 12000
m castle_tower_corner 10000
m castle_main_tower 16000
m rainbow_gate 6000
m candy_cannon 4000
m candy_plate 6000
# extras the artist added for the hidden routes and the scenery
m gingerbread_house 12000
m choco_waterfall_wall 10000
m gumdrop_bush 8000
