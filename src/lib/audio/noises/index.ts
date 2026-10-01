import type { NoiseColor, NoiseLayer } from '@/db/types'
import type { Graph } from '../graph'
import type { Rng } from '../noise'
import { buildBirds } from './birds'
import { buildCafe } from './cafe'
import { buildCampfire } from './campfire'
import { buildCreek } from './creek'
import { buildNoise } from './noise'
import { buildRain } from './rain'
import { buildStorm } from './storm'
import { buildWaves } from './waves'
import { buildWind } from './wind'

export type LayerBuilder = (ctx: AudioContext, rng: Rng, opts: { color: NoiseColor }) => Graph

export const NOISE_BUILDERS: Record<NoiseLayer, LayerBuilder> = {
  rain: buildRain,
  storm: buildStorm,
  wind: buildWind,
  campfire: buildCampfire,
  cafe: buildCafe,
  waves: buildWaves,
  birds: buildBirds,
  creek: buildCreek,
  noise: buildNoise,
}
