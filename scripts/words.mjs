import { readFileSync, writeFileSync } from "fs";

const SOURCE = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt";
const NAMES = "https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/us.txt";
const VERSION = "#cheeseburger-words v3";
const TARGETS = 30000;
const SHORT = "a i am an as at be by do go he hi if in is it me my no of oh ok on or so to up us we".split(" ");
const SLANG = `
u ur ya yo ye uh um ah aw ew eh ha hm mm hmm mhm nah naw yea yeah yep yup nope ok okay okk kk k
lol lmao lmfao lmaoo rofl xd xdd omg omfg wtf wth idk idc ikr ily ilysm ily2 imo imho tbh ngl fr frfr ong istg smh rn btw bc cuz cus coz tho thru
pls plz pwease thx ty tysm np nvm gn gm gnight wyd wbu hbu hru sup wassup ayo ayy ayyy bruh bro bros sis fam
gonna wanna gotta kinda sorta lemme gimme dunno outta tryna finna ima imma aint yall y'all
uwu owo awoo rawr nya nyah mew meow purr hehe hihi haha hahaha heh teehee bleh blegh ugh ughh oof yikes welp
pog poggers gg ggs wp ez lmk hmu ttyl brb afk irl dm dms pfp vc gc ss sus mid bet cap nocap lowkey highkey deadass slay ate periodt
mommy mama momma daddy babe baby bae hun hon sweetie cutie
im ive id youre theyre dont doesnt didnt cant wont isnt wasnt arent werent couldnt wouldnt shouldnt hes shes thats whats lets theres wheres heres youve weve theyve youll theyll itll hed shed wed theyd youd hadnt hasnt havent mustnt neednt whos hows whys
sm gn gm np ik ig ic bf gf bc tf wb hb ly mb nm pp ez dm vc gc ft ma pa da oo ou yh ikr idek idrc ofc obv def deff prolly rly srsly fyi tmi ppl bday bff omw otw wbu atm asap ttys gtg g2g nite tonite ilu luv luvs ur urs cya cyaa sry soz bby babyy hbd tmr tmrw 2day
wdym wym ion iykyk nbd gl hf glhf gj ty4 tyy thnx thanx kys ffs fml stfu ftw goated bussin mewing rizz sigma skibidi delulu ick vibe vibes vibing yass yas sheesh oop oops welp womp bestie besties
emoji emojis emote emotes discord nitro ganna gunna gotchu ofc fs nah ion iont deadass
`.split(/\s+/).filter(Boolean);

const text = process.argv[2] ? readFileSync(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
const nameText = process.argv[3] ? readFileSync(process.argv[3], "utf8") : await (await fetch(NAMES)).text();
const names = new Set(nameText.split(/\r?\n/).map(n => n.trim().toLowerCase()).filter(Boolean));
let rank = 0;
const named = [];
const seen = new Set();
const targets = [];
const known = [];
for (const line of text.split("\n")) {
    const w = line.split(" ")[0]?.trim();
    if (!w || !/^[a-z]+$/.test(w) || seen.has(w)) continue;
    if (w.length < 3 && !SHORT.includes(w)) continue;
    seen.add(w);
    rank++;
    if (names.has(w) && rank > 3000) named.push(w);
    else if (SLANG.includes(w) || targets.length >= TARGETS) known.push(w);
    else targets.push(w);
}
const slang = [...new Set([...SLANG.map(w => w.replace(/'/g, "")), ...named])];
const rest = known.filter(w => !slang.includes(w));
writeFileSync("addons/cheeseburger-words.txt", [VERSION, ...targets, "#known", ...rest, "#slang", ...slang, ""].join("\n"));
console.log(`words: ${targets.length} fix targets, ${rest.length} rare, ${slang.length} slang`);
