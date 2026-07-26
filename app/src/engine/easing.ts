export type Easing = (t: number) => number

export const linear: Easing = (t) => t
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}
export const easeOutElastic: Easing = (t) => {
  const c4 = (2 * Math.PI) / 3
  if (t === 0 || t === 1) return t
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
export const easeOutBounce: Easing = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
/** hard on/off at the halfway point — for typewriter-style instant character reveal */
export const step: Easing = (t) => (t < 0.5 ? 0 : 1)
