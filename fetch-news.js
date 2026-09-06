// Fetches recent + upcoming soccer matches and writes them into data.json
// Runs automatically via GitHub Actions (see .github/workflows/update-news.yml)

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE = 'https://api.football-data.org/v4';

const COMPETITIONS = [
  { code: 'PL',  name: 'Premier League',    dot: '#9CC0F0' },
  { code: 'CL',  name: 'Champions League',  dot: '#F0C878' },
  { code: 'SA',  name: 'Serie A',           dot: '#A9E6A0' },
  { code: 'PD',  name: 'La Liga',           dot: '#E3B4F5' },
  { code: 'BL1', name: 'Bundesliga',        dot: '#FFC469' },
  { code: 'FL1', name: 'Ligue 1',           dot: '#B8D4E8' }
];

function pad(n){ return String(n).padStart(2, '0'); }

function fmtDate(iso){
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
function fmtTime(iso){
  const d = new Date(iso);
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchCompetitionMatches(comp, dateFrom, dateTo){
  const url = `${BASE}/competitions/${comp.code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  try{
    const res = await fetch(url, { headers: { 'X-Auth-Token': API_KEY } });
    if(!res.ok){
      console.error(`Skipping ${comp.code}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.matches || []).map(m => ({ ...m, _comp: comp }));
  }catch(e){
    console.error(`Error fetching ${comp.code}:`, e.message);
    return [];
  }
}

function toFinishedArticle(match){
  const comp = match._comp;
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  const hs = match.score.fullTime.home;
  const as = match.score.fullTime.away;
  let headline;
  if(hs > as) headline = `${home} beat ${away} ${hs}-${as}`;
  else if(as > hs) headline = `${away} beat ${home} ${as}-${hs}`;
  else headline = `${home} and ${away} draw ${hs}-${hs}`;
  return {
    id: 'match-' + match.id,
    league: comp.name,
    dot: comp.dot,
    time: fmtDate(match.utcDate),
    headline,
    body: `${home} finished ${hs}-${as} against ${away} in the ${comp.name}, played on ${fmtDate(match.utcDate)}.`,
    _sortDate: match.utcDate
  };
}

function toUpcomingArticle(match){
  const comp = match._comp;
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  return {
    id: 'match-' + match.id,
    league: comp.name,
    dot: comp.dot,
    time: fmtDate(match.utcDate),
    headline: `${home} host ${away} in the ${comp.name}`,
    body: `Kick-off is scheduled for ${fmtDate(match.utcDate)} at ${fmtTime(match.utcDate)}.`,
    _sortDate: match.utcDate
  };
}

async function main(){
  if(!API_KEY){
    console.error('Missing FOOTBALL_DATA_API_KEY environment variable.');
    process.exit(1);
  }

  const now = new Date();
  const past = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const dateFrom = past.toISOString().slice(0, 10);
  const dateTo = future.toISOString().slice(0, 10);

  let allMatches = [];
  for(const comp of COMPETITIONS){
    const matches = await fetchCompetitionMatches(comp, dateFrom, dateTo);
    allMatches = allMatches.concat(matches);
    await sleep(6500); // respect free-tier rate limit (10 requests/minute)
  }

  const finished = allMatches.filter(m => m.status === 'FINISHED');
  const upcoming = allMatches.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED');

  finished.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
  upcoming.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  let hero = null;
  const clFinished = finished.find(m => m._comp.code === 'CL');
  if(clFinished) hero = toFinishedArticle(clFinished);
  else if(finished.length) hero = toFinishedArticle(finished[0]);
  else if(upcoming.length) hero = toUpcomingArticle(upcoming[0]);

  const heroMatchId = hero ? hero.id : null;

  const firstHalf = finished
    .map(toFinishedArticle)
    .filter(a => a.id !== heroMatchId)
    .slice(0, 6);

  const secondHalf = upcoming
    .map(toUpcomingArticle)
    .filter(a => a.id !== heroMatchId)
    .slice(0, 4);

  const output = {
    updatedAt: new Date().toISOString(),
    hero: hero || {
      id: 'placeholder-hero',
      league: 'Aggregate',
      dot: '#F0C878',
      time: 'Quiet spell',
      headline: 'No major matches in the last few days',
      body: 'Check back soon — this updates automatically every few hours.'
    },
    firstHalf,
    secondHalf
  };

  const fs = require('fs');
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('data.json updated:', firstHalf.length, 'recent,', secondHalf.length, 'upcoming.');
}

main();
