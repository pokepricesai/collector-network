// Character-page editorial + card-data-driven copy generator.
//
// Purpose: produce human-readable, factual "About X" copy for a Lorcana
// character page WITHOUT hallucinating Disney lore. Two channels:
//
//   1. `KNOWN_INTROS` — a curated allow-list of short, unambiguous
//      one-line intros for high-certainty franchise characters. If the
//      slug isn't in this map, we DO NOT fabricate franchise facts.
//   2. Card-data-driven paragraphs computed from the versions list
//      that /character/[slug] already builds. Always safe to render.
//
// No em dashes anywhere. Copy is short — 1-4 short sentences per
// character total. No "In this article we'll explore…" filler.
//
// Callers pass the character name + versions + pricing summary +
// inks/sets already aggregated by the page. This module never touches
// Supabase and never runs at request-time longer than a few micros.
//
// FORMAT NOTE: currency is caller-controlled. Any price rendering uses
// formatPrice() and states the native marketplace via CURRENCY_SOURCE_NAME
// so an EU visitor sees "Cardmarket" and a US visitor sees "TCGPlayer".

import type { LorcanaCurrency } from './currency';
import { CURRENCY_SOURCE_NAME, formatPrice } from './currency';
import { LC_INK_LABEL, type LcInk } from './lorcana/ink';

export interface CharacterContentInput {
  characterName: string;
  slug: string;
  versionCount: number;
  inks: LcInk[];
  setNames: string[];
  raritiesPresent: string[];         //  ["Enchanted", "Legendary", …]
  hasEnchantedOrIconic: boolean;
  highestPricedVersion: {
    fullName: string;                //  "Elsa - Snow Queen"
    subtitle: string | null;         //  "Snow Queen"
    price: number;
    currency: LorcanaCurrency;
    rarity: string | null;
  } | null;
}

export interface CharacterContent {
  introParagraph: string;            //  1-2 sentences, plain text
  cardSummary: string;               //  1-2 sentences, card-data derived
  inksLine: string;                  //  "Amber, Ruby and Sapphire"
  setsLine: string;                  //  "The First Chapter, Rise of the Floodborn, …"
  highestValueLine: string | null;   //  "Elsa's most valuable printing is …"
}

// One-line factual descriptors keyed by character slug. Intentionally
// terse; every entry is a fact you can verify from a single Wikipedia
// paragraph. Do NOT expand these into paragraphs; the card-data
// summary handles the rest. Never uses an em dash.
const KNOWN_INTROS: Record<string, string> = {
  'elsa': 'Elsa is the queen of Arendelle from the Frozen films (2013 onward), the elder daughter of King Agnarr and Queen Iduna.',
  'anna': 'Anna is the princess of Arendelle and younger sister of Elsa in the Frozen films (2013 onward).',
  'mickey-mouse': 'Mickey Mouse is a Walt Disney cartoon character created in 1928, appearing in animated shorts, comics and films.',
  'minnie-mouse': 'Minnie Mouse is a Walt Disney cartoon character introduced alongside Mickey in 1928.',
  'donald-duck': 'Donald Duck is a Walt Disney cartoon character introduced in 1934.',
  'daisy-duck': 'Daisy Duck is a Walt Disney cartoon character introduced in 1940.',
  'goofy': 'Goofy is a Walt Disney cartoon character introduced in 1932.',
  'pluto': "Pluto is Mickey Mouse's pet dog, a Disney cartoon character introduced in 1930.",
  'ariel': 'Ariel is a mermaid princess and the protagonist of The Little Mermaid (1989).',
  'belle': 'Belle is the protagonist of Beauty and the Beast (1991).',
  'beast': 'Beast is the enchanted prince from Beauty and the Beast (1991).',
  'cinderella': 'Cinderella is the protagonist of the 1950 Disney animated film of the same name.',
  'aurora': 'Aurora is the princess protagonist of Sleeping Beauty (1959).',
  'snow-white': 'Snow White is the protagonist of Snow White and the Seven Dwarfs (1937), Disney\'s first animated feature.',
  'jasmine': 'Jasmine is the princess of Agrabah in Aladdin (1992).',
  'aladdin': 'Aladdin is the protagonist of Aladdin (1992).',
  'genie': 'Genie is the shape-shifting djinn from Aladdin (1992), first voiced by Robin Williams.',
  'jafar': 'Jafar is the royal vizier and antagonist of Aladdin (1992).',
  'mulan': 'Mulan is the protagonist of Mulan (1998), based on the Chinese legend of Hua Mulan.',
  'moana': 'Moana is the protagonist of Moana (2016), the daughter of a Polynesian village chief.',
  'maui': 'Maui is a demigod companion character in Moana (2016).',
  'rapunzel': 'Rapunzel is the protagonist of Tangled (2010), a princess with magical hair.',
  'tiana': 'Tiana is the protagonist of The Princess and the Frog (2009).',
  'pocahontas': 'Pocahontas is the protagonist of Pocahontas (1995), inspired by the historical figure.',
  'maleficent': 'Maleficent is the villain of Sleeping Beauty (1959), a dark fairy who curses Princess Aurora.',
  'ursula': 'Ursula is the sea witch villain of The Little Mermaid (1989).',
  'cruella-de-vil': 'Cruella De Vil is the villain of One Hundred and One Dalmatians (1961).',
  'scar': 'Scar is the villain of The Lion King (1994), the younger brother of Mufasa.',
  'simba': 'Simba is the protagonist of The Lion King (1994).',
  'mufasa': "Mufasa is the king of the Pride Lands in The Lion King (1994), Simba's father.",
  'nala': "Nala is Simba's companion in The Lion King (1994).",
  'timon': 'Timon is the meerkat sidekick in The Lion King (1994).',
  'pumbaa': 'Pumbaa is the warthog sidekick in The Lion King (1994).',
  'stitch': 'Stitch is the blue alien protagonist of Lilo & Stitch (2002), designated Experiment 626.',
  'lilo': 'Lilo is a young Hawaiian girl and the protagonist of Lilo & Stitch (2002).',
  'peter-pan': 'Peter Pan is the flying boy from Neverland in Peter Pan (1953).',
  'captain-hook': 'Captain Hook is the pirate villain of Peter Pan (1953).',
  'tinker-bell': "Tinker Bell is the fairy sidekick from Peter Pan (1953)'s Neverland.",
  'wendy': 'Wendy Darling is the eldest Darling child in Peter Pan (1953).',
  'winnie-the-pooh': 'Winnie the Pooh is a honey-loving bear introduced in A.A. Milne\'s 1926 stories, later a Disney animated staple.',
  'tigger': 'Tigger is a bouncing tiger from the Winnie the Pooh stories.',
  'piglet': 'Piglet is a small pig companion in the Winnie the Pooh stories.',
  'eeyore': 'Eeyore is the melancholic donkey in the Winnie the Pooh stories.',
  'bambi': 'Bambi is the deer protagonist of Bambi (1942).',
  'dumbo': 'Dumbo is the elephant protagonist of Dumbo (1941), able to fly using his oversized ears.',
  'sleeping-beauty': 'See Aurora, the princess protagonist of Sleeping Beauty (1959).',
  'robin-hood': 'Robin Hood is the fox-designed protagonist of Disney\'s Robin Hood (1973), based on the English legend.',
  'baloo': 'Baloo is the bear from The Jungle Book (1967).',
  'mowgli': 'Mowgli is the boy protagonist of The Jungle Book (1967).',
  'shere-khan': 'Shere Khan is the tiger villain of The Jungle Book (1967).',
  'kaa': 'Kaa is the python from The Jungle Book (1967).',
  'gaston': 'Gaston is the vain antagonist of Beauty and the Beast (1991).',
  'lumiere': 'Lumiere is the candelabra footman in Beauty and the Beast (1991).',
  'mrs-potts': 'Mrs. Potts is the enchanted teapot in Beauty and the Beast (1991).',
  'chip': 'Chip is the young enchanted teacup in Beauty and the Beast (1991).',
  'kristoff': 'Kristoff is the ice harvester from the Frozen films (2013 onward).',
  'olaf': 'Olaf is the enchanted snowman from the Frozen films (2013 onward).',
  'sven': "Sven is Kristoff's reindeer companion from the Frozen films (2013 onward).",
  'hades': 'Hades is the villain of Hercules (1997), the god of the underworld.',
  'hercules': 'Hercules is the demigod protagonist of Hercules (1997).',
  'megara': 'Megara is a mortal woman in Hercules (1997), bound to Hades.',
  'zeus': 'Zeus is the king of the gods in Hercules (1997).',
  'quasimodo': 'Quasimodo is the bell-ringer protagonist of The Hunchback of Notre Dame (1996).',
  'esmeralda': 'Esmeralda is the Roma dancer in The Hunchback of Notre Dame (1996).',
  'frollo': 'Judge Claude Frollo is the antagonist of The Hunchback of Notre Dame (1996).',
  'jack-skellington': "Jack Skellington is the Pumpkin King of Halloween Town in The Nightmare Before Christmas (1993).",
  'sally': 'Sally is a rag-doll character in The Nightmare Before Christmas (1993).',
  'kuzco': 'Kuzco is the emperor protagonist of The Emperor\'s New Groove (2000).',
  'yzma': 'Yzma is the villain of The Emperor\'s New Groove (2000).',
  'kronk': "Kronk is Yzma's henchman in The Emperor's New Groove (2000).",
  'the-queen': 'The Queen is the vain antagonist of Snow White and the Seven Dwarfs (1937).',
  'evil-queen': 'The Evil Queen is the antagonist of Snow White and the Seven Dwarfs (1937).',
  'prince-john': 'Prince John is the villain of Disney\'s Robin Hood (1973).',
  'sir-hiss': 'Sir Hiss is the snake sidekick to Prince John in Robin Hood (1973).',
  'little-john': "Little John is Robin Hood's bear companion in Robin Hood (1973).",
  'anastasia': 'Anastasia is one of Cinderella\'s stepsisters in Cinderella (1950).',
  'drizella': 'Drizella is one of Cinderella\'s stepsisters in Cinderella (1950).',
  'lady-tremaine': "Lady Tremaine is Cinderella's stepmother and antagonist in Cinderella (1950).",
  'fairy-godmother': "The Fairy Godmother is Cinderella's magical benefactor in Cinderella (1950).",
  'prince-eric': 'Prince Eric is the human prince who Ariel falls for in The Little Mermaid (1989).',
  'flounder': "Flounder is Ariel's fish companion in The Little Mermaid (1989).",
  'sebastian': 'Sebastian is the crab advisor in The Little Mermaid (1989).',
  'king-triton': "King Triton is Ariel's father and ruler of Atlantica in The Little Mermaid (1989).",
  'yen-sid': "Yen Sid is the sorcerer from Fantasia (1940) and the Sorcerer's Apprentice segment.",
  'chernabog': 'Chernabog is the demonic being from Fantasia (1940)\'s Night on Bald Mountain segment.',
  'jim-hawkins': 'Jim Hawkins is the protagonist of Treasure Planet (2002).',
  'john-silver': 'John Silver is the cyborg antagonist and mentor figure in Treasure Planet (2002).',
  'flynn-rider': "Flynn Rider is Rapunzel's companion in Tangled (2010).",
  'mother-gothel': "Mother Gothel is the antagonist of Tangled (2010).",
  'pascal': "Pascal is Rapunzel's chameleon companion in Tangled (2010).",
  'maximus': 'Maximus is the palace horse in Tangled (2010).',
  'diaval': "Diaval is Maleficent's raven companion in the Maleficent live-action films.",
  'basil': 'Basil is the mouse detective protagonist of The Great Mouse Detective (1986).',
  'ratigan': 'Ratigan is the rat antagonist of The Great Mouse Detective (1986).',
  'dr-facilier': 'Dr. Facilier is the shadow-man villain of The Princess and the Frog (2009).',
  'nick-wilde': 'Nick Wilde is the fox protagonist of Zootopia (2016).',
  'judy-hopps': 'Judy Hopps is the rabbit police officer protagonist of Zootopia (2016).',
  'wreck-it-ralph': 'Wreck-It Ralph is the video-game villain protagonist of Wreck-It Ralph (2012).',
  'vanellope': 'Vanellope von Schweetz is the racing-game character in Wreck-It Ralph (2012).',
  'elastigirl': 'Elastigirl is the stretchy superheroine in The Incredibles (2004).',
  'mr-incredible': 'Mr. Incredible is the super-strong hero of The Incredibles (2004).',
  'frozone': "Frozone is Mr. Incredible's friend and an ice-generating hero in The Incredibles (2004).",
  'dash': 'Dash is the speedster son in The Incredibles (2004).',
  'violet': 'Violet is the invisibility-and-forcefield daughter in The Incredibles (2004).',
  'jack-jack': 'Jack-Jack is the shape-shifting baby in The Incredibles (2004).',
  'edna-mode': 'Edna Mode is the super-suit designer in The Incredibles (2004).',
  'buzz-lightyear': 'Buzz Lightyear is the space-ranger toy in the Toy Story films (1995 onward).',
  'woody': 'Woody is the cowboy toy in the Toy Story films (1995 onward).',
  'jessie': 'Jessie is the cowgirl toy introduced in Toy Story 2 (1999).',
  'bo-peep': 'Bo Peep is the porcelain shepherd toy in the Toy Story films.',
  'mr-potato-head': 'Mr. Potato Head is a customisable toy in the Toy Story films.',
  'rex': 'Rex is the anxious dinosaur toy in the Toy Story films.',
  'slinky-dog': 'Slinky Dog is a slinky-bodied toy in the Toy Story films.',
  'hamm': 'Hamm is the piggy-bank toy in the Toy Story films.',
  'sulley': 'Sulley is the blue monster protagonist of Monsters, Inc. (2001).',
  'mike-wazowski': "Mike Wazowski is Sulley's one-eyed partner in Monsters, Inc. (2001).",
  'boo': "Boo is the human toddler who bonds with Sulley in Monsters, Inc. (2001).",
  'randall-boggs': 'Randall Boggs is the chameleon antagonist of Monsters, Inc. (2001).',
  'marlin': "Marlin is a clownfish and Nemo's father in Finding Nemo (2003).",
  'nemo': 'Nemo is the young clownfish in Finding Nemo (2003).',
  'dory': 'Dory is a blue tang with short-term memory loss in Finding Nemo (2003) and Finding Dory (2016).',
  'remy': 'Remy is the rat protagonist of Ratatouille (2007).',
  'linguini': 'Linguini is the young cook in Ratatouille (2007).',
  'wall-e': 'WALL-E is the trash-compactor robot protagonist of WALL-E (2008).',
  'eve': 'EVE is the reconnaissance robot in WALL-E (2008).',
  'merida': 'Merida is the archer princess of Brave (2012).',
  'joy': 'Joy is a personified emotion in Inside Out (2015).',
  'sadness': 'Sadness is a personified emotion in Inside Out (2015).',
  'anger': 'Anger is a personified emotion in Inside Out (2015).',
  'fear': 'Fear is a personified emotion in Inside Out (2015).',
  'disgust': 'Disgust is a personified emotion in Inside Out (2015).',
  'coco': 'Coco is the great-grandmother in Coco (2017).',
  'miguel': 'Miguel Rivera is the young musician protagonist of Coco (2017).',
  'hector': 'Hector is the trickster spirit in Coco (2017).',
  'raya': 'Raya is the warrior protagonist of Raya and the Last Dragon (2021).',
  'sisu': 'Sisu is the dragon companion in Raya and the Last Dragon (2021).',
  'mirabel': 'Mirabel Madrigal is the protagonist of Encanto (2021).',
  'bruno': 'Bruno Madrigal is the ostracised uncle in Encanto (2021).',
  'isabela': 'Isabela Madrigal is a flower-generating sister in Encanto (2021).',
  'luisa': 'Luisa Madrigal is the super-strong sister in Encanto (2021).',
  'stitch-experiment-626': 'Experiment 626, better known as Stitch, is the alien protagonist of Lilo & Stitch (2002).',
};

function formatList(items: readonly string[]): string {
  const arr = items.filter((s) => !!s);
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0]!;
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
}

//  Compose the "About X" content. Pure. Deterministic. Non-null strings
//  except for `highestValueLine` which is null when we can't cite a price.
export function buildCharacterContent(input: CharacterContentInput): CharacterContent {
  const { characterName, slug, versionCount, inks, setNames, highestPricedVersion } = input;

  const inkLabels = inks.map((i) => LC_INK_LABEL[i]);
  const inksLine = inkLabels.length > 0 ? formatList(inkLabels) : '';
  const setsLine = setNames.length > 0 ? formatList(setNames) : '';

  //  Intro: use curated fact if we're confident. Otherwise fall back to
  //  a card-data intro that makes no franchise claim.
  const known = KNOWN_INTROS[slug];
  const introParagraph = known
    ? known
    : `${characterName} appears in the Disney Lorcana catalogue with ${versionCount} tracked printing${versionCount === 1 ? '' : 's'}.`;

  //  Card-data summary. Always factual, always safe.
  const cardSummary = [
    `${characterName} has ${versionCount} version${versionCount === 1 ? '' : 's'} in Disney Lorcana`,
    inksLine ? ` across ${inksLine}` : '',
    '.',
    setsLine
      ? ` Sets featuring ${characterName}: ${setsLine}.`
      : '',
  ].join('');

  //  Highest-value line (currency-aware, cites native marketplace).
  let highestValueLine: string | null = null;
  if (highestPricedVersion) {
    const priceStr = formatPrice(highestPricedVersion.price, highestPricedVersion.currency);
    const marketplace = CURRENCY_SOURCE_NAME[highestPricedVersion.currency];
    const rarityStr = highestPricedVersion.rarity
      ? ` (${highestPricedVersion.rarity})`
      : '';
    highestValueLine = `The most valuable ${characterName} printing on ${marketplace} is ${highestPricedVersion.fullName}${rarityStr} at ${priceStr}.`;
  }

  return {
    introParagraph,
    cardSummary,
    inksLine,
    setsLine,
    highestValueLine,
  };
}

//  Adaptive FAQ builder. Skips questions when the underlying data
//  doesn't support them. Answers cite native marketplaces and use
//  formatPrice() for the caller's currency.
export interface CharacterFaqInput extends CharacterContentInput {
  currency: LorcanaCurrency;
  characterUrl: string;              //  Canonical /character/<slug>
}

export interface CharacterFaqEntry {
  q: string;
  a: string;                          //  Plain-text; used for BOTH visible + JSON-LD.
}

export function buildCharacterFaq(input: CharacterFaqInput): CharacterFaqEntry[] {
  const {
    characterName,
    versionCount,
    inks,
    setNames,
    hasEnchantedOrIconic,
    highestPricedVersion,
    characterUrl,
  } = input;
  const inkLabels = inks.map((i) => LC_INK_LABEL[i]);
  const entries: CharacterFaqEntry[] = [];

  entries.push({
    q: `How many ${characterName} cards are in Disney Lorcana?`,
    a: `${characterName} has ${versionCount} tracked version${versionCount === 1 ? '' : 's'} in Lorcana. Each is a distinct printing with its own set, rarity and price.`,
  });

  if (setNames.length > 0) {
    entries.push({
      q: `Which Lorcana sets feature ${characterName}?`,
      a: `${characterName} appears in ${formatList(setNames)}.`,
    });
  }

  if (inkLabels.length > 0) {
    entries.push({
      q: `What inks are ${characterName} cards?`,
      a: `${characterName} cards use the ${formatList(inkLabels)} ink${inkLabels.length === 1 ? '' : 's'}.`,
    });
  }

  if (highestPricedVersion) {
    const marketplace = CURRENCY_SOURCE_NAME[highestPricedVersion.currency];
    const priceStr = formatPrice(highestPricedVersion.price, highestPricedVersion.currency);
    entries.push({
      q: `What is the most valuable ${characterName} Lorcana card?`,
      a: `The most valuable ${characterName} printing on ${marketplace} is ${highestPricedVersion.fullName} at ${priceStr}. Live price on this page.`,
    });
  }

  if (hasEnchantedOrIconic) {
    entries.push({
      q: `Are there Enchanted or Iconic ${characterName} cards?`,
      a: `Yes. ${characterName} has an Enchanted or Iconic printing in the Lorcana catalogue. Every rarity tier is shown on the version grid on this page.`,
    });
  }

  entries.push({
    q: `Where can I find all ${characterName} Lorcana cards?`,
    a: `Every ${characterName} printing is on this page at ${characterUrl}. Use the version grid to jump straight to any specific printing's live price.`,
  });

  return entries;
}
