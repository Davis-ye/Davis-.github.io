// Fetches real soccer headlines from multiple outlets + a scoreboard.
// Writes data.json AND generates a standalone article page per story.
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE = 'https://api.football-data.org/v4';
const fs = require('fs');

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
  { url: 'https://www.theguardian.com/football/rss', source: 'The Guardian' },
  { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports' },
  { url: 'https://talksport.com/feed/', source: 'talkSPORT' },
  { url: 'https://www.90min.com/posts.rss', source: '90min' },
  { url: 'https://www.101greatgoals.com/feed/', source: '101 Great Goals' },
  { url: 'https://www.sportslens.com/feed/', source: 'Sportslens' }
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
  return str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&#039;/g,"'").replace(/&quot;/g,'"');
}
function stripTags(str){ return str.replace(/<[^>]*>/g,'').trim(); }
function escHtml(str){
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function firstWords(str, n){
  const words = (str||'').trim().split(/\s+/);
  if(words.length <= n) return words.join(' ');
  return words.slice(0, n).join(' ') + '…';
}

function extractImage(block, descRaw){
  var media = block.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || block.match(/<media:content[^>]*url="([^"]+)"/i);
  if(media) return media[1];
  var enclosure = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image[^"]*"/i);
  if(enclosure) return enclosure[1];
  var img = descRaw.match(/<img[^>]*src="([^"]+)"/i);
  if(img) return img[1];
  return null;
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
    const title = decodeEntities(stripTags(titleRaw.replace('<![CDATA[','').replace(']]>','')));
    const link = linkRaw.replace('<![CDATA[','').replace(']]>','').trim();
    const desc = decodeEntities(stripTags(descRaw.replace('<![CDATA[','').replace(']]>','')));
    const pubDate = pubDateRaw.trim();
    const image = extractImage(block, descRaw);
    if(title && link) items.push({ title, link, desc, pubDate, source: sourceName, image });
  }
  return items;
}

async function fetchTopStories(){
  let all = [];
  for(const feed of NEWS_FEEDS){
    try{
      const res = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (AggregateBot/1.0)' } });
      if(!res.ok){ console.error('Feed failed:', feed.source, res.status); continue; }
      const xml = await res.text();
      all = all.concat(parseRSS(xml, feed.source));
    }catch(e){
      console.error('Feed error:', feed.source, e.message);
    }
  }
  const seen = new Set();
  const deduped = all.filter(item => {
    const key = item.title.toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  return deduped.slice(0, 24).map((item, i) => {
    const league = tagLeague(item.title + ' ' + item.desc);
    return {
      id: 'story-' + i,
      league: league.name,
      dot: league.dot,
      source: item.source,
      time: item.pubDate ? fmtDate(item.pubDate) : '',
      headline: item.title,
      excerpt: firstWords(item.desc, 15),
      link: item.link,
      image: item.image || null
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
  }catch(e){ return []; }
}

function toScoreline(match){
  const comp = match._comp;
  return {
    id: 'score-' + match.id,
    league: comp.name,
    dot: comp.dot,
    time: fmtDate(match.utcDate),
    home: match.homeTeam.name,
    away: match.awayTeam.name,
    homeScore: match.score.fullTime.home,
    awayScore: match.score.fullTime.away
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

function articlePageHTML(story){
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(story.headline)} — Aggregate</title>
<style>
  :root{--bg:#0A1811;--surface:#16301F;--line:#3C5A45;--ink:#FFFFFF;--ink-dim:#E3EBDD;--ink-muted:#AFC4AC;--lime:#D9FF7A;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);}
  body{font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;padding:0 0 60px;font-size:17px;}
  .back{display:inline-block;padding:20px 20px 0;color:var(--ink-muted);text-decoration:none;font-size:14px;}
  .wrap{padding:16px 20px 0;}
  .tag-row{display:flex;align-items:center;gap:7px;font-size:13.5px;color:var(--ink-muted);margin-bottom:12px;font-weight:bold;}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
  h1{font-family:'Arial Narrow',Arial,Helvetica,sans-serif;font-weight:800;font-size:30px;line-height:1.12;margin:0 0 18px;}
  blockquote{border-left:3px solid var(--lime);margin:0 0 22px;padding:4px 0 4px 16px;color:var(--ink-dim);font-style:italic;font-size:17px;line-height:1.5;}
  .note{font-size:14.5px;color:var(--ink-dim);line-height:1.6;margin-bottom:26px;}
  .cta{display:inline-block;background:var(--lime);color:#0A1811;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:4px;font-family:'Arial Narrow',Arial,Helvetica,sans-serif;font-size:15px;letter-spacing:0.3px;}
  .article-img{width:100%;height:200px;object-fit:cover;border-radius:6px;margin:16px 0;display:block;}
</style>
</head>
<body>
<a class="back" href="../index.html">← Back to Aggregate</a>
<div class="wrap">
  <div class="tag-row"><span class="dot" style="background:${story.dot}"></span>${escHtml(story.league)} · ${escHtml(story.source)}${story.time ? ' · ' + story.time : ''}</div>
  <h1>${escHtml(story.headline)}</h1>
  ${story.image ? `<img class="article-img" src="${story.image}" alt="">` : ''}
  ${story.excerpt ? `<blockquote>"${escHtml(story.excerpt)}"</blockquote>` : ''}
  <p class="note">This is a short excerpt. ${escHtml(story.source)} has the complete, original reporting — tap below to read it in full.</p>
  <a class="cta" href="${story.link}" target="_blank" rel="noopener">Read the full story at ${escHtml(story.source)} →</a>
</div>
</body>
</html>`;
}

async function main(){
  if(!API_KEY){ console.error('Missing FOOTBALL_DATA_API_KEY'); process.exit(1); }

  const topStories = await fetchTopStories();
  const scoreboard = await fetchScoreboard();

  fs.mkdirSync('articles', { recursive: true });
  topStories.forEach(story => {
    fs.writeFileSync(`articles/${story.id}.html`, articlePageHTML(story));
  });

  const hero = topStories[0] || null;
  const restStories = topStories.slice(1);

  const output = {
    updatedAt: new Date().toISOString(),
    hero: hero || {
      league: 'Aggregate', dot: '#F0C878', time: '',
      headline: 'Checking for the latest…',
      excerpt: 'This refreshes automatically every few minutes.'
    },
    topStories: restStories,
    scoreboard
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('Updated:', restStories.length, 'stories,', scoreboard.length, 'scores,', topStories.length, 'article pages.');
}

main();
