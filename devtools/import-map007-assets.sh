#!/bin/sh
# Map 007 prefabs from the artist's raw exports in "E:\game\Parkout\Asset map 7" (copied to devtools/out/raw7real),
# the 9 PNGs renamed into devtools/out/png7 and packed into the scenery atlas; soft blocks are generated.
#   meshy_14cc7f2f play_deck · meshy_2011eec3 swing_seat · meshy_2a88c37c ball_pit · meshy_30637a95 rope_bridge
#   meshy_40deb27e straight_slide · meshy_43d8ad63 playground_island · meshy_43ee3b5b rope_ladder
#   meshy_7efb9b33 curved_slide · meshy_836d196c seesaw_large · meshy_ba3cab42 tube_tunnel · meshy_c3eadb9e climbing_net
#   meshy_cbfb7413 tower_roof · meshy_d791440a swing_frame · meshy_e4e71e8d roundabout · meshy_e76f3747 play_stairs
#   meshy_f40f954c rainbow_gate · meshy_fcb654c7 spiral_slide · meshy_0837378e soft_block (blue; other colours by hue)
#   PNGs "ChatGPT Image ... -1..9" = playground_city_far, slide_island_far, swing_island_far, ball_castle_far,
#   rainbow_cloud_far, balloon_cluster_far, playground_tower_far, cloud_white, cloud_pastel
set -e
R=devtools/out/raw7real; O=packs/map007/assets/map007; mkdir -p $O
n() { cp "$R/$1"*.glb "$R/named_$2.glb"; }
n meshy_14cc7f2f play_deck; n meshy_2011eec3 swing_seat; n meshy_2a88c37c ball_pit; n meshy_30637a95 rope_bridge
n meshy_40deb27e straight_slide; n meshy_43d8ad63 playground_island; n meshy_43ee3b5b rope_ladder
n meshy_7efb9b33 curved_slide; n meshy_836d196c seesaw_large; n meshy_ba3cab42 tube_tunnel; n meshy_c3eadb9e climbing_net
n meshy_cbfb7413 tower_roof; n meshy_d791440a swing_frame; n meshy_e4e71e8d roundabout; n meshy_e76f3747 play_stairs
n meshy_f40f954c rainbow_gate; n meshy_fcb654c7 spiral_slide
# soft blocks: the artist's blue foam block (meshy_0837378e), four more colours by repainting its texture
n meshy_0837378e soft_block_blue
for c in "red #f2484d" "yellow #ffc51f" "green #4cc764" "purple #a46ef0"; do set -- $c; node devtools/pipeline/recolor-tex.mjs $R/named_soft_block_blue.glb $R/named_soft_block_$1.glb "$2"; done
m() { node devtools/pipeline/prefab.mjs "$R/named_$1.glb" $O $1 1024 $2 | grep -E "size|cut|lod1" | head -2; }
m playground_island 12000
m rainbow_gate 6000
m play_deck 6000
CUT="-0.21,0.21,0.66,1.01,-0.5,-0.37" m play_stairs 4000  # the back rail of the top landing cut away (it opens onto a deck)
m tower_roof 3000
m swing_frame 3000
m swing_seat 2000
CUT="-0.27,0.27,0.745,1.01,-0.86,-0.74" m straight_slide 4000  # the back rail of the top opens onto a deck
CUT="0.55,1.0,0.69,1.01,-0.30,0.26" m curved_slide 4000  # the platform's end rail opens onto a deck
m spiral_slide 6000
m seesaw_large 3000
m rope_ladder 1500
m climbing_net 2000
m rope_bridge 3000
m ball_pit 6000
m tube_tunnel 6000
m roundabout 4000
for c in red blue yellow green purple; do node devtools/pipeline/prefab.mjs "$R/named_soft_block_$c.glb" $O soft_block_$c 512 600 | grep -E "size" | head -1; done
node devtools/build-atlas007.mjs devtools/out/png7
