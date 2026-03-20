/*
  util.js

  Miscellaneous helper functions used throughout the project.  Use
  these small utilities instead of sprinkling magic numbers and
  repeated logic in the main game code.  Feel free to extend
  this module with your own helpers.
*/

export function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}