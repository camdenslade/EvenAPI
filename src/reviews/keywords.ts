//********************************************************************
//
// FLAGGED_WORDS Constant
//
// Array of flagged words used for review comment moderation. Contains
// words related to violence, threats, harassment, abuse, sexual
// exploitation, profanity, hate speech, self-harm, substance abuse,
// graphic content, and extremism. Used by ReviewsService to detect
// and flag abusive review content.
//
// Return Value
// ------------
// string[]    Array of flagged word strings
//
// Value Parameters
// ----------------
// None
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// None
//
//*******************************************************************
export const FLAGGED_WORDS: string[] = [
  // Violence / Threats
  "kill",
  "killing",
  "killed",
  "murder",
  "murdering",
  "murdered",
  "execute",
  "execution",
  "suicide",
  "selfharm",
  "self-harm",
  "cutting",
  "stab",
  "stabbing",
  "stabbed",
  "shoot",
  "shooting",
  "shot",
  "bomb",
  "bombing",
  "explosion",
  "explode",
  "attack",
  "attacking",
  "assault",
  "assaulting",
  "beat",
  "beating",
  "torture",
  "torturing",
  "strangle",
  "strangling",
  "choke",
  "choking",
  "hang",
  "hanging",
  "lynch",
  "lynching",

  // Harassment / Abuse
  "abuse",
  "abusive",
  "harass",
  "harassing",
  "harassment",
  "threat",
  "threaten",
  "threatening",
  "bully",
  "bullying",
  "demean",
  "degrading",
  "insult",
  "insulting",
  "humiliate",
  "humiliating",

  // Sexual exploitation / Explicit
  "rape",
  "raping",
  "raped",
  "molest",
  "molesting",
  "molestation",
  "grooming",
  "sexslave",
  "trafficking",
  "pimp",
  "porn",
  "porno",
  "pornographic",
  "nude",
  "nudity",
  "explicit",
  "bestiality",

  // General strong profanity (non-identity targeted)
  "fuck",
  "fucking",
  "fucked",
  "shit",
  "shitty",
  "bitch",
  "bastard",
  "asshole",
  "dick",
  "dickhead",
  "prick",
  "cunt",
  "slut",
  "whore",
  "scumbag",
  "jackass",

  // Hate-like general expressions
  "hate",
  "hating",
  "hated",
  "disgusting",
  "worthless",
  "idiot",
  "stupid",
  "moron",
  "retard",
  "retarded",
  "imbecile",
  "loser",

  // Self-harm / Implicit dangerous content
  "kms",
  "kys",
  "die",
  "endmyself",
  "end-it-all",

  // Substance / Hard drug references
  "cocaine",
  "heroin",
  "meth",
  "lsd",
  "crack",
  "overdose",
  "od",

  // Graphic content
  "blood",
  "bloody",
  "gore",
  "gory",
  "decapitate",
  "dismember",
  "maim",

  // Extremism / Criminal Activity
  "terror",
  "terrorist",
  "terrorism",
  "extremist",
  "extremism",
  "cartel",
  "kidnap",
  "kidnapping",
  "hostage",
  "arson",
  "rob",
  "robbery",
  "steal",
  "theft",
  "burglar",
  "burglarize",
];
