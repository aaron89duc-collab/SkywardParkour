#!/bin/sh
# Rebuild every Map 003 prefab from the raw exports in "E:\game\Parkout\Asset map 3" (copied to devtools/out/raw3).
# Walkable props keep their full collision mesh (simplifying it opened holes in flat tops).
set -e
R=devtools/out/raw3; O=packs/map003/assets/map003; mkdir -p $O
m() { node devtools/pipeline/prefab.mjs "$R/meshy_$1.glb" $O $2 1024 $3 | grep -E "size|cut|lod1"; }
m 0a5f312e-c76e-5882-9833-8d68147ee676 cargo_pallet_stand 12000
m 0a829895-ceae-5c0a-a58f-dd77768db383 tower_crane 1800
m 398e45d0-d78f-500f-8687-21454ccb3e70 banner_crane_arm 800
m 78187805-53f7-5e50-9379-9a84dbb136bd suspended_platform 12000
m 830a4511-7d3f-5f2a-b7c8-e6cbe489795c steel_catwalk 12000
m 989529d3-6a9c-5aa8-a85e-4a09a48a6a75 balance_beam 8000
m 9ff76d20-c52a-53c8-82ca-07e53de348fa steel_crate 10000
# the gantry arm a swinging container hangs from (its own container and hook cut away)
CUT="-0.3,0.3,-1,0.785,-1,1;-0.52,0.52,-1,0.5,-1,1" m 8300b06a-4ff5-5155-afa7-d8abceef7bf6 gantry_arm 1500
# second batch (assets requested for Map 003)
m aad2682e-999f-5274-882f-789193bbb6af steel_ibeam 4000            # long I-beam (balance beams, walkways)
m c8da03d7-a2f4-50ca-8839-12f91736d09d hanging_container 3000      # container on slings + hook (swing)
m fac8754d-8858-5081-a3a0-222611e6e7b7 crane_jib 6000              # slewing jib (rotor)
m 4db488fe-f80b-5c11-b7a7-83ca2633dfb7 slewing_crane 4000          # whole slewing crane (landmark, walkable jib)
# lift tower = static frame + moving car; rail trolley = moving car (the rail itself is kit, any length)
KEEP="-0.215,0.175,0.34,0.62,0.0,0.3" m 59939494-e02a-5c5d-81cb-da2d8f04b4a5 lift_car 3000
CUT="-0.215,0.175,0.34,0.62,0.0,0.3" m 59939494-e02a-5c5d-81cb-da2d8f04b4a5 lift_frame 6000
CUT="-2,-0.6,0.45,2,-1,1;0.6,2,0.45,2,-1,1" m 6681f3f8-3fcb-510d-ac1d-654d0dad5c0b trolley_car 3000
# multi-part exports: every material baked into vertex colour, one mesh
node devtools/pipeline/prefab-vc.mjs "$R/model-rough.glb" $O shipping_container 3000 600 | grep -E "size|wrote"
node devtools/pipeline/prefab-vc.mjs "$R/sci-fi-pad-rough.glb" $O bounce_pad 9000 600 | grep -E "size|wrote"
node devtools/pipeline/prefab-vc.mjs "$R/model-rough (1).glb" $O container_tower_a 24000 2000 | grep -E "size|wrote"
ERR=0.06 node devtools/pipeline/prefab-vc.mjs "$R/model-rough (2).glb" $O container_tower_b 30000 2400 | grep -E "size|wrote"
# colour variants of the container (the blue body gets another hue)
node devtools/pipeline/recolor.mjs $O/shipping_container.glb $O/container_red.glb 2 1.15 1.0
node devtools/pipeline/recolor.mjs $O/shipping_container.glb $O/container_yellow.glb 42 1.6 0.95
node devtools/pipeline/recolor.mjs $O/shipping_container.glb $O/container_green.glb 128 1.05 0.9
