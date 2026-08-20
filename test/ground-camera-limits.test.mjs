import test from 'node:test';
import assert from 'node:assert/strict';

// Regression seam for the horizon fix in PR #12. A skirt that only clears the fog at the default
// follow-camera settings is not enough: zoom and pitch are player verbs. This uses the real camera
// limits, the real ground/skirt mesh, and the real fog plane so none of those values are restated.
test('distance skirt stays beyond the fog at the camera limits from every walkable edge', async () => {
  const THREE = await import('../public/vendor/three.module.min.js');
  const { createGround, WALKABLE_BOUNDS } = await import('../public/src/world/ground.js');
  const { createFollowCamera, MAX_PITCH, MIN_DISTANCE } = await import('../public/src/camera/follow.js');
  const { FOG_FAR } = await import('../public/src/render/sky.js');

  const world = createGround();
  let skirt = null;
  world.traverse((object) => {
    if (object.isMesh && object.name === 'ground-skirt') skirt = object;
  });
  assert.ok(skirt, 'ground-skirt mesh is missing');

  const half = skirt.geometry.parameters.width / 2;
  const { x: cx, z: cz } = skirt.position;
  const camera = new THREE.PerspectiveCamera(42, 768 / 1024, 0.1, 1000);
  const follow = createFollowCamera(camera, { distance: MIN_DISTANCE, pitch: MAX_PITCH });

  const edges = [
    ['north', 0, WALKABLE_BOUNDS.maxZ, 0, cx, cz + half],
    ['south', Math.PI, WALKABLE_BOUNDS.minZ, 0, cx, cz - half],
    ['east', Math.PI / 2, 0, WALKABLE_BOUNDS.maxX, cx + half, cz],
    ['west', -Math.PI / 2, 0, WALKABLE_BOUNDS.minX, cx - half, cz],
  ];

  for (const [name, heading, heroZ, heroX, edgeX, edgeZ] of edges) {
    follow.setHeading(heading);
    follow.update(new THREE.Vector3(heroX, 0, heroZ));
    camera.updateMatrixWorld(true);
    const depth = -new THREE.Vector3(edgeX, skirt.position.y, edgeZ)
      .applyMatrix4(camera.matrixWorldInverse).z;
    assert.ok(depth >= FOG_FAR,
      `at minimum zoom / maximum pitch on the ${name} clamp, the skirt edge is only `
      + `${depth.toFixed(2)} m deep against FOG_FAR ${FOG_FAR}`);
  }
});
