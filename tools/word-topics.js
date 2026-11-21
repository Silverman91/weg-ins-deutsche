// Builds word-topics.js: a level and a topic for every word the app teaches (Core deck, level lists, lessons),
// used by the dictionary to search and browse words by level and by topic.
//   level: lesson words take their lesson's level; level-list words their list; Core words come from
//          tools/core-levels.json (made once from the Goethe-Institut A1/A2/B1 lists, frequency for the rest).
//   topic: level-list words written under a themed heading in tools/levels/ ("// health and body") take that
//          heading's topic; everything else is sorted by keywords in its English meaning.
// Output is compact: one character per word, in the same order as the word lists.
// Usage: node tools/word-topics.js [-v]   (-v prints a sample of each topic and the words left without one)
const fs = require("fs"), path = require("path"), vm = require("vm");
const APP = path.join(__dirname, ".."), LV = ["A1", "A2", "B1", "B2", "C1"];

const TOPICS = [
  ["people", "Family & people", "👪"], ["love", "Friends, love & feelings", "💞"], ["home", "Home & household", "🏠"],
  ["food", "Food & drink", "🍽️"], ["money", "Shopping & money", "🛒"], ["work", "Work & business", "💼"],
  ["school", "School & learning", "🎓"], ["health", "Health & body", "🩺"], ["travel", "Travel & transport", "🚆"],
  ["nature", "Nature, weather & animals", "🌿"], ["leisure", "Free time, sport & culture", "🎭"],
  ["media", "Media & technology", "📱"], ["society", "Society & politics", "🏛️"], ["law", "Law & crime", "⚖️"],
  ["talk", "Talking & expressions", "💬"], ["time", "Time & numbers", "🕒"], ["everyday", "Everyday words", "✨"],
];
const CODE = Object.fromEntries(TOPICS.map((t, i) => [t[0], String.fromCharCode(97 + i)])); // a, b, c, …

// Themed headings in tools/levels/*.js -> topic
const SECTION = {
  "abstract nouns and verbs for discussion": "talk", "animals": "nature", "appearance and descriptions": "love",
  "colloquial words and slang": "talk", "connectors and discourse words": "talk", "culture and arts": "leisure",
  "culture, arts and religion": "leisure", "economy and finance": "money", "education": "school",
  "environment and nature": "nature", "everyday compound nouns": null, "fixed noun-verb phrases": "talk",
  "food and cooking": "food", "formal prepositions": "talk", "handling objects": "home", "health and body": "health",
  "health and medicine": "health", "history": "society", "home and objects": "home", "housing": "home", "idioms": "talk",
  "law and administration": "law", "law and crime": "law", "media": "media", "mind and psychology": "love",
  "money": "money", "more verbs": null, "movements": null, "nature": "nature", "news language": "society",
  "people and relationships": "love", "politics and state": "society", "science and research": "school",
  "society and politics": "society", "society and social change": "society", "sounds": null,
  "spoken German: adverbs, fillers, adjectives": "talk", "spoken German: verbs heard in every series": null,
  "sport and leisure": "leisure", "technology": "media", "travel and transport": "travel",
  "ways of seeing and perceiving": null, "ways of speaking": "talk", "work and career": "work", "workplace": "work",
};

// English keywords -> topic, tried in order (first match wins). \b word boundaries; "s?" for plurals.
const RULES = [
  ["people", /\b(mother|father|parents?|son|daughter|brother|sister|siblings?|grand(mother|father|ma|pa|son|daughter|children)|grandma|grandpa|aunt|uncle|cousin|nephew|niece|husband|wife|family|child(ren)?|kids?|baby|man|woman|men|women|boy|girl|person|people|relatives?|twin|widow(er)?|in-law|step(mother|father)|ancestor|descendant|adult|teenager|young person|pensioner|neighbour|mr|mrs|ms|lady|gentleman|name|surname)\b/i],
  ["love", /\b(love|friends?|friendship|boyfriend|girlfriend|partner|date|kiss|hug|marr(y|ied|iage)|wedding|divorce|engaged|jealous|happy|sad|angry|afraid|fear|scared|lonely|proud|ashamed|shame|feel(ing)?s?|emotion|mood|hate|trust|hope|worr(y|ied)|anxious|nervous|calm|shy|polite|rude|kind|mean|honest|lie|cheeky|patient|curious|character|personality|bored|boring|surprised|disappoint|annoy|glad|pleased|excited|upset|cry|laugh|smile|argu(e|ment)|quarrel|apologi[sz]e|forgive|compliment|insult|grateful|envy|pride|tears?)\b/i],
  ["food", /\b(food|eat|drink|meal|breakfast|lunch|dinner|supper|snack|bread|roll|cake|biscuit|butter|cheese|milk|egg|meat|sausage|ham|fish|chicken|beef|pork|vegetables?|fruit|apple|banana|orange|lemon|potato(es)?|tomato(es)?|rice|pasta|noodles?|soup|salad|sauce|sugar|salt|pepper|honey|jam|coffee|tea|juice|water|beer|wine|cook|kitchen|bake|recipe|restaurant|caf[eé]|bakery|menu|waiter|waitress|tasty|delicious|hungry|thirsty|spicy|sweet|sour|bitter|fry|boil|main course|starter|plate|cup|glass|bottle|spoon|fork|knife|pot|pan|chips|fries|pizza|chocolate|ice cream|dessert|vegetarian|vegan|organic)\b/i],
  ["health", /\b(doctor|hospital|ill|sick|illness|disease|ill|pain|hurt|ache|headache|fever|cold|flu|cough|medicine|medicine|tablet|pill|prescription|chemist|pharmacy|nurse|patient|health(y)?|body|head|face|eyes?|ears?|nose|mouth|teeth|tooth|tongue|neck|throat|shoulders?|arms?|hands?|fingers?|legs?|knees?|feet|foot|stomach|belly|heart|blood|skin|bones?|get well|injur(y|ed)|wound|operation|surgery|ambulance|emergency|dentist|therapy|allerg(y|ic)|vaccin|virus|infection|sleep|tired|exhausted|breathe|sweat|pregnan|birth|die|death|dead)\b/i],
  ["home", /\b(house|home|flat|apartment|room|bedroom|bathroom|living room|kitchen|garden|balcony|floor|storey|wall|door|window|stairs|roof|cellar|attic|lift|furniture|table|chair|bed|sofa|couch|cupboard|wardrobe|shelf|drawer|lamp|light|heating|key|lock|rent|tenant|landlord|move house|move in|move out|neighbour|clean|tidy|wash|laundry|iron|vacuum|rubbish|bin|towel|soap|toothbrush|shower|bath|toilet|sink|tap|fridge|oven|cooker|dishwasher|washing machine|tool|hammer|screw|ladder|blanket|pillow|curtain|carpet|mirror|clock)\b/i],
  ["money", /\b(money|pay|paid|payment|price|cost|cheap|expensive|euros?|cents?|cash|card|bank|account|buy|sell|shop|shopping|supermarket|market|store|customer|receipt|bill|invoice|discount|offer|sale|change|wallet|purse|savings|spend|debt|loan|credit|tax|insurance|salary|wage|income|rich|poor|afford|bargain|goods|product|brand|order|deliver|delivery|return|exchange|clothes|clothing|dress|shirt|trousers|jeans|shoes?|coat|jacket|hat|size|try on|tie|stockings?|socks?|underwear|blouse|skirt|sweater|pullover|jumper|gloves?|scarf|boots?|belt|bag|handbag)\b/i],
  ["work", /\b(work|job|office|boss|colleague|employee|employer|staff|company|firm|business|manager|meeting|project|contract|career|profession|occupation|apply|application|interview|cv|unemploy|retire|retirement|shift|overtime|trainee|apprentic|intern|internship|team|department|client|customer service|negotiat|deadline|strike|trade union|factory|industry|produce|production|profit|loss|sales|market|economy|economic|engineer|lawyer|teacher|secretary|mechanic|craftsman|tradesman|chef|cook|farmer|salesman|shop assistant)\b/i],
  ["school", /\b(school|class|lesson|learn|study|student|pupil|teacher|university|college|course|exam|test|homework|grade|mark|subject|book|read|write|pen|pencil|paper|dictionary|word|sentence|language|grammar|science|research|knowledge|educat|degree|certificate|lecture|semester|library|maths?|history|biology|chemistry|physics|question|answer|explain|understand|know|remember|forget)\b/i],
  ["travel", /\b(travel|trip|journey|holiday|vacation|tourist|hotel|hostel|camping|tent|passport|visa|luggage|suitcase|ticket|train|station|platform|bus|tram|underground|metro|taxi|car|bike|bicycle|motorbike|plane|flight|airport|fly|drive|driver|road|street|motorway|traffic|parking|park the car|petrol|map|direction|straight on|corner|crossroads|bridge|abroad|border|customs|arrive|arrival|depart|departure|delay|timetable|connection|ship|boat|ferry|harbour|beach|sea|city|town|village|country|place|sight|museum|church)\b/i],
  ["nature", /\b(weather|rain|snow|sun|sunny|wind|windy|cloud|cloudy|fog|storm|thunder|lightning|hot|cold|warm|temperature|climate|season|spring|summer|autumn|winter|nature|tree|flower|grass|forest|wood|mountain|hill|river|lake|sea|ocean|island|coast|field|earth|sky|star|moon|environment|pollution|recycl|animal|dog|cat|bird|horse|cow|pig|sheep|fish|mouse|insect|bee|plant|garden|landscape|valley|desert|sand|stone|rock)\b/i],
  ["leisure", /\b(hobby|free time|leisure|sport|football|tennis|swim|swimming|run|jog|play|game|music|song|sing|dance|concert|band|guitar|piano|film|movie|cinema|theatre|theater|play|actor|art|painting|museum|exhibition|book|novel|read|photo|camera|party|celebrat|festival|birthday|christmas|easter|holiday|fun|enjoy|relax|walk|hike|hiking|cycling|club|team|match|win|lose|ball|church|religion|god|culture)\b/i],
  ["media", /\b(phone|mobile|smartphone|computer|laptop|internet|online|email|e-mail|website|app|message|text|chat|post|video|tv|television|radio|newspaper|magazine|news|article|media|social media|camera|photo|download|upload|password|screen|keyboard|printer|file|data|technology|digital|device|battery|charge|wifi|wi-fi|network|software|program|click|link|channel|stream|podcast|blog)\b/i],
  ["society", /\b(government|politic|party|election|vote|state|country|nation|citizen|president|chancellor|minister|parliament|law|democra|society|social|public|war|peace|army|soldier|refugee|immigra|integration|religion|history|historical|king|queen|emperor|europe|world|international|protest|demonstrat|crisis|reform|freedom|right|rights|equal|poverty|population)\b/i],
  ["law", /\b(police|crime|criminal|thief|steal|stole|theft|rob|robbery|murder|kill|court|judge|lawyer|guilty|innocent|prison|jail|arrest|suspect|witness|victim|fine|punish|illegal|legal|law|lawsuit|sue|contract|permit|ban|forbid|allowed)\b/i],
  ["time", /\b(time|day|days|week|month|year|hour|minute|second|morning|afternoon|evening|night|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|weekend|early|late|soon|now|then|always|never|often|sometimes|already|still|yet|ago|before|after|during|since|until|calendar|date|o'clock|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|hundred|thousand|million|first|second|third|half|quarter|number|count)\b/i],
  ["talk", /\b(say|said|speak|talk|tell|ask|answer|call|phone call|hello|hi|bye|goodbye|please|thanks|yes|no|ok|okay|sorry|excuse me|well|so|oh|really|maybe|perhaps|probably|of course|certainly|exactly|actually|anyway|but|and|or|because|although|therefore|however|also|too|very|quite|rather|only|just|even|again|not|nothing|something|everything|anything|somebody|nobody|everybody|this|that|these|those|here|there|where|what|who|why|how|which|whose|whom|i|you|he|she|it|we|they|me|him|her|us|them|my|your|his|our|their|mine|yours|word|expression|phrase|idiom|swear|shout|whisper|mean|meaning)\b/i],
];

const ctx = { window: {} }; ctx.window = ctx;
for (const f of ["core-words.js", "level-words.js", "course.js", "lessons-1.js", "lessons-2.js", "lessons-3.js", "lessons-4.js", "lessons-5.js", "lessons-6.js", "lessons-7.js"])
  vm.runInNewContext(fs.readFileSync(path.join(APP, f), "utf8"), ctx, { filename: f });
const CORE = ctx.CORE_WORDS, LEVEL = ctx.LEVEL_WORDS, LESSONS = ctx.LESSONS, PHASES = vm.runInNewContext("PHASES", ctx);
const coreLevels = JSON.parse(fs.readFileSync(path.join(__dirname, "core-levels.json"), "utf8"));

// heading for every entry written under a themed section in tools/levels/
const heading = new Map();
for (const f of fs.readdirSync(path.join(__dirname, "levels")).filter(f => /^words-.*\.js$/.test(f))) {
  let cur = null;
  for (const line of fs.readFileSync(path.join(__dirname, "levels", f), "utf8").split(/\r?\n/)) {
    const h = line.match(/^\/\/ ([a-z].*)$/); if (h) { cur = h[1].trim(); continue; }
    const e = line.match(/^\["((?:[^"\\]|\\.)*)"/); if (e && cur && !heading.has(e[1])) heading.set(e[1], cur);
  }
}
const unknownHeadings = new Set([...heading.values()].filter(h => !(h in SECTION)));
if (unknownHeadings.size) console.log("headings without a topic (add them to SECTION):", [...unknownHeadings].join(" | "));

// match the meaning without notes in brackets ("patient (woman)" is not a family word)
const byKeyword = en => { const e = String(en).replace(/\(.*?\)/g, " "); const t = RULES.find(([, re]) => re.test(e)); return t ? t[0] : null; };
const topicOf = (de, en) => {
  const k = byKeyword(en); if (k === "people") return k; // family words win over their section (Witwe in "people and relationships")
  const h = heading.get(de); const s = h && SECTION[h]; return s || k || "everyday";
};
const enc = t => t ? CODE[t] : "-";
const out = { topics: TOPICS, core: "", coreLevel: "", levels: {}, lessons: {} };
const LCODE = { A1: "1", A2: "2", B1: "3", B2: "4", C1: "5" };
for (const w of CORE) { out.core += enc(topicOf(w[0], w[1])); out.coreLevel += LCODE[coreLevels[w[0]] || "B1"]; }
for (const lv of LV) out.levels[lv] = (LEVEL[lv] || []).map(w => enc(topicOf(w[0], w[1]))).join("");
for (const p of PHASES) for (const l of p.lessons) if (LESSONS[l[0]]) out.lessons[l[0]] = (LESSONS[l[0]].v || []).map(v => enc(topicOf(v[0], v[1]))).join("");

fs.writeFileSync(path.join(APP, "word-topics.js"),
  "// Topic and level for every word, for the dictionary. Built by tools/word-topics.js; one character per word,\n" +
  "// in the same order as CORE_WORDS, LEVEL_WORDS and each lesson's word list ('-' = no topic).\n" +
  "window.WORD_TOPICS = " + JSON.stringify(out) + ";\n");

const all = out.core + Object.values(out.levels).join("") + Object.values(out.lessons).join("");
const counts = Object.fromEntries(TOPICS.map(t => [t[0], [...all].filter(c => c === CODE[t[0]]).length]));
console.log(`${all.length} words · ${[...all].filter(c => c === "-").length} without a topic`, counts);
if (process.argv.includes("-v")) {
  const show = (de, en, t) => `${de.replace(/,\s*-.*$/, "")} (${String(en).split(/[;,]/)[0]})`;
  for (const t of TOPICS) {
    const ws = []; CORE.forEach((w, i) => { if (out.core[i] === CODE[t[0]]) ws.push(show(w[0], w[1])); });
    for (const lv of LV) (LEVEL[lv] || []).forEach((w, i) => { if (out.levels[lv][i] === CODE[t[0]]) ws.push(show(w[0], w[1])); });
    console.log(`\n${t[1]}: ` + ws.filter((_, i) => i % Math.ceil(ws.length / 25) === 0).join(", "));
  }
  const none = []; CORE.forEach((w, i) => { if (out.core[i] === "-") none.push(show(w[0], w[1])); });
  console.log("\nno topic (core sample): " + none.filter((_, i) => i % 20 === 0).join(", "));
}
