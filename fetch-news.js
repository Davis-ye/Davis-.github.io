// Fetches real soccer headlines (top 5 leagues) + a compact scoreboard, writes data.json
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE = 'https://api.football-data.org/v4';

const COMPETITIONS = [
  { code: 'PL',  name: 'Premier League', dot: '#9CC0F0' },
  { code: 'CL',  name: 'Champions League', dot: '#F0C878' },
  { code: 'SA',  name: 'Serie A', dot: '#A9E6A0' },
  { code: 'PD',  name: 'La Liga', dot: '#E3B4F5' },
  { code: 'BL1', name: 'Bundesliga', dot: '#FFC469' },
  { code: 'FL1', name: 'Ligue 1', dot: '#B8D4E8' }
];

const NEWS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport' },
  { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports' }
];

const LEAGUE_KEYWORDS = [
  { name: 'Premier League', dot: '#9CC0F0', words: ['Arsenal','Man City','Manchester City','Man Utd','Man United','Manchester United','Liverpool','Chelsea','Tottenham','Newcastle','Aston Villa','West Ham','Brighton','Everton','Wolves','Fulham','Crystal Palace','Brentford','Nottingham Forest','Bournemouth','Leicester','Southampton','Ipswich','Sunderland','Burnley','Leeds','Premier League'] },
  { name: 'La Liga', dot: '#E3B4F5', words: ['Real Madrid','Barcelona','Atletico Madrid','Atlético Madrid','Sevilla','Real Sociedad','Villarreal','Athletic Bilbao','Valencia','Real Betis','Girona','La Liga'] },
  { name: 'Serie A', dot: '#A9E6A0', words: ['Juventus','AC Milan','Inter Milan','Napoli','Roma','Lazio','Atalanta','Fiorentina','Bologna','Serie A'] },
  { name: 'Bundesliga', dot: '#FFC469', words: ['Bayern Munich','Bayern','Borussia Dortmund','Dortmund','RB Leipzig','Bayer Leverkusen','Leverkusen','Union Berlin','Eintracht Frankfurt','Bundesliga'] },
  { name: 'Ligue 1', dot: '#B8D4E8', words: ['Paris Saint-Germain','PSG','Marseille','Monaco','Lyon','Lille','Nice','Rennes','Ligue 1'] },
  { name: 'Champions League', dot: '#F0C878', words: ['Champions League'] }
];

function tagLeague(text){
  for(const l of LEAGUE_KEYWORDS){
    for(const w of l.words){
      if(text.toLowerCase().includes(w.toLowerCase())) return { name: l.name, dot: l.dot };
    }
  }
  return { name: 'Football', dot: '#AFC4AC' };
}

function pad(n){ return String(n).padStart(2, '0'); }
function fmtDate(iso){
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function decodeEntities(str){
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'").replace(/&quot;/g, '"');
}

function stripTags(str){
  return str.replace(/<[^>]*>/g, '').trim();
}

function parseRSS(xml, sourceName){
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while((match = itemRegex.exec(xml))){
    const block = match[1];
    const titleRaw = (block.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1];
    const linkRaw = (block.match(/<link>([\s\S]*?)<\/link>/) || [, ''])[1];
    const descRaw = (block.match(/<description>([\s\S]*?)<\/description>/) || [, ''])[1];
    const pubDateRaw = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ''])[1];
    const title = decodeEntities(stripTags(titleRaw.replace('<![CDATA[', '').replace(']]>', '')));
    const link = linkRaw.replace('<![CDATA[', '').replace(']]>', '').trim();
    const desc = decodeEntities(stripTags(descRaw.replace('<![CDATA[', '').replace(']]>', ''))).slice(0, 140);
    const pubDate = pubDateRaw.trim();
    if(title && link) items.push({ title, link, desc, pubDate, source: sourceName });
  }
  return items;
}

async function fetchTopStories(){
  let all = [];
  for(const feed of NEWS_FEEDS){
    try{
      const res = await fetch(feed.url);
      if(!res.ok){ console.error('Feed failed:', feed.source, res.status); continue; }
      const xml = await res.text();
      all = all.concat(parseRSS(xml, feed.source));
    }catch(e){
      console.error('Feed error:', feed.source, e.message);
    }
  }
  // De-dupe by title similarity (exact title match)
  const seen = new Set();
  const deduped = all.filter(item => {
    const key = item.title.toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Sort newest first when we have dates
  deduped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  return deduped.slice(0, 12).map((item, i) => {
    const league = tagLeague(item.title + ' ' + item.desc);
    return {
      id: 'story-' + i,
      league: league.name,
      dot: league.dot,
      source: item.source,
      time: item.pubDate ? fmtDate(item.pubDate) : '',
      headline: item.title,
      body: item.desc,
      link: item.link
    };
  });
}

async function fetchCompetitionMatches(comp, dateFrom, dateTo){
  const url = `${BASE}/competitions/${comp.code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=FINISHED`;
  try{
    const res = await fetch(url, { headers: { 'X-Auth-Token': API_KEY } });
    if(!res.ok) return [];
    const data = await res.json();
    return (data.matches || []).map(m => ({ ...m, _comp: comp }));
  }catch(e){
    console.error('Match fetch error:', comp.code, e.message);
    return [];
  }
}

function toScoreline(match){
  const comp = match._comp;
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  const hs = match.score.fullTime.home;
  const as = match.score.fullTime.away;
  return {
    id: 'score-' + match.id,
    league: comp.name,
    dot: comp.dot,
    time: fmtDate(match.utcDate),
    home, away, homeScore: hs, awayScore: as
  };
}

async function fetchScoreboard(){
  const now = new Date();
  const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const dateFrom = past.toISOString().slice(0, 10);
  const dateTo = now.toISOString().slice(0, 10);

  let all = [];
  for(const comp of COMPETITIONS){
    const matches = await fetchCompetitionMatches(comp, dateFrom, dateTo);
    all = all.concat(matches);
    await sleep(6200);
  }
  all.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
  return all.slice(0, 6).map(toScoreline);
}

async function main(){
  if(!API_KEY){
    console.error('Missing FOOTBALL_DATA_API_KEY');
    process.exit(1);
  }

  const topStories = await fetchTopStories();
  const scoreboard = await fetchScoreboard();

  const hero = topStories[0] || null;
  const restStories = topStories.slice(1);

  const output = {
    updatedAt: new Date().toISOString(),
    hero: hero || {
      league: 'Aggregate', dot: '#F0C878', time: '',
      headline: 'Checking for the latest…',
      body: 'This refreshes automatically every few minutes.'
    },
    topStories: restStories,
    scoreboard
  };

  const fs = require('fs');
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('Updated:', restStories.length, 'stories,', scoreboard.length, 'scores.');
}

main();
