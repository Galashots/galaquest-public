// Screen input -> world direction, for a follow camera at `heading`.
//
// The camera sits at target - (sin h, 0, cos h) * distance and looks back at the target, so its
// forward is (sin h, cos h). Its RIGHT is not (cos h, -sin h): three.js builds the camera basis as
// x = up x z with z = normalize(eye - target), which puts screen-right at (-cos h, sin h). The first
// version of this file used the positive form, and the strafe axis came out exactly inverted --
// dot(cameraRight, screenRight) = -1 at every heading. camera-input.test.mjs now asserts against a
// real THREE.PerspectiveCamera rather than restating the formula, which is what let it through.
export function screenToWorld(screen, heading) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    x: -screen.x * cos + screen.y * sin,
    z: screen.x * sin + screen.y * cos,
  };
}

// The same rotation, the other way round: a world offset -> where it sits relative to the camera,
// with +y FORWARD (away from the camera) and +x to the camera's right. Used by the minimap, which
// has to place a world point on a hero-centred, camera-up dial.
//
// It delegates to screenToWorld rather than restating the matrix, and that is exact rather than a
// convenient approximation: the transform is its own inverse. Writing it as
//
//     M = [ -cos  sin ]      screenToWorld(s) = M s
//         [  sin  cos ]
//
// then M M = [ cos^2 + sin^2, -cos sin + sin cos ; sin(-cos) + cos sin, sin^2 + cos^2 ] = I.
//
// So there is one trig definition in this file and no second copy to drift from it (GQ-007), and
// the round trip is pinned by a test rather than by this comment. The separate name exists because
// calling something `screenToWorld` to go the other way reads as a bug at every call site.
export function worldToScreen(world, heading) {
  const screen = screenToWorld({ x: world.x, y: world.z }, heading);
  return { x: screen.x, y: screen.z };
}

// Unit-or-zero world direction for a stick input. Normalising here is the whole point: `screen`
// carries the stick's deflection magnitude and groundSpeedForInput() has already priced that
// magnitude in, so a direction that kept its length would multiply it twice. The first wiring
// integrated screenToWorld(screen) * groundSpeed directly and the measured walk speed came out at
// magnitude^2 * speed -- 0.72 m/s while the status line claimed 1.00.
//
// This is also exactly what goes on the wire, so the server is told the same direction the hero is
// walking, and the protocol's unit-or-zero rule is satisfied by construction rather than by luck.
export function worldDirectionForInput(screen, heading) {
  const magnitude = Math.hypot(screen.x, screen.y);
  if (magnitude === 0) return { x: 0, z: 0 };
  const direction = screenToWorld(screen, heading);
  return { x: direction.x / magnitude, z: direction.z / magnitude };
}

// Composed from the direction above rather than repeating the normalisation, so there is one
// definition of "which way is the stick pointing in the world".
export function worldVelocityForInput(screen, heading, groundSpeed) {
  if (groundSpeed === 0) return { x: 0, z: 0 };
  const direction = worldDirectionForInput(screen, heading);
  return { x: direction.x * groundSpeed, z: direction.z * groundSpeed };
}
