#!/bin/sh
# Map 005 prefabs from the artist's raw exports in "E:\game\Parkout\Asset map 5" (copied to devtools/out/raw5real and
# renamed named_<id>.glb), the 15 PNGs renamed into devtools/out/png5 and packed into the scenery atlas.
#   meshy_85db7e6b abc_block · meshy_05f83dff arch_bridge · meshy_600ce87c jack_box · meshy_e2b4e873 playmat_island
#   meshy_2ee18bf0 race_car · meshy_9e34a30c race_track · meshy_50cb271e rail_track · meshy_a5483c59 robot_arm
#   meshy_bf0ece98 robot_body · meshy_7b1667a5 rocking_horse · meshy_053cc0da seesaw · meshy_a0f368a5 spinning_top
#   meshy_066442f8 teddy_bear · meshy_3bcdeb14 toy_brick · meshy_35fbf23f toy_drum · meshy_3ba863a5 toy_house
#   meshy_ee416049 toy_train
set -e
R=devtools/out/raw5real; O=packs/map005/assets/map005; mkdir -p $O
m() { node devtools/pipeline/prefab.mjs "$R/named_$1.glb" $O $1 1024 $2 | grep -E "size|cut|lod1" | head -2; }
m toy_brick 2000
m abc_block 2000
# the arch's end posts would block the walkway: cut them off
CUT="-1.2,-0.84,0.645,1.1,-0.16,0.16;0.84,1.2,0.645,1.1,-0.16,0.16" m arch_bridge 8000
m playmat_island 12000
m toy_house 6000
m rail_track 4120
m race_track 4000
m teddy_bear 8000
m robot_body 8000
m robot_arm 2000
m toy_train 3000
m race_car 3000
m seesaw 3000
m rocking_horse 8000
m jack_box 6000
m toy_drum 3000
m spinning_top 4000
# bricks and blocks collide as clean boxes (no stud seams)
node devtools/pipeline/boxcol.mjs $O/toy_brick.col.bin -1.435 1.435 0 1 -0.768 0.768
node devtools/pipeline/boxcol.mjs $O/abc_block.col.bin -0.497 0.497 0 1 -0.494 0.494
# scenery atlas from the PNGs
node devtools/build-atlas005.mjs devtools/out/png5
