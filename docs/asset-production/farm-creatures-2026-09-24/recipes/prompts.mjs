// One shared house-style template for every GalaQuest farm creature reference image.
//   node prompts.mjs <id> [variant] > prompt.txt
// Names/elements/rarity/shape/colors follow prototypes/farm-slice/content/content.js (origin/co-ceo/shell).

const HOUSE = 'Original character design for a 3D creature-collector farm adventure game, shown as a single '
  + 'finished stylized 3D game model render: chunky toy-like sculpt, smooth clean surfaces, bold hand-painted '
  + 'color blocks, soft even studio lighting. House style: a bold-silhouette monster with a confident, slightly '
  + 'fierce, heroic attitude - cool, never babyish - big expressive eyes with a determined look, thick sturdy limbs, '
  + 'vibrant saturated colors.';

const RARITY = {
  common: 'Rarity COMMON: compact and cool-cute, small sturdy body, simple strong shapes.',
  rare: 'Rarity RARE: sleeker, more agile proportions and extra element features, clearly fancier than a basic creature.',
  epic: 'Rarity EPIC: big, powerful and legendary-looking, armored plates and an ornate element crest, with glowing accent markings painted onto the armor.',
};

const SHAPE = {
  round: 'Body plan: round chunky body standing on two short sturdy feet.',
  tall: 'Body plan: upright and taller than wide, standing on two strong legs.',
  long: 'Body plan: long low powerful four-legged body with a long thick tail, all four feet planted on the floor.',
  winged: 'Body plan: compact body standing on two sturdy feet with one pair of thick, solid, chunky wings folded half-open at its sides.',
};

const RULES = 'Composition: exactly one creature, alone, centered, the entire body visible from ears to feet and '
  + 'tail tip with generous empty margins on all sides, neutral three-quarter front view, standing in a stable '
  + 'pose with feet on the floor. Plain solid flat pale-grey background, no floor, no scenery, no props, only a '
  + 'tiny soft contact shadow under the feet. Every element effect (fire, water, leaves, lightning) is a SOLID '
  + 'sculpted shape attached to the body - no floating particles, no sparks or droplets in the air, no smoke, '
  + 'no thin whiskers, no wires, no text, no logos, no watermark. Wholly original design that does not resemble '
  + 'any existing franchise character.';

const CREATURES = {
  sprout: {
    name: 'Sprout', element: 'sun', rarity: 'common', shape: 'round',
    look: 'Creature "Sprout", a sun-element lion-dragon cub. Deep orange body (#ff7043) with a sunny golden-yellow '
      + '(#ffd54f) belly, muzzle and paws. A thick mane of chunky triangular golden sun-ray spikes frames its face '
      + 'like a blazing sun. Two thick golden leaf-shaped sprout tufts stand up on top of its head. Short stubby '
      + 'tail ending in a solid golden flame-shaped sun flare. Small arms at its sides with little fists clenched, '
      + 'a cocky confident grin showing one tiny fang.',
  },
  puddlefin: {
    name: 'Puddlefin', element: 'water', rarity: 'common', shape: 'round',
    look: 'Creature "Puddlefin", a water-element baby sea-dragon. Bright sky-blue body (#4fc3f7) with a pale icy-blue '
      + '(#b3e5fc) belly and cheeks. A big solid curling wave-shaped fin crest runs from its forehead down its back '
      + 'like a breaking wave, two fin-shaped ears, stubby arms with little webbed hands, a short thick tail with a '
      + 'solid fish-fin tip. Confident smirk with one tiny fang.',
  },
  mossbun: {
    name: 'Mossbun', element: 'leaf', rarity: 'common', shape: 'round',
    look: 'Creature "Mossbun", a leaf-element forest rabbit beast. Fresh leaf-green body (#8bc34a) with a creamy '
      + 'off-white (#f1f8e9) belly, muzzle and paws. Two long thick ears shaped like broad solid leaves with painted '
      + 'leaf veins, a chunky mossy tuft crest on its head, a round moss-ball tail, big sturdy hind feet. Brave '
      + 'determined grin with two buck teeth.',
  },
  zapkit: {
    name: 'Zapkit', element: 'spark', rarity: 'common', shape: 'round',
    look: 'Creature "Zapkit", a spark-element electric fox kit. Bright lemon-yellow body (#ffee58) with a pale '
      + 'cream-yellow (#fff9c4) belly and muzzle, bold charcoal-navy zigzag stripe markings on its back and ear tips. '
      + 'Two thick zigzag lightning-bolt horns on its forehead, pointed fox ears, and a big fluffy tail shaped like a '
      + 'solid spiky spark burst. Mischievous confident grin.',
  },
  flamewhisk: {
    name: 'Flamewhisk', element: 'fire', rarity: 'epic', shape: 'long',
    look: 'Creature "Flamewhisk", a legendary fire-element fox-dragon. Deep red-orange body (#d84315) with warm '
      + 'light-orange (#ffcc80) belly and chest. Dark ember-rock armor plates along its back and shoulders with '
      + 'glowing molten-orange crack markings painted on them, swept-back horns, a mane of solid sculpted flames, '
      + 'and a long thick tail ending in a huge glowing solid flame plume - its tail glows brightest. Fierce proud '
      + 'expression.',
  },
  tidekit: {
    name: 'Tidekit', element: 'water', rarity: 'epic', shape: 'long',
    look: 'Creature "Tidekit", a legendary water-element sea-otter-dragon. Deep ocean-blue body (#0288d1) with '
      + 'light aqua (#81d4fa) belly and fins. Pearly shell armor plates along its back with glowing aqua spiral '
      + 'markings painted on them, a big solid curling wave-crest mane, fin-shaped ears, and a long thick tail '
      + 'ending in a broad solid tail fin. Calm powerful heroic expression.',
  },
  bloomtail: {
    name: 'Bloomtail', element: 'leaf', rarity: 'epic', shape: 'long',
    look: 'Creature "Bloomtail", a legendary leaf-element forest wolf-lizard. Deep forest-green body (#558b2f) with '
      + 'light lime-green (#aed581) belly and paws. Bark-brown armor plates along its back with glowing green '
      + 'vine markings painted on them, a crown of short thick branch antlers with broad solid leaves, a few chunky '
      + 'flowers on its shoulders, and a long thick tail ending in a big solid pink-and-white flower bloom. Noble '
      + 'fierce expression.',
  },
  boltbun: {
    name: 'Boltbun', element: 'spark', rarity: 'epic', shape: 'tall',
    look: 'Creature "Boltbun", a legendary spark-element rabbit warrior. Amber-gold fur (#f9a825) with a pale cream '
      + '(#ffecb3) chest and muzzle, powerful legs built for speed, two tall thick ears shaped like solid zigzag '
      + 'lightning bolts, dark steel-blue armored shoulder pads and gauntlets with glowing electric-cyan lightning '
      + 'markings painted on them, a fluffy spark-burst tail. Fists clenched, fearless competitive grin.',
  },
  cinderkit: {
    // v2 (v1 text preserved in raw/cinderkit/ref1/prompt.txt): v1 read plainer than the common Sprout,
    // so v2 adds the "rare" extras - flame mane crest and flame cuffs - on a sleeker lynx dancer.
    name: 'Cinderkit', element: 'fire', rarity: 'rare', shape: 'tall',
    look: 'Creature "Cinderkit", a sleek agile fire-element lynx dancer. Burnt red-orange fur (#e64a19) with a soft '
      + 'peach (#ffab91) chest, muzzle and paws, long athletic legs, a big solid sculpted flame crest sweeping back '
      + 'from its forehead like a blazing mohawk, tall pointed ears with solid flame-shaped tufts, solid sculpted '
      + 'flame cuffs wrapped around its wrists and ankles, dark ember stripe markings on its arms and thighs, and a '
      + 'long tail ending in a large solid sculpted flame. Fierce playful grin showing a fang, arms relaxed at its '
      + 'sides in a balanced ready stance.',
  },
  splashpuff: {
    name: 'Splashpuff', element: 'water', rarity: 'rare', shape: 'winged',
    look: 'Creature "Splashpuff", a water-element puffin-seal creature. Bright blue body (#29b6f6) with a snowy '
      + 'white-blue (#e1f5fe) belly and face, a pair of thick solid fin-shaped wings, a solid water-droplet crest on '
      + 'its head with a small painted rainbow stripe across it, webbed feet, a short fan tail. Cheerful confident '
      + 'expression.',
  },
  fernsprout: {
    name: 'Fernsprout', element: 'leaf', rarity: 'rare', shape: 'tall',
    look: 'Creature "Fernsprout", a leaf-element forest lizard scout. Mossy green scales (#689f38) with pale '
      + 'sage-green (#c5e1a5) belly and face, a tall crest of thick solid fern fronds on its head, broad leaf-shaped '
      + 'tail, wrapped vine bands on its forearms, sturdy clawed feet. Alert brave expression, arms at its sides.',
  },
  glimmerpup: {
    name: 'Glimmerpup', element: 'spark', rarity: 'rare', shape: 'winged',
    look: 'Creature "Glimmerpup", a spark-element puppy. Golden-yellow fur (#fdd835) with lighter lemon (#fff176) '
      + 'chest and muzzle, bold deep-violet star-shaped markings on its back, one short zigzag lightning horn on its '
      + 'forehead, a pair of thick solid chunky wings shaped like lightning bolts, a spiky spark-burst tail tip. '
      + 'Eager daring grin.',
  },
};

// Egg v1 (raw/egg/ref1/prompt.txt) reconstructed with a blurred view-blend band and near-invisible
// cracks. v2 uses fewer, bigger, bolder color masses (robust to multi-view texture blending) and
// thick bright painted crack lines, plus a legendary feel.
const EGG = 'Original prop design for a 3D creature-collector farm adventure game, shown as a single finished '
  + 'stylized 3D game model render: a big chunky legendary mystery creature egg standing upright on a slightly '
  + 'flattened rounded base, wider at the bottom. Thick glossy warm ivory shell decorated with about a dozen '
  + 'LARGE bold rounded spots in bright orange, sky-blue, leaf-green and golden yellow spread evenly all around '
  + 'the egg, plus THICK bright glowing golden-yellow zigzag crack lines PAINTED flat on the surface that wrap '
  + 'around the whole egg - the shell is completely intact, smooth and not cracked open. Soft even studio '
  + 'lighting, bold clean color blocks, exciting and magical. Composition: exactly one egg, alone, centered, '
  + 'fully visible with generous empty margins, neutral three-quarter view. Plain solid flat pale-grey '
  + 'background, no nest, no floor, no scenery, only a tiny soft contact shadow. No text, no logos, no watermark.';

// Hero: rig-friendly strict T-pose per docs/pipeline/characters-npcs.md step 1. Hat band is green, not
// red, to stay clear of a famous straw-hat franchise cue.
const HERO = 'Original character design for a 3D creature-collector farm adventure game, shown as a single '
  + 'finished stylized 3D game model render: chunky toy-like sculpt, smooth clean surfaces, bold hand-painted '
  + 'color blocks, soft even studio lighting. Character: a brave 10-year-old kid farmer-adventurer hero with '
  + 'chibi proportions - big head about one third of total height, short sturdy body, chunky boots. Short messy '
  + 'brown hair under a wide-brimmed woven straw hat with a leaf-green band and a small leaf pin. Snug teal '
  + 'adventurer vest with two big pockets over a cream short-sleeved shirt, brown belt with a small pouch, '
  + 'knee-length olive cargo shorts, sturdy brown lace-up boots, and a compact rounded orange backpack strapped '
  + 'tight to the back with a rolled blanket on top. Confident friendly grin, determined bright eyes. No '
  + 'weapons, no tools, nothing in the hands. Pose: strict T-pose, front view facing the viewer straight on, '
  + 'arms stretched straight out horizontally to the sides, palms down, fingers together, empty open hands, legs '
  + 'straight and slightly apart, feet flat on the floor, entire body visible from hat to boots with generous '
  + 'empty margins. Clothing is snug and connected to the body: no loose flaps, no dangling straps, no scarf. '
  + 'Plain solid flat pale-grey background, no floor, no scenery, only a tiny soft contact shadow. No text, no '
  + 'logos, no watermark. Wholly original design that does not resemble any existing franchise character.';

export function creaturePrompt(id, extra = '') {
  if (id === 'egg') return EGG;
  if (id === 'hero') return [HERO, extra].filter(Boolean).join(' ');
  const c = CREATURES[id];
  if (!c) throw new Error(`unknown creature ${id}`);
  // Hex codes document the content.js color pairs but are stripped from the sent prompt: image models
  // can paint them as literal text. The color words beside each code carry the intent.
  const look = c.look.replace(/\s*\(#[0-9a-f]{6}\)/gi, '');
  return [HOUSE, look, RARITY[c.rarity], SHAPE[c.shape], extra, RULES].filter(Boolean).join(' ');
}
export { CREATURES };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, ...extra] = process.argv.slice(2);
  process.stdout.write(`${creaturePrompt(id, extra.join(' '))}\n`);
}
