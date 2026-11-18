export interface Vec3JSON { x: number; y: number; z: number }

export type PlatformPalette = 'coral' | 'sun' | 'mint' | 'sky' | 'violet' | 'stone';

export interface PlatformDefinition {
  id: string;
  x: number;
  z: number;
  topY: number;
  width: number;
  depth: number;
  thickness: number;
  color: PlatformPalette;
  marker: boolean;
}

export interface MapDefinition {
  id: string;
  title: string;
  version: number;
  spawn: Vec3JSON;
  platforms: PlatformDefinition[];
  recoveryDecks: PlatformDefinition[];
  finish: Vec3JSON;
  theme?: { sky: string; fog: string };
}

export interface MapManifest {
  version: number;
  maps: Array<{ id: string; src: string; offset: Vec3JSON }>;
}
