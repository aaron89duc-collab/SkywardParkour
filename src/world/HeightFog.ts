import * as THREE from 'three';

/**
 * Aerial perspective for a vertical game: on top of the normal distance fog, everything far *below* the camera
 * fades into a pale blue haze. Looking down from a rooftop the street becomes softer and bluer the higher you are,
 * which reads as real depth. Patched into three's fog chunks once, before any material compiles, so every lit
 * material and the custom cloud shaders get it.
 */
export const HEIGHT_HAZE = {
  start: 12, // metres below the camera where haze begins
  full: 260, // metres below the camera at full haze
  max: 0.62, // strongest blend toward the haze colour
};

let installed = false;
export function installHeightFog() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogDY;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// world-space height of this vertex relative to the camera (view rotation transposed, no inverse needed)
	vFogDY = dot( viewMatrix[1].xyz, mvPosition.xyz );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogDY;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float hz = smoothstep( ${HEIGHT_HAZE.start.toFixed(1)}, ${HEIGHT_HAZE.full.toFixed(1)}, - vFogDY ) * ${HEIGHT_HAZE.max.toFixed(2)} * smoothstep( 4.0, 30.0, vFogDepth );
	vec3 hazeCol = mix( fogColor, vec3( 0.72, 0.84, 0.98 ), 0.55 );
	vec3 fc = mix( fogColor, hazeCol, step( fogFactor, hz ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fc, max( fogFactor, hz ) );
#endif`;
}
