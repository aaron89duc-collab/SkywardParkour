#!/bin/sh
# Map 006 prefabs from the artist's raw exports in "E:\game\Parkout\Asset map 6" (copied to devtools/out/raw6real and
# renamed named_<id>.glb), the 14 PNGs renamed into devtools/out/png6 and packed into the scenery atlas.
#   meshy_0d22cea8 hanging_log · meshy_12430cad spore_flower · meshy_18224512 tree_trunk · meshy_2079f80e vine_climb
#   meshy_3aab16c8 shelf_fungus · meshy_3c607f43 glow_mushrooms · meshy_45a026a3 mushroom_tower · meshy_465943a0 glow_cave
#   meshy_56b28d11 root_arch_gate · meshy_660b85e4 root_bridge · meshy_82992462 tree_trunk_hollow
#   meshy_82ae798c giant_leaf (modelled standing up: laid flat, rotate x -90) · meshy_8c62e840 branch_platform
#   meshy_ac6927ae mushroom_tilted · meshy_b80a6a5c crown_platform · meshy_c7081ff4 mushroom_bounce
#   meshy_e28ca5b1 forest_island · meshy_f1f36e4d mushroom_power
#   PNGs: "ChatGPT Image ... -1..4" = spore_glow, falling_leaf, butterfly, dandelion_seeds
set -e
R=devtools/out/raw6real; O=packs/map006/assets/map006; mkdir -p $O
m() { node devtools/pipeline/prefab.mjs "$R/named_$1.glb" $O $1 1024 $2 | grep -E "size|cut|lod1" | head -2; }
m forest_island 12000
m root_arch_gate 8000
m tree_trunk 4000
m tree_trunk_hollow 8000
m branch_platform 6000
m shelf_fungus 4000
m mushroom_bounce 4000
m mushroom_tilted 4000
m mushroom_power 4000
m mushroom_tower 8000
m glow_mushrooms 3000
node devtools/pipeline/rotate.mjs $R/meshy_82ae798c-4ea1-5413-b4ec-848d1841f8bf.glb $R/named_giant_leaf.glb x -90
m giant_leaf 3000
# the three moving leaves are the same leaf recoloured: yellow-green = springy, orange = folds, mint = sways in the wind
SHIFT=1 node devtools/pipeline/recolor.mjs $O/giant_leaf.glb $O/leaf_spring.glb -25 1.15 0.9
SHIFT=1 node devtools/pipeline/recolor.mjs $O/giant_leaf.glb $O/leaf_fold.glb -80 1.15 1.1
SHIFT=1 node devtools/pipeline/recolor.mjs $O/giant_leaf.glb $O/leaf_sway.glb 60 1.2 0.65
m hanging_log 4000
m vine_climb 1000
m root_bridge 8000
m spore_flower 4000
m glow_cave 10000
m crown_platform 12000
node devtools/build-atlas006.mjs devtools/out/png6
