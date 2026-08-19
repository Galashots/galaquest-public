import * as THREE from '../../vendor/three.module.min.js';
import { CHARACTER } from './layers.js';

export function createRimLight() {
  const light = new THREE.DirectionalLight(0x8fd7ff, 1.5);
  light.name = 'character-rim-light';
  light.position.set(-3, 4, -4);
  light.layers.set(CHARACTER);
  light.target.name = 'character-rim-target';
  light.target.layers.set(CHARACTER);

  return {
    light,
    target: light.target,
    update(targetPosition) {
      light.target.position.set(targetPosition.x, targetPosition.y + 0.8, targetPosition.z);
    },
  };
}
