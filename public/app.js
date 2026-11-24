"use strict";
/* ---------------- constants ---------------- */
const EXP=[{k:"none",l:"I don't play piano"},{k:"avg",l:"I'm average"},{k:"good",l:"I play well"},{k:"owen",l:"I'm Owen"}];
const DEV=[{k:"hp",l:"Headphones"},{k:"spk",l:"Speakers"},{k:"laptop",l:"Laptop or phone speakers"}];
const LENS=[{k:120000,l:"2 minutes",s:"About 12 slips"},{k:240000,l:"4 minutes",s:"About 25 slips"},{k:0,l:"The whole piece",s:"6:49 · about 40 slips"}];
const WINDOW_MAX=3000;          // longest press window the dashboard can use
const SERIES=["var(--s1)","var(--s2)","var(--s3)","var(--s4)"];
const NOTE_NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const noteName=p=>NOTE_NAMES[p%12]+(Math.floor(p/12)-1);
const fmtT=ms=>{ms=Math.max(0,ms);const s=Math.floor(ms/1000);return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};

/* ---------------- routing ---------------- */
function route(){
  const r=location.hash==="#results"?"results":"test";
  $("view-test").hidden=r!=="test"; $("view-results").hidden=r!=="results";
  $("tab-test").removeAttribute("aria-current"); $("tab-results").removeAttribute("aria-current");
  if(r==="test")$("tab-test").setAttribute("aria-current","page"); else $("tab-results").setAttribute("aria-current","page");
  if(r==="results")renderDash();
}
addEventListener("hashchange",route);

/* ---------------- setup options ---------------- */
function radios(el,name,list,checked){
  el.innerHTML=list.map(o=>`<label class="opt"><input type="radio" name="${name}" value="${o.k}" ${String(o.k)===String(checked)?"checked":""}><span>${esc(o.l)}${o.s?`<small>${esc(o.s)}</small>`:""}</span></label>`).join("");
}
const prev=store.get("slip-setup")||{};
radios($("opt-exp"),"exp",EXP,prev.exp);
radios($("opt-dev"),"dev",DEV,prev.dev||"hp");
radios($("opt-len"),"len",LENS,prev.len!=null?prev.len:120000);
const formVal=n=>{const e=document.querySelector(`input[name=${n}]:checked`);return e?e.value:null};
$("setup").addEventListener("change",updateGo);

/* ---------------- song ---------------- */
let SONG=null; // {T,P,D,ch,dn,pg,ng,end}
async function loadSong(){
  const r=await fetch("song.json"); const j=await r.json();
  const n=j.notes, T=n.map(x=>x[0]), P=n.map(x=>x[1]), D=n.map(x=>x[3]);
  const N=T.length, ch=new Array(N), dn=new Array(N), pg=new Array(N), ng=new Array(N);
  for(let i=0;i<N;i++){
    let c=0,d=0,j2;
    for(j2=i-1;j2>=0&&T[i]-T[j2]<=25;j2--)c++;
    for(j2=i+1;j2<N&&T[j2]-T[i]<=25;j2++)c++;
    ch[i]=c>0?1:0;
    for(j2=i;j2>=0&&T[j2]>T[i]-1000;j2--)d++;
    for(j2=i+1;j2<N&&T[j2]<T[i]+1000;j2++)d++;
    dn[i]=d/2;
    let a=i-1;while(a>=0&&T[i]-T[a]<=25)a--; pg[i]=a>=0?T[i]-T[a]:9999;
    let b=i+1;while(b<N&&T[b]-T[i]<=25)b++; ng[i]=b<N?T[b]-T[i]:9999;
  }
  // ---- making the flat MIDI sound played (same for every listener, never tied to the slips) ----
  // The MIDI is 160 bpm in 4/4 (beat 375 ms, bar 1500 ms) and every note has velocity 50.
  const BEAT=375, BAR=1500, HALF=750;
  const near=(t,g)=>{const r=t%g;return r<25||r>g-25};
  const vel=new Array(N), pedalUp=new Array(N);
  for(let i=0;i<N;i++){
    let v=50;
    if(near(T[i],BAR))v+=10; else if(near(T[i],BEAT))v+=5;      // natural beat accents
    if(ch[i])v+=8;                                              // the chords are the sforzandos
    if(P[i]<48)v+=4;                                            // bass a little fuller
    v+=5*Math.sin(2*Math.PI*T[i]/(BAR*8));                      // gentle 8-bar swell
    vel[i]=Math.max(30,Math.min(90,v));
    // sustain pedal: changed every half bar, the way this movement is usually pedalled
    pedalUp[i]=(Math.floor((T[i]+25)/HALF)+1)*HALF+30;
  }
  SONG={T,P,D,ch,dn,pg,ng,vel,pedalUp,end:T[N-1]+D[N-1]};
}

/* ---------------- piano samples ----------------
   Salamander Grand Piano (Yamaha C5, CC-BY 3.0, Alexander Holm): one recording every
   3 semitones, at 3 of its 16 loudness layers. Each note uses the nearest recording
   (at most 1 semitone away) and the layer that matches how hard it's played. */
const LAYERS=[{v:6,upTo:52},{v:9,upTo:63},{v:12,upTo:999}];
const AC=window.AudioContext||window.webkitAudioContext;
const ctx=new AC({latencyHint:"interactive"});
const SAMPLE_NAMES={0:"C",3:"Ds",6:"Fs",9:"A"};
const SAMPLES={}; // layer -> [{midi, buffer, onset}]
let pianoReady=false;
// MP3 files start with a little silence that differs per file. Find where the
// hammer actually hits so every note's attack lands exactly on its scheduled time.
function findOnset(buf){
  const chs=[];for(let c=0;c<buf.numberOfChannels;c++)chs.push(buf.getChannelData(c));
  const n=Math.min(buf.length,Math.floor(buf.sampleRate*0.5));
  let pk=0;for(let i=0;i<n;i++)for(const d of chs)pk=Math.max(pk,Math.abs(d[i]));
  const th=pk*0.03;
  for(let i=0;i<n;i++)for(const d of chs)if(Math.abs(d[i])>th)return Math.max(0,i/buf.sampleRate-0.001);
  return 0;
}
async function buildPiano(){
  const list=[];
  const lo=Math.min(...SONG.P)-2, hi=Math.max(...SONG.P)+2;
  for(const L of LAYERS){ SAMPLES[L.v]=[];
    for(let oct=1;oct<=7;oct++)for(const pc of [0,3,6,9]){const midi=12*(oct+1)+pc; if(midi>=lo&&midi<=hi)list.push({midi,layer:L.v,file:"samples/"+SAMPLE_NAMES[pc]+oct+"v"+L.v+".mp3"});} }
  const need=list;
  let done=0;
  await Promise.all(need.map(async s=>{
    const r=await fetch(s.file); if(!r.ok)throw new Error("missing "+s.file);
    const buffer=await ctx.decodeAudioData(await r.arrayBuffer());
    SAMPLES[s.layer].push({midi:s.midi,buffer,onset:findOnset(buffer)});
    done++; $("go").textContent=`Loading piano… ${Math.round(100*done/need.length)}%`;
  }));
  pianoReady=true; updateGo();
}
function sampleFor(p,v){
  const L=LAYERS.find(l=>v<=l.upTo), list=SAMPLES[L.v];
  let best=list[0];
  for(const s of list)if(Math.abs(s.midi-p)<Math.abs(best.midi-p))best=s;
  return {s:best,layer:L};
}
// a short, quiet room reverb so the dry samples don't sound boxy (doesn't move note onsets)
function makeReverb(){
  // a small concert-room tail: 12 ms pre-delay, darker as it decays, different per ear
  const sr=ctx.sampleRate, len=Math.floor(sr*2.0), pre=Math.floor(sr*0.012), ir=ctx.createBuffer(2,len,sr);
  for(let c=0;c<2;c++){const d=ir.getChannelData(c);let lp=0;
    for(let i=pre;i<len;i++){const x=(i-pre)/(len-pre);const k=0.55-0.45*x;lp+=k*((Math.random()*2-1)-lp);d[i]=lp*Math.pow(1-x,2.6);}}
  const cv=ctx.createConvolver(); cv.buffer=ir; return cv;
}

/* ---------------- results storage (local server: server.js → results.json) ---------------- */
let uid=store.get("slip-pid");
if(!uid){uid="p"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);store.set("slip-pid",uid)}
let runsDocs=[], dbState="loading", canSave=true;
async function loadResults(){
  try{
    const r=await fetch("api/results",{cache:"no-store"}); if(!r.ok)throw new Error(r.status);
    const j=await r.json();
    runsDocs=Object.entries(j.participants||{}).map(([id,v])=>({id,data:v}));
    dbState="ok";
  }catch(e){dbState=location.protocol==="file:"?"none":"error"}
  renderDash();
}
function showAccess(){
  const n=$("access-note");
  if(location.protocol==="file:"){n.hidden=false;n.className="notice warn";n.textContent="This page was opened as a file, so the piano can't load and results can't be saved. Close it, double-click start.bat in the project folder, and use the page it opens.";}
  else n.hidden=true;
}
let saveChain=Promise.resolve();
function queueSave(att){ saveChain=saveChain.catch(()=>{}).then(()=>doSave(att)); return saveChain; }
async function doSave(att,retry){
  try{
    const r=await fetch("api/attempt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pid:uid,attempt:att}),keepalive:JSON.stringify(att).length<60000});
    if(!r.ok)throw {code:"server "+r.status};
    loadResults();
    return "ok";
  }catch(e){
    if(!retry){await new Promise(r=>setTimeout(r,800));return doSave(att,true)}
    throw e.code?e:{code:"no connection to server"};
  }
}

/* ---------------- test run ---------------- */
let run=null;
function updateGo(){
  const ok=pianoReady&&formVal("exp");
  $("go").disabled=!ok;
  if(pianoReady)$("go").textContent="Go";
  $("go-hint").textContent=!pianoReady?"Preparing the piano sound…":(formVal("exp")?"Press the button whenever something sounds off. Pressing at random hurts your results.":"Pick an experience level to start.");
}
function rnd(a,b){return a+Math.random()*(b-a)}
function planRun(limit){
  const {T,P,D}=SONG, N=T.length;
  const shift=new Float64Array(N); const mistakes=[];
  let next=rnd(4000,8000), i=0;
  while(next<limit-WINDOW_MAX-500){
    while(i<N&&T[i]<next)i++;
    if(i>=N)break;
    const mag=1+Math.floor(Math.random()*200), d=Math.random()<0.5?-mag:mag;
    shift[i]=d;
    mistakes.push({i,t:T[i]+d,o:T[i],d,p:P[i],ch:SONG.ch[i],dn:SONG.dn[i],pg:SONG.pg[i],ng:SONG.ng[i]});
    next=T[i]+rnd(6000,12000);
  }
  const ev=[]; for(let k=0;k<N;k++){ if(T[k]>=limit)break; const on=T[k]+shift[k]; ev.push({t:on,p:P[k],v:SONG.vel[k],end:Math.max(on+D[k],SONG.pedalUp[k])}); }
  ev.sort((a,b)=>a.t-b.t);
  return {mistakes,ev};
}
function playNote(when,p,v,rel){
  const {s,layer}=sampleFor(p,v);
  const rate=Math.pow(2,(p-s.midi)/12);
  const src=ctx.createBufferSource(); src.buffer=s.buffer; src.playbackRate.value=rate;
  // fine loudness inside the chosen layer
  const g=ctx.createGain(); const vol=0.42*Math.pow(v/55,1.3);
  g.gain.setValueAtTime(vol,when);
  // damper comes down when the key is up AND the pedal has been changed
  rel=Math.max(rel,when+0.06);
  g.gain.setValueAtTime(vol,rel); g.gain.setTargetAtTime(0,rel,0.09);
  src.connect(g); g.connect(run.master);
  src.start(when,s.onset);
  src.stop(Math.min(when+(s.buffer.duration-s.onset)/rate,rel+1.2));
}
const songMs=()=>run?(ctx.currentTime-run.t0)*1000-((ctx.outputLatency||0)*1000):0;
let ticker=null;
function startTicker(fn){
  try{ const w=new Worker(URL.createObjectURL(new Blob(["setInterval(()=>postMessage(0),25)"],{type:"text/javascript"}))); w.onmessage=fn; ticker={stop:()=>w.terminate()}; }
  catch(e){ const h=setInterval(fn,25); ticker={stop:()=>clearInterval(h)}; }
}
async function startRun(){
  const exp=formVal("exp"), dev=formVal("dev"), lenSel=Number(formVal("len"));
  store.set("slip-setup",{exp,dev,len:lenSel});
  if(ctx.state!=="running")await ctx.resume();
  const limit=lenSel>0?Math.min(lenSel,SONG.end):SONG.end;
  const plan=planRun(limit);
  const master=ctx.createGain(); master.gain.value=0.9;
  const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-12; comp.ratio.value=3; comp.attack.value=0.003;
  const verb=makeReverb(), wet=ctx.createGain(); wet.gain.value=0.14;
  master.connect(comp); master.connect(verb); verb.connect(wet); wet.connect(comp); comp.connect(ctx.destination);
  run={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),exp,dev,len:lenSel,limit,endMs:limit+1500,
    start:new Date().toISOString(),t0:ctx.currentTime+0.4,ev:plan.ev,ptr:0,mistakes:plan.mistakes,clicks:[],master,comp,buffers:{},lastSave:0,finished:false};
  $("stage-setup").hidden=true; $("stage-done").hidden=true; $("stage-play").hidden=false;
  $("t-end").textContent=fmtT(limit); $("presses").textContent="0 presses";
  $("play-label").textContent=EXP.find(e=>e.k===exp).l+" · "+DEV.find(d=>d.k===dev).l;
  $("heard").focus({preventScroll:true});
  startTicker(tick);
  tick();
}
function tick(){
  if(!run||run.finished)return;
  const now=ctx.currentTime, horizon=(now-run.t0+1.2)*1000;
  while(run.ptr<run.ev.length&&run.ev[run.ptr].t<horizon){ const e=run.ev[run.ptr++]; playNote(run.t0+e.t/1000,e.p,e.v,run.t0+e.end/1000); }
  const ms=songMs();
  $("bar").style.width=Math.min(100,100*ms/run.limit)+"%";
  $("t-now").textContent=fmtT(Math.min(ms,run.limit));
  if(ms-run.lastSave>60000){ run.lastSave=ms; queueSave(snapshot(false)).catch(()=>{}); }
  if(ms>=run.endMs)finish(true);
}
function press(){
  if(!run||run.finished)return;
  const ms=Math.round(songMs()); if(ms<0)return;
  const last=run.clicks[run.clicks.length-1]; if(last!=null&&ms-last<120)return;
  run.clicks.push(ms);
  $("presses").textContent=run.clicks.length+(run.clicks.length===1?" press":" presses");
  const b=$("heard"); b.classList.add("hit"); setTimeout(()=>b.classList.remove("hit"),110);
}
function snapshot(done){
  const listened=Math.round(Math.max(0,Math.min(songMs(),run.limit+1500)));
  return {id:run.id,v:1,snd:2,exp:run.exp,dev:run.dev,len:run.len,start:run.start,listened,done,
    m:run.mistakes.filter(m=>m.t+WINDOW_MAX<=listened).map(m=>({t:Math.round(m.t),d:m.d,p:m.p,ch:m.ch,dn:m.dn,pg:m.pg,ng:m.ng})),
    c:run.clicks.slice()};
}
function finish(done){
  if(!run||run.finished)return;
  const att=snapshot(done); run.finished=true; if(ticker)ticker.stop();
  const m=run.master; m.gain.setTargetAtTime(0,ctx.currentTime,0.05); setTimeout(()=>{try{m.disconnect();run&&run.comp.disconnect()}catch(e){}},400);
  showDone(att);
  const st=$("save-state"); st.className="save-state"; st.textContent="Saving…";
  queueSave(att).then(r=>{
    if(r==="skipped"){st.className="save-state err";st.textContent="Not saved.";}
    else{st.className="save-state ok";st.textContent="Saved. Your attempt is now in the results.";}
  }).catch(e=>{st.className="save-state err";st.textContent="Couldn't save this attempt ("+((e&&e.code)||"error")+"). Check your connection and press Retry.";
    const r=document.createElement("button");r.className="btn";r.textContent="Retry";r.style.marginLeft="8px";r.onclick=()=>{r.remove();st.textContent="Saving…";queueSave(att).then(()=>{st.className="save-state ok";st.textContent="Saved."}).catch(()=>{st.className="save-state err";st.textContent="Still couldn't save."})};st.appendChild(r);});
}
function scoreAttempt(a,win,minRT){
  const ms=a.m||[], cs=a.c||[]; let fp=0;
  for(const c of cs){ if(!ms.some(m=>c>=m.t&&c<=m.t+win))fp++; }
  const det=ms.map(m=>{const c=cs.find(c=>c>=m.t+minRT&&c<=m.t+win);return c==null?null:c-m.t});
  return {fp,det};
}
function showDone(att){
  $("stage-play").hidden=true; $("stage-done").hidden=false;
  const s=scoreAttempt(att,WINDOW_MAX,100);
  const caught=s.det.filter(x=>x!=null).length;
  const caughtD=att.m.filter((m,i)=>s.det[i]!=null).map(m=>Math.abs(m.d));
  const missedD=att.m.filter((m,i)=>s.det[i]==null).map(m=>Math.abs(m.d));
  const rts=s.det.filter(x=>x!=null);
  const tiles=[
    [caught+" / "+att.m.length,"slips you caught"],
    [caughtD.length?Math.min(...caughtD)+" ms":"–","smallest slip you caught"],
    [missedD.length?Math.max(...missedD)+" ms":"–","biggest slip you missed"],
    [s.fp,"presses with no slip nearby"],
    [rts.length?Math.round(rts.reduce((a,b)=>a+b,0)/rts.length)+" ms":"–","average reaction time"]
  ];
  $("done-grid").innerHTML=tiles.map(t=>`<div class="stat"><div class="v">${esc(t[0])}</div><div class="k">${esc(t[1])}</div></div>`).join("");
  $("done-sub").textContent=att.done?"You listened to the whole selection.":"You stopped early. Everything you heard up to that point still counts.";
}
$("go").addEventListener("click",()=>{startRun().catch(e=>{$("go-hint").textContent="Audio couldn't start: "+e.message})});
$("stop").addEventListener("click",()=>finish(false));
$("again").addEventListener("click",()=>{run=null;$("stage-done").hidden=true;$("stage-setup").hidden=false;updateGo();scrollTo(0,0)});
$("heard").addEventListener("pointerdown",e=>{e.preventDefault();press()});
$("heard").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();press()}});
addEventListener("keydown",e=>{ if(run&&!run.finished&&(e.code==="Space"||e.key===" ")){ e.preventDefault(); if(!e.repeat)press(); } });
addEventListener("keyup",e=>{ if(run&&(e.code==="Space"||e.key===" "))e.preventDefault(); });
addEventListener("pagehide",()=>{ if(run&&!run.finished){ queueSave(snapshot(false)).catch(()=>{}); } });

/* ---------------- dashboard ---------------- */
const SPLITS={
  exp:{l:"Experience level",keys:EXP.map(e=>e.k),label:k=>EXP.find(e=>e.k===k).l,of:r=>r.exp},
  dir:{l:"Early vs late",keys:["early","late"],label:k=>k==="early"?"Early":"Late",of:r=>r.d<0?"early":"late"},
  half:{l:"Top vs bottom half of octave",keys:["bottom","top"],label:k=>k==="bottom"?"Bottom half (C–F)":"Top half (F#–B)",of:r=>r.p%12<6?"bottom":"top"},
  reg:{l:"Low vs high register",keys:["low","high"],label:k=>k==="low"?"Below middle C":"Middle C and up",of:r=>r.p<60?"low":"high"},
  chord:{l:"Single note vs chord",keys:["single","chord"],label:k=>k==="single"?"Single note":"Part of a chord",of:r=>r.ch?"chord":"single"},
  dev:{l:"Listening device",keys:DEV.map(d=>d.k),label:k=>DEV.find(d=>d.k===k).l,of:r=>r.dev},
  none:{l:"Everyone together",keys:["all"],label:()=>"All selected attempts",of:()=>"all"}
};
const OCTS=[1,2,3,4,5,6];
const DEFAULTS={exp:EXP.map(e=>e.k),dev:DEV.map(d=>d.k),mine:false,fpm:31,fps:100,minl:30,inc:true,silent:false,
  dir:["early","late"],dmin:1,dmax:200,chord:["single","chord"],gap:0,dnmin:0,dnmax:40,half:["bottom","top"],reg:["low","high"],oct:OCTS.slice(),pmin:29,pmax:88,smin:0,smax:410,order:["first","rest"],
  split:"exp",bin:10,win:3000,rt:100,minn:3};
let F=Object.assign({},DEFAULTS,store.get("slip-filters")||{});
function chips(id,key,opts){
  const el=$(id);
  el.innerHTML=opts.map(o=>`<button type="button" class="chip" data-v="${o.k}" aria-pressed="${F[key].map(String).includes(String(o.k))}">${esc(o.l)}</button>`).join("");
  el.onclick=e=>{const b=e.target.closest(".chip");if(!b)return;const v=b.dataset.v;const cur=F[key].map(String);
    const isNum=typeof DEFAULTS[key][0]==="number";
    let nx=cur.includes(v)?cur.filter(x=>x!==v):cur.concat(v); if(!nx.length)return;
    F[key]=isNum?nx.map(Number):nx; b.setAttribute("aria-pressed",String(F[key].map(String).includes(v))); changed();};
}
function buildFilters(){
  chips("f-exp","exp",EXP); chips("f-dev","dev",DEV);
  chips("f-dir","dir",[{k:"early",l:"Early"},{k:"late",l:"Late"}]);
  chips("f-chord","chord",[{k:"single",l:"Single note"},{k:"chord",l:"In a chord"}]);
  chips("f-half","half",[{k:"bottom",l:"Bottom (C–F)"},{k:"top",l:"Top (F#–B)"}]);
  chips("f-reg","reg",[{k:"low",l:"Below middle C"},{k:"high",l:"Middle C & up"}]);
  chips("f-oct","oct",OCTS.map(o=>({k:o,l:"C"+o+"–B"+o})));
  chips("f-order","order",[{k:"first",l:"First slip"},{k:"rest",l:"Later slips"}]);
  $("f-split").innerHTML=Object.entries(SPLITS).map(([k,s])=>`<option value="${k}">${esc(s.l)}</option>`).join("");
  const vals={"f-mine":"mine","f-fpm":"fpm","f-fps":"fps","f-minl":"minl","f-inc":"inc","f-silent":"silent","f-dmin":"dmin","f-dmax":"dmax","f-gap":"gap","f-dnmin":"dnmin","f-dnmax":"dnmax","f-pmin":"pmin","f-pmax":"pmax","f-smin":"smin","f-smax":"smax","f-split":"split","f-bin":"bin","f-win":"win","f-rt":"rt","f-minn":"minn"};
  for(const [id,k] of Object.entries(vals)){
    const el=$(id);
    if(el.type==="checkbox")el.checked=!!F[k]; else el.value=F[k];
    el.addEventListener("input",()=>{
      F[k]=el.type==="checkbox"?el.checked:(k==="split"?el.value:Number(el.value));
      // keep paired ranges ordered
      const pairs=[["dmin","dmax"],["dnmin","dnmax"],["pmin","pmax"],["smin","smax"]];
      for(const [a,b] of pairs){ if(F[a]>F[b]){ if(k===a){F[b]=F[a];$( "f-"+b).value=F[b]} else {F[a]=F[b];$("f-"+a).value=F[a]} } }
      changed();
    });
  }
  $("f-reset").onclick=()=>{F=JSON.parse(JSON.stringify(DEFAULTS));buildFilters();changed()};
  outputs();
}
function outputs(){
  $("o-fpm").textContent=F.fpm>=31?"no limit":F.fpm;
  $("o-fps").textContent=F.fps>=100?"no limit":F.fps+"%";
  $("o-minl").textContent=F.minl+" s";
  $("o-dr").textContent=F.dmin+"–"+F.dmax+" ms";
  $("o-gap").textContent=F.gap+" ms";
  $("o-dn").textContent=F.dnmin+"–"+(F.dnmax>=40?"40+":F.dnmax);
  $("o-pr").textContent=noteName(F.pmin)+"–"+noteName(F.pmax);
  $("o-st").textContent=fmtT(F.smin*1000)+"–"+fmtT(F.smax*1000);
  $("o-win").textContent=(F.win/1000).toFixed(F.win%1000?2:1).replace(/0$/,"")+" s";
  $("o-rt").textContent=F.rt+" ms";
  $("o-minn").textContent=F.minn;
}
let rafPending=false;
function changed(){ store.set("slip-filters",F); outputs(); if(!rafPending){rafPending=true;requestAnimationFrame(()=>{rafPending=false;renderDash()})} }

function compute(){
  const q={total:0,people:new Set(),kept:0,reasons:{exp:0,dev:0,mine:0,inc:0,minl:0,silent:0,fpm:0,fps:0}};
  const recs=[]; const keptPeople=new Set();
  for(const doc of runsDocs){
    const list=doc.data&&Array.isArray(doc.data.attempts)?doc.data.attempts:[];
    for(const a of list){
      if(!a||!EXP.some(e=>e.k===a.exp))continue;
      q.total++; q.people.add(doc.id);
      const listened=Number(a.listened)||0, cs=(a.c||[]).map(Number), ms=(a.m||[]);
      const sc=scoreAttempt({m:ms,c:cs},F.win,F.rt);
      const fpm=listened>0?sc.fp/(listened/60000):0, fps=cs.length?100*sc.fp/cs.length:0;
      let why=null;
      if(!F.exp.includes(a.exp))why="exp";
      else if(!F.dev.includes(a.dev))why="dev";
      else if(F.mine&&doc.id!==uid)why="mine";
      else if(!F.inc&&!a.done)why="inc";
      else if(listened<F.minl*1000)why="minl";
      else if(F.silent&&cs.length===0)why="silent";
      else if(F.fpm<31&&fpm>F.fpm)why="fpm";
      else if(F.fps<100&&cs.length>0&&fps>F.fps)why="fps";
      if(why){q.reasons[why]++;continue}
      q.kept++; keptPeople.add(doc.id);
      ms.forEach((m,i)=>{
        const r={uid:doc.id,att:a.id,exp:a.exp,dev:a.dev,done:!!a.done,listened,t:Number(m.t),d:Number(m.d),p:Number(m.p),ch:m.ch?1:0,dn:Number(m.dn),pg:Number(m.pg),ng:Number(m.ng),order:i,fpm,det:sc.det[i]!=null,rt:sc.det[i]};
        const ad=Math.abs(r.d), oct=Math.floor(r.p/12)-1, orig=r.t-r.d;
        if(!F.dir.includes(r.d<0?"early":"late"))return;
        if(ad<F.dmin||ad>F.dmax)return;
        if(!F.chord.includes(r.ch?"chord":"single"))return;
        if(Math.min(r.pg,r.ng)<F.gap)return;
        if(r.dn<F.dnmin||(F.dnmax<40&&r.dn>F.dnmax))return;
        if(!F.half.includes(r.p%12<6?"bottom":"top"))return;
        if(!F.reg.includes(r.p<60?"low":"high"))return;
        if(!F.oct.includes(Math.min(6,Math.max(1,oct))))return;
        if(r.p<F.pmin||r.p>F.pmax)return;
        if(orig<F.smin*1000||(F.smax<410&&orig>F.smax*1000))return;
        if(!F.order.includes(i===0?"first":"rest"))return;
        recs.push(r);
      });
    }
  }
  return {q,recs,keptPeople};
}
function bins(){const b=F.bin,out=[];for(let lo=1;lo<=200;lo+=b){out.push({lo,hi:Math.min(200,lo+b-1)})}return out}

function renderDash(){
  if($("view-results").hidden)return;
  const note=$("db-note");
  if(dbState==="none"){note.hidden=false;note.textContent="Results can't load because this page was opened as a file. Double-click start.bat and use the page it opens.";}
  else if(dbState==="slow"){note.hidden=false;note.textContent="Still waiting for results to load. They'll appear when the connection answers.";}
  else if(dbState==="error"){note.hidden=false;note.textContent="Can't reach the results server. Make sure the start.bat window is still open, then reload.";}
  else note.hidden=true;

  const {q,recs,keptPeople}=compute();
  const sp=SPLITS[F.split]||SPLITS.exp;
  const keys=sp.keys.filter(k=>F.split==="exp"?F.exp.includes(k):F.split==="dev"?F.dev.includes(k):F.split==="dir"?F.dir.includes(k):F.split==="half"?F.half.includes(k):F.split==="reg"?F.reg.includes(k):F.split==="chord"?F.chord.includes(k):true);
  const colorOf=k=>SERIES[sp.keys.indexOf(k)%SERIES.length];
  const B=bins();
  const grid={}; for(const k of sp.keys)grid[k]=B.map(()=>({n:0,hit:0}));
  const all=B.map(()=>({n:0,hit:0}));
  for(const r of recs){ const k=sp.of(r); const bi=Math.min(B.length-1,Math.floor((Math.abs(r.d)-1)/F.bin)); if(grid[k]){grid[k][bi].n++;if(r.det)grid[k][bi].hit++;} all[bi].n++; if(r.det)all[bi].hit++; }

  // tiles
  const hits=recs.filter(r=>r.det).length;
  const rts=recs.filter(r=>r.det).map(r=>r.rt);
  // smallest bucket reaching 50% (overall, among buckets with n>=minn)
  let fifty=null; for(let i=0;i<B.length;i++){ if(all[i].n>=F.minn&&all[i].hit/all[i].n>=0.5){fifty=B[i];break} }
  const tiles=[
    [keptPeople.size+"",`people (of ${q.people.size})`],
    [q.kept+"",`attempts kept (of ${q.total})`],
    [recs.length+"","slips in view"],
    [recs.length?Math.round(100*hits/recs.length)+"%":"–","noticed overall"],
    [fifty?`${fifty.lo}–${fifty.hi} ms`:"–","first bucket ≥ 50% noticed"],
    [rts.length?Math.round(median(rts))+" ms":"–","median reaction time"]
  ];
  $("tiles").innerHTML=tiles.map(t=>`<div class="stat"><div class="v">${esc(t[0])}</div><div class="k">${esc(t[1])}</div></div>`).join("");

  // legend
  $("legend").innerHTML=keys.map(k=>`<span><i style="background:${colorOf(k)}"></i>${esc(sp.label(k))}</span>`).join("");
  $("chart-sub").textContent=`Each point is a ${F.bin} ms bucket of slip sizes (early and late combined as distance). A press within ${F.win/1000} s after the slip counts as noticed. Buckets with fewer than ${F.minn} slips are hidden.`;
  drawChart(keys,grid,B,colorOf,sp);
  drawTable(keys,grid,B,sp,all);
  drawQual(q);
  lastRecs=recs;
}
function median(a){const s=a.slice().sort((x,y)=>x-y);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}

function drawChart(keys,grid,B,colorOf,sp){
  const wrap=$("chartwrap");
  const any=keys.some(k=>grid[k].some(c=>c.n>=F.minn));
  if(!any){ wrap.innerHTML=`<div class="empty">${runsDocs.length?"No buckets have enough slips with these filters. Try widening them or lowering the minimum per bucket.":"No attempts yet. Results appear here as soon as someone finishes or stops a test."}</div>`; return; }
  const W=Math.max(320,wrap.clientWidth||700), H=Math.round(Math.min(380,Math.max(260,W*0.45)));
  const m={l:44,r:W<520?16:128,t:12,b:40}, iw=W-m.l-m.r, ih=H-m.t-m.b;
  const x=v=>m.l+(v/200)*iw, y=v=>m.t+ih-(v/100)*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Percent of slips noticed by slip size">`;
  for(const v of [0,25,50,75,100]) s+=`<line x1="${m.l}" x2="${m.l+iw}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" ${v===50?'stroke-dasharray="4 4"':""}/><text x="${m.l-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${v}%</text>`;
  for(let v=0;v<=200;v+=25) s+=`<text x="${x(v)}" y="${m.t+ih+18}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-mono)">${v}</text>`;
  s+=`<text x="${m.l+iw/2}" y="${H-4}" text-anchor="middle" font-size="12" fill="var(--ink-2)">How far off the note was (ms)</text>`;
  const ends=[];
  keys.forEach(k=>{
    const pts=B.map((b,i)=>{const c=grid[k][i];return c.n>=F.minn?{x:x((b.lo+b.hi)/2),y:y(100*c.hit/c.n)}:null});
    let d="",pen=false; for(const p of pts){ if(!p){pen=false;continue} d+=(pen?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1); pen=true; }
    s+=`<path d="${d}" fill="none" stroke="${colorOf(k)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for(const p of pts) if(p) s+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colorOf(k)}" stroke="var(--panel)" stroke-width="2"/>`;
    const last=pts.filter(Boolean).pop(); if(last)ends.push({k,y:last.y,x:last.x});
  });
  if(m.r>60&&keys.length<=4){ ends.sort((a,b)=>a.y-b.y); for(let i=1;i<ends.length;i++) if(ends[i].y-ends[i-1].y<15) ends[i].y=ends[i-1].y+15;
    for(const e of ends) s+=`<text x="${m.l+iw+10}" y="${e.y+4}" font-size="12" fill="var(--ink-2)">${esc(sp.label(e.k))}</text>`; }
  s+=`<line id="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t+ih}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`;
  s+=`<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" id="hov"/></svg><div class="tip" id="tip" hidden></div>`;
  wrap.innerHTML=s;
  const svg=wrap.querySelector("svg"), tip=$("tip"), xh=svg.querySelector("#xh");
  const move=ev=>{
    const r=svg.getBoundingClientRect(), sx=(ev.clientX-r.left)*(W/r.width);
    const v=Math.max(0,Math.min(200,(sx-m.l)/iw*200)); const bi=Math.min(B.length-1,Math.max(0,Math.floor(v/F.bin)));
    const b=B[bi], cx=x((b.lo+b.hi)/2);
    xh.setAttribute("x1",cx);xh.setAttribute("x2",cx);xh.setAttribute("visibility","visible");
    tip.innerHTML=`<div style="margin-bottom:4px"><b>${b.lo}–${b.hi} ms</b></div>`+keys.map(k=>{const c=grid[k][bi];return `<div class="r"><span><i style="background:${colorOf(k)}"></i>${esc(sp.label(k))}</span><span class="mono">${c.n?Math.round(100*c.hit/c.n)+"%":"–"} <span style="color:var(--muted)">${c.hit}/${c.n}</span></span></div>`}).join("");
    tip.hidden=false; const px=cx*(r.width/W), tw=tip.offsetWidth;
    tip.style.left=Math.max(0,Math.min(r.width-tw,px+12>r.width-tw?px-tw-12:px+12))+"px"; tip.style.top="8px";
  };
  svg.addEventListener("pointermove",move); svg.addEventListener("pointerdown",move);
  svg.addEventListener("pointerleave",()=>{tip.hidden=true;xh.setAttribute("visibility","hidden")});
}
function drawTable(keys,grid,B,sp,all){
  const cell=c=>c.n?`<td class="${c.n<F.minn?"low":""}">${Math.round(100*c.hit/c.n)}%<span class="n">n=${c.n}</span></td>`:`<td class="low">–</td>`;
  let h=`<table><thead><tr><th>Slip size</th>${keys.map(k=>`<th>${esc(sp.label(k))}</th>`).join("")}${keys.length>1?"<th>All shown</th>":""}</tr></thead><tbody>`;
  B.forEach((b,i)=>{ h+=`<tr><td class="mono">${b.lo}–${b.hi} ms</td>${keys.map(k=>cell(grid[k][i])).join("")}${keys.length>1?cell(all[i]):""}</tr>`; });
  $("tablewrap").innerHTML=h+"</tbody></table>";
}
function drawQual(q){
  const L={exp:"Experience level not selected",dev:"Listening device not selected",mine:"Someone else's attempt",inc:"Stopped early",minl:`Listened less than ${F.minl} s`,silent:"No presses at all",fpm:`More than ${F.fpm} false alarms per minute`,fps:`More than ${F.fps}% of presses were false`};
  const rows=Object.entries(q.reasons).filter(([k,v])=>v>0);
  $("qual").innerHTML=`<div><span>Attempts in the database</span><b>${q.total}</b></div>`+(rows.length?rows.map(([k,v])=>`<div><span>${esc(L[k])}</span><b>−${v}</b></div>`).join(""):`<div><span>Nothing removed</span><b>0</b></div>`)+`<div><span>Attempts used</span><b>${q.kept}</b></div>`+`<div class="hint" style="display:block;margin-top:6px">A false alarm is a press with no slip in the ${F.win/1000} s before it. Each attempt is checked against one rule at a time, in the order listed.</div>`;
}

/* CSV of every slip currently in view */
let lastRecs=[];
function csv(){
  const head=["participant","attempt","experience","device","finished","listened_s","slip_index","song_time_ms","delay_ms","direction","abs_delay_ms","pitch","note","pitch_class_half","register","in_chord","density_nps","gap_before_ms","gap_after_ms","noticed","reaction_ms","attempt_false_alarms_per_min"];
  const ids={}; let n=0;
  const rows=lastRecs.map(r=>{ if(!(r.uid in ids))ids[r.uid]="P"+(++n);
    return [ids[r.uid],r.att,r.exp,r.dev,r.done?1:0,(r.listened/1000).toFixed(1),r.order,r.t-r.d,r.d,r.d<0?"early":"late",Math.abs(r.d),r.p,noteName(r.p),r.p%12<6?"bottom":"top",r.p<60?"low":"high",r.ch,r.dn,r.pg>=9999?"":r.pg,r.ng>=9999?"":r.ng,r.det?1:0,r.rt==null?"":r.rt,r.fpm.toFixed(2)].join(",");});
  return head.join(",")+"\n"+rows.join("\n");
}
$("csv-copy").addEventListener("click",()=>{
  const text=csv(), msg=$("csv-msg");
  navigator.clipboard.writeText(text).then(()=>{msg.textContent=`Copied ${lastRecs.length} rows. Paste into a spreadsheet.`}).catch(()=>{
    msg.innerHTML=""; const ta=document.createElement("textarea"); ta.value=text; ta.rows=6; ta.style.width="100%"; msg.append("Copy didn't work here. Select the text below and copy it:",ta); ta.select();
  });
});
$("csv-dl").hidden=false;
$("csv-dl").addEventListener("click",()=>{
  const url=URL.createObjectURL(new Blob([csv()],{type:"text/csv"}));
  const a=document.createElement("a"); a.href=url; a.download="timing-slips.csv"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
});

let resizeT; addEventListener("resize",()=>{clearTimeout(resizeT);resizeT=setTimeout(renderDash,150)});

/* ---------------- boot ---------------- */
buildFilters(); route();
loadSong().then(buildPiano).catch(e=>{$("go").textContent="Couldn't load the song";$("go-hint").textContent="Reload the page to try again."});
showAccess();
loadResults();
setInterval(()=>{ if(!$("view-results").hidden&&!(run&&!run.finished))loadResults(); },8000);
