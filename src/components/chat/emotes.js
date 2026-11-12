// Twitch-style emotes: the usual Twitch, BTTV, FFZ and 7TV ones, pinned to fixed
// ids so a random upload with the same name never shows up. A word in a message
// that is exactly one of these codes is shown as the picture (case matters, like
// on Twitch). Pictures come straight from the providers' CDNs.

// [code, provider, id, animated]
const LIST = [
  ['Kappa', 'twitch', '25'],
  ['Keepo', 'twitch', '1902'],
  ['LUL', 'twitch', '425618'],
  ['4Head', 'twitch', '354'],
  ['Kreygasm', 'twitch', '41'],
  ['ResidentSleeper', 'twitch', '245'],
  ['NotLikeThis', 'twitch', '58765'],
  ['SeemsGood', 'twitch', '64138'],
  ['WutFace', 'twitch', '28087'],
  ['DansGame', 'twitch', '33'],
  ['SwiftRage', 'twitch', '34'],
  ['PJSalt', 'twitch', '36'],
  ['CoolStoryBob', 'twitch', '123171'],
  ['HeyGuys', 'twitch', '30259'],
  ['FailFish', 'twitch', '360'],
  ['BabyRage', 'twitch', '22639'],
  ['Jebaited', 'twitch', '114836'],
  ['CoolCat', 'twitch', '58127'],
  ['HotPokket', 'twitch', '357'],
  ['VoHiYo', 'twitch', '81274'],
  ['PogBones', 'twitch', 'emotesv2_30050f4353aa4322b25b6b044703e5d1'],
  ['monkaS', 'bttv', '56e9f494fff3cc5c35e5287e'],
  ['FeelsBadMan', 'bttv', '566c9fc265dbbdab32ec053b'],
  ['FeelsGoodMan', 'bttv', '566c9fde65dbbdab32ec053e'],
  ['FeelsAmazingMan', 'bttv', '5733ff12e72c3c0814233e20'],
  ['FeelsBirthdayMan', 'bttv', '55b6524154eefd53777b2580'],
  ['KKona', 'bttv', '566ca04265dbbdab32ec054a'],
  ['haHAA', 'bttv', '555981336ba1901877765555'],
  ['D:', 'bttv', '55028cd2135896936880fdd7'],
  ['SourPls', 'bttv', '566ca38765dbbdab32ec0560', 1],
  ['RarePepe', 'bttv', '555015b77676617e17dd2e8e'],
  ['NaM', 'bttv', '566ca06065dbbdab32ec054e'],
  ['VapeNation', 'bttv', '56f5be00d48006ba34f530a4'],
  ['KEKW', 'ffz', '381875'],
  ['KEKWait', 'ffz', '390750'],
  ['OMEGALUL', 'ffz', '128054'],
  ['LULW', 'ffz', '139407'],
  ['Pog', 'ffz', '210748'],
  ['POGGERS', 'ffz', '214129'],
  ['PepeLaugh', 'ffz', '64785'],
  ['monkaW', 'ffz', '214681'],
  ['monkaHmm', 'ffz', '240746'],
  ['monkaGIGA', 'ffz', '183221'],
  ['Sadge', 'ffz', '425196'],
  ['PepeHands', 'ffz', '231552'],
  ['5Head', 'ffz', '239504'],
  ['3Head', 'ffz', '274406'],
  ['Pepega', 'ffz', '243789'],
  ['WeirdChamp', 'ffz', '421124'],
  ['PauseChamp', 'ffz', '557676'],
  ['widepeepoHappy', 'ffz', '270930'],
  ['widepeepoSad', 'ffz', '303899'],
  ['HYPERS', 'ffz', '236895'],
  ['FeelsStrongMan', 'ffz', '64210'],
  ['FeelsWeirdMan', 'ffz', '131597'],
  ['FeelsOkayMan', 'ffz', '145947'],
  ['PepoThink', 'ffz', '174942'],
  ['Okayge', 'ffz', '410314'],
  ['COPIUM', 'ffz', '563443'],
  ['BibleThump', '7tv', '01J8NMZ2HG0005G1FWF2H9Y615'],
  ['PogU', '7tv', '01F6M3N17G000B5V5G2M2RYJN7'],
  ['catJAM', '7tv', '01F6MQ33FG000FFJ97ZB8MWV52', 1],
  ['pepeD', '7tv', '01F2ZWD6CR000DSBG200DM9SGM', 1],
  ['PepePls', '7tv', '01FAJSRS8000093YGWG35GMV60', 1],
  ['ratJAM', '7tv', '01F6QV6G8R0000TEKRM6BFG0Z3', 1],
  ['Clap', '7tv', '01F6NE9AER000CKKT9BSDYGT0J', 1],
  ['NODDERS', '7tv', '01F6MDFCSR0000WDA7ERT623YT', 1],
  ['NOPERS', '7tv', '01EZY51MDR000CYST6006V20T4', 1],
  ['peepoClap', '7tv', '01F6NET6G00009JYTB75QDKV1S', 1],
  ['peepoHappy', '7tv', '01F6RC8C1G0003SBEQ3QZTEE99'],
  ['peepoSad', '7tv', '01FAJVVKXG00093YGWG35VAPNZ'],
  ['Aware', '7tv', '01FFWH9WV80000JT8GHDKHJNZC', 1],
  ['Clueless', '7tv', '01F6T8NM9R0007M5BTFWSP1YSJ'],
  ['xdd', '7tv', '01FF3R5C30000FF5VVCKV49G6J'],
  ['ICANT', '7tv', '01FA0PBXM8000AD7Y8T9ZMTFZ5'],
  ['BatChest', '7tv', '01FH5KYA9R000D4WNXNQW4KVF2'],
  ['GIGACHAD', '7tv', '01F6MZGCNG000255K4X1K7NTHR', 1],
  ['Jammies', '7tv', '01GB5S18QG00090V9B3D8CGHNG', 1],
  ['Stare', '7tv', '01FA0WRBM0000AD7Y8T9ZJEDXQ'],
  ['EZ', '7tv', '01F9FS6EEG0006XXD6DX0K9Y04'],
  ['AYAYA', '7tv', '01F8CTQCZ800099FQVFJ9XQRM1'],
  ['WAYTOODANK', '7tv', '01EZPJ8YRR000C438200A44F2Y', 1],
  ['Bedge', '7tv', '01F6MXJD8R000F76KNAAV5HDGD'],
  ['Deadge', '7tv', '01F8YE5QNR00081476FRV8XDEZ'],
  ['Madge', '7tv', '01F6ASPNM00009TPCEMWQTT4XX'],
  ['Chatting', '7tv', '01FAK9C8MR0004HKF2ZK1YPQ5A', 1],
  ['Listening', '7tv', '01FWR6BNTR0007SGPMW6AKG0Q9', 1],
  ['Smoge', '7tv', '01F6PW2Q180005589X3BDH8408', 1],
  ['Wokege', '7tv', '01FEEK9MRG000FR0PC38FM26SD'],
]

const CDN = {
  twitch: id => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
  bttv: id => `https://cdn.betterttv.net/emote/${id}/2x.webp`,
  ffz: id => `https://cdn.frankerfacez.com/emote/${id}/2`,
  '7tv': id => `https://cdn.7tv.app/emote/${id}/2x.webp`,
}

// The ones people use most come first (picker and Tab completion); the rest keep the list order.
const TOP = 'KEKW Pog OMEGALUL LUL Kappa monkaS PepeLaugh Sadge catJAM PepeHands POGGERS LULW monkaW EZ Clap Aware Clueless ICANT 5Head Pepega FeelsBadMan FeelsGoodMan pepeD COPIUM xdd Okayge Madge Bedge Deadge Stare GIGACHAD BibleThump Kreygasm WeirdChamp PauseChamp widepeepoHappy peepoHappy NODDERS'.split(' ')
const rank = code => { const i = TOP.indexOf(code); return i < 0 ? TOP.length : i }

export const EMOTES = LIST
  .map(([code, p, id, a], i) => ({ code, url: CDN[p](id), animated: !!a, i }))
  .sort((a, b) => rank(a.code) - rank(b.code) || a.i - b.i)
  .map(({ i, ...e }) => e)
const BY_CODE = new Map(EMOTES.map(e => [e.code, e]))

export const emote = word => BY_CODE.get(word) || null

/** Splits plain text into strings and emotes: ["gg ", {code, url}, " wp"]. */
export function withEmotes(text) {
  if (!text) return []
  const out = []
  let buf = ''
  for (const part of text.split(/(\s+)/)) {
    const e = BY_CODE.get(part)
    if (e) { if (buf) out.push(buf); buf = ''; out.push(e) } else buf += part
  }
  if (buf) out.push(buf)
  return out
}

/** 1-3 when the message is nothing but emotes, so it can be shown big; else 0. */
export function emotesOnly(text) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 3) return 0
  return words.every(w => BY_CODE.has(w)) ? words.length : 0
}
