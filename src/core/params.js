// Parameter specification: exactly 21 user-adjustable parameters.
// key  -> uniform mapping is explicit (`uniform` field).

export const PARAM_GROUPS = [
  { id: 'disk', label: 'Accretion Disk' },
  { id: 'phys', label: 'Relativistic Effects' },
  { id: 'bg', label: 'Deep-Space Background' },
  { id: 'post', label: 'Post-Processing' },
];

export const PARAMS = [
  // ---- accretion disk (11) ----
  { key: 'disk.rIn',     group: 'disk', label: 'Inner radius',       uniform: 'uDiskRIn',       min: 1.5, max: 6.0,  step: 0.05,  def: 3.0,  fmt: v => v.toFixed(2) + ' rs' },
  { key: 'disk.rOut',    group: 'disk', label: 'Outer radius',       uniform: 'uDiskROut',      min: 5.0, max: 30.0, step: 0.5,   def: 12.0, fmt: v => v.toFixed(1) + ' rs' },
  { key: 'disk.h0',      group: 'disk', label: 'Scale height',       uniform: 'uDiskH0',        min: 0.04, max: 0.9, step: 0.01,  def: 0.22, fmt: v => v.toFixed(2) + ' rs' },
  { key: 'disk.flare',   group: 'disk', label: 'Height flare',       uniform: 'uDiskFlare',     min: 0.0, max: 1.5, step: 0.01,  def: 0.55, fmt: v => v.toFixed(2) },
  { key: 'disk.opacity', group: 'disk', label: 'Optical depth',      uniform: 'uDiskOpacity',   min: 0.5, max: 30.0, step: 0.1,   def: 4.0,  fmt: v => v.toFixed(1) },
  { key: 'disk.temp',    group: 'disk', label: 'Inner temperature',  uniform: 'uDiskTemp',      min: 0.8, max: 6.0,  step: 0.05,  def: 3.0,  fmt: v => (v * 1e4).toFixed(0) + ' K', toUniform: v => v * 1e4 },
  { key: 'disk.emis',    group: 'disk', label: 'Radial emission',    uniform: 'uDiskEmis',      min: 0.5, max: 4.0,  step: 0.05,  def: 2.0,  fmt: v => 'r^-' + v.toFixed(2) },
  { key: 'disk.turb',    group: 'disk', label: 'Turbulence',         uniform: 'uDiskTurb',      min: 0.0, max: 2.0,  step: 0.05,  def: 0.9,  fmt: v => v.toFixed(2) },
  { key: 'disk.turbSpd', group: 'disk', label: 'Turbulence speed',   uniform: 'uDiskTurbSpd',   min: 0.0, max: 3.0,  step: 0.05,  def: 0.8,  fmt: v => v.toFixed(2) + 'x' },
  { key: 'disk.swirl',   group: 'disk', label: 'Swirl advection',    uniform: 'uDiskSwirl',     min: 0.0, max: 3.0,  step: 0.05,  def: 0.9,  fmt: v => v.toFixed(2) + 'x' },
  { key: 'disk.precess', group: 'disk', label: 'Pattern precession', uniform: 'uDiskPrecess',   min: 0.0, max: 0.6,  step: 0.01,  def: 0.06, fmt: v => v.toFixed(2) + ' rad/s' },
  // ---- relativistic (2) ----
  { key: 'phys.doppler', group: 'phys', label: 'Doppler beaming',    uniform: 'uDoppler',       min: 0.0, max: 1.5,  step: 0.05,  def: 1.0,  fmt: v => v.toFixed(2) },
  { key: 'phys.redshift',group: 'phys', label: 'Grav. redshift',     uniform: 'uRedshift',      min: 0.0, max: 1.0,  step: 0.05,  def: 1.0,  fmt: v => v.toFixed(2) },
  // ---- background (3) ----
  { key: 'bg.stars',     group: 'bg', label: 'Starfield',            uniform: 'uStars',         min: 0.0, max: 2.5,  step: 0.05,  def: 1.0,  fmt: v => v.toFixed(2) },
  { key: 'bg.galaxy',    group: 'bg', label: 'Galaxy band',          uniform: 'uGalaxy',        min: 0.0, max: 2.5,  step: 0.05,  def: 0.9,  fmt: v => v.toFixed(2) },
  { key: 'bg.dust',      group: 'bg', label: 'Dust lanes',           uniform: 'uDust',          min: 0.0, max: 1.5,  step: 0.05,  def: 0.7,  fmt: v => v.toFixed(2) },
  // ---- post (5) ----
  { key: 'post.bloom',    group: 'post', label: 'Bloom strength',     uniform: 'uBloomStr',      min: 0.0, max: 3.0,  step: 0.05,  def: 1.25, fmt: v => v.toFixed(2) },
  { key: 'post.bloomThresh', group: 'post', label: 'Bloom threshold', uniform: 'uThresh',       min: 0.2, max: 3.0,  step: 0.05,  def: 1.1,  fmt: v => v.toFixed(2) },
  { key: 'post.vignette', group: 'post', label: 'Vignette',           uniform: 'uVignette',      min: 0.0, max: 1.0,  step: 0.01,  def: 0.38, fmt: v => v.toFixed(2) },
  { key: 'post.grain',    group: 'post', label: 'Film grain',         uniform: 'uGrain',         min: 0.0, max: 0.5,  step: 0.01,  def: 0.12, fmt: v => v.toFixed(2) },
  { key: 'post.exposure', group: 'post', label: 'Exposure',           uniform: 'uExposure',      min: 0.3, max: 3.0,  step: 0.05,  def: 1.15, fmt: v => v.toFixed(2) + 'x' },
];

export const PARAM_MAP = Object.fromEntries(PARAMS.map(p => [p.key, p]));

export function defaultParams() {
  const o = {};
  for (const p of PARAMS) o[p.key] = p.def;
  return o;
}

export function paramCount() {
  return PARAMS.length; // 21
}
