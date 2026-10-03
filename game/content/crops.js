// Crops. `freeSeed`: the seed sack never runs out of it. `starSeed`: the special seed
// (limited; the first tray holds one). `element` tints the egg when first harvested.
export const CROPS = [
  { id: 'carrot', name: 'Carrot', growSeconds: 20, yield: 3, rarity: 'common', sellPrice: 2, color: '#f28c28', element: null, distinctive: false, freeSeed: true },
  { id: 'wheat', name: 'Wheat', growSeconds: 10, yield: 1, rarity: 'common', sellPrice: 1, color: '#f5d061', element: null, distinctive: false },
  { id: 'pumpkin', name: 'Pumpkin', growSeconds: 14, yield: 1, rarity: 'common', sellPrice: 3, color: '#ff8c00', element: null, distinctive: false },
  { id: 'sunberry', name: 'Sunberry', growSeconds: 40, yield: 2, rarity: 'special', sellPrice: 5, color: '#ff5722', element: 'sun', distinctive: true, starSeed: true },
  { id: 'dewmelon', name: 'Dewmelon', growSeconds: 18, yield: 1, rarity: 'common', sellPrice: 3, color: '#4fc3f7', element: 'water', distinctive: true },
  { id: 'glowleaf', name: 'Glowleaf', growSeconds: 20, yield: 1, rarity: 'common', sellPrice: 4, color: '#8bc34a', element: 'leaf', distinctive: true },
];
