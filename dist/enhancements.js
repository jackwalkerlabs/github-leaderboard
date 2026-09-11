const interestPatterns={
 ai:/\b(llm|llms|ai|gpt|chatgpt|neural|machine.learning|deep.learning|pytorch|tensorflow|language.model|inference|embeddings?|diffusion)\b/i,
 cli:/\b(cli|terminal|command.line|shell|console|tui|commandline)\b/i,
 web:/\b(web|browser|frontend|front.end|react|vue|svelte|html|css|http|website|django|flask|javascript|typescript)\b/i,
 data:/\b(database|databases|sqlite|sql|data|dataset|datasets|analytics|pandas|postgres|redis|csv|json|query)\b/i,
 creative:/\b(animation|graphics|rendering|drawing|visualization|image|images|video|audio|music|canvas|3d|game|games)\b/i
};
function matchesInterest(repo,interest){return !interest||Boolean(interestPatterns[interest]?.test([repo.name,repo.description,...(repo.topics||[])].join(' ')));}
let comparisonSelection=[];
function compareMetrics(d){return {stars:d.total_stars,projects:d.repos.length,forks:d.total_forks,followers:d.followers,archived:d.repos.filter(r=>r.archived).length,largestShare:d.total_stars?d.repos[0].stargazers_count/d.total_stars*100:0};}
function comparisonHTML(list){
 const rows=[['Total stars','stars'],['Eligible projects','projects'],['Total forks','forks'],['Followers','followers'],['Archived projects','archived']];
 return `<div class="comparison-table-wrap"><table class="comparison-table"><caption class="visually-hidden">Developer metrics across all eligible personal repositories</caption><thead><tr><th scope="col">Metric</th>${list.map(d=>`<th scope="col"><img src="${esc(d.avatar_url)}" alt="" width="42" height="42"><strong>${esc(d.name||d.login)}</strong><span>@${esc(d.login)}</span></th>`).join('')}</tr></thead><tbody>${rows.map(([label,key])=>{const max=Math.max(1,...list.map(d=>compareMetrics(d)[key]));return `<tr><th scope="row">${label}</th>${list.map(d=>`<td><strong>${num(compareMetrics(d)[key])}</strong><div class="compare-bar" aria-hidden="true"><span style="width:${compareMetrics(d)[key]/max*100}%"></span></div></td>`).join('')}</tr>`;}).join('')}<tr><th scope="row">Most-starred project</th>${list.map(d=>`<td><a href="${esc(d.repos[0].html_url)}" target="_blank" rel="noopener noreferrer">${esc(d.repos[0].name)} ↗</a><small>${num(d.repos[0].stargazers_count)} stars</small></td>`).join('')}</tr><tr><th scope="row">Stars in top project</th>${list.map(d=>`<td>${compareMetrics(d).largestShare.toFixed(1)}%</td>`).join('')}</tr><tr><th scope="row">Snapshot date</th>${list.map(d=>`<td>${date(d.fetched_at||snapshot)}</td>`).join('')}</tr></tbody></table></div><p class="compare-footnote">A developer with projects under an organization may have a smaller personal total. Filters on the leaderboard do not apply to this comparison. Bars use a separate scale for each metric.</p>`;
}
function renderComparison(){
 const names=['compare-one','compare-two','compare-three'].map(id=>el(id).value).filter(Boolean);
 const list=names.map(name=>developers.find(d=>d.login===name)).filter(Boolean);
 const valid=list.length>=2&&new Set(names).size===names.length;
 el('compare-error').textContent=valid?'':'Choose at least two different developers.';el('compare-content').innerHTML=valid?comparisonHTML(list):'';el('copy-comparison').disabled=!valid;
 if(valid){comparisonSelection=names;history.replaceState(null,'','#compare='+names.map(encodeURIComponent).join(','));}el('comparison-copy-status').textContent='';
}
function openComparison(names){
 const picks=(names?.length?names:comparisonSelection.length?comparisonSelection:developers.slice(0,2).map(d=>d.login)).filter(n=>developers.some(d=>d.login===n)).slice(0,3);
 if(picks.length<2){const other=developers.find(d=>d.login!==picks[0]);if(other)picks.push(other.login);}
 if(el('profile-dialog').open)el('profile-dialog').close();
 ['compare-one','compare-two','compare-three'].forEach((id,i)=>el(id).value=picks[i]||'');renderComparison();if(!el('compare-dialog').open)el('compare-dialog').showModal();
}
function csvCell(value){let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function exportRows(){
 const list=sortDevelopers(filteredDevelopers());
 if(state.view==='developers')return [['Developer','GitHub username','Matching projects','Stars','Forks','Profile URL','Snapshot date'],...list.map(d=>[d.name||d.login,d.login,d.repos.length,d.total_stars,d.total_forks,d.html_url,d.fetched_at||snapshot])];
 const repos=list.flatMap(d=>d.repos.map(r=>({d,r}))).sort((a,b)=>state.sort==='recent'?(Date.parse(b.r.pushed_at)||0)-(Date.parse(a.r.pushed_at)||0):state.sort==='forks'?b.r.forks_count-a.r.forks_count:b.r.stargazers_count-a.r.stargazers_count);
 return [['Repository','Owner','Stars','Forks','Language','License','Archived','Last push','URL','Snapshot date'],...repos.map(({d,r})=>[r.name,d.login,r.stargazers_count,r.forks_count,r.language,r.license.spdx_id,r.archived,r.pushed_at,r.html_url,d.fetched_at||snapshot])];
}
function initEnhancements(){
 el('date-range').addEventListener('change',e=>{state.dateRange=e.target.value;state.page=1;el('custom-dates').hidden=state.dateRange!=='custom';render();});
 for(const [id,key] of [['date-from','dateFrom'],['date-to','dateTo']]){el(id).max=new Date(snapshot).toISOString().slice(0,10);el(id).addEventListener('change',e=>{state[key]=e.target.value;state.page=1;render();});}

 document.querySelectorAll('[data-interest]').forEach(b=>b.addEventListener('click',()=>{state.interest=b.dataset.interest;state.page=1;render();}));
 el('min-stars').addEventListener('change',e=>{state.minStars=Number(e.target.value);state.page=1;render();});
 const options=[...developers].sort((a,b)=>(a.name||a.login).localeCompare(b.name||b.login)).map(d=>`<option value="${esc(d.login)}">${esc(d.name||d.login)} (@${esc(d.login)})</option>`).join('');
 for(const id of ['compare-one','compare-two','compare-three']){el(id).insertAdjacentHTML('beforeend',options);el(id).addEventListener('change',renderComparison);}
 el('compare-open').addEventListener('click',()=>openComparison());el('compare-close').addEventListener('click',()=>el('compare-dialog').close());el('compare-dialog').addEventListener('close',()=>{if(location.hash.startsWith('#compare='))history.replaceState(null,'',location.pathname+location.search);});
 document.addEventListener('click',e=>{const button=e.target.closest('[data-compare-person]');if(button)openComparison([button.dataset.comparePerson]);});
 el('copy-comparison').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);el('comparison-copy-status').textContent='Link copied';}catch{el('comparison-copy-status').textContent='Copy the URL from your address bar.';}});
 el('export-data').addEventListener('click',()=>{const csv=exportRows().map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`starboard-${state.view}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('compare'))openComparison(hash.get('compare').split(','));
}
function dateBounds(){
 const end=new Date(snapshot),day=86400000,today=Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate()),year=end.getUTCFullYear(),month=end.getUTCMonth();
 const ranges={all:[-Infinity,Infinity],today:[today,end.getTime()], '7d':[today-6*day,end.getTime()], '30d':[today-29*day,end.getTime()],year:[Date.UTC(year,0,1),end.getTime()], 'last-year':[Date.UTC(year-1,0,1),Date.UTC(year,0,1)-1], 'last-month':[Date.UTC(year,month-1,1),Date.UTC(year,month,1)-1]};
 const monday=today-((end.getUTCDay()+6)%7)*day;ranges['last-week']=[monday-7*day,monday-1];
 if(state.dateRange==='custom'){
  if(!state.dateFrom||!state.dateTo)return null;
  const from=Date.parse(state.dateFrom+'T00:00:00Z'),to=Date.parse(state.dateTo+'T23:59:59.999Z');
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>to||from>end.getTime()||Date.parse(state.dateTo+'T00:00:00Z')>today)return null;
  return [from,Math.min(to,end.getTime())];
 }
 return ranges[state.dateRange]||ranges.all;
}
function matchesDate(repo){if(state.dateRange==='all')return true;const bounds=dateBounds(),pushed=Date.parse(repo.pushed_at);return Boolean(bounds&&Number.isFinite(pushed)&&pushed>=bounds[0]&&pushed<=bounds[1]);}
function updateDateCaption(){
 const bounds=dateBounds();el('date-error').hidden=Boolean(bounds);el('date-error').textContent=bounds?'':'Choose both dates in order, no later than the dataset date.';
 el('date-caption').textContent=state.dateRange==='all'?`Last project push · as of ${date(snapshot)} (UTC). Stars are all-time totals.`:bounds?`Last push: ${date(bounds[0])} – ${date(bounds[1])} (UTC). Stars are all-time totals.`:'Stars are all-time totals; activity dates filter the projects included.';
}
