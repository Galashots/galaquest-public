import { normalizeHiddenRegions } from '../character/anatomyOcclusion.js';

/**
 * Owner-locked headgear manufacturing frames.
 *
 * These are NOT claims that every helmet has the same interior geometry. They are stable starting
 * frames distilled from accepted GalaQuest gear so a generated candidate does not begin from a fresh
 * bounding-box guess every time. The Dawnwarden frame is the first one: it captures the approved
 * Head-local seat, orientation, visible size and semantic body coverage of the accepted open-face
 * helmet. New open-face headgear can begin here, then be fine-fitted and independently approved.
 */
export const OPEN_FACE_HELMET_PROFILE_V1 = Object.freeze({
  id: 'headgear-open-face-v1',
  referenceAssetId: 'helmet_dawnwarden_v1',
  referenceAssetUrl: 'assets/gear/candidates/dawnwarden-helmet-v1.glb',
  referenceSourceSha: '687f903f33def5dddc7662e9093de4d80f55fc12',
  boneName: 'Head',
  targetWorldLongest: 0.38,
  anchorLocalPosition: Object.freeze([
    -0.12855126128084882,
    13.826713406476742,
    -4.365260824014637,
  ]),
  anchorLocalQuaternion: Object.freeze([
    -0.15227835255560962,
    -0.0053021111882924805,
    0.005302196102046388,
    0.9883092014676261,
  ]),
  hideAnatomy: Object.freeze(normalizeHiddenRegions(['hair', 'ears'])),
  note: 'Owner-locked Dawnwarden open-face helmet frame. Use as a starting seat/clearance reference, never as automatic approval for a different mesh.',
});

export const GEAR_FIT_PROFILES = Object.freeze([
  OPEN_FACE_HELMET_PROFILE_V1,
]);

const BY_ID = new Map(GEAR_FIT_PROFILES.map((profile) => [profile.id, profile]));

export function gearFitProfile(id) {
  return BY_ID.get(id) ?? null;
}
