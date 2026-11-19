"use strict";
/* =====================================================================
   Triozizz Journal
   - Accounts: Supabase Auth (email + password, email code, phone code)
   - Data: Supabase Postgres with row-level security (see supabase/schema.sql)
   - PIN: quick-unlock lock screen, hashed (PBKDF2) on the user's profile,
          reset by a one-time code sent to the account's email or phone
   - Preview mode: with no Supabase keys in config.js, everything runs in
          this browser so the design can be tried without a backend
   ===================================================================== */

/* ---------- helpers ---------- */
const MISTAKES=["Moved stop","Closed early","Oversized lot","No valid setup","Chased entry","Ignored news","Overtraded","Held a loser"];
const DEF_SETTINGS={currency:"$",dailyLoss:5,maxTrades:5,riskPct:2,autoLock:5,leverage:500,clock:"24",
  sources:["Manual","Expert Advisor","Trading bot"],
  accounts:[{name:"Main account",start:100}],
  rules:["Only take A or B setups with a stop loss set before entry","Risk 2% or less per trade","Stop for the day once the daily loss limit is hit","No new trades 15 minutes either side of high-impact news","Check the higher-timeframe trend before entering","Log every trade the same day, with a screenshot"]};
const DOW=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const PIN_ITER=150000;
const $=s=>document.querySelector(s);
const F=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>{if(v===""||v==null)return null;const n=parseFloat(String(v).replace(/,/g,""));return isFinite(n)?n:null};
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parseDay=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const cur=()=>S.settings.currency||"$";
const money=(v,sign=true)=>{if(v==null||!isFinite(v))return "–";const s=v>0&&sign?"+":v<0?"−":"";return s+cur()+Math.abs(v).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})};
const cls=v=>v==null||!isFinite(v)?"flat":v>0?"pos":v<0?"neg":"flat";
const pct=v=>v==null||!isFinite(v)?"–":(v*100).toFixed(0)+"%";
const spct=(v,d=2)=>v==null||!isFinite(v)?"–":(v>0?"+":v<0?"−":"")+Math.abs(v*100).toFixed(d)+"%";
const fx=(v,d=2)=>v==null||!isFinite(v)?"–":v.toFixed(d);
const isoWeek=d=>{const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const y=new Date(Date.UTC(t.getUTCFullYear(),0,1));return t.getUTCFullYear()+"-W"+pad(Math.ceil(((t-y)/864e5+1)/7))};
const monIdx=d=>(d.getDay()+6)%7;
const ls={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove("show"),2800)}
const uuid=()=>crypto.randomUUID?crypto.randomUUID():"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(+c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>+c/4).toString(16));
const te=new TextEncoder();
const b64=buf=>{const u=new Uint8Array(buf);let s="";for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const maskEmail=e=>{if(!e)return "";const [u,d]=e.split("@");return u.slice(0,2)+"•••@"+d};
const maskPhone=p=>p?p.slice(0,4)+" ••• "+p.slice(-3):"";

/* ---------- config & storage ---------- */
const CFG=window.TJ_CONFIG||{};
const LIVE=!!(CFG.supabaseUrl&&CFG.supabaseAnonKey&&window.supabase&&window.supabase.createClient);
const sb=LIVE?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
let USER=null,PROFILE=null;

const toRow=t=>({id:t.id,user_id:USER.id,trade_date:t.date,trade_time:t.time||null,symbol:t.symbol,market:t.market,direction:t.dir,source:t.source,account:t.account||null,setup:t.setup||null,session:t.session,
  entry_price:t.entry,sl_price:t.sl,tp_price:t.tp,exit_price:t.exit,lots:t.lots,risk:t.risk,pnl:t.pnl,grade:t.grade,emotion:t.emotion,followed:t.followed,mistakes:t.mistakes||[],notes:t.notes||null,link:t.link||null,screenshot_path:t.shot||null,updated_at:new Date().toISOString()});
const N=v=>v==null?null:Number(v);
const fromRow=r=>({id:r.id,date:r.trade_date,time:r.trade_time?String(r.trade_time).slice(0,5):"",symbol:r.symbol,market:r.market||"Forex",dir:r.direction||"Buy",source:r.source||"Manual",account:r.account||"",setup:r.setup||"",session:r.session||"London",
  entry:N(r.entry_price),sl:N(r.sl_price),tp:N(r.tp_price),exit:N(r.exit_price),lots:N(r.lots),risk:N(r.risk),pnl:Number(r.pnl),grade:r.grade||"B",emotion:r.emotion||"Calm",followed:r.followed!==false,mistakes:r.mistakes||[],notes:r.notes||"",link:r.link||"",shot:r.screenshot_path||""});
function chk({error}){if(error)throw error}

const Remote={
  async getProfile(){
    let {data,error}=await sb.from("profiles").select("*").eq("id",USER.id).maybeSingle();if(error)throw error;
    if(!data){const ins={id:USER.id,display_name:(USER.user_metadata&&USER.user_metadata.display_name)||"",settings:{}};chk(await sb.from("profiles").insert(ins));data=ins}
    return data;
  },
  async saveProfile(p){chk(await sb.from("profiles").update({...p,updated_at:new Date().toISOString()}).eq("id",USER.id))},
  async listTrades(){const out=[];for(let from=0;;from+=1000){const {data,error}=await sb.from("trades").select("*").order("trade_date").range(from,from+999);if(error)throw error;out.push(...data);if(data.length<1000)break}return out.map(fromRow)},
  async saveTrade(t){chk(await sb.from("trades").upsert(toRow(t)))},
  async deleteTrade(id){chk(await sb.from("trades").delete().eq("id",id))},
  async listCash(){const {data,error}=await sb.from("cashflows").select("*").order("flow_date");if(error)throw error;return data.map(r=>({id:r.id,date:r.flow_date,amount:Number(r.amount),account:r.account||"",note:r.note||""}))},
  async saveCash(c){chk(await sb.from("cashflows").upsert({id:c.id,user_id:USER.id,flow_date:c.date,amount:c.amount,account:c.account||null,note:c.note||null}))},
  async deleteCash(id){chk(await sb.from("cashflows").delete().eq("id",id))},
  async listWeeks(){const {data,error}=await sb.from("weekly_reviews").select("week,body");if(error)throw error;const o={};data.forEach(r=>o[r.week]=r.body||"");return o},
  async saveWeek(k,body){chk(await sb.from("weekly_reviews").upsert({user_id:USER.id,week:k,body,updated_at:new Date().toISOString()},{onConflict:"user_id,week"}))},
  async uploadShot(blob,tradeId){const path=`${USER.id}/${tradeId}-${Date.now()}.jpg`;chk(await sb.storage.from("screenshots").upload(path,blob,{contentType:"image/jpeg",upsert:true}));return path},
  async shotUrl(path){if(!path)return "";if(path.startsWith("data:"))return path;const {data,error}=await sb.storage.from("screenshots").createSignedUrl(path,3600);if(error)return "";return data.signedUrl},
  async deleteShot(path){if(path&&!path.startsWith("data:"))await sb.storage.from("screenshots").remove([path])}
};
const LK="tj3_preview";
const Local={
  db(){return ls.get(LK)||{profile:null,trades:[],cash:[],weeks:{}}},
  put(d){if(!ls.set(LK,d))throw {message:"This browser is out of storage space."}},
  async getProfile(){const d=this.db();if(!d.profile){d.profile={id:"preview",display_name:"",settings:{}};this.put(d)}return d.profile},
  async saveProfile(p){const d=this.db();d.profile={...d.profile,...p};this.put(d)},
  async listTrades(){return this.db().trades},
  async saveTrade(t){const d=this.db();const i=d.trades.findIndex(x=>x.id===t.id);if(i>=0)d.trades[i]=t;else d.trades.push(t);this.put(d)},
  async deleteTrade(id){const d=this.db();d.trades=d.trades.filter(x=>x.id!==id);this.put(d)},
  async listCash(){return this.db().cash},
  async saveCash(c){const d=this.db();const i=d.cash.findIndex(x=>x.id===c.id);if(i>=0)d.cash[i]=c;else d.cash.push(c);this.put(d)},
  async deleteCash(id){const d=this.db();d.cash=d.cash.filter(x=>x.id!==id);this.put(d)},
  async listWeeks(){return this.db().weeks||{}},
  async saveWeek(k,body){const d=this.db();d.weeks=d.weeks||{};d.weeks[k]=body;this.put(d)},
  async uploadShot(blob){return await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob)})},
  async shotUrl(p){return p||""},
  async deleteShot(){}
};
const Store=LIVE?Remote:Local;

/* ---------- PIN hashing ---------- */
async function hashPin(pin,salt,iter){const k=await crypto.subtle.importKey("raw",te.encode(pin),"PBKDF2",false,["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({name:"PBKDF2",salt:unb64(salt),iterations:iter,hash:"SHA-256"},k,256))}
async function makePin(pin){const salt=b64(crypto.getRandomValues(new Uint8Array(16)));return {pin_salt:salt,pin_iter:PIN_ITER,pin_hash:await hashPin(pin,salt,PIN_ITER)}}
async function checkPin(pin){if(!PROFILE||!PROFILE.pin_hash)return false;const h=await hashPin(pin,PROFILE.pin_salt,PROFILE.pin_iter||PIN_ITER);
  let d=h.length^PROFILE.pin_hash.length;for(let i=0;i<Math.min(h.length,PROFILE.pin_hash.length);i++)d|=h.charCodeAt(i)^PROFILE.pin_hash.charCodeAt(i);return d===0}

/* ---------- state ---------- */
const S={trades:[],cash:[],settings:structuredClone(DEF_SETTINGS),weeks:{},sample:false,acct:"",
  period:"all",hunit:"pct",calMonth:(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)})(),
  tf:{q:"",src:"",res:"",date:""},view:"dashboard",editing:null,notes:{},noteDay:null,editAcct:null,mt5:null};
let UNLOCKED=false;

/* ---------- instruments for the calculators ---------- */
const INS=(()=>{const L=[];const fx=(s,c=1e5)=>{const b=s.slice(0,3),q=s.slice(3);L.push({s,base:b,quote:q,contract:c,pip:q==="JPY"?0.01:0.0001,step:0.01,grp:"Forex",unit:"pips"})};
  ["EURUSD","GBPUSD","AUDUSD","NZDUSD","USDJPY","USDCHF","USDCAD","EURJPY","GBPJPY","AUDJPY","NZDJPY","CADJPY","CHFJPY","EURGBP","EURAUD","EURNZD","EURCAD","EURCHF","GBPAUD","GBPNZD","GBPCAD","GBPCHF","AUDNZD","AUDCAD","AUDCHF","NZDCAD","CADCHF"].forEach(s=>fx(s));
  L.push({s:"XAUUSD",base:"XAU",quote:"USD",contract:100,pip:0.1,step:0.01,grp:"Metals",unit:"pips ($0.10)"});
  L.push({s:"XAGUSD",base:"XAG",quote:"USD",contract:5000,pip:0.01,step:0.01,grp:"Metals",unit:"pips ($0.01)"});
  L.push({s:"BTCUSD",base:"BTC",quote:"USD",contract:1,pip:1,step:0.01,grp:"Crypto",unit:"points ($1)"});
  L.push({s:"ETHUSD",base:"ETH",quote:"USD",contract:1,pip:1,step:0.01,grp:"Crypto",unit:"points ($1)"});
  L.push({s:"US30",base:"IDX",quote:"USD",contract:1,pip:1,step:0.1,grp:"Indices",unit:"points"});
  L.push({s:"NAS100",base:"IDX",quote:"USD",contract:1,pip:1,step:0.1,grp:"Indices",unit:"points"});
  [["Volatility 10 Index",0.5],["Volatility 25 Index",0.5],["Volatility 50 Index",4],["Volatility 75 Index",0.001],["Volatility 100 Index",0.5],["Volatility 75 (1s) Index",0.05],["Boom 1000 Index",0.2],["Crash 1000 Index",0.2],["Boom 500 Index",0.2],["Crash 500 Index",0.2]].forEach(([s,min])=>L.push({s,base:"SYN",quote:"USD",contract:1,pip:1,step:0.001,min,grp:"Deriv synthetics",unit:"points"}));
  L.push({s:"Step Index",base:"SYN",quote:"USD",contract:10,pip:0.1,step:0.1,min:0.1,grp:"Deriv synthetics",unit:"steps (0.1)"});
  L.push({s:"Custom",base:"CUS",quote:"USD",contract:1,pip:1,step:0.01,grp:"Other",unit:"points",custom:true});
  return L})();
const insBy=s=>INS.find(i=>i.s===s)||INS[0];
const QUOTE_MUL={EUR:"EURUSD",GBP:"GBPUSD",AUD:"AUDUSD",NZD:"NZDUSD"},QUOTE_DIV={JPY:"USDJPY",CHF:"USDCHF",CAD:"USDCAD"};
function convNeed(ins){if(ins.quote==="USD"||ins.base==="USD")return null;return QUOTE_MUL[ins.quote]?{pair:QUOTE_MUL[ins.quote],mul:true}:{pair:QUOTE_DIV[ins.quote],mul:false}}
/* how many USD one unit of the quote currency is worth */
function quoteUSD(ins,price,conv){if(ins.quote==="USD")return 1;if(ins.base==="USD")return price>0?1/price:null;const n=convNeed(ins);if(!(conv>0))return null;return n.mul?conv:1/conv}

/* ---------- sample trades (shown until the first real trade) ---------- */
function makeSamples(){
  const syms=[["EURUSD","Forex",1.0850,5],["GBPJPY","Forex",192.40,3],["XAUUSD","Metals",2650,2],["Volatility 75 Index","Synthetic",412000,2],["Boom 1000 Index","Synthetic",11800,2],["BTCUSD","Crypto",91000,2],["USDJPY","Forex",153.20,3]];
  const setups=["Trend pullback","Breakout retest","London open range","Supply/demand zone","News fade"];
  const srcs=S.settings.sources.length?S.settings.sources:DEF_SETTINGS.sources;const acct=S.settings.accounts[0]?.name||"";
  let seed=11;const rnd=()=>(seed=(seed*9301+49297)%233280)/233280;
  const out=[];const today=new Date();const risk=+((S.settings.accounts[0]?.start||100)*S.settings.riskPct/100).toFixed(2)||1;
  for(let i=0;i<40;i++){
    const d=new Date(today);d.setDate(d.getDate()-Math.floor(rnd()*75));
    const [sym,market,base,dp]=syms[Math.floor(rnd()*syms.length)];
    const src=rnd()<.55?srcs[0]:srcs[Math.floor(rnd()*srcs.length)];
    const dir=rnd()>.5?"Buy":"Sell";const sgn=dir==="Buy"?1:-1;
    const followed=rnd()>.27;const win=rnd()<(followed?.58:.3);
    const rr=1.2+Math.round(rnd()*14)/10;
    const r=win?+(0.6+rnd()*(rr-0.6)).toFixed(2):(rnd()>.8?-0.5:-1);
    const dist=base*0.0025;const entry=+(base*(1+(rnd()-.5)*.01)).toFixed(dp);
    const h=market==="Synthetic"?Math.floor(rnd()*24):[3,8,9,10,13,14,15][Math.floor(rnd()*7)];
    out.push({id:"s"+i,date:ymd(d),time:pad(h)+":"+pad(Math.floor(rnd()*60)),symbol:sym,market,dir,source:src,account:acct,
      setup:setups[Math.floor(rnd()*setups.length)],session:market==="Synthetic"?"24/7 (synthetic)":h<7?"Asian":h<12?"London":h<16?"London/NY overlap":"New York",
      entry,sl:+(entry-sgn*dist).toFixed(dp),tp:+(entry+sgn*dist*rr).toFixed(dp),exit:+(entry+sgn*dist*r).toFixed(dp),lots:0.01,risk,pnl:+(r*risk).toFixed(2),
      grade:followed?(rnd()>.5?"A":"B"):"C",emotion:followed?"Calm":["FOMO","Revenge","Hesitant"][Math.floor(rnd()*3)],
      followed,mistakes:followed?[]:[MISTAKES[Math.floor(rnd()*MISTAKES.length)]],notes:"Example trade",link:"",shot:""});
  }
  return out;
}

/* =====================================================================
   SIGN-IN, ACCOUNT AND PIN SCREENS
   ===================================================================== */
const G={st:"loading",tab:"signin",method:"email",target:null,otpType:null,purpose:null,name:"",cc:"+254"};
const COUNTRIES=[["+254","Kenya"],["+255","Tanzania"],["+256","Uganda"],["+250","Rwanda"],["+251","Ethiopia"],["+234","Nigeria"],["+233","Ghana"],["+27","South Africa"],["+260","Zambia"],["+263","Zimbabwe"],["+1","USA / Canada"],["+44","UK"],["+91","India"],["+971","UAE"]];
const logoHTML=`<div class="logo"><img src="icons/logo.svg" alt=""><div><b>TRIOZIZZ</b><small>Journal</small></div></div>`;
function phoneHTML(){return `<div class="f"><label for="gPhone">Phone number</label><div class="phone"><select class="input" id="gCC" aria-label="Country code">${COUNTRIES.map(([c,n])=>`<option value="${c}"${G.cc===c?" selected":""}>${c} ${n}</option>`).join("")}</select><input class="input" id="gPhone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="712 345 678"></div></div>`}
function readPhone(){const cc=F("gCC").value;G.cc=cc;let n=F("gPhone").value.replace(/[^\d]/g,"");if(n.startsWith("0"))n=n.slice(1);if(F("gPhone").value.trim().startsWith("+"))return "+"+F("gPhone").value.replace(/[^\d]/g,"");return n.length>=6?cc+n:null}
function gate(st,msg="",ok=""){
  G.st=st;UNLOCKED=false;F("app").hidden=true;F("fab").hidden=true;F("gate").hidden=false;closeTrade();
  const box=F("gatebox");let h=logoHTML;
  const err=`<div class="err" id="gErr" role="alert">${esc(msg)}</div>${ok?`<div class="okmsg">${esc(ok)}</div>`:""}`;
  const demo=!LIVE?`<div class="demo"><span><b style="color:var(--accent)">Preview mode.</b> Accounts aren't connected yet, so sign-up and codes are switched off. Your data stays in this browser.</span><button class="btn primary" data-g="preview">Open the preview</button></div>`:"";
  if(st==="loading")h+=`<p class="sub">Loading your journal…</p>`;
  else if(st==="welcome"){
    const tab=G.tab,m=G.method;
    h+=`<h1>${tab==="signup"?"Create your account":"Welcome back"}</h1>${demo}
    <div class="tabs2" role="group"><button data-gtab="signin" aria-pressed="${tab==="signin"}">Sign in</button><button data-gtab="signup" aria-pressed="${tab==="signup"}">Create account</button></div>
    <form class="gatecard" id="gForm" novalidate>
      <div class="seg" role="group" aria-label="Use email or phone"><button type="button" data-gm="email" aria-pressed="${m==="email"}">Email</button><button type="button" data-gm="phone" aria-pressed="${m==="phone"}">Phone</button></div>
      ${tab==="signup"?`<div class="f"><label for="gName">Your name</label><input class="input" id="gName" autocomplete="name" value="${esc(G.name)}"></div>`:""}
      ${m==="email"?`<div class="f"><label for="gEmail">Email</label><input class="input" id="gEmail" type="email" autocomplete="email" inputmode="email"></div>
        <div class="f"><label for="gPass">Password${tab==="signup"?" (8+ characters)":""}</label><input class="input" id="gPass" type="password" autocomplete="${tab==="signup"?"new-password":"current-password"}"></div>
        ${tab==="signup"?`<div class="f"><label for="gPass2">Repeat password</label><input class="input" id="gPass2" type="password" autocomplete="new-password"></div>`:""}`
       :phoneHTML()+`<p class="gatenote">We'll text you a 6-digit code. Standard SMS rates may apply.</p>`}
      ${err}
      <button class="btn primary" ${LIVE?"":"disabled"}>${m==="phone"?"Send code":tab==="signup"?"Create account":"Sign in"}</button>
      ${tab==="signin"&&m==="email"?`<div class="links"><button type="button" class="linkbtn" data-g="email-code">Email me a sign-in code</button><button type="button" class="linkbtn" data-g="forgot-pass">Forgot password?</button></div>`:""}
    </form>
    ${CFG.google?`<div class="gor"><span>or</span></div>
    <button type="button" class="btn wide gbtn" data-g="google" ${LIVE?"":"disabled"}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>`:""}
    <p class="gatenote">Your journal is private to your account. Only you can see your trades.</p>`;
  }
  else if(st==="code"){
    h+=`<h1>Enter your code</h1><p class="sub">We sent a 6-digit code to <b>${esc(G.otpType==="sms"?maskPhone(G.target):maskEmail(G.target))}</b>. It expires in a few minutes.</p>
    <form class="gatecard" id="gForm" novalidate><div class="f"><label for="gCode">Code</label><input class="input code" id="gCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></div>${err}
    <button class="btn primary">Verify</button><div class="links"><button type="button" class="linkbtn" data-g="resend">Send a new code</button><button type="button" class="linkbtn" data-g="back">Back</button></div></form>`;
  }
  else if(st==="check-email")h+=`<h1>Check your email</h1><div class="gatecard"><p style="margin:0">We sent a confirmation link to <b>${esc(G.target)}</b>. Open it on this device, then come back and sign in.</p>${err}<button class="btn wide" data-g="back">Back to sign in</button></div>`;
  else if(st==="email-code")h+=`<h1>Sign in with a code</h1><form class="gatecard" id="gForm" novalidate><div class="f"><label for="gEmail">Email</label><input class="input" id="gEmail" type="email" autocomplete="email" inputmode="email"></div>${err}<button class="btn primary">Email me a code</button><button type="button" class="linkbtn" data-g="back">Back</button></form>`;
  else if(st==="forgot-pass")h+=`<h1>Reset your password</h1><form class="gatecard" id="gForm" novalidate><div class="f"><label for="gEmail">Email</label><input class="input" id="gEmail" type="email" autocomplete="email" inputmode="email"></div>${err}<button class="btn primary">Email me a reset link</button><button type="button" class="linkbtn" data-g="back">Back</button></form>`;
  else if(st==="newpass")h+=`<h1>Choose a new password</h1><form class="gatecard" id="gForm" novalidate><div class="f"><label for="gPass">New password (8+ characters)</label><input class="input" id="gPass" type="password" autocomplete="new-password"></div><div class="f"><label for="gPass2">Repeat password</label><input class="input" id="gPass2" type="password" autocomplete="new-password"></div>${err}<button class="btn primary">Save password</button></form>`;
  else if(st==="pin-create"||st==="pin-reset")h+=`<h1>${st==="pin-reset"?"Choose a new PIN":"Create your PIN"}</h1><p class="sub">6 to 8 digits. You'll use it to open the journal on this device. Your password or a code still protects your account.</p>
    <form class="gatecard" id="gForm" novalidate><div class="f"><label for="gPin">PIN</label><input class="input pin" id="gPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"></div>
    <div class="f"><label for="gPin2">Type the same PIN again</label><input class="input pin" id="gPin2" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"></div>${err}<button class="btn primary">Save PIN and open</button></form>`;
  else if(st==="pin-unlock")h+=`<h1>Hi${PROFILE&&PROFILE.display_name?", "+esc(PROFILE.display_name.split(" ")[0]):""}</h1><p class="sub">Enter your PIN to open your journal.</p>
    <form class="gatecard" id="gForm" novalidate><div class="f"><label for="gPin">PIN</label><input class="input pin" id="gPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"></div>${err}<button class="btn primary">Unlock</button>
    <div class="links"><button type="button" class="linkbtn" data-g="forgot-pin">Forgot PIN?</button><button type="button" class="linkbtn" data-g="signout">Sign out</button></div></form>`;
  else if(st==="forgot-pin"){
    const ph=USER&&USER.phone,em=USER&&USER.email;
    h+=`<h1>Reset your PIN</h1><p class="sub">We'll send a one-time code to your account to confirm it's you. Your trades stay as they are.</p><div class="gatecard">
     ${LIVE?(em?`<button class="btn primary" data-g="pin-code-email">Send code to ${esc(maskEmail(em))}</button>`:"")+(ph?`<button class="btn ${em?"wide":"primary"}" data-g="pin-code-sms">Text code to ${esc(maskPhone("+"+String(ph).replace(/^\+/,"")))}</button>`:""):`<p class="gatenote">In preview mode no code can be sent, so you can set a new PIN straight away.</p><button class="btn primary" data-g="pin-preview-reset">Set a new PIN</button>`}
     ${err}<button type="button" class="linkbtn" data-g="to-unlock">Back</button></div>`;
  }
  box.innerHTML=h;
  const first=box.querySelector("input:not([type=hidden]),button.primary");if(first&&st!=="loading")setTimeout(()=>first.focus(),40);
}
function gErr(m){const e=F("gErr");if(e)e.textContent=m;else toast(m)}
function busy(on,label){const b=F("gatebox").querySelector("form button.primary, form .btn.primary");if(!b)return;if(on){b.dataset.l=b.textContent;b.textContent=label||"Please wait…";b.disabled=true}else{b.textContent=b.dataset.l||b.textContent;b.disabled=!LIVE&&G.st==="welcome"}}
const friendly=e=>{const m=(e&&(e.message||e.error_description))||String(e||"");
  if(/Invalid login credentials/i.test(m))return "Wrong email or password.";
  if(/Email not confirmed/i.test(m))return "Confirm your email first. Check your inbox for the link.";
  if(/already registered|already been registered/i.test(m))return "That email already has an account. Sign in instead.";
  if(/rate limit|too many/i.test(m))return "Too many attempts. Wait a minute and try again.";
  if(/expired|invalid.*(otp|token)|Token has expired/i.test(m))return "That code is wrong or has expired. Request a new one.";
  if(/phone.*(provider|disabled)|Unsupported phone provider/i.test(m))return "Phone sign-in isn't switched on for this app yet. Use email.";
  if(/Signups not allowed|User not found/i.test(m))return "No account found. Create one first.";
  if(/Failed to fetch|NetworkError/i.test(m))return "No connection. Check your internet and try again.";
  return m||"Something went wrong. Try again."};
async function sendOtp(target,type,purpose,create){
  const opts={shouldCreateUser:!!create};if(create&&G.name)opts.data={display_name:G.name};
  const {error}=type==="sms"?await sb.auth.signInWithOtp({phone:target,options:opts}):await sb.auth.signInWithOtp({email:target,options:opts});
  if(error)throw error;G.target=target;G.otpType=type;G.purpose=purpose;gate("code");
}
F("gatebox").addEventListener("click",async e=>{
  const b=e.target.closest("[data-g],[data-gtab],[data-gm]");if(!b)return;
  if(b.dataset.gtab){G.tab=b.dataset.gtab;gate("welcome");return}
  if(b.dataset.gm){const n=F("gName");if(n)G.name=n.value;G.method=b.dataset.gm;gate("welcome");return}
  const a=b.dataset.g;
  try{
    if(a==="preview"){USER={id:"preview"};await afterAuth(false)}
    else if(a==="back")gate("welcome");
    else if(a==="email-code"||a==="forgot-pass")gate(a);
    else if(a==="google"){
      /* Google refuses to show its sign-in page inside a frame, so the whole tab goes to Google and comes back to this Journal page */
      b.disabled=true;
      const {data,error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname,skipBrowserRedirect:true}});
      if(error){b.disabled=false;throw error}
      let top=null;try{top=window.top.location;void top.href}catch(_){top=null}
      (top||location).href=data.url;
    }
    else if(a==="resend"){b.disabled=true;if(G.purpose==="confirm"){const r=await sb.auth.resend({type:"signup",email:G.target});if(r.error)throw r.error}else await sendOtp(G.target,G.otpType,G.purpose,G.purpose==="signup");toast("New code sent")}
    else if(a==="signout"){await signOut()}
    else if(a==="forgot-pin")gate("forgot-pin");
    else if(a==="to-unlock")gate("pin-unlock");
    else if(a==="pin-code-email"){b.disabled=true;await sendOtp(USER.email,"email","pin",false)}
    else if(a==="pin-code-sms"){b.disabled=true;await sendOtp("+"+String(USER.phone).replace(/^\+/,""),"sms","pin",false)}
    else if(a==="pin-preview-reset")gate("pin-reset");
  }catch(x){b.disabled=false;gErr(friendly(x))}
});
F("gatebox").addEventListener("submit",async e=>{
  e.preventDefault();const st=G.st;const v=id=>(F(id)?F(id).value.trim():"");gErr("");
  try{
    if(st==="welcome"){
      if(!LIVE)return;
      if(G.tab==="signup")G.name=v("gName");
      if(G.tab==="signup"&&!G.name)return gErr("Enter your name.");
      if(G.method==="phone"){const p=readPhone();if(!p)return gErr("Enter a valid phone number.");busy(true,"Sending…");await sendOtp(p,"sms",G.tab,G.tab==="signup");return}
      const em=v("gEmail"),pw=F("gPass").value;
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))return gErr("Enter a valid email address.");
      if(G.tab==="signup"){
        if(pw.length<8)return gErr("Use at least 8 characters for your password.");
        if(pw!==F("gPass2").value)return gErr("The passwords don't match.");
        busy(true,"Creating account…");
        const {data,error}=await sb.auth.signUp({email:em,password:pw,options:{data:{display_name:G.name},emailRedirectTo:location.origin+location.pathname}});
        if(error)throw error;
        if(data.session){await afterAuth(true)}else{G.target=em;G.otpType="email";G.purpose="confirm";gate("code","","Account created. Enter the code we emailed you to confirm it.")}
      }else{
        busy(true,"Signing in…");const {error}=await sb.auth.signInWithPassword({email:em,password:pw});if(error){if(/Email not confirmed/i.test(error.message||"")){const r=await sb.auth.resend({type:"signup",email:em});if(r.error)throw r.error;G.target=em;G.otpType="email";G.purpose="confirm";return gate("code","","Your email isn't confirmed yet. Enter the code we just emailed you.")}throw error}await afterAuth(true);
      }
    }
    else if(st==="code"){
      const code=v("gCode").replace(/\s/g,"");if(!/^\d{6,10}$/.test(code))return gErr("Enter the code from the message.");
      busy(true,"Checking…");
      const {error}=G.otpType==="sms"?await sb.auth.verifyOtp({phone:G.target,token:code,type:"sms"}):await sb.auth.verifyOtp({email:G.target,token:code,type:G.purpose==="confirm"?"signup":"email"});
      if(error)throw error;
      if(G.purpose==="pin"){await loadSessionUser();gate("pin-reset")}else await afterAuth(true);
    }
    else if(st==="email-code"){const em=v("gEmail");if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))return gErr("Enter a valid email address.");busy(true,"Sending…");await sendOtp(em,"email","signin",false)}
    else if(st==="forgot-pass"){const em=v("gEmail");if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))return gErr("Enter a valid email address.");busy(true,"Sending…");
      const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname});if(error)throw error;gate("welcome","","If that email has an account, a reset link is on its way.")}
    else if(st==="newpass"){const pw=F("gPass").value;if(pw.length<8)return gErr("Use at least 8 characters.");if(pw!==F("gPass2").value)return gErr("The passwords don't match.");
      busy(true,"Saving…");const {error}=await sb.auth.updateUser({password:pw});if(error)throw error;toast("Password updated");await afterAuth(true)}
    else if(st==="pin-create"||st==="pin-reset"){
      const p=v("gPin");if(!/^\d{6,8}$/.test(p))return gErr("Use 6 to 8 digits, numbers only.");if(p!==v("gPin2"))return gErr("The two PINs don't match.");
      busy(true,"Saving…");const h=await makePin(p);await Store.saveProfile(h);Object.assign(PROFILE,h);ls.del("tj3_fail_"+USER.id);
      if(st==="pin-reset")toast("PIN changed");await unlock();
    }
    else if(st==="pin-unlock"){
      const k="tj3_fail_"+USER.id;const fs=ls.get(k)||{n:0};const p=v("gPin");if(!p)return gErr("Enter your PIN.");
      busy(true,"Unlocking…");
      if(await checkPin(p)){ls.del(k);await unlock();return}
      const n=fs.n+1;ls.set(k,{n});busy(false);F("gPin").value="";F("gPin").focus();
      if(n>=5){ls.del(k);if(LIVE){await signOut("Too many wrong PINs. Sign in again with your password or a code.")}else gate("forgot-pin","Too many wrong PINs. Set a new one.");return}
      gErr(`Wrong PIN. ${5-n} tr${5-n===1?"y":"ies"} left before you'll need to sign in again.`);
    }
  }catch(x){busy(false);gErr(friendly(x))}
});

async function loadSessionUser(){if(!LIVE)return;const {data}=await sb.auth.getUser();if(data&&data.user)USER=data.user}
async function afterAuth(fresh){
  gate("loading");
  if(LIVE){await loadSessionUser();if(!USER)return gate("welcome")}
  try{PROFILE=await Store.getProfile()}catch(x){return gate("welcome",friendly(x))}
  if(!PROFILE.display_name&&G.name&&LIVE){PROFILE.display_name=G.name;Store.saveProfile({display_name:G.name}).catch(()=>{})}
  S.settings=mergeSettings(PROFILE.settings);
  if(!PROFILE.pin_hash)return gate("pin-create");
  if(fresh)return unlock();
  gate("pin-unlock");
}
async function signOut(msg){UNLOCKED=false;clearData();if(LIVE)await sb.auth.signOut().catch(()=>{});USER=null;PROFILE=null;G.tab="signin";gate("welcome",msg||"")}
function mergeSettings(s){const o={...structuredClone(DEF_SETTINGS),...(s||{})};
  if(!Array.isArray(o.accounts)||!o.accounts.length)o.accounts=structuredClone(DEF_SETTINGS.accounts);
  if(!Array.isArray(o.sources)||!o.sources.length)o.sources=[...DEF_SETTINGS.sources];if(!Array.isArray(o.rules))o.rules=[...DEF_SETTINGS.rules];return o}
function clearData(){S.trades=[];S.cash=[];S.weeks={};S.notes={};S.settings=structuredClone(DEF_SETTINGS);F("main").innerHTML=""}
let lastLoad=0;
async function loadData(){
  const [trades,cash,weeks]=await Promise.all([Store.listTrades(),Store.listCash(),Store.listWeeks()]);
  S.cash=cash;S.weeks={};const nt={};Object.entries(weeks||{}).forEach(([k,v])=>{if(k.startsWith("day:"))nt[k.slice(4)]=v;else S.weeks[k]=v});
  if(notePending)nt[notePending.day]=notePending.body;S.notes=nt;lastLoad=Date.now();
  if(trades.length){S.trades=trades;S.sample=false}else{S.trades=makeSamples();S.sample=true}
}
async function unlock(){
  gate("loading");
  try{await loadData()}catch(x){return gate("pin-unlock",friendly(x))}
  UNLOCKED=true;F("gate").hidden=true;F("app").hidden=false;F("fab").hidden=false;
  fillAcctFilters();setSync();go(S.view);bump();
}
function lockNow(msg){if(!UNLOCKED)return;noteSaveNow();F("sheet").hidden=true;clearData();S.settings=mergeSettings(PROFILE&&PROFILE.settings);gate("pin-unlock",msg||"")}
let idleT=null;
function bump(){clearTimeout(idleT);const m=+S.settings.autoLock;if(UNLOCKED&&m>0)idleT=setTimeout(()=>lockNow("Locked after "+m+" minute"+(m>1?"s":"")+" without activity."),m*60000)}
["pointerdown","keydown","scroll","touchstart"].forEach(ev=>document.addEventListener(ev,()=>{if(UNLOCKED)bump()},{passive:true}));
document.addEventListener("visibilitychange",async()=>{if(document.visibilityState==="visible"&&UNLOCKED&&LIVE&&Date.now()-lastLoad>60000){try{await loadData();render()}catch(e){}}});
function setSync(){F("sync").innerHTML=LIVE?`<b>${esc(PROFILE.display_name||USER.email||USER.phone||"Signed in")}</b><br>Saved to your account`:"<b>Preview mode</b><br>Saved in this browser only"}

/* =====================================================================
   STATS
   ===================================================================== */
const acctOf=x=>x.account||S.settings.accounts[0]?.name||"";
const inScope=x=>!S.acct||acctOf(x)===S.acct;
const scopedTrades=()=>S.trades.filter(inScope);
function scopeStart(){const a=S.settings.accounts;return S.acct?(+(a.find(x=>x.name===S.acct)?.start)||0):a.reduce((s,x)=>s+(+x.start||0),0)}
const sortT=a=>a.slice().sort((x,y)=>(x.date+(x.time||"")).localeCompare(y.date+(y.time||"")));
const rOf=t=>t.risk>0?t.pnl/t.risk:null;
function stats(list){
  const n=list.length,w=list.filter(t=>t.pnl>0),l=list.filter(t=>t.pnl<0);
  const gw=w.reduce((a,t)=>a+t.pnl,0),gl=l.reduce((a,t)=>a+t.pnl,0),net=gw+gl;
  const rs=list.map(rOf).filter(v=>v!=null);
  let streakW=0,streakL=0,cw=0,cl=0;sortT(list).forEach(t=>{if(t.pnl>0){cw++;cl=0}else if(t.pnl<0){cl++;cw=0}streakW=Math.max(streakW,cw);streakL=Math.max(streakL,cl)});
  return {n,wins:w.length,losses:l.length,net,gw,gl,wr:n?w.length/n:null,pf:gl?gw/Math.abs(gl):(gw>0?Infinity:null),
    exp:n?net/n:null,avgW:w.length?gw/w.length:null,avgL:l.length?gl/l.length:null,avgR:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null,streakW,streakL};
}
function periodFrom(){
  if(S.period==="all")return "";const now=new Date();let from;
  if(S.period==="month")from=new Date(now.getFullYear(),now.getMonth(),1);
  else if(S.period==="year")from=new Date(now.getFullYear(),0,1);
  else{from=new Date(now);from.setDate(from.getDate()-(+S.period-1))}
  return ymd(from);
}
/* every trade in scope with the balance before it, its return on that balance, and a time-weighted index (deposits don't count as profit) */
function ledger(){
  const ev=[];scopedTrades().forEach(t=>ev.push({k:1,key:t.date+" "+(t.time||"12:00"),t}));
  if(!S.sample)S.cash.filter(inScope).forEach(c=>ev.push({k:0,key:c.date+" 00:00",c}));
  ev.sort((a,b)=>a.key.localeCompare(b.key)||a.k-b.k);
  let bal=scopeStart(),idx=1;const out=[];
  ev.forEach(e=>{if(!e.k){bal+=e.c.amount;return}const before=bal;bal+=e.t.pnl;const ret=before>0?e.t.pnl/before:null;const idx0=idx;idx*=1+(ret||0);out.push({t:e.t,before,after:bal,ret,idx0,idx})});
  return out;
}
function periodLedger(){const f=periodFrom();return ledger().filter(x=>x.t.date>=f)}
const twr=rows=>rows.length?rows[rows.length-1].idx/rows[0].idx0-1:null;
function bucketReturns(rows,keyFn){const m=new Map();rows.forEach(x=>{const k=keyFn(x.t);if(!m.has(k))m.set(k,{label:k,start:x.before,i0:x.idx0,i1:x.idx,pnl:0,n:0});const o=m.get(k);o.pnl+=x.t.pnl;o.n++;o.i1=x.idx});
  return [...m.values()].map(o=>({...o,ret:o.i1/o.i0-1}))}
function ddSeries(rows){if(!rows.length)return [];let peak=rows[0].idx0;const out=[0];rows.forEach(x=>{peak=Math.max(peak,x.idx);out.push(x.idx/peak-1)});return out}
function group(list,key){const m=new Map();list.forEach(t=>{const k=typeof key==="function"?key(t):t[key]||"—";if(!m.has(k))m.set(k,[]);m.get(k).push(t)});
  return [...m].map(([label,ts])=>{const s=stats(ts);return {label,pnl:s.net,n:s.n,wr:s.wr}}).sort((a,b)=>b.pnl-a.pnl)}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const sd=a=>{if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))};
function curBal(){if(S.sample)return scopeStart();return scopeStart()+scopedTrades().reduce((a,t)=>a+t.pnl,0)+S.cash.filter(inScope).reduce((a,c)=>a+c.amount,0)}
function todayStatus(){
  const td=ymd(new Date());const ts=S.sample?[]:scopedTrades().filter(t=>t.date===td);
  const pnl=ts.reduce((a,t)=>a+t.pnl,0);const lim=+S.settings.dailyLoss||0,maxT=+S.settings.maxTrades||0;
  let st="ok",txt="Clear to trade";
  if((lim&&pnl<=-lim)||(maxT&&ts.length>=maxT)){st="stop";txt="Stop for today"}
  else if((lim&&pnl<=-lim*.6)||(maxT&&ts.length>=maxT-1)){st="warn";txt="Near your limit"}
  return {ts,pnl,lim,maxT,st,txt};
}

/* =====================================================================
   CHARTS (SVG drawn at the card's real width so text stays readable)
   ===================================================================== */
function innerW(){const m=F("main");if(!m||!m.clientWidth)return 900;const cs=getComputedStyle(m);return m.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)}
const CWF=()=>Math.max(280,Math.round(innerW()-34));
const CW=()=>{const w=innerW();return Math.max(280,Math.round(window.innerWidth>820?(w-14)/2-34:w-34))};
const TXT='fill="#8792a3" font-size="11" font-family="JetBrains Mono,monospace"';
const TXC=c=>`fill="${c}" font-size="11" font-family="JetBrains Mono,monospace"`;
function niceStep(x){if(!(x>0))return 1;const p=10**Math.floor(Math.log10(x)),f=x/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
function niceTicks(mn,mx,n=4){const st=niceStep((mx-mn)/n);const out=[];for(let v=Math.ceil(mn/st)*st;v<=mx+st*1e-6;v+=st)out.push(+v.toFixed(10));return out}
function bars(rows,emptyMsg="No trades in this period"){
  if(!rows.length)return `<div class="empty">${emptyMsg}</div>`;
  const max=Math.max(...rows.map(r=>Math.abs(r.pnl)),1e-9);
  return `<div class="bars">${rows.map(r=>`<div class="bar"><span class="bl" title="${esc(r.label)}">${esc(r.label)}<small>${r.n} trade${r.n===1?"":"s"} · ${pct(r.wr)} win</small></span><span class="bt"><i class="${r.pnl>=0?"p":"n"}" style="width:${Math.abs(r.pnl)/max*50}%"></i></span><span class="bv ${cls(r.pnl)}">${money(r.pnl)}</span></div>`).join("")}</div>`;
}
function lineChart(vals,{W,H=200,fmt,first="",last="",color,area="toMin",base=null,label}){
  if(vals.length<2)return `<div class="empty">Log at least two trades to draw this chart.</div>`;
  const L=64,R=14,T=14,B=26;
  let mn=Math.min(...vals,base??Infinity),mx=Math.max(...vals,base??-Infinity);if(mx-mn<1e-9){mx+=1;mn-=1}
  const ticks=niceTicks(mn,mx,4);mn=Math.min(mn,ticks[0]);mx=Math.max(mx,ticks[ticks.length-1]);
  const X=i=>L+(W-L-R)*i/(vals.length-1),Y=v=>T+(H-T-B)*(1-(v-mn)/(mx-mn));
  const line=vals.map((v,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(v).toFixed(1)).join(" ");
  const yb=area==="toZero"?Y(0):H-B;
  const ar=line+` L${X(vals.length-1).toFixed(1)} ${yb.toFixed(1)} L${L} ${yb.toFixed(1)} Z`;
  const id="g"+Math.random().toString(36).slice(2,7);const flip=area==="toZero";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label||"")}">
   <defs><linearGradient id="${id}" x1="0" y1="${flip?1:0}" x2="0" y2="${flip?0:1}"><stop offset="0" stop-color="${color}" stop-opacity=".3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
   ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#252d39" stroke-dasharray="3 4"/><text x="${L-8}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end" ${TXT}>${esc(fmt(v))}</text>`).join("")}
   ${base!=null?`<line x1="${L}" x2="${W-R}" y1="${Y(base).toFixed(1)}" y2="${Y(base).toFixed(1)}" stroke="#f0a63a" stroke-opacity=".5"/>`:""}
   <path d="${ar}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
   <circle cx="${X(vals.length-1).toFixed(1)}" cy="${Y(vals[vals.length-1]).toFixed(1)}" r="4.5" fill="${color}" stroke="#141920" stroke-width="2"/>
   <text x="${L}" y="${H-6}" ${TXT}>${esc(first)}</text><text x="${W-R}" y="${H-6}" text-anchor="end" ${TXT}>${esc(last)}</text>
  </svg>`;
}
function vbars(items,{W,H=220,fmt,label}){
  if(!items.length)return `<div class="empty">No trades in this period.</div>`;
  const L=60,R=10,T=18,B=30;const vs=items.map(i=>i.v??0);
  let mn=Math.min(0,...vs),mx=Math.max(0,...vs);if(mx-mn<1e-9)mx=1;
  const ticks=niceTicks(mn,mx,4);mn=Math.min(mn,ticks[0]);mx=Math.max(mx,ticks[ticks.length-1]);
  const Y=v=>T+(H-T-B)*(1-(v-mn)/(mx-mn));const slot=(W-L-R)/items.length,bw=Math.max(2,Math.min(46,slot*.7));
  const every=Math.ceil(items.length/Math.max(1,Math.floor((W-L-R)/58)));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label||"")}">
   ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v===0?"#3a4453":"#252d39"}" ${v===0?"":'stroke-dasharray="3 4"'}/><text x="${L-8}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end" ${TXT}>${esc(fmt(v))}</text>`).join("")}
   ${items.map((it,i)=>{const v=it.v??0,x=L+slot*i+(slot-bw)/2,y0=Y(0),y1=Y(v);
     const lab=items.length<=12&&it.v!=null?(()=>{const ly=v>=0?y1-5:Math.min(y1+13,H-B-4);const inside=v<0&&y1+13>H-B-4;return `<text x="${(x+bw/2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" ${TXC(inside?"#0d1015":v>=0?"#2fbf87":"#ef5d5d")}>${esc(fmt(v))}</text>`})():"";
     return `<rect x="${x.toFixed(1)}" y="${Math.min(y0,y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,Math.abs(y1-y0)).toFixed(1)}" rx="2" fill="${v>=0?"#2fbf87":"#ef5d5d"}"><title>${esc(it.label)}: ${esc(fmt(v))}${it.tip?" · "+esc(it.tip):""}</title></rect>`+lab
     +(i%every===0?`<text x="${(L+slot*i+slot/2).toFixed(1)}" y="${H-8}" text-anchor="middle" ${TXT}>${esc(it.short||it.label)}</text>`:"")}).join("")}
  </svg>`;
}
function histogram(vals,{W,H=230,fmt,unit}){
  if(vals.length<3)return `<div class="empty">Log at least three trades to see the distribution.</div>`;
  let mn=Math.min(...vals),mx=Math.max(...vals);if(mx-mn<1e-12){mn-=1;mx+=1}
  const k=Math.max(6,Math.min(18,Math.round(Math.sqrt(vals.length))+3));
  const w=niceStep((mx-mn)/k);const lo=Math.floor(mn/w+1e-9)*w;let nb=Math.max(1,Math.ceil((mx-lo)/w-1e-9));if(lo+nb*w<=mx+1e-12)nb++;
  const counts=new Array(nb).fill(0);vals.forEach(v=>{counts[Math.min(nb-1,Math.max(0,Math.floor((v-lo)/w+1e-9)))]++});
  const L=40,R=12,T=16,B=40;const cmax=Math.max(...counts);const yt=niceTicks(0,cmax,Math.min(4,cmax)).filter(v=>Number.isInteger(v));const ymax=Math.max(cmax,yt[yt.length-1]||1);
  const X=v=>L+(W-L-R)*(v-lo)/(nb*w),Y=c=>T+(H-T-B)*(1-c/ymax);
  const every=Math.ceil((nb+1)/Math.max(2,Math.floor((W-L-R)/56)));const m=mean(vals);
  let out=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram of ${vals.length} trade results in ${esc(unit)}">`;
  yt.forEach(c=>out+=`<line x1="${L}" x2="${W-R}" y1="${Y(c).toFixed(1)}" y2="${Y(c).toFixed(1)}" stroke="#252d39" stroke-dasharray="3 4"/><text x="${L-8}" y="${(Y(c)+4).toFixed(1)}" text-anchor="end" ${TXT}>${c}</text>`);
  counts.forEach((c,i)=>{const a=lo+i*w,b=a+w;const x=X(a)+1,bw=Math.max(1,X(b)-X(a)-2);const col=(a+b)/2<0?"#ef5d5d":"#2fbf87";
    if(c)out+=`<rect x="${x.toFixed(1)}" y="${Y(c).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0)-Y(c)).toFixed(1)}" rx="2" fill="${col}" fill-opacity=".85"><title>${esc(fmt(a))} to ${esc(fmt(b))}: ${c} trade${c>1?"s":""}</title></rect>`});
  for(let i=0;i<=nb;i+=every){const v=lo+i*w;out+=`<line x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="${H-B}" y2="${H-B+4}" stroke="#3a4453"/><text x="${X(v).toFixed(1)}" y="${H-B+17}" text-anchor="middle" ${TXT}>${esc(fmt(+v.toFixed(10)))}</text>`}
  if(lo<0&&lo+nb*w>0)out+=`<line x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" y1="${T-6}" y2="${H-B}" stroke="#3a4453"/>`;
  out+=`<line x1="${X(m).toFixed(1)}" x2="${X(m).toFixed(1)}" y1="${T-6}" y2="${H-B}" stroke="#f0a63a" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${(X(m)+5).toFixed(1)}" y="${T+4}" ${TXC("#f0a63a")}>avg ${esc(fmt(m))}</text>`;
  out+=`<line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" stroke="#3a4453"/><text x="${(L+W-R)/2}" y="${H-4}" text-anchor="middle" fill="#8792a3" font-size="11" font-family="IBM Plex Sans,sans-serif">Result per trade (${esc(unit)}) · height = trades</text></svg>`;
  return out;
}

/* =====================================================================
   VIEWS
   ===================================================================== */
function headHTML(title,sub,right=""){return `<div class="head"><div><h1>${title}</h1>${sub?`<div class="sub">${sub}</div>`:""}</div>${right}</div>`}
function sampleBanner(){return S.sample?`<div class="banner"><span><b>Example trades.</b> These are made-up so you can see how the journal reads. They disappear when you log your first real trade.</span><button class="btn sm primary" data-act="add">Log my first trade</button></div>`:""}
function periodSeg(){const o=[["7","7D"],["30","30D"],["month","Month"],["90","90D"],["year","Year"],["all","All"]];
  return `<div class="seg" role="group" aria-label="Period">${o.map(([v,l])=>`<button data-period="${v}" aria-pressed="${S.period===v}">${l}</button>`).join("")}</div>`}
const periodName=()=>({all:"all time",month:"this month",year:"this year"}[S.period]||"last "+S.period+" days")+(S.acct?" · "+esc(S.acct):"");

function vDashboard(){
  const rows=periodLedger(),list=rows.map(x=>x.t),s=stats(list),td=todayStatus();
  const startBal=rows.length?rows[0].before:curBal(),endBal=rows.length?rows[rows.length-1].after:curBal();
  const eq=rows.length?[rows[0].before,...rows.map(x=>x.after)]:[];const dd=ddSeries(rows);const maxDD=dd.length?Math.min(...dd):0;
  const followed=list.filter(t=>t.followed),broke=list.filter(t=>!t.followed);
  const mist=new Map();broke.forEach(t=>(t.mistakes&&t.mistakes.length?t.mistakes:["Unlabelled"]).forEach(m=>{const o=mist.get(m)||{label:m,pnl:0,n:0,w:0};o.pnl+=t.pnl;o.n++;if(t.pnl>0)o.w++;mist.set(m,o)}));
  const mrows=[...mist.values()].map(o=>({...o,wr:o.w/o.n})).sort((a,b)=>a.pnl-b.pnl);
  const sf=stats(followed),sb_=stats(broke);const ret=twr(rows);
  const up=eq.length&&eq[eq.length-1]>=eq[0];
  const ses=group(list,"session").filter(r=>r.n>=3&&r.label!=="—").sort((a,b)=>b.pnl-a.pnl);
  const sesTip=ses.length>=2?`<p class="sub" style="margin:10px 0 0">Best: <b>${esc(ses[0].label)}</b> (${pct(ses[0].wr)} win, <span class="${cls(ses[0].pnl)}">${money(ses[0].pnl)}</span>). Weakest: <b>${esc(ses[ses.length-1].label)}</b> (${pct(ses[ses.length-1].wr)} win, <span class="${cls(ses[ses.length-1].pnl)}">${money(ses[ses.length-1].pnl)}</span>).</p>`:"";
  const ckN=list.filter(t=>!(t.mistakes||[]).some(m=>m.startsWith("Skipped rule: "))).length;
  return headHTML("Dashboard",`${s.n} trades · ${periodName()}`,`<div class="headright">${sessCardHTML()}${periodSeg()}</div>`)+sampleBanner()+`
  <div class="card status" style="margin-bottom:14px"><span class="pill ${td.st}">${td.txt}</span>
    <span class="stat-line">Today <b class="${cls(td.pnl)}">${money(td.pnl)}</b>${td.lim?` of −${cur()}${(+td.lim).toFixed(2)} limit`:""}</span>
    <span class="stat-line">Trades <b>${td.ts.length}</b>${td.maxT?` / ${td.maxT}`:""}</span>
    ${td.lim?`<span class="meter" title="Daily loss used"><i class="${td.st==="stop"?"bad":""}" style="width:${Math.min(100,Math.max(0,-td.pnl/td.lim*100))}%"></i></span>`:""}</div>
  ${propPanels()}
  <div class="grid kpis">
    <div class="card kpi"><div class="k">Net P&amp;L</div><div class="v ${cls(s.net)}">${money(s.net)}</div><div class="s">Balance ${money(endBal,false)}</div></div>
    <div class="card kpi"><div class="k">Return</div><div class="v ${cls(ret)}">${spct(ret)}</div><div class="s">Deposits excluded</div></div>
    <div class="card kpi"><div class="k">Win rate</div><div class="v">${pct(s.wr)}</div><div class="s">${s.wins}W · ${s.losses}L · best run ${s.streakW}W</div></div>
    <div class="card kpi"><div class="k">Profit factor</div><div class="v ${s.pf!=null&&s.pf>=1?"pos":s.pf!=null?"neg":""}">${s.pf===Infinity?"∞":fx(s.pf)}</div><div class="s">Gross ${money(s.gw,false)} / ${money(Math.abs(s.gl),false)}</div></div>
    <div class="card kpi"><div class="k">Avg R</div><div class="v ${cls(s.avgR)}">${s.avgR==null?"–":(s.avgR>0?"+":"")+fx(s.avgR)+"R"}</div><div class="s">Expectancy ${money(s.exp)}/trade</div></div>
    <div class="card kpi"><div class="k">Max drawdown</div><div class="v ${cls(maxDD)}">${spct(maxDD,1)}</div><div class="s">Worst run ${s.streakL} losses</div></div>
  </div>
  <div class="card chart mt"><h2>Equity curve</h2>${lineChart(eq,{W:CWF(),fmt:v=>cur()+(Math.abs(v)>=1000?Math.round(v).toLocaleString("en"):v.toFixed(2)),first:list[0]?.date||"",last:list[list.length-1]?.date||"",color:up?"#2fbf87":"#ef5d5d",base:scopeStart(),label:"Account balance over time"})}
    <div class="legend"><span><i style="background:${up?"#2fbf87":"#ef5d5d"}"></i>Balance (includes deposits)</span><span><i style="background:#f0a63a"></i>Starting balance</span></div></div>
  <div class="grid two mt">
    <div class="card"><h2>Manual vs bots</h2>${bars(group(list,"source"))}</div>
    <div class="card"><h2>By symbol</h2>${bars(group(list,"symbol").slice(0,7))}</div>
    <div class="card"><h2>By setup</h2>${bars(group(list,"setup"))}</div>
    <div class="card"><h2>By session</h2>${bars(group(list,"session"))}${sesTip}</div>
    <div class="card"><h2>By weekday</h2>${bars(group(list,t=>DOW[monIdx(parseDay(t.date))]).sort((a,b)=>DOW.indexOf(a.label)-DOW.indexOf(b.label)))}</div>
    <div class="card"><h2>Discipline</h2>
      <div class="status" style="margin-bottom:12px"><span class="stat-line">Plan followed <b>${pct(list.length?followed.length/list.length:null)}</b></span><span class="stat-line">Checklist complete <b>${pct(list.length?ckN/list.length:null)}</b></span></div>
      <div style="margin-bottom:14px">${bars([{label:"Followed plan",pnl:sf.net,n:sf.n,wr:sf.wr},{label:"Broke plan",pnl:sb_.net,n:sb_.n,wr:sb_.wr}].filter(r=>r.n))}</div>
      <h3 style="font-size:13px;color:var(--muted)">What mistakes cost</h3>${bars(mrows,"No rule breaks logged in this period")}
    </div>
  </div>`;
}

function vReturns(){
  const rows=periodLedger(),W=CW(),WF=CWF();
  const rets=rows.map(x=>x.ret).filter(v=>v!=null);
  const total=twr(rows);
  const months=bucketReturns(rows,t=>t.date.slice(0,7)),days=bucketReturns(rows,t=>t.date),weeks=bucketReturns(rows,t=>isoWeek(parseDay(t.date)));
  const dd=ddSeries(rows),maxDD=dd.length?Math.min(...dd):0;
  const cum=rows.length?[0,...rows.map(x=>x.idx/rows[0].idx0-1)]:[];
  const best=rows.reduce((b,x)=>x.ret!=null&&(!b||x.ret>b.ret)?x:b,null),worst=rows.reduce((b,x)=>x.ret!=null&&(!b||x.ret<b.ret)?x:b,null);
  const bm=months.reduce((b,x)=>!b||x.ret>b.ret?x:b,null),wm=months.reduce((b,x)=>!b||x.ret<b.ret?x:b,null);
  const posM=months.filter(m=>m.ret>0).length;
  const dRets=days.map(d=>d.ret).filter(v=>v!=null),dMean=mean(dRets),dSd=sd(dRets);
  const sharpe=dSd>0?dMean/dSd*Math.sqrt(252):null;
  const hv=S.hunit==="pct"?rets.map(r=>r*100):S.hunit==="r"?rows.map(x=>rOf(x.t)).filter(v=>v!=null):rows.map(x=>x.t.pnl);
  const hfmt=S.hunit==="pct"?v=>(Math.abs(v)<1&&v!==0?v.toFixed(2):v.toFixed(1))+"%":S.hunit==="r"?v=>fx(v,1)+"R":v=>cur()+fx(v,Math.abs(v)<10?2:0);
  const hunit=S.hunit==="pct"?"% of balance":S.hunit==="r"?"R multiples":cur()+" profit / loss";
  const hseg=`<div class="seg" role="group" aria-label="Histogram unit">${[["pct","% return"],["r","R"],["usd",cur()]].map(([v,l])=>`<button data-hunit="${v}" aria-pressed="${S.hunit===v}">${esc(l)}</button>`).join("")}</div>`;
  const mlabel=k=>{const [y,m]=k.split("-");return new Date(+y,+m-1,1).toLocaleString("en",{month:"short"})+" "+y.slice(2)};
  const recentDays=days.slice(-30);const winsR=hv.filter(v=>v>0).length,lossR=hv.filter(v=>v<0).length;
  const pf=v=>(v>0?"+":"")+v.toFixed(Math.abs(v)<10?1:0)+"%";
  return headHTML("Returns",`${rows.length} trades · ${periodName()} · each trade's return is measured on the balance before it`,periodSeg())+sampleBanner()+`
  <div class="grid kpis">
    <div class="card kpi"><div class="k">Total return</div><div class="v ${cls(total)}">${spct(total)}</div><div class="s">Time-weighted, deposits excluded</div></div>
    <div class="card kpi"><div class="k">Avg per trade</div><div class="v ${cls(mean(rets))}">${spct(mean(rets))}</div><div class="s">Spread ±${rets.length>1?(sd(rets)*100).toFixed(2)+"%":"–"}</div></div>
    <div class="card kpi"><div class="k">Avg per month</div><div class="v ${cls(mean(months.map(m=>m.ret)))}">${spct(mean(months.map(m=>m.ret)))}</div><div class="s">${posM} of ${months.length} months green</div></div>
    <div class="card kpi"><div class="k">Best / worst month</div><div class="v" style="font-size:18px"><span class="${cls(bm?.ret)}">${spct(bm?.ret,1)}</span> <span class="flat">/</span> <span class="${cls(wm?.ret)}">${spct(wm?.ret,1)}</span></div><div class="s">${bm?mlabel(bm.label)+" / "+mlabel(wm.label):"–"}</div></div>
    <div class="card kpi"><div class="k">Best / worst trade</div><div class="v" style="font-size:18px"><span class="${cls(best?.ret)}">${spct(best?.ret,1)}</span> <span class="flat">/</span> <span class="${cls(worst?.ret)}">${spct(worst?.ret,1)}</span></div><div class="s">${best?esc(best.t.symbol)+" / "+esc(worst.t.symbol):"–"}</div></div>
    <div class="card kpi"><div class="k">Sharpe (daily)</div><div class="v ${cls(sharpe)}">${fx(sharpe)}</div><div class="s">Return ÷ drawdown ${maxDD<0&&total!=null?fx(total/Math.abs(maxDD)):"–"}</div></div>
  </div>
  <div class="card chart mt"><div class="cardhead"><h2>Distribution of trade results</h2>${hseg}</div>
    ${histogram(hv,{W:WF,fmt:hfmt,unit:hunit})}
    <div class="legend"><span><i style="background:#2fbf87"></i>Winning trades (${winsR})</span><span><i style="background:#ef5d5d"></i>Losing trades (${lossR})</span><span><i style="background:#f0a63a"></i>Average</span></div></div>
  <div class="grid ch2 mt">
    <div class="card chart"><h2>Monthly returns</h2>${vbars(months.map(m=>({label:m.label,short:mlabel(m.label),v:m.ret*100,tip:m.n+" trades, "+money(m.pnl)})),{W,fmt:pf,label:"Return per month"})}</div>
    <div class="card chart"><h2>Weekly returns</h2>${vbars(weeks.slice(-16).map(w=>({label:w.label,short:w.label.slice(5),v:w.ret*100,tip:w.n+" trades, "+money(w.pnl)})),{W,fmt:pf,label:"Return per week"})}</div>
    <div class="card chart"><h2>Cumulative return</h2>${lineChart(cum.map(v=>v*100),{W,fmt:pf,first:rows[0]?.t.date||"",last:rows[rows.length-1]?.t.date||"",color:(cum[cum.length-1]??0)>=0?"#2fbf87":"#ef5d5d",base:0,label:"Cumulative return in percent"})}</div>
    <div class="card chart"><h2>Drawdown from peak</h2>${lineChart(dd.map(v=>v*100),{W,fmt:v=>v.toFixed(Math.abs(v)<10?1:0)+"%",first:rows[0]?.t.date||"",last:rows[rows.length-1]?.t.date||"",color:"#ef5d5d",area:"toZero",label:"Drawdown in percent"})}</div>
  </div>
  <div class="card chart mt"><h2>Daily P&amp;L · last ${recentDays.length} trading days</h2>${vbars(recentDays.map(d=>({label:d.label,short:d.label.slice(8)+"/"+d.label.slice(5,7),v:d.pnl,tip:d.n+" trades, "+spct(d.ret)})),{W:WF,fmt:v=>(v<0?"−":v>0?"+":"")+cur()+Math.abs(v).toFixed(Math.abs(v)<100?2:0),label:"Profit or loss per day"})}
    <p class="sub">Average day ${spct(dMean)} with a spread of ±${dSd==null?"–":(dSd*100).toFixed(2)+"%"} across ${dRets.length} trading days.</p></div>`;
}

function vCalendar(){
  const m=S.calMonth,y=m.getFullYear(),mo=m.getMonth();
  const first=new Date(y,mo,1),start=new Date(first);start.setDate(1-monIdx(first));
  const byDay=new Map();scopedTrades().forEach(t=>{const o=byDay.get(t.date)||{pnl:0,n:0};o.pnl+=t.pnl;o.n++;byDay.set(t.date,o)});
  const mk=y+"-"+pad(mo+1);const mrows=ledger().filter(x=>x.t.date.startsWith(mk));const ms=stats(mrows.map(x=>x.t));const mret=twr(mrows);
  let maxAbs=1e-9;byDay.forEach((v,k)=>{if(k.startsWith(mk))maxAbs=Math.max(maxAbs,Math.abs(v.pnl))});
  const today=ymd(new Date());let cells=DOW.map(d=>`<div class="dow">${d}</div>`).join("")+`<div class="dow wkh">Week</div>`;
  const d=new Date(start);let greenDays=0,redDays=0;
  for(let w=0;w<6;w++){
    let wp=0,wn=0;
    for(let i=0;i<7;i++){
      const k=ymd(d),o=byDay.get(k),inM=d.getMonth()===mo;
      if(o&&inM){wp+=o.pnl;wn+=o.n;if(o.pnl>0)greenDays++;else if(o.pnl<0)redDays++}
      const a=o?Math.min(1,Math.abs(o.pnl)/maxAbs):0;
      const bg=o?(o.pnl>=0?`rgba(47,191,135,${.10+a*.32})`:`rgba(239,93,93,${.10+a*.32})`):"";
      const hasN=inM&&S.notes[k]&&S.notes[k].trim();
      cells+=`<button class="day${inM?"":" out"}${k===today?" today":""}" data-day="${k}" style="${bg?"background:"+bg:""}" aria-label="${k}${o?", "+o.n+" trades, "+money(o.pnl):""}"><span class="dn">${d.getDate()}${hasN?'<i class="nmark" title="Has a note">✎</i>':""}</span>${o?`<span><div class="dp ${cls(o.pnl)}">${money(o.pnl)}</div><div class="dc">${o.n} trade${o.n>1?"s":""}</div></span>`:""}</button>`;
      d.setDate(d.getDate()+1);
    }
    cells+=`<div class="wk"><span class="dc" style="color:var(--muted)">${wn} trade${wn===1?"":"s"}</span><span class="dp ${cls(wp)}">${wn?money(wp):"–"}</span></div>`;
    if(d.getMonth()!==mo&&w>=3)break;
  }
  const nav=`<div class="calhead"><button class="btn sm" data-cal="-1" aria-label="Previous month">‹</button><h3>${first.toLocaleString("en",{month:"long",year:"numeric"})}</h3><button class="btn sm" data-cal="1" aria-label="Next month">›</button><button class="btn sm ghost" data-cal="0">Today</button><button class="btn sm" data-report="${mk}">Monthly report</button></div>`;
  return headHTML("Calendar",`Month <span class="num ${cls(ms.net)}">${money(ms.net)}</span> (<span class="num ${cls(mret)}">${spct(mret,1)}</span>) · ${ms.n} trades · ${greenDays} green days, ${redDays} red`,nav)+sampleBanner()+`<div class="cal">${cells}</div><p class="sub mt">Tap a day to open its page: that day's trades and your note (✎ marks days with a note).</p>`;
}

function sourcesList(){return [...new Set([...(S.settings.sources||[]),...S.trades.map(t=>t.source).filter(Boolean)])]}
function filteredTrades(){
  const f=S.tf,q=f.q.trim().toLowerCase();
  return ledger().reverse().filter(({t})=>(!q||[t.symbol,t.setup,t.notes,t.market].join(" ").toLowerCase().includes(q))&&(!f.src||t.source===f.src)&&(!f.res||(f.res==="win"?t.pnl>0:f.res==="loss"?t.pnl<0:!t.followed))&&(!f.date||t.date===f.date));
}
function vTrades(){
  const list=filteredTrades(),s=stats(list.map(x=>x.t));
  const filters=`<div class="filters"><input class="input" id="tq" type="search" placeholder="Search symbol, setup, notes" value="${esc(S.tf.q)}" aria-label="Search trades">
   <select class="input" id="tsrc" aria-label="Taken by"><option value="">All sources</option>${sourcesList().map(x=>`<option${S.tf.src===x?" selected":""}>${esc(x)}</option>`).join("")}</select>
   <select class="input" id="tres" aria-label="Result"><option value="">All results</option><option value="win"${S.tf.res==="win"?" selected":""}>Winners</option><option value="loss"${S.tf.res==="loss"?" selected":""}>Losers</option><option value="broke"${S.tf.res==="broke"?" selected":""}>Broke plan</option></select>
   ${S.tf.date?`<button class="btn sm" data-act="cleardate">${esc(S.tf.date)} ✕</button>`:""}</div>`;
  const rows=list.map(({t,ret})=>{const r=rOf(t);return `<button class="row" data-edit="${esc(t.id)}">
     <span class="c-date mono" style="font-size:13px">${esc(t.date.slice(5))}<br><span class="flat">${esc(fmtT(t.time))}</span></span>
     <span class="sym">${esc(t.symbol)}${t.shot||t.link?" 📷":""}<small>${esc(t.date.slice(5))} · ${esc(t.source)} · <span class="${cls(ret)}">${spct(ret)}</span></small></span>
     <span class="c-dir dir ${t.dir==="Buy"?"buy":"sell"}">${esc(String(t.dir).toUpperCase())}</span>
     <span class="c-src ell">${esc(t.source)}</span>
     <span class="c-setup ell">${esc(t.setup||"—")}${!t.followed?`<br><span class="tag bad">${esc((t.mistakes||[])[0]||"Broke plan")}</span>`:""}</span>
     <span class="c-r r mono ${cls(r)}">${r==null?"–":(r>0?"+":"")+r.toFixed(1)+"R"}</span>
     <span class="c-ret r mono ${cls(ret)}">${spct(ret,1)}</span>
     <span class="r mono ${cls(t.pnl)}">${money(t.pnl)}</span></button>`}).join("");
  return headHTML("Trades",`${s.n} shown · net <span class="num ${cls(s.net)}">${money(s.net)}</span> · ${pct(s.wr)} win rate`,`<span class="inline"><button class="btn" data-act="gomt5">Import from MT5</button><button class="btn primary" data-act="add">+ Log trade</button></span>`)+sampleBanner()+filters+
   (list.length?`<div class="rows"><div class="row th"><span class="c-date">Date</span><span>Symbol</span><span class="c-dir">Side</span><span class="c-src">Taken by</span><span class="c-setup">Setup</span><span class="c-r r">R</span><span class="c-ret r">Return</span><span class="r">P&amp;L</span></div>${rows}</div>`:`<div class="card empty">No trades match these filters.</div>`);
}

/* ---------- calculators ---------- */
function insOptions(sel){const g={};INS.forEach(i=>(g[i.grp]=g[i.grp]||[]).push(i));return Object.entries(g).map(([k,a])=>`<optgroup label="${esc(k)}">${a.map(i=>`<option value="${esc(i.s)}"${i.s===sel?" selected":""}>${esc(i.s)}</option>`).join("")}</optgroup>`).join("")}
const TS={ps:"EURUSD",pl:"EURUSD",pv:"EURUSD",pc:"EURUSD",rr:"EURUSD",mg:"EURUSD"};
function insBlock(p){return `<div class="f"><label for="${p}Ins">Instrument</label><select class="input" id="${p}Ins">${insOptions(TS[p])}</select></div>
  <div class="f" id="${p}CustW" hidden><label for="${p}Con">Contract size</label><input class="input num" id="${p}Con" inputmode="decimal" value="1"></div>
  <div class="f" id="${p}PipW" hidden><label for="${p}Pip">Pip / point size</label><input class="input num" id="${p}Pip" inputmode="decimal" value="1"></div>
  <div class="f" id="${p}ConvW" hidden><label for="${p}Conv" id="${p}ConvL">Rate</label><input class="input num" id="${p}Conv" inputmode="decimal"></div>`}
function vTools(){
  const bal=curBal();const st=S.settings;
  return headHTML("Calculators","Lot size, pips, pip value, profit, reward : risk, margin and growth. Tap \"How to use\" on any calculator for simple steps and an example. Results are in your account currency (USD).")+`
  <div class="grid tools">
   <div class="card tool" data-tool="ps">${toolHead("ps","Position size &amp; risk")}
    <div class="form">
     <div class="f"><label for="psBal">Account balance</label><input class="input num" id="psBal" inputmode="decimal" value="${bal.toFixed(2)}"></div>
     <div class="f"><label for="psMode">Risk as</label><select class="input" id="psMode"><option value="pct">% of balance</option><option value="amt">Fixed amount</option></select></div>
     <div class="f"><label for="psRisk" id="psRiskL">Risk %</label><input class="input num" id="psRisk" inputmode="decimal" value="${esc(st.riskPct)}"></div>
     ${insBlock("ps")}
     <div class="f"><label for="psDir">Direction</label><select class="input" id="psDir"><option>Buy</option><option>Sell</option></select></div>
     <div class="f"><label for="psEntry">Entry price</label><input class="input num" id="psEntry" inputmode="decimal" placeholder="1.08500"></div>
     <div class="f"><label for="psSL">Stop-loss price</label><input class="input num" id="psSL" inputmode="decimal" placeholder="1.08300"></div>
     <div class="f"><label for="psPips">…or stop in pips</label><input class="input num" id="psPips" inputmode="decimal" placeholder="20"></div>
     <div class="f"><label for="psTP">Take-profit price</label><input class="input num" id="psTP" inputmode="decimal" placeholder="1.08900"></div>
     <div class="f"><label for="psLev">Leverage 1:</label><input class="input num" id="psLev" inputmode="numeric" value="${esc(st.leverage)}"></div>
    </div>
    <div class="calcout" id="psOut"></div><div id="psWarn"></div></div>

   <div class="card tool" data-tool="pl">${toolHead("pl","Profit / loss")}
    <div class="form">${insBlock("pl")}
     <div class="f"><label for="plDir">Direction</label><select class="input" id="plDir"><option>Buy</option><option>Sell</option></select></div>
     <div class="f"><label for="plLots">Lots</label><input class="input num" id="plLots" inputmode="decimal" value="0.10"></div>
     <div class="f"><label for="plEntry">Entry</label><input class="input num" id="plEntry" inputmode="decimal" placeholder="1.08500"></div>
     <div class="f"><label for="plExit">Exit</label><input class="input num" id="plExit" inputmode="decimal" placeholder="1.08900"></div>
    </div><div class="calcout" id="plOut"></div></div>

   <div class="card tool" data-tool="pv">${toolHead("pv","Pip value")}
    <div class="form">${insBlock("pv")}
     <div class="f"><label for="pvLots">Lots</label><input class="input num" id="pvLots" inputmode="decimal" value="1"></div>
     <div class="f"><label for="pvPrice">Current price</label><input class="input num" id="pvPrice" inputmode="decimal" placeholder="Needed for USD-base pairs"></div>
    </div><div class="calcout" id="pvOut"></div></div>

   <div class="card tool" data-tool="pc">${toolHead("pc","Pip counter")}
    <div class="form">${insBlock("pc")}
     <div class="f"><label for="pcA">First price</label><input class="input num" id="pcA" inputmode="decimal" placeholder="1.08500"></div>
     <div class="f"><label for="pcB">Second price</label><input class="input num" id="pcB" inputmode="decimal" placeholder="1.08750"></div>
     <div class="f"><label for="pcLots">Lots (optional)</label><input class="input num" id="pcLots" inputmode="decimal" value="0.01"></div>
    </div><div class="calcout" id="pcOut"></div></div>

   <div class="card tool" data-tool="rr">${toolHead("rr","Reward : risk")}
    <div class="form">${insBlock("rr")}
     <div class="f"><label for="rrDir">Direction</label><select class="input" id="rrDir"><option>Buy</option><option>Sell</option></select></div>
     <div class="f"><label for="rrE">Entry price</label><input class="input num" id="rrE" inputmode="decimal" placeholder="1.08500"></div>
     <div class="f"><label for="rrSL">Stop-loss price</label><input class="input num" id="rrSL" inputmode="decimal" placeholder="1.08300"></div>
     <div class="f"><label for="rrTP">Take-profit price</label><input class="input num" id="rrTP" inputmode="decimal" placeholder="1.09100"></div>
    </div><div class="calcout" id="rrOut"></div><div id="rrWarn"></div></div>

   <div class="card tool" data-tool="mg">${toolHead("mg","Margin")}
    <div class="form">${insBlock("mg")}
     <div class="f"><label for="mgLots">Lots</label><input class="input num" id="mgLots" inputmode="decimal" value="0.10"></div>
     <div class="f"><label for="mgPrice">Current price</label><input class="input num" id="mgPrice" inputmode="decimal" placeholder="1.08500"></div>
     <div class="f"><label for="mgLev">Leverage 1:</label><input class="input num" id="mgLev" inputmode="numeric" value="${esc(st.leverage)}"></div>
    </div><div class="calcout" id="mgOut"></div></div>

   <div class="card tool" data-tool="be">${toolHead("be","Break-even &amp; expectancy")}
    <div class="form">
     <div class="f"><label for="beRR">Reward : risk (1 : x)</label><input class="input num" id="beRR" inputmode="decimal" value="2"></div>
     <div class="f"><label for="beWR">Your win rate %</label><input class="input num" id="beWR" inputmode="decimal" value="${S.sample?45:Math.round((stats(scopedTrades()).wr||0.45)*100)}"></div>
     <div class="f"><label for="beRisk">Risk per trade (${esc(cur())})</label><input class="input num" id="beRisk" inputmode="decimal" value="${(bal*st.riskPct/100).toFixed(2)}"></div>
     <div class="f"><label for="beDD">Drawdown to recover %</label><input class="input num" id="beDD" inputmode="decimal" value="20"></div>
    </div><div class="calcout" id="beOut"></div></div>

   <div class="card tool" data-tool="cg" style="grid-column:1/-1">${toolHead("cg","Compounding growth")}
    <div class="form">
     <div class="f"><label for="cgStart">Starting balance</label><input class="input num" id="cgStart" inputmode="decimal" value="${bal.toFixed(2)}"></div>
     <div class="f"><label for="cgRate">Gain per period %</label><input class="input num" id="cgRate" inputmode="decimal" value="2"></div>
     <div class="f"><label for="cgPer">Period</label><select class="input" id="cgPer"><option value="day">Trading day</option><option value="week" selected>Week</option><option value="month">Month</option></select></div>
     <div class="f"><label for="cgN">Number of periods</label><input class="input num" id="cgN" inputmode="numeric" value="52"></div>
     <div class="f"><label for="cgAdd">Add each period (${esc(cur())})</label><input class="input num" id="cgAdd" inputmode="decimal" value="0"></div>
    </div><div class="calcout" id="cgOut"></div><div class="chart mt" id="cgChart"></div></div>
  </div>
  <p class="sub mt">Contract sizes follow common MT5 specs (forex 100,000; gold 100 oz; Deriv synthetics 1, Step Index 10). Brokers differ, so confirm in MT5 → Symbol → Specification.</p>`;
}
function readIns(p){
  const ins={...insBy(F(p+"Ins").value)};TS[p]=ins.s;
  F(p+"CustW").hidden=F(p+"PipW").hidden=!ins.custom;
  if(ins.custom){ins.contract=num(F(p+"Con").value)||1;ins.pip=num(F(p+"Pip").value)||1}
  const need=convNeed(ins);F(p+"ConvW").hidden=!need;
  if(need){F(p+"ConvL").textContent=need.pair+" rate (to convert "+ins.quote+" to USD)";F(p+"Conv").placeholder=need.pair==="USDJPY"?"153.20":need.pair==="EURUSD"?"1.0850":""}
  return {ins,conv:need?num(F(p+"Conv").value):null};
}
const fmtLots=(l,step)=>l==null?"–":l.toFixed(step<0.01?3:2);
const out=(arr)=>arr.map(([k,v,c,hero])=>`<div class="${hero?"hero":""}"><small>${k}</small><b class="${c||""}">${v}</b></div>`).join("");
function runTool(name){
  const $v=id=>num(F(id)&&F(id).value);
  if(name==="ps"){
    const {ins,conv}=readIns("ps");const bal=$v("psBal"),mode=F("psMode").value,rv=$v("psRisk"),e=$v("psEntry"),sl=$v("psSL"),tp=$v("psTP"),lev=$v("psLev");
    F("psRiskL").textContent=mode==="pct"?"Risk %":"Risk amount ("+cur()+")";
    const risk=mode==="pct"?(bal!=null&&rv!=null?bal*rv/100:null):rv;
    const pips=e!=null&&sl!=null?Math.abs(e-sl)/ins.pip:$v("psPips");
    const price=e??null;const qf=quoteUSD(ins,price,conv);
    const pvLot=qf!=null?ins.contract*ins.pip*qf:null;
    const raw=risk!=null&&pips>0&&pvLot?risk/(pips*pvLot):null;
    const lots=raw!=null?Math.floor(raw/ins.step+1e-9)*ins.step:null;
    const realRisk=lots!=null?lots*pips*pvLot:null;
    const rr=e!=null&&sl!=null&&tp!=null&&Math.abs(e-sl)>0?Math.abs(tp-e)/Math.abs(e-sl):null;
    const tpProfit=rr!=null&&realRisk!=null?realRisk*rr:null;
    const margin=lots!=null&&price!=null&&qf!=null&&lev>0?lots*ins.contract*price*qf/lev:null;
    const wrongSide=e!=null&&sl!=null&&((F("psDir").value==="Buy"&&sl>=e)||(F("psDir").value==="Sell"&&sl<=e));
    F("psOut").innerHTML=out([["Lot size",fmtLots(lots,ins.step),"",1],["Risk amount",risk==null?"–":money(risk,false)],["Stop",pips==null?"–":fx(pips,1)+" "+ins.unit.split(" ")[0]],["Pip value / lot",pvLot==null?"–":money(pvLot,false)],
      ["Actual risk",realRisk==null?"–":money(realRisk,false)+(bal?" ("+(realRisk/bal*100).toFixed(2)+"%)":"")],["Reward : risk",rr==null?"–":"1 : "+rr.toFixed(2)],["Profit at TP",tpProfit==null?"–":money(tpProfit),"pos"],["Margin needed",margin==null?"–":money(margin,false)+(bal?" ("+(margin/bal*100).toFixed(1)+"%)":"")]]);
    const w=[];if(wrongSide)w.push("Your stop is on the wrong side of the entry for a "+F("psDir").value.toLowerCase()+".");
    if(qf==null&&ins.base==="USD")w.push("Enter the entry price so the pip value can be converted to USD.");
    if(qf==null&&convNeed(ins))w.push("Enter the "+convNeed(ins).pair+" rate to convert to USD.");
    if(lots!=null&&ins.min&&lots<ins.min)w.push(`${ins.s} minimum lot is ${ins.min}. At that size this stop would risk ${money(ins.min*pips*pvLot,false)}, more than you planned.`);
    else if(lots===0)w.push("The risk is too small for the minimum lot step. Increase risk or tighten the stop.");
    if(margin!=null&&bal&&margin>bal)w.push("Margin needed is more than your balance.");
    F("psWarn").innerHTML=w.map(x=>`<div class="warnline">⚠ ${esc(x)}</div>`).join("");
  }
  if(name==="pl"){
    const {ins,conv}=readIns("pl");const lots=$v("plLots"),e=$v("plEntry"),x=$v("plExit");const sg=F("plDir").value==="Buy"?1:-1;
    const qf=quoteUSD(ins,x??e,conv);const pips=e!=null&&x!=null?sg*(x-e)/ins.pip:null;
    const pnl=pips!=null&&lots!=null&&qf!=null?pips*ins.contract*ins.pip*qf*lots:null;const bal=curBal();
    F("plOut").innerHTML=out([["Profit / loss",pnl==null?"–":money(pnl),cls(pnl),1],["Move",pips==null?"–":(pips>0?"+":"")+fx(pips,1)+" "+ins.unit.split(" ")[0],cls(pips)],["Of balance",pnl==null||!(bal>0)?"–":spct(pnl/bal),cls(pnl)]]);
  }
  if(name==="pv"){
    const {ins,conv}=readIns("pv");const lots=$v("pvLots"),p=$v("pvPrice");const qf=quoteUSD(ins,p,conv);const v=qf!=null&&lots!=null?ins.contract*ins.pip*qf*lots:null;
    F("pvOut").innerHTML=out([["Per "+ins.unit.split(" ")[0].replace(/s$/,""),v==null?"–":money(v,false),"",1],["Per 10",v==null?"–":money(v*10,false)],["Per 100",v==null?"–":money(v*100,false)]]);
  }
  if(name==="pc"){
    const {ins,conv}=readIns("pc");const a=$v("pcA"),b=$v("pcB"),l=$v("pcLots");const u=ins.unit.split(" ")[0];
    const pips=a!=null&&b!=null?Math.abs(b-a)/ins.pip:null;const qf=quoteUSD(ins,b??a,conv);const per=qf!=null?ins.contract*ins.pip*qf:null;
    F("pcOut").innerHTML=out([["Distance",pips==null?"–":fx(pips,1)+" "+u,"",1],["Price difference",a!=null&&b!=null?String(+Math.abs(b-a).toFixed(6)):"–"],["Worth on 1 lot",pips==null||per==null?"–":money(pips*per,false)],["Worth on "+(l??"–")+" lots",pips==null||per==null||l==null?"–":money(pips*per*l,false)]]);
  }
  if(name==="rr"){
    const {ins}=readIns("rr");F("rrConvW").hidden=true;const e=$v("rrE"),sl=$v("rrSL"),tp=$v("rrTP");const buy=F("rrDir").value==="Buy";const u=ins.unit.split(" ")[0];
    const risk=e!=null&&sl!=null?Math.abs(e-sl)/ins.pip:null,rew=e!=null&&tp!=null?Math.abs(tp-e)/ins.pip:null;const rr=risk>0&&rew!=null?rew/risk:null;
    F("rrOut").innerHTML=out([["Reward : risk",rr==null?"–":"1 : "+rr.toFixed(2),rr==null?"":rr>=2?"pos":rr<1?"neg":"",1],["Risk",risk==null?"–":fx(risk,1)+" "+u],["Reward",rew==null?"–":fx(rew,1)+" "+u],["Break-even win rate",rr==null?"–":(100/(1+rr)).toFixed(1)+"%"]]);
    const w=[];if(e!=null&&sl!=null&&(buy?sl>=e:sl<=e))w.push("The stop is on the wrong side of the entry for a "+(buy?"buy":"sell")+".");
    if(e!=null&&tp!=null&&(buy?tp<=e:tp>=e))w.push("The target is on the wrong side of the entry for a "+(buy?"buy":"sell")+".");
    F("rrWarn").innerHTML=w.map(x=>`<div class="warnline">⚠ ${esc(x)}</div>`).join("");
  }
  if(name==="mg"){
    const {ins,conv}=readIns("mg");const l=$v("mgLots"),p=$v("mgPrice"),lev=$v("mgLev");const qf=quoteUSD(ins,p,conv);
    const m=l!=null&&p!=null&&qf!=null&&lev>0?l*ins.contract*p*qf/lev:null;const bal=curBal();
    F("mgOut").innerHTML=out([["Margin needed",m==null?"–":money(m,false),"",1],["Of your balance",m==null||!(bal>0)?"–":(m/bal*100).toFixed(1)+"%"],["Trade size",l!=null&&p!=null&&qf!=null?money(l*ins.contract*p*qf,false):"–"]]);
  }
  if(name==="be"){
    const rr=$v("beRR"),wr=$v("beWR"),risk=$v("beRisk"),dd=$v("beDD");
    const bewr=rr>0?1/(1+rr):null;const exR=rr>0&&wr!=null?(wr/100)*rr-(1-wr/100):null;
    const rec=dd!=null&&dd<100&&dd>=0?dd/(100-dd):null;
    F("beOut").innerHTML=out([["Break-even win rate",bewr==null?"–":(bewr*100).toFixed(1)+"%","",1],["Expectancy",exR==null?"–":(exR>0?"+":"")+exR.toFixed(2)+"R / trade",cls(exR)],["Per trade",exR==null||risk==null?"–":money(exR*risk),cls(exR)],["Per 100 trades",exR==null||risk==null?"–":money(exR*risk*100),cls(exR)],["Gain to recover "+(dd??"–")+"%",rec==null?"–":"+"+(rec*100).toFixed(1)+"%","warn"]]);
  }
  if(name==="cg"){
    const s0=$v("cgStart"),r=$v("cgRate"),n=Math.min(1000,Math.max(1,Math.round($v("cgN")||0))),add=$v("cgAdd")||0;const per=F("cgPer").value;
    if(s0==null||r==null){F("cgOut").innerHTML="";F("cgChart").innerHTML="";return}
    const vals=[s0];let b=s0;for(let i=0;i<n;i++){b=b*(1+r/100)+add;vals.push(b)}
    const contrib=s0+add*n;
    F("cgOut").innerHTML=out([["Final balance",money(b,false),"",1],["Total gain",money(b-contrib),cls(b-contrib)],["Growth",spct(b/s0-1,0),cls(b-s0)],["You put in",money(contrib,false)]]);
    F("cgChart").innerHTML=lineChart(vals,{W:CWF(),fmt:v=>cur()+(Math.abs(v)>=1e6?(v/1e6).toFixed(1)+"M":Math.abs(v)>=1e3?(v/1e3).toFixed(1)+"k":v.toFixed(0)),first:"Start",last:n+" "+per+(n>1?"s":""),color:"#f0a63a",label:"Projected balance"})+`<p class="sub">Projection only. Real returns vary from period to period, and losing runs slow compounding sharply.</p>`;
  }
}
function runAllTools(){["ps","pl","pv","pc","rr","mg","be","cg"].forEach(runTool)}

function vPlan(){
  const st=S.settings,td=todayStatus(),wk=isoWeek(new Date());
  const wkTrades=scopedTrades().filter(t=>isoWeek(parseDay(t.date))===wk),ws=stats(wkTrades);
  return headHTML("Plan","Your rules, today's limits and the weekly review")+`
  <div class="grid two">
   <div class="card"><h2>My rules</h2><ul class="rules" id="rules">${st.rules.map((r,i)=>`<li><span>${esc(r)}</span><button class="x" data-delrule="${i}" aria-label="Remove rule">×</button></li>`).join("")}</ul>
     <form class="inline mt" id="ruleForm"><input class="input" id="newRule" placeholder="Add a rule" style="flex:1"><button class="btn">Add</button></form></div>
   <div class="card"><h2>Today</h2><div class="status" style="margin-bottom:14px"><span class="pill ${td.st}">${td.txt}</span></div>
     <div class="calcout" style="margin-top:0"><div><small>P&amp;L today</small><b class="${cls(td.pnl)}">${money(td.pnl)}</b></div><div><small>Loss limit</small><b>−${cur()}${(+st.dailyLoss||0).toFixed(2)}</b></div><div><small>Trades</small><b>${td.ts.length} / ${st.maxTrades||"∞"}</b></div></div>
     <p class="sub mt">Change the limits in Setup. Size your next trade in Calculators.</p></div>
   <div class="card" style="grid-column:1/-1"><h2>Weekly review · ${wk}</h2>
     <div class="calcout" style="margin-top:0;margin-bottom:12px"><div><small>Net</small><b class="${cls(ws.net)}">${money(ws.net)}</b></div><div><small>Trades</small><b>${ws.n}</b></div><div><small>Win rate</small><b>${pct(ws.wr)}</b></div><div><small>Plan followed</small><b>${pct(ws.n?wkTrades.filter(t=>t.followed).length/ws.n:null)}</b></div></div>
     <label class="sub" for="weekNote" style="display:block;margin-bottom:6px">What worked, what didn't, one thing to change next week</label>
     <textarea class="input" id="weekNote" style="min-height:140px">${esc(S.weeks[wk]||"")}</textarea>
     <div class="sub" id="weekSaved">Saves when you leave the box.</div></div>
  </div>`;
}

function vSetup(){
  const st=S.settings;const ident=LIVE?(USER.email||("+"+String(USER.phone||"").replace(/^\+/,""))):"Preview (this browser)";
  const cash=S.cash.slice().sort((a,b)=>b.date.localeCompare(a.date));
  return headHTML("Setup","Profile, trading accounts, security and backups",`<button class="btn primary" data-act="backup">Download a backup</button>`)+`
  <div class="grid two">
   <div class="card"><h2>Profile</h2><div class="form">
     <div class="f full"><label for="sName">Name</label><input class="input" id="sName" value="${esc(PROFILE.display_name||"")}"></div>
     <div class="f full"><label>Signed in as</label><div class="mono" style="font-size:14px">${esc(ident)}</div></div>
   </div>${LIVE?`<div class="inline mt"><button class="btn" data-act="signout">Sign out</button></div>`:""}</div>

   <div class="card" id="acctCard"><h2>Trading accounts</h2>
     <div class="list">${st.accounts.map((a,i)=>`<div class="li"><span>${esc(a.name)} <span class="tag ${acctType(a)==="Funded"?"fund":acctType(a)==="Demo"?"demo":""}">${esc(acctType(a))}</span><small>${acctType(a)==="Funded"?esc((a.firm||"")+" · "+(a.stage||"")+" · size "+money(+a.start,false)):"Starting balance "+money(+a.start,false)}</small></span><button class="btn sm ghost" data-editacct="${i}">Edit</button>${st.accounts.length>1?`<button class="btn sm ghost" data-delacct="${i}">Remove</button>`:"<span></span>"}</div>`).join("")}</div>
     ${acctForm()}
     <p class="sub">${S.editAcct!=null?"The name can't change, so your trades stay linked to this account.":"Pick Funded for a prop-firm account to track its loss limits and profit target."}</p></div>

   <div class="card"><h2>Deposits &amp; withdrawals</h2>
     <form class="form" id="cashForm" novalidate>
      <div class="f"><label for="cDate">Date</label><input class="input" type="date" id="cDate" value="${ymd(new Date())}"></div>
      <div class="f"><label for="cType">Type</label><select class="input" id="cType"><option value="1">Deposit</option><option value="-1">Withdrawal</option></select></div>
      <div class="f"><label for="cAmt">Amount</label><input class="input num" id="cAmt" inputmode="decimal"></div>
      <div class="f"><label for="cAcct">Account</label><select class="input" id="cAcct">${st.accounts.map(a=>`<option>${esc(a.name)}</option>`).join("")}</select></div>
      <div class="f" style="align-self:end"><button class="btn">Add</button></div></form>
     <div class="list mt">${cash.length?cash.map(c=>`<div class="li"><span>${c.amount>=0?"Deposit":"Withdrawal"} · ${esc(c.date)}<small>${esc(acctOf(c))}</small></span><b class="mono ${cls(c.amount)}">${money(c.amount)}</b><button class="btn sm ghost" data-delcash="${esc(c.id)}">Remove</button></div>`).join(""):`<div class="empty">None yet. Deposits raise your balance without counting as profit.</div>`}</div></div>

   <div class="card"><h2>Trading settings</h2><div class="form">
     <div class="f"><label for="sCur">Currency symbol</label><input class="input" id="sCur" maxlength="4" value="${esc(st.currency)}"></div>
     <div class="f"><label for="sLoss">Daily loss limit</label><input class="input num" id="sLoss" inputmode="decimal" value="${esc(st.dailyLoss)}"></div>
     <div class="f"><label for="sMax">Max trades per day</label><input class="input num" id="sMax" inputmode="numeric" value="${esc(st.maxTrades)}"></div>
     <div class="f"><label for="sRisk">Default risk %</label><input class="input num" id="sRisk" inputmode="decimal" value="${esc(st.riskPct)}"></div>
     <div class="f"><label for="sLev">Leverage 1:</label><input class="input num" id="sLev" inputmode="numeric" value="${esc(st.leverage)}"></div>
     <div class="f"><label for="sClock">Clock</label><select class="input" id="sClock"><option value="24"${st.clock!=="12"?" selected":""}>24-hour (14:30)</option><option value="12"${st.clock==="12"?" selected":""}>12-hour (2:30 pm)</option></select></div>
     <div class="f full"><label for="sSrc">Who takes your trades (comma separated)</label><input class="input" id="sSrc" value="${esc(st.sources.join(", "))}" placeholder="Manual, TZ v1.0 EA, DBot"></div>
   </div><p class="sub">Changes save when you leave a field.</p></div>

   <div class="card"><h2>Security</h2>
     <div class="form"><div class="f full"><label for="sLock">Lock automatically after</label><select class="input" id="sLock">${[[1,"1 minute"],[5,"5 minutes"],[15,"15 minutes"],[60,"1 hour"],[0,"Never"]].map(([v,l])=>`<option value="${v}"${+st.autoLock===v?" selected":""}>${l} without activity</option>`).join("")}</select></div></div>
     <form id="pinForm" class="form mt" novalidate>
      <div class="f"><label for="pOld">Current PIN</label><input class="input pin" style="font-size:16px;letter-spacing:.3em" id="pOld" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div>
      <div class="f"><label for="pNew">New PIN</label><input class="input pin" style="font-size:16px;letter-spacing:.3em" id="pNew" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div>
      <div class="f"><label for="pNew2">New PIN again</label><input class="input pin" style="font-size:16px;letter-spacing:.3em" id="pNew2" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div>
      <div class="f full"><div class="err" id="pErr" role="alert"></div><button class="btn">Change PIN</button></div>
     </form>
     <p class="sub">Forgot your PIN? Lock the journal and choose "Forgot PIN?" to get a code by email or SMS.</p></div>

   <div class="card"><h2>Backup</h2>
     <div class="inline"><button class="btn" data-act="csv">Export CSV</button><button class="btn" data-act="json">Export backup (JSON)</button>
     <label class="btn" for="imp" tabindex="0">Import backup</label><input type="file" id="imp" accept=".json,application/json" hidden></div>
     <p class="sub">CSV opens in Excel or Google Sheets. The JSON backup restores trades, deposits, settings, weekly reviews and daily notes. Keep a copy now and then.</p>
     <div id="expOut"></div>
     <h2 class="mt">Danger zone</h2><button class="btn danger" data-act="wipe" ${S.sample?"disabled":""}>Delete all trades</button></div>

   <div class="card" id="mt5" style="grid-column:1/-1"><h2>Import trades from MT5</h2>
     <ol class="steps"><li>Open MT5 on a computer. (The phone app can't export history.)</li><li>Open the <b>Toolbox</b> (Ctrl+T), go to the <b>History</b> tab and choose the period.</li><li>Right-click the list, choose <b>Report</b> → <b>HTML</b>, and save the file.</li><li>Choose that file here, check the account details, then press Import.</li></ol>
     <div class="form">
      <div class="f"><label for="mtFile">MT5 report (.html)</label><input class="input" type="file" id="mtFile" accept=".html,.htm,text/html"></div>
      <div class="f"><label for="mtAcct">Into account</label><select class="input" id="mtAcct">${st.accounts.map(a=>`<option${S.acct===a.name?" selected":""}>${esc(a.name)}</option>`).join("")}</select></div>
      <div class="f"><label for="mtSrc">Taken by</label><select class="input" id="mtSrc">${sourcesList().map(x=>`<option>${esc(x)}</option>`).join("")}</select></div>
      <div class="f"><label for="mtOff">Broker server time</label><select class="input" id="mtOff">${[0,1,2,3].map(h=>`<option value="${h}"${h===2?" selected":""}>GMT+${h}${h===0?" (Deriv)":h===2?" (most brokers in winter)":h===3?" (most brokers in summer)":""}</option>`).join("")}</select></div>
     </div>
     <p class="sub">MT5 reports use the broker's server clock (the time in Market Watch). The journal turns it into Kenya time. Each trade's P&amp;L includes commission and swap. Importing the same report again updates those trades instead of adding copies. The session is filled in from the trade's open time; change it on any trade if you like.</p>
     <div id="mtOut"></div></div>
  </div>`;
}

const VIEWS={dashboard:vDashboard,sessions:vSessions,returns:vReturns,calendar:vCalendar,notes:vNotes,trades:vTrades,tools:vTools,plan:vPlan,setup:vSetup};
function render(){
  if(!UNLOCKED)return;
  document.querySelectorAll(".tab[data-view]").forEach(b=>b.setAttribute("aria-current",b.dataset.view===S.view?"page":"false"));
  F("moreBtn").setAttribute("aria-current",["plan","setup","sessions","notes"].includes(S.view)?"page":"false");
  F("main").innerHTML=VIEWS[S.view]();
  if(S.view==="tools")runAllTools();
  const syms=[...new Set([...S.trades.map(t=>t.symbol),...INS.filter(i=>!i.custom).map(i=>i.s)])];F("symList").innerHTML=syms.map(s=>`<option value="${esc(s)}">`).join("");
  const sets=[...new Set(S.trades.map(t=>t.setup).filter(Boolean))];F("setupList").innerHTML=sets.map(s=>`<option value="${esc(s)}">`).join("");
}
function go(v){if(!VIEWS[v])v="dashboard";if(S.view==="notes"&&v!=="notes")noteSaveNow();if(v!=="setup")S.editAcct=null;S.view=v;F("sheet").hidden=true;if(location.hash!=="#"+v){try{history.replaceState(null,"","#"+v)}catch(e){}}render();window.scrollTo(0,0)}
let rz;window.addEventListener("resize",()=>{clearTimeout(rz);rz=setTimeout(()=>{if(UNLOCKED&&["returns","dashboard"].includes(S.view))render()},200)});
function fillAcctFilters(){const o=`<option value="">All accounts</option>`+S.settings.accounts.map(a=>`<option${S.acct===a.name?" selected":""}>${esc(a.name)}</option>`).join("");F("acctFilter").innerHTML=o;F("acctFilterM").innerHTML=o;if(S.acct&&!S.settings.accounts.some(a=>a.name===S.acct)){S.acct=""}}
async function saveSettings(){PROFILE.settings=S.settings;await Store.saveProfile({settings:S.settings})}
function saveErr(e){toast(friendly(e))}

/* =====================================================================
   TRADE FORM
   ===================================================================== */
F("fMistakes").innerHTML=MISTAKES.map((m,i)=>`<label class="chip"><input type="checkbox" value="${esc(m)}" id="fm${i}"><span>${esc(m)}</span></label>`).join("");
let readOnly=false,shotBlob=null,shotPath="",shotRemoved=false;
async function openTrade(t){
  readOnly=!!(t&&S.sample);S.editing=t&&!S.sample?t.id:null;shotBlob=null;shotRemoved=false;shotPath=t&&t.shot||"";
  F("fSrc").innerHTML=sourcesList().map(s=>`<option>${esc(s)}</option>`).join("");
  F("fAcct").innerHTML=S.settings.accounts.map(a=>`<option>${esc(a.name)}</option>`).join("");
  F("fRiskL").textContent="Risked ("+cur()+")";F("fPnlL").textContent="Net P&L ("+cur()+")";
  const now=new Date();const d=t||{date:S.view==="notes"&&S.noteDay?S.noteDay:ymd(now),time:pad(now.getHours())+":"+pad(now.getMinutes()),symbol:"",market:"Forex",dir:"Buy",source:sourcesList()[0]||"Manual",account:S.acct||S.settings.accounts[0]?.name,setup:"",session:"London",entry:"",sl:"",tp:"",exit:"",lots:"",risk:+(curBal()*S.settings.riskPct/100).toFixed(2),pnl:"",grade:"B",emotion:"Calm",followed:true,mistakes:[],notes:"",link:""};
  F("mTitle").textContent=readOnly?"Example trade (log your own to replace these)":S.editing?"Edit trade":"Log trade";
  F("fDate").value=d.date;F("fTime").value=d.time||"";F("fSym").value=d.symbol;F("fMarket").value=d.market;F("fDir").value=d.dir;F("fSrc").value=d.source;F("fAcct").value=acctOf(d);
  F("fSetup").value=d.setup||"";F("fSession").innerHTML=sessOptions(d.session);F("fSession").value=d.session;
  const rules=S.settings.rules||[],skipped=(d.mistakes||[]).filter(m=>m.startsWith("Skipped rule: ")).map(m=>m.slice(14));
  F("fCheckW").hidden=!rules.length;F("fCheck").innerHTML=rules.map((r,i)=>`<label class="chk"><input type="checkbox" value="${i}"${t&&!skipped.includes(r)?" checked":""}><span>${esc(r)}</span></label>`).join("");
  F("fPnl").dataset.auto=t?"0":"1";F("fPlan").dataset.autoNo=t?"":"1";const stamp=Date.now().toString(36);
  document.querySelectorAll("#tradeForm input:not([type=file]):not([type=checkbox]):not([type=date]):not([type=time])").forEach(i=>{i.setAttribute("autocomplete","off");i.setAttribute("name",i.id+"_"+stamp)});
  [["fEntry","entry"],["fSL","sl"],["fTP","tp"],["fExit","exit"],["fLots","lots"],["fRisk","risk"],["fPnl","pnl"]].forEach(([i,k])=>F(i).value=d[k]??"");
  F("fGrade").value=d.grade||"B";F("fEmo").value=d.emotion||"Calm";F("fPlan").value=d.followed===false?"0":"1";
  document.querySelectorAll("#fMistakes input").forEach(c=>c.checked=(d.mistakes||[]).includes(c.value));
  F("fNotes").value=d.notes||"";F("fLink").value=d.link||"";F("fErr").textContent="";F("fShot").value="";F("fShotName").textContent="";
  F("fDel").style.visibility=S.editing?"visible":"hidden";F("fSave").hidden=readOnly;
  F("fShotImg").hidden=true;F("fShotClear").hidden=!shotPath;
  if(shotPath){Store.shotUrl(shotPath).then(u=>{if(u&&!shotBlob&&!shotRemoved){F("fShotImg").src=u;F("fShotImg").hidden=false}})}
  S.keepMist=(d.mistakes||[]).filter(m=>!MISTAKES.includes(m)&&!m.startsWith("Skipped rule: "));
  preview();F("ov").classList.add("open");setTimeout(()=>F(S.editing?"fPnl":"fSym").focus(),30);
}
function closeTrade(){F("ov").classList.remove("open");S.editing=null}
function preview(){
  const e=num(F("fEntry").value),sl=num(F("fSL").value),tp=num(F("fTP").value),x=num(F("fExit").value),risk=num(F("fRisk").value),pnl=num(F("fPnl").value);
  const dist=e!=null&&sl!=null?Math.abs(e-sl):null;const rr=dist&&tp!=null?Math.abs(tp-e)/dist:null;
  const sgn=F("fDir").value==="Buy"?1:-1;const xr=dist&&x!=null?sgn*(x-e)/dist:null;const R=risk>0&&pnl!=null?pnl/risk:null;
  const bal=curBal();
  F("fPreview").innerHTML=`<span>Planned R:R <b>${rr==null?"–":"1 : "+rr.toFixed(2)}</b></span><span>Exit at <b class="${cls(xr)}">${xr==null?"–":(xr>0?"+":"")+xr.toFixed(2)+"R"}</b></span><span>Result <b class="${cls(R)}">${R==null?"–":(R>0?"+":"")+R.toFixed(2)+"R"}</b></span><span>Return <b class="${cls(pnl)}">${pnl==null||!(bal>0)?"–":spct(pnl/bal)}</b></span><span>Risk <b>${risk==null||!(bal>0)?"–":(risk/bal*100).toFixed(1)+"%"}</b> of balance</span>`;
  const broke=document.querySelectorAll("#fMistakes input:checked").length||document.querySelectorAll("#fCheck input:not(:checked)").length;
  if(F("fPlan").value==="1"&&broke){F("fPlan").value="0";F("fPlan").dataset.autoNo="1"}
  else if(!broke&&F("fPlan").value==="0"&&F("fPlan").dataset.autoNo==="1"){F("fPlan").value="1";F("fPlan").dataset.autoNo=""}
  autoPnlUI();
}
function sessOptions(sel){const st=sessState();const h=k=>sessRange(st.rows.find(r=>r.s.key===k));const o=st.ov.find(x=>x.a==="London");
  const L=[["Sydney",h("Sydney")],["Tokyo",h("Tokyo")],["London",h("London")],["New York",h("New York")],["London/NY overlap",o&&o.open?fmtEAT(o.open)+" – "+fmtEAT(o.close):""],["24/7 (synthetic)",""]];
  if(sel&&!L.some(x=>x[0]===sel))L.unshift([sel,""]);return L.map(([v,hh])=>`<option value="${esc(v)}">${esc(v)}${hh?" ("+hh.replace(/ – /g,"–")+")":""}</option>`).join("")}
/* win/loss and profit from direction, entry, exit and lots */
function autoCalc(){const raw=F("fSym").value.trim().toUpperCase();const ins=INS.find(i=>!i.custom&&i.s.toUpperCase()===raw)||INS.find(i=>!i.custom&&i.s.length===6&&raw.replace(/[^A-Z]/g,"").startsWith(i.s));
  const e=num(F("fEntry").value),x=num(F("fExit").value),l=num(F("fLots").value);if(e==null||x==null)return null;const sg=F("fDir").value==="Buy"?1:-1;const mv=sg*(x-e);
  const r={win:mv>0,flat:mv===0,ins};if(!ins||!(l>0))return r;r.pips=mv/ins.pip;const qf=quoteUSD(ins,x,null);if(qf==null){r.need=convNeed(ins)&&convNeed(ins).pair;return r}
  r.pnl=+(mv*ins.contract*qf*l).toFixed(2);return r}
function autoPnlUI(){const box=F("fAuto");if(!box)return;const r=autoCalc();if(!r||readOnly){box.hidden=true;return}
  const pf=F("fPnl");if(r.pnl!=null&&(pf.dataset.auto==="1"||pf.value.trim()==="")){pf.value=r.pnl.toFixed(2);pf.dataset.auto="1"}
  const typed=num(pf.value);const res=r.flat?`<b class="flat">BREAK-EVEN</b>`:r.win?`<b class="pos">WIN</b>`:`<b class="neg">LOSS</b>`;
  let msg="";if(r.pnl!=null)msg=pf.dataset.auto==="1"?`Profit filled in: <b class="${cls(r.pnl)}">${money(r.pnl)}</b>${r.pips!=null?" ("+(r.pips>0?"+":"")+fx(r.pips,1)+" "+esc(r.ins.unit.split(" ")[0])+")":""}. Change it if MT5 shows commission or swap.`:`Calculated ${money(r.pnl)}; you entered ${typed==null?"nothing":money(typed)}${typed!=null&&Math.abs(typed-r.pnl)>0.005?(Math.abs(typed-r.pnl)<=Math.max(1,Math.abs(r.pnl)*.1)?" (difference "+money(typed-r.pnl)+", usually commission or swap)":". That doesn't match the prices: check the entry, exit and lot size"):""}.`;
  else if(r.need)msg=`To work out the profit on ${esc(r.ins.s)} the journal needs the ${esc(r.need)} rate, so type the P&amp;L from MT5.`;
  else if(!r.ins)msg="Type the P&amp;L from MT5. (Automatic profit works for the symbols in the Calculators list.)";
  else msg="Add the lot size to fill in the profit.";
  box.innerHTML=`${res}<span>${msg}</span>`;box.hidden=false}
async function compress(file){
  const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});
    const sc=Math.min(1,1600/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);return await new Promise(r=>c.toBlob(r,"image/jpeg",LIVE?0.82:0.6))}
  finally{URL.revokeObjectURL(url)}
}
F("fShot").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;
  try{shotBlob=await compress(f);shotRemoved=false;F("fShotImg").src=URL.createObjectURL(shotBlob);F("fShotImg").hidden=false;F("fShotClear").hidden=false;F("fShotName").textContent=f.name}catch(x){toast("That image couldn't be read. Try a PNG or JPG.")}});
F("fShotClear").onclick=()=>{shotBlob=null;shotRemoved=true;F("fShotImg").hidden=true;F("fShotClear").hidden=true;F("fShotName").textContent="";F("fShot").value=""};
F("tradeForm").addEventListener("input",e=>{const id=e.target.id;if(id==="fPnl")F("fPnl").dataset.auto="0";else if(id==="fPlan")F("fPlan").dataset.autoNo="";
  else if(["fSym","fDir","fEntry","fExit","fLots"].includes(id))F("fPnl").dataset.auto="1"});
F("tradeForm").addEventListener("input",preview);
F("tradeForm").addEventListener("submit",async ev=>{
  ev.preventDefault();if(readOnly)return;
  const raw=F("fSym").value.trim(),sym=/\s/.test(raw)?raw:raw.toUpperCase(),pnl=num(F("fPnl").value);
  if(!F("fDate").value)return F("fErr").textContent="Pick the trade date.";
  if(!sym)return F("fErr").textContent="Enter the symbol, e.g. EURUSD or Volatility 75 Index.";
  if(pnl==null)return F("fErr").textContent="Enter the net P&L from your platform, e.g. -1.00 or 2.40.";
  const id=S.editing||uuid();
  const t={id,date:F("fDate").value,time:F("fTime").value,symbol:sym,market:F("fMarket").value,dir:F("fDir").value,source:F("fSrc").value,account:F("fAcct").value,
    setup:F("fSetup").value.trim(),session:F("fSession").value,entry:num(F("fEntry").value),sl:num(F("fSL").value),tp:num(F("fTP").value),exit:num(F("fExit").value),
    lots:num(F("fLots").value),risk:num(F("fRisk").value),pnl,grade:F("fGrade").value,emotion:F("fEmo").value,followed:F("fPlan").value==="1",
    mistakes:[...document.querySelectorAll("#fMistakes input:checked")].map(c=>c.value).concat(S.keepMist||[],[...document.querySelectorAll("#fCheck input:not(:checked)")].map(c=>"Skipped rule: "+(S.settings.rules[+c.value]||""))),notes:F("fNotes").value.trim(),link:F("fLink").value.trim(),shot:shotRemoved?"":shotPath};
  F("fSave").disabled=true;F("fSave").textContent="Saving…";
  try{
    if(shotBlob){const old=shotPath;t.shot=await Store.uploadShot(shotBlob,id);if(old)Store.deleteShot(old).catch(()=>{})}
    else if(shotRemoved&&shotPath)Store.deleteShot(shotPath).catch(()=>{});
    await Store.saveTrade(t);
    if(S.sample){S.trades=[];S.sample=false}
    const i=S.trades.findIndex(x=>x.id===t.id);if(i>=0)S.trades[i]=t;else S.trades.push(t);
    closeTrade();render();
    const fa=S.settings.accounts.find(a=>a.name===t.account&&acctType(a)==="Funded");const ps=fa?propState(fa):null;
    if(ps&&ps.msg){toast("⚠ "+ps.msg);clearTimeout(toast.h);toast.h=setTimeout(()=>F("toast").classList.remove("show"),9000)}else toast(i>=0?"Trade updated":"Trade logged · "+money(t.pnl));
  }catch(e){F("fErr").textContent=friendly(e)}
  finally{F("fSave").disabled=false;F("fSave").textContent="Save trade"}
});
F("fDel").onclick=()=>confirmBox("This trade will be removed from your journal.",async()=>{const id=S.editing;const t=S.trades.find(x=>x.id===id);
  try{await Store.deleteTrade(id);if(t&&t.shot)Store.deleteShot(t.shot).catch(()=>{});S.trades=S.trades.filter(x=>x.id!==id);closeTrade();if(!S.trades.length){S.trades=makeSamples();S.sample=true}render();toast("Trade deleted")}catch(e){saveErr(e)}});
F("mClose").onclick=F("fCancel").onclick=closeTrade;
F("ov").addEventListener("click",e=>{if(e.target.id==="ov")closeTrade()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeTrade();F("cov").classList.remove("open");F("sheet").hidden=true}});
function confirmBox(msg,yes){F("cMsg").textContent=msg;F("cov").classList.add("open");F("cYes").onclick=()=>{F("cov").classList.remove("open");yes()};F("cNo").onclick=()=>F("cov").classList.remove("open")}

/* ---------- export / import ---------- */
function csv(){const cols=["date","time","account","symbol","market","dir","source","setup","session","entry","sl","tp","exit","lots","risk","pnl","return_pct","balance_after","grade","emotion","followed","mistakes","notes","link"];
  const q=v=>{v=Array.isArray(v)?v.join("; "):v??"";v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  return [cols.join(","),...ledger().map(x=>cols.map(c=>c==="return_pct"?(x.ret==null?"":(x.ret*100).toFixed(4)):c==="balance_after"?x.after.toFixed(2):c==="account"?q(acctOf(x.t)):q(x.t[c])).join(","))].join("\n")}
async function offer(filename,data,type){
  try{const blob=new Blob([data],{type});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}catch(e){}
  F("expOut").innerHTML=`<p class="sub mt">If no download started, copy this and save it as <b>${esc(filename)}</b>.</p><textarea class="input out" readonly id="expTxt"></textarea><button class="btn sm mt" data-act="copy">Copy</button>`;F("expTxt").value=data;
}
async function importFile(file){
  let d;try{d=JSON.parse(await file.text())}catch(e){return toast("That file isn't a journal backup.")}
  const isU=s=>/^[0-9a-f-]{36}$/i.test(String(s||""));
  const tr=(d.trades||[]).filter(t=>t&&t.date&&t.symbol&&isFinite(t.pnl)).map(t=>{const {kind,...b}=t;return {mistakes:[],followed:true,...b,id:isU(t.id)?t.id:uuid(),shot:String(t.shot||"").startsWith("data:")&&LIVE?"":(t.shot||"")}});
  if(!tr.length&&!Object.keys(d.notes||{}).length)return toast("No trades found in that file.");
  toast("Importing "+tr.length+" trades…");
  try{for(const t of tr)await Store.saveTrade(t);
    for(const c of (d.cash||[]))if(c&&c.date&&isFinite(c.amount))await Store.saveCash({...c,id:isU(c.id)?c.id:uuid()});
    if(d.settings){S.settings=mergeSettings(d.settings);await saveSettings();fillAcctFilters()}
    for(const [k,v] of Object.entries(d.weeks||{}))await Store.saveWeek(k,v);
    for(const [k,v] of Object.entries(d.notes||{}))if(/^\d{4}-\d{2}-\d{2}$/.test(k))await Store.saveWeek("day:"+k,String(v||""));
    await loadData();render();toast("Imported "+tr.length+" trades")}catch(e){saveErr(e)}
}

/* ---------- East African Time (EAT, GMT+3) and the user's 12/24-hour choice ---------- */
const EAT_OFF=180;
const eatNow=()=>new Date(Date.now()+EAT_OFF*60000);            /* read it with getUTC… */
const eatYmd=d=>d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate());
const h12=()=>S.settings.clock==="12";
function fmtHM(h,m){h=((h%24)+24)%24;if(!h12())return pad(h)+":"+pad(m);return (h%12||12)+":"+pad(m)+(h<12?" am":" pm")}
function fmtT(str){if(!str)return "";const [h,m]=String(str).split(":").map(Number);return isFinite(h)?fmtHM(h,m||0):String(str)}
const fmtEAT=ms=>{const d=new Date(ms+EAT_OFF*60000);return fmtHM(d.getUTCHours(),d.getUTCMinutes())};
function fmtDur(ms){const m=Math.max(0,Math.round(ms/60000)),h=Math.floor(m/60);return h?h+"h "+pad(m%60)+"m":m+"m"}
/* a trade's date + time (typed in Kenya time) as a moment in time */
const tradeMs=t=>{const [y,mo,d]=t.date.split("-").map(Number);const [h,m]=(t.time||"00:00").split(":").map(Number);return Date.UTC(y,mo-1,d,h||0,m||0)-EAT_OFF*60000};

/* ---------- forex sessions (Babypips hours, each in its own city's clock, so summer-time changes are automatic) ---------- */
const SESSIONS=[
  {key:"Sydney",tz:"Australia/Sydney",o:7,c:16,flag:"🇦🇺",color:"#5aa9ff",region:"Australia / Pacific",note:"Usually the quietest session. AUD and NZD pairs move the most.",pairs:"AUDUSD, NZDUSD, AUDJPY"},
  {key:"Tokyo",tz:"Asia/Tokyo",o:9,c:18,flag:"🇯🇵",color:"#b38cff",region:"Asia",note:"Yen pairs are most active. Moves are usually smooth and steady.",pairs:"USDJPY, EURJPY, GBPJPY, AUDJPY"},
  {key:"London",tz:"Europe/London",o:8,c:17,flag:"🇬🇧",color:"#f0a63a",region:"Europe",note:"The most liquid session. GBP and EUR pairs are most active, with big moves at the open.",pairs:"EURUSD, GBPUSD, EURGBP, XAUUSD"},
  {key:"New York",tz:"America/New_York",o:8,c:17,flag:"🇺🇸",color:"#2fbf87",region:"America",note:"Strong moves on USD pairs and gold, especially around US news.",pairs:"EURUSD, GBPUSD, USDJPY, XAUUSD, US30"}];
const OVERLAPS=[["Sydney","Tokyo","Steady but not huge"],["Tokyo","London","Small overlap: watch the handover"],["London","New York","Most volatile: the best trading hours"]];
const _dtf={};
function tzOffMin(tz,ms){const f=_dtf[tz]||(_dtf[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  const p={};f.formatToParts(new Date(ms)).forEach(x=>p[x.type]=x.value);return (Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-Math.floor(ms/1000)*1000)/60000}
function zonedMs(tz,y,mo,d,h){const g=Date.UTC(y,mo,d,h);let ms=g-tzOffMin(tz,g)*60000;return g-tzOffMin(tz,ms)*60000}
let _stCache={k:0,v:null};
function sessionTimes(at){
  const out=[];SESSIONS.forEach(s=>{for(let k=-2;k<=4;k++){const b=new Date(at+k*864e5+tzOffMin(s.tz,at)*60000);const y=b.getUTCFullYear(),mo=b.getUTCMonth(),d=b.getUTCDate();
    const dow=new Date(Date.UTC(y,mo,d)).getUTCDay();if(dow===0||dow===6)continue;out.push({s,open:zonedMs(s.tz,y,mo,d,s.o),close:zonedMs(s.tz,y,mo,d,s.c)})}});
  return out.sort((a,b)=>a.open-b.open)}
function sessState(at=Date.now()){
  const key=Math.floor(at/15000);if(_stCache.k===key&&_stCache.v)return _stCache.v;
  const T=sessionTimes(at);
  const rows=SESSIONS.map(s=>{const mine=T.filter(x=>x.s===s);const cur=mine.find(x=>x.open<=at&&at<x.close);const next=mine.find(x=>x.open>at);
    return {s,open:!!cur,cur,next,show:cur||next,left:cur?cur.close-at:null,until:next?next.open-at:null,prog:cur?(at-cur.open)/(cur.close-cur.open):0}});
  const ov=OVERLAPS.map(([a,b,imp])=>{const A=T.filter(x=>x.s.key===a),B=T.filter(x=>x.s.key===b);let best=null;
    A.forEach(x=>B.forEach(y=>{const o=Math.max(x.open,y.open),c=Math.min(x.close,y.close);if(c>o&&c>at&&(!best||o<best.open))best={open:o,close:c}}));
    return {a,b,imp,open:best?best.open:null,close:best?best.close:null,active:!!best&&best.open<=at&&at<best.close}});
  const v={rows,ov,at};_stCache={k:key,v};return v}
const sessRange=r=>r&&r.show?fmtEAT(r.show.open)+" – "+fmtEAT(r.show.close):"";
/* the session a moment falls in (newest one that is open) — used only for MT5 imports */
function sessionAt(ms){const T=sessionTimes(ms).filter(x=>x.open<=ms&&ms<x.close).sort((a,b)=>b.open-a.open);return T.length?T[0].s.key:""}

function sessCardHTML(){
  const {rows,ov,at}=sessState();const open=rows.filter(r=>r.open).sort((a,b)=>b.cur.open-a.cur.open);
  if(!open.length){const n=rows.filter(r=>r.next).sort((a,b)=>a.until-b.until)[0];
    return `<div class="sesscard quiet" id="sessCard" role="status"><div class="sc1"><span class="dot"></span><b>No session open</b><span class="scleft">${n?esc(n.s.key)+" opens in "+fmtDur(n.until):""}</span></div>
      <div class="sc2">${n?`${n.s.flag} ${esc(n.s.key)} · ${fmtEAT(n.next.open)} – ${fmtEAT(n.next.close)} EAT`:"Forex is closed"}</div></div>`}
  const m=open[0];const o=ov.find(x=>x.active&&(x.a===m.s.key||x.b===m.s.key));const other=o?(o.a===m.s.key?o.b:o.a):(open[1]?open[1].s.key:null);
  return `<div class="sesscard" id="sessCard" role="status" style="--sc:${m.s.color}">
    <div class="sc1"><span class="dot"></span><b>${m.s.flag} ${esc(m.s.key.toUpperCase())}</b><span class="scleft">${fmtDur(m.left)} left</span></div>
    <div class="sc2"><span>${fmtEAT(m.cur.open)} – ${fmtEAT(m.cur.close)} EAT</span><span class="scbar"><i style="width:${(m.prog*100).toFixed(1)}%"></i></span></div>
    ${o?`<div class="sc3">Overlapping with ${esc(other)} until ${fmtEAT(o.close)}</div>`:other?`<div class="sc3">${esc(other)} is also open</div>`:""}</div>`}

function ringSVG(){
  const {rows,at}=sessState();const C=160;const A=h=>h/24*2*Math.PI-Math.PI/2;const P=(r,h)=>[(C+r*Math.cos(A(h))).toFixed(2),(C+r*Math.sin(A(h))).toFixed(2)];
  const eh=ms=>{const d=new Date(ms+EAT_OFF*60000);return d.getUTCHours()+d.getUTCMinutes()/60};
  let g=`<circle cx="${C}" cy="${C}" r="152" fill="#10141a" stroke="#252d39"/>`;
  for(let h=0;h<24;h++){const [x1,y1]=P(132,h),[x2,y2]=P(h%6?137:129,h),[tx,ty]=P(145,h);
    g+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3a4352" stroke-width="${h%6?1:2}"/><text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" class="rl${h%6?"":" big"}">${h12()?(h%12||12):pad(h)}</text>`}
  const radii=[118,100,82,64];
  rows.forEach((r,i)=>{if(!r.show)return;const rad=radii[i];let a=eh(r.show.open),b=eh(r.show.close);if(b<=a)b+=24;
    const [x1,y1]=P(rad,a),[x2,y2]=P(rad,b),big=b-a>12?1:0,id="arc"+i;
    g+=`<circle cx="${C}" cy="${C}" r="${rad}" fill="none" stroke="#1b212b" stroke-width="13"/>
      <path id="${id}" d="M${x1} ${y1} A${rad} ${rad} 0 ${big} 1 ${x2} ${y2}" fill="none" stroke="${r.open?r.s.color:"#3a4352"}" stroke-width="13" stroke-linecap="round" opacity="${r.open?1:.85}"/>
      ${(()=>{const mid=((a+b)/2)%24,flip=mid>6&&mid<18;const lr=flip?rad+3:rad-3;const [lx1,ly1]=P(lr,flip?b:a),[lx2,ly2]=P(lr,flip?a:b);
        return `<path id="${id}t" d="M${lx1} ${ly1} A${lr} ${lr} 0 ${big} ${flip?0:1} ${lx2} ${ly2}" fill="none"/><text class="arcl"><textPath href="#${id}t" startOffset="${flip?"94%":"6%"}" text-anchor="${flip?"end":"start"}">${esc(r.s.key.toUpperCase())}</textPath></text>`})()}`});
  const nh=eh(at);const [hx,hy]=P(126,nh);const d=new Date(at+EAT_OFF*60000);
  g+=`<line x1="${C}" y1="${C}" x2="${hx}" y2="${hy}" stroke="#ef5d5d" stroke-width="2.5" stroke-linecap="round"/><circle cx="${C}" cy="${C}" r="48" fill="#0d1015" stroke="#f0a63a" stroke-width="1.5"/>
    <text x="${C}" y="${C-12}" text-anchor="middle" class="rc1">Nairobi (EAT)</text><text x="${C}" y="${C+8}" text-anchor="middle" class="rc2" id="rcTime">${fmtHM(d.getUTCHours(),d.getUTCMinutes())}</text><text x="${C}" y="${C+26}" text-anchor="middle" class="rc1">GMT+3</text>`;
  return `<svg viewBox="0 0 320 320" class="ring" role="img" aria-label="24-hour clock of the forex sessions in Kenya time">${g}</svg>`}

function sessListHTML(){
  const {rows}=sessState();
  return rows.map(r=>{const dur=r.show?fmtDur(r.show.close-r.show.open):"";
    return `<div class="srow${r.open?" on":""}" style="--sc:${r.s.color}"><span class="sflag">${r.s.flag}</span>
      <span class="sname"><b>${esc(r.s.key)}</b><small>${esc(r.s.region)} · ${dur}</small></span>
      <span class="shrs mono">${sessRange(r)}</span>
      <span class="schip ${r.open?"open":""}">${r.open?"OPEN":"CLOSED"}</span>
      <span class="sleft"><small>${r.open?"Closes in":"Opens in"}</small><b class="mono">${fmtDur(r.open?r.left:r.until)}</b></span>
      ${r.open?`<span class="sprog"><i style="width:${(r.prog*100).toFixed(1)}%"></i></span>`:""}
      <span class="snote">${esc(r.s.note)} <span class="flat">Pairs: ${esc(r.s.pairs)}</span></span></div>`}).join("")}

function vSessions(){
  const {rows,ov}=sessState();const R=k=>rows.find(r=>r.s.key===k);
  const lo=R("London"),tk=R("Tokyo"),lny=ov.find(o=>o.a==="London");
  const clockSeg=`<div class="seg" role="group" aria-label="Clock">${[["24","24-hour"],["12","12-hour"]].map(([v,l])=>`<button data-clock="${v}" aria-pressed="${(S.settings.clock||"24")===v}">${l}</button>`).join("")}</div>`;
  const nextO=rows.filter(r=>!r.open&&r.next).sort((a,b)=>a.until-b.until)[0];
  return headHTML("Market sessions","All times in East African Time (Nairobi, GMT+3). Hours follow Babypips and shift automatically when Europe, the US and Australia change their clocks.",clockSeg)+`
  <div class="grid sessgrid">
    <div class="card ringcard"><div id="ringWrap">${ringSVG()}</div>
      <div class="nextline">${nextO?`Next: <b>${esc(nextO.s.key)}</b> opens in <b class="mono">${fmtDur(nextO.until)}</b>`:""}</div>
      <div class="legend">${SESSIONS.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.key)}</span>`).join("")}<span><i style="background:#3a4352"></i>Closed</span></div></div>
    <div class="card"><h2>Timetable</h2><div class="slist" id="sessList">${sessListHTML()}</div></div>
  </div>
  <div class="grid two mt">
    <div class="card"><h2>Overlaps</h2><div class="olist">${ov.map(o=>`<div class="orow${o.active?" on":""}"><b>${esc(o.a)} + ${esc(o.b)}</b><span class="mono">${o.open?fmtEAT(o.open)+" – "+fmtEAT(o.close):"–"}</span><span class="flat">${esc(o.imp)}</span>${o.active?`<span class="schip open">NOW</span>`:""}</div>`).join("")}</div></div>
    <div class="card"><h2>When to trade</h2><ul class="tips">
      <li><b>Smooth moves:</b> trade the Tokyo session (${sessRange(tk)}).</li>
      <li><b>Big moves:</b> trade the London open (${lo&&lo.show?fmtEAT(lo.show.open)+" – "+fmtEAT(lo.show.open+2*36e5):"–"}).</li>
      <li><b>Most movement:</b> trade the London–New York overlap (${lny&&lny.open?fmtEAT(lny.open)+" – "+fmtEAT(lny.close):"–"}).</li>
      <li><b>Careful:</b> spreads widen around the daily rollover and at the Monday open. Check the news calendar before London and New York open.</li></ul></div>
  </div>
  <p class="sub mt">These are forex session hours, not stock-exchange hours. Forex closes from Friday evening (New York close) until Sydney opens on Monday morning. Deriv synthetic indices trade 24/7.</p>`;
}
/* keep the clock and the dashboard card moving */
const _tick={full:0,card:0};
setInterval(()=>{if(!UNLOCKED||document.hidden)return;
  if(S.view==="sessions"){const t=F("rcTime");const d=eatNow();if(t)t.textContent=fmtHM(d.getUTCHours(),d.getUTCMinutes());
    if(Date.now()-_tick.full>30000){_tick.full=Date.now();const w=F("ringWrap"),l=F("sessList");if(w)w.innerHTML=ringSVG();if(l)l.innerHTML=sessListHTML()}}
  else if(S.view==="dashboard"&&Date.now()-_tick.card>30000){_tick.card=Date.now();const c=F("sessCard");if(c)c.outerHTML=sessCardHTML()}
},1000);

/* ---------- daily notes: one page per day, like a book ---------- */
let noteT=null,notePending=null;
function noteSaveNow(){clearTimeout(noteT);if(!notePending)return Promise.resolve();const {day,body}=notePending;notePending=null;
  const st=F("noteSaved");if(st)st.textContent="Saving…";
  return Store.saveWeek("day:"+day,body).then(()=>{const s=F("noteSaved");if(s)s.textContent="Saved to your account"+(LIVE?"":" (this browser)")+" · "+fmtEAT(Date.now())}).catch(e=>{notePending=notePending||{day,body};saveErr(e);const s=F("noteSaved");if(s)s.textContent="Not saved yet. Check your connection."})}
function noteQueue(day,body){S.notes[day]=body;notePending={day,body};clearTimeout(noteT);const st=F("noteSaved");if(st)st.textContent="Typing…";noteT=setTimeout(noteSaveNow,1200)}
function shiftDay(day,n){const d=parseDay(day);d.setDate(d.getDate()+n);return ymd(d)}
function vNotes(){
  const today=eatYmd(eatNow());const day=S.noteDay&&S.noteDay<=today?S.noteDay:today;S.noteDay=day;const d=parseDay(day);
  const label=d.toLocaleDateString("en",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  const pages=Object.keys(S.notes).filter(k=>(S.notes[k]||"").trim()).sort().reverse();
  const ts=sortT(scopedTrades().filter(t=>t.date===day));const s=stats(ts);
  const prevNote=pages.find(k=>k<day),nextNote=pages.slice().reverse().find(k=>k>day);
  const nav=`<div class="calhead"><button class="btn sm" data-noteday="${shiftDay(day,-1)}" aria-label="Previous day">‹</button><h3>${day===today?"Today":esc(d.toLocaleDateString("en",{day:"numeric",month:"short",year:"numeric"}))}</h3><button class="btn sm" data-noteday="${shiftDay(day,1)}" aria-label="Next day" ${day>=today?"disabled":""}>›</button>${day!==today?`<button class="btn sm ghost" data-noteday="${today}">Today</button>`:""}</div>`;
  return headHTML("Notes",`One page per day. ${pages.length} page${pages.length===1?"":"s"} written`,nav)+`
  <div class="grid notesgrid">
    <div class="card notepage"><div class="nphead"><h2>${esc(label)}</h2><span class="flat mono">Page ${pages.filter(k=>k<day).length+1}</span></div>
      <textarea class="input notebody" id="noteBody" data-day="${day}" placeholder="What did you see in the market today? What did you do and why, what worked, what you lost, and what you'll change tomorrow.">${esc(S.notes[day]||"")}</textarea>
      <div class="npfoot"><span class="sub" id="noteSaved">${S.notes[day]?"Saved":"Saves as you type"}</span><span class="inline">${prevNote?`<button class="btn sm ghost" data-noteday="${prevNote}">‹ Previous page</button>`:""}${nextNote?`<button class="btn sm ghost" data-noteday="${nextNote}">Next page ›</button>`:""}</span></div></div>
    <div class="card"><h2>This day's trades</h2>
      ${ts.length?`<div class="calcout" style="margin-top:0;margin-bottom:10px"><div><small>Net</small><b class="${cls(s.net)}">${money(s.net)}</b></div><div><small>Trades</small><b>${s.n}</b></div><div><small>Win rate</small><b>${pct(s.wr)}</b></div></div>
      <div class="dlist">${ts.map(t=>`<button class="dli" data-edit="${esc(t.id)}"><span class="mono flat">${esc(fmtT(t.time))}</span><b>${esc(t.symbol)}</b><span class="dir ${t.dir==="Buy"?"buy":"sell"}">${esc(String(t.dir).toUpperCase())}</span><span class="mono ${cls(t.pnl)}">${money(t.pnl)}</span></button>`).join("")}</div>`
      :`<div class="empty">No trades logged on this day.</div>`}
      <div class="inline mt"><button class="btn sm" data-act="add">+ Log trade</button>${ts.length?`<button class="btn sm ghost" data-tradesday="${day}">Open in Trades</button>`:""}</div>
      <h2 class="mt">Earlier pages</h2>${pages.length?`<div class="pagelist">${pages.slice(0,40).map(k=>`<button class="pg${k===day?" on":""}" data-noteday="${k}"><b>${esc(parseDay(k).toLocaleDateString("en",{day:"numeric",month:"short"}))}</b><small>${esc((S.notes[k]||"").trim().slice(0,60))}</small></button>`).join("")}</div>`:`<div class="empty">Your pages will be listed here.</div>`}
    </div></div>`;
}

/* ---------- trading accounts: real, demo or prop-firm funded ---------- */
const PROP_FIRMS=["Alpha Capital Group","Blueberry Funded","BrightFunded","City Traders Imperium","E8 Markets","FTMO","FundedNext","FundingPips","FXIFY","Hola Prime","Maven Trading","OneFunded","The Trading Pit","The5ers"];
const acctType=a=>a&&a.type||"Real";
function acctForm(){
  const e=S.editAcct!=null?S.settings.accounts[S.editAcct]:null;const a=e||{type:"Real",stage:"Phase 1",daily:5,dailyBase:"start",maxLoss:10,ddType:"Static",t1:10,t2:5,reset:"00:00"};
  const fund=acctType(a)==="Funded";const firmKnown=!a.firm||PROP_FIRMS.includes(a.firm);
  const sel=(id,opts,v)=>`<select class="input" id="${id}">${opts.map(o=>{const [val,lab]=Array.isArray(o)?o:[o,o];return `<option value="${esc(val)}"${String(val)===String(v)?" selected":""}>${esc(lab)}</option>`}).join("")}</select>`;
  return `<form class="form mt" id="acctForm" novalidate>
    <div class="f"><label for="aName">Account name</label><input class="input" id="aName" value="${esc(e?e.name:"")}" placeholder="Deriv MT5 real" ${e?"readonly":""}></div>
    <div class="f"><label for="aStart">${fund?"Account size":"Starting balance"}</label><input class="input num" id="aStart" inputmode="decimal" value="${e?esc(e.start):""}" placeholder="${fund?"10000":"50"}"></div>
    <div class="f"><label for="aType">Account type</label>${sel("aType",["Real","Demo","Funded"],acctType(a))}</div>
    <div class="propf" id="propF" ${fund?"":"hidden"}>
      <div class="f"><label for="aFirm">Prop firm</label>${sel("aFirm",[...PROP_FIRMS,["__other","Other (type it)"]],firmKnown?(a.firm||"FTMO"):"__other")}</div>
      <div class="f" id="aFirmOW" ${firmKnown?"hidden":""}><label for="aFirmO">Firm name</label><input class="input" id="aFirmO" value="${firmKnown?"":esc(a.firm)}" placeholder="Your firm's name"></div>
      <div class="f"><label for="aStage">Stage</label>${sel("aStage",["Phase 1","Phase 2","Funded"],a.stage)}</div>
      <div class="f"><label for="aDaily">Daily loss limit %</label><input class="input num" id="aDaily" inputmode="decimal" value="${esc(a.daily)}"></div>
      <div class="f"><label for="aDBase">Daily limit measured from</label>${sel("aDBase",[["start","Account size"],["day","Balance at the daily reset"]],a.dailyBase)}</div>
      <div class="f"><label for="aMax">Maximum total loss %</label><input class="input num" id="aMax" inputmode="decimal" value="${esc(a.maxLoss)}"></div>
      <div class="f"><label for="aDD">Drawdown type</label>${sel("aDD",[["Static","Static (fixed from account size)"],["Trailing","Trailing (follows your highest balance)"]],a.ddType)}</div>
      <div class="f"><label for="aT1">Phase 1 target %</label><input class="input num" id="aT1" inputmode="decimal" value="${esc(a.t1)}"></div>
      <div class="f"><label for="aT2">Phase 2 target %</label><input class="input num" id="aT2" inputmode="decimal" value="${esc(a.t2)}"></div>
      <div class="f"><label for="aReset">Daily reset time (Kenya time)</label><input class="input" type="time" id="aReset" value="${esc(a.reset||"00:00")}"></div>
      <p class="sub full">Copy these from your firm's dashboard or rules page. Firms change their rules, so the journal never fills them in for you. Midnight in Europe is 01:00 (summer) or 02:00 (winter) Kenya time.</p>
    </div>
    <div class="f full inline"><button class="btn primary">${e?"Save changes":"Add account"}</button>${e?`<button type="button" class="btn ghost" data-act="canceledit">Cancel</button>`:""}</div></form>`;
}
function readAcctForm(){
  const v=id=>F(id)?F(id).value:"";const t=v("aType");const a={name:v("aName").trim(),start:num(v("aStart")),type:t};
  if(t==="Funded")Object.assign(a,{firm:v("aFirm")==="__other"?v("aFirmO").trim():v("aFirm"),stage:v("aStage"),daily:num(v("aDaily"))??0,dailyBase:v("aDBase"),maxLoss:num(v("aMax"))??0,ddType:v("aDD"),t1:num(v("aT1"))??0,t2:num(v("aT2"))??0,reset:v("aReset")||"00:00"});
  return a}

/* where a funded account stands against its rules, from the closed trades logged in it */
function propState(a){
  const size=+a.start||0;const cashSum=S.cash.filter(c=>acctOf(c)===a.name).reduce((s,c)=>s+c.amount,0);
  const ts=sortT(S.sample?[]:S.trades.filter(t=>acctOf(t)===a.name));
  let bal=size+cashSum,peak=bal;ts.forEach(t=>{bal+=t.pnl;peak=Math.max(peak,bal)});
  const [rh,rm]=String(a.reset||"00:00").split(":").map(Number);const n=eatNow();
  let start=Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),rh||0,rm||0)-EAT_OFF*60000;if(start>Date.now())start-=864e5;
  const dayPnl=ts.filter(t=>tradeMs(t)>=start).reduce((s,t)=>s+t.pnl,0);const dayStart=bal-dayPnl;
  const dLim=(a.dailyBase==="day"?dayStart:size)*(+a.daily||0)/100,dUsed=Math.max(0,-dayPnl),dLeft=dLim-dUsed;
  const mLim=size*(+a.maxLoss||0)/100,floor=(a.ddType==="Trailing"?peak:size)-mLim,mLeft=bal-floor;
  const tgt=a.stage==="Phase 1"?+a.t1:a.stage==="Phase 2"?+a.t2:0;const profit=bal-size-cashSum;const need=size*(tgt||0)/100-profit;
  const P=v=>size>0?v/size*100:0;
  const stop=(dLim>0&&dLeft<=0)||(mLim>0&&mLeft<=0);const warn=!stop&&((dLim>0&&dLeft<=Math.max(dLim*.3,size*.005))||(mLim>0&&mLeft<=mLim*.2));
  let msg="";
  if(mLim>0&&mLeft<=0)msg="Maximum loss reached. By the firm's rules this account has failed. Stop trading it.";
  else if(dLim>0&&dLeft<=0)msg="Daily loss limit reached. Stop trading this account until the reset at "+fmtT(a.reset||"00:00")+".";
  else if(warn)msg=dLim>0&&dLeft<=Math.max(dLim*.3,size*.005)?`Only ${P(dLeft).toFixed(2)}% (${money(dLeft,false)}) left today. Stop trading or cut your size.`:`Only ${P(mLeft).toFixed(2)}% (${money(mLeft,false)}) left before the maximum loss.`;
  return {a,size,bal,peak,dayPnl,dLim,dUsed,dLeft,mLim,mLeft,floor,tgt,profit,need,P,stop,warn,msg,passed:tgt>0&&need<=0}}
function meter(used,lim,bad){const w=lim>0?Math.min(100,Math.max(0,used/lim*100)):0;return `<span class="meter wide"><i class="${bad?"bad":w>=70?"warnm":""}" style="width:${w}%"></i></span>`}
function propPanel(a){
  const p=propState(a);const P=p.P;const lvl=p.stop?"stop":p.warn?"warn":"ok";
  return `<div class="card prop ${lvl}"><div class="cardhead"><h2>🏦 ${esc(a.firm||"Prop firm")} · ${esc(a.stage||"")} <span class="flat" style="font-weight:500">· ${esc(a.name)}</span></h2><span class="pill ${lvl}">${p.stop?"Stop trading":p.warn?"Careful":"Within rules"}</span></div>
   ${p.msg?`<div class="propmsg">⚠ ${esc(p.msg)}</div>`:""}
   <div class="proprows">
    ${p.dLim>0?`<div class="prow"><span><b>Daily loss</b><small>${P(p.dUsed).toFixed(2)}% used of ${(+a.daily).toFixed(2)}% · resets ${esc(fmtT(a.reset||"00:00"))}</small></span>${meter(p.dUsed,p.dLim,p.dLeft<=0)}<span class="pv ${p.dLeft<=0?"neg":""}"><b>${P(Math.max(0,p.dLeft)).toFixed(2)}% left</b><small>${money(Math.max(0,p.dLeft),false)}</small></span></div>`:""}
    ${p.mLim>0?`<div class="prow"><span><b>Maximum loss</b><small>${esc(a.ddType||"Static")} · floor ${money(p.floor,false)}</small></span>${meter(p.mLim-p.mLeft,p.mLim,p.mLeft<=0)}<span class="pv ${p.mLeft<=0?"neg":""}"><b>${P(Math.max(0,p.mLeft)).toFixed(2)}% left</b><small>${money(Math.max(0,p.mLeft),false)}</small></span></div>`:""}
    ${p.tgt>0?`<div class="prow"><span><b>${esc(a.stage)} target +${(+p.tgt).toFixed(2)}%</b><small>You're at ${spct(p.profit/(p.size||1))}</small></span><span class="meter wide"><i class="good" style="width:${Math.min(100,Math.max(0,p.profit/(p.size*p.tgt/100)*100))}%"></i></span><span class="pv ${p.passed?"pos":""}"><b>${p.passed?"Target reached":P(p.need).toFixed(2)+"% to go"}</b><small>${p.passed?"Check your firm's other rules":money(p.need,false)}</small></span></div>`
      :`<div class="prow"><span><b>Funded account</b><small>No profit target. Keep within the loss limits.</small></span><span></span><span class="pv"><b>${money(p.bal,false)}</b><small>Balance</small></span></div>`}
   </div><p class="sub" style="margin:8px 0 0">Based on the closed trades you've logged. Open trades and the firm's own figures can differ.</p></div>`}
function propPanels(){const a=S.settings.accounts.filter(x=>acctType(x)==="Funded"&&(!S.acct||x.name===S.acct));return a.length?`<div class="grid propgrid mt">${a.map(propPanel).join("")}</div>`:""}

/* ---------- calculators: plain-words "How to use" guides ---------- */
const HOWTO={
 ps:{what:"Finds the lot size that makes a losing trade cost only the amount you chose to risk.",steps:["Type your account balance.","Choose risk as a % of balance or a fixed amount, and type it.","Pick the instrument (pair, gold, index or synthetic).","Type the entry and stop-loss prices. Or leave the prices empty and type the stop in pips.","Optional: add the take-profit and your leverage to see reward : risk, profit at TP and margin.","Use the Lot size shown in MT5. Read any warning under the results."],ex:"EURUSD, $100 balance, 2% risk = $2. Stop 20 pips. One pip on 1 lot is $10, so 20 pips cost $200 per lot. $2 ÷ $200 = 0.01 lots."},
 pl:{what:"Shows how much a trade made or lost from its entry, exit and lot size.",steps:["Pick the instrument.","Choose Buy or Sell.","Type the lot size.","Type the entry price and the exit price.","Read the profit or loss and how many pips it moved."],ex:"EURUSD buy 0.10 lots at 1.08500, closed at 1.08900: +40 pips × $1 per pip = +$40."},
 pv:{what:"Shows how much money one pip (or point) is worth for the lot size you trade.",steps:["Pick the instrument.","Type the lot size.","For pairs that start with USD (USDJPY, USDCAD…), type the current price.","For cross pairs (EURJPY, GBPCAD…), type the conversion rate it asks for.","Read the value per pip, per 10 and per 100 pips."],ex:"EURUSD, 1 lot: 100,000 × 0.0001 = $10 per pip. At 0.01 lots it's $0.10 per pip."},
 pc:{what:"Counts how many pips (or points) are between two prices, and what that move is worth.",steps:["Pick the instrument, so the journal knows its pip size.","Type the first price (for example your entry).","Type the second price (for example your stop or target).","Optional: type a lot size to see what the move is worth."],ex:"EURUSD from 1.08500 to 1.08750 = 25 pips. USDJPY from 150.20 to 150.70 = 50 pips. Gold from 2350.0 to 2352.5 = 25 pips."},
 rr:{what:"Compares what a trade can win against what it risks, and the win rate you need to break even.",steps:["Pick the instrument and Buy or Sell.","Type the entry price.","Type the stop-loss price.","Type the take-profit price.","Read the reward : risk. Aim for at least 1 : 2."],ex:"Buy at 1.0850, stop 1.0830 (20 pips), target 1.0910 (60 pips) = 1 : 3. You make money if you win more than 25% of these trades."},
 mg:{what:"Shows how much of your balance the broker holds (margin) to open a trade.",steps:["Pick the instrument.","Type the lot size.","Type the current price.","Type your account leverage (for example 500 for 1:500).","For cross pairs, type the conversion rate it asks for."],ex:"EURUSD 0.10 lots at 1.0850 with 1:500 leverage: 0.10 × 100,000 × 1.0850 ÷ 500 = $21.70."},
 be:{what:"Shows the win rate you need for a given reward : risk, and what your results add up to over many trades.",steps:["Type your usual reward : risk (2 means 1 : 2).","Type your win rate in %.","Type how much you risk per trade.","Optional: type a drawdown % to see the gain needed to recover it."],ex:"At 1 : 2 you break even winning 33.3% of trades. Winning 45% gives +0.35R per trade."},
 cg:{what:"Projects how a balance grows if it gains the same % every period.",steps:["Type the starting balance.","Type the gain per period in %.","Choose the period: day, week or month.","Type how many periods.","Optional: type an amount you add each period."],ex:"$100 growing 2% a week for 52 weeks ends near $280. Real results go up and down, so treat it as a guide."}};
const howBtn=k=>`<button type="button" class="btn sm ghost howb" data-howto="${k}" aria-expanded="false">How to use</button>`;
const howBox=k=>{const h=HOWTO[k];return `<div class="howto" id="how_${k}" hidden><p><b>What it does:</b> ${esc(h.what)}</p><ol>${h.steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol><p class="ex"><b>Example:</b> ${esc(h.ex)}</p></div>`};
function toolHead(k,title){return `<div class="cardhead"><h2>${title}</h2>${howBtn(k)}</div>${howBox(k)}`}

/* ---------- downloads (works outside Setup too) ---------- */
function download(filename,data,type){try{const blob=new Blob([data],{type});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);toast("Downloading "+filename)}catch(e){toast("Download failed. Use Setup → Backup.")}}
const backupJSON=()=>JSON.stringify({version:4,trades:S.sample?[]:S.trades,cash:S.cash,settings:S.settings,weeks:S.weeks,notes:S.notes},null,1);

/* ---------- MT5 history import (Report → HTML from MT5 on a computer) ---------- */
async function readTextFile(file){const b=new Uint8Array(await file.arrayBuffer());
  if(b[0]===0xFF&&b[1]===0xFE)return new TextDecoder("utf-16le").decode(b);if(b[0]===0xFE&&b[1]===0xFF)return new TextDecoder("utf-16be").decode(b);
  let z=0;for(let i=1;i<Math.min(b.length,400);i+=2)if(b[i]===0)z++;if(z>100)return new TextDecoder("utf-16le").decode(b);return new TextDecoder("utf-8").decode(b)}
const mnum=s=>{const v=parseFloat(String(s||"").replace(/[\s ]/g,"").replace(/,(?=\d{3}\b)/g,""));return isFinite(v)?v:null};
function parseMT5(html){
  const doc=new DOMParser().parseFromString(html,"text/html");const rows=[...doc.querySelectorAll("tr")];
  let i=rows.findIndex(r=>/^\s*Positions\s*$/i.test(r.textContent));if(i<0)return {error:"This file has no Positions table. In MT5 use History → right-click → Report → HTML."};
  const out=[];
  for(let j=i+1;j<rows.length;j++){const r=rows[j];const txt=r.textContent.trim();if(/^(Orders|Deals|Working Orders|Results|Summary)$/i.test(txt))break;
    const c=[...r.querySelectorAll("td")].filter(td=>!td.classList.contains("hidden")).map(td=>td.textContent.trim());
    if(c.length<13||!/^\d{4}\.\d{2}\.\d{2}/.test(c[0])||!/^(buy|sell)/i.test(c[3]))continue;
    out.push({open:c[0],pos:c[1],symbol:c[2],dir:/^buy/i.test(c[3])?"Buy":"Sell",lots:mnum(String(c[4]).split("/")[0]),entry:mnum(c[5]),sl:mnum(c[6]),tp:mnum(c[7]),close:c[8],exit:mnum(c[9]),comm:mnum(c[10])||0,swap:mnum(c[11])||0,profit:mnum(c[12])})}
  if(!out.length)return {error:"No closed trades were found in this report."};return {rows:out}}
function mt5Time(s,srvOff){const m=String(s).match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);if(!m)return null;return Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0))-srvOff*36e5}
function marketOf(sym){const s=sym.toUpperCase();if(/XAU|XAG|GOLD|SILVER/.test(s))return "Metals";if(/BTC|ETH|LTC|XRP|SOL/.test(s))return "Crypto";if(/VOLATILITY|BOOM|CRASH|STEP|JUMP|RANGE BREAK|DEX/.test(s))return "Synthetic";if(/US30|NAS|SPX|US500|GER|UK100|JP225|DJ/.test(s))return "Indices";if(/^[A-Z]{6}/.test(s))return "Forex";return "Stocks"}
async function idFor(acct,pos){const h=new Uint8Array(await crypto.subtle.digest("SHA-256",te.encode("mt5|"+acct+"|"+pos)));const x=[...h.slice(0,16)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return x.slice(0,8)+"-"+x.slice(8,12)+"-5"+x.slice(13,16)+"-"+((parseInt(x[16],16)&3)|8).toString(16)+x.slice(17,20)+"-"+x.slice(20,32)}
async function mt5Build(rows,acct,src,srvOff){
  const out=[];for(const r of rows){if(r.profit==null||!r.symbol)continue;const ms=mt5Time(r.open,srvOff);if(ms==null)continue;const e=new Date(ms+EAT_OFF*60000);
    const net=+(r.profit+r.comm+r.swap).toFixed(2);const sym=/\s/.test(r.symbol)?r.symbol:r.symbol.toUpperCase();
    out.push({id:await idFor(acct,r.pos||r.open+r.symbol),date:eatYmd(e),time:pad(e.getUTCHours())+":"+pad(e.getUTCMinutes()),symbol:sym,market:marketOf(sym),dir:r.dir,source:src,account:acct,setup:"",session:marketOf(sym)==="Synthetic"?"24/7 (synthetic)":(sessionAt(ms)||"24/7 (synthetic)"),
      entry:r.entry,sl:r.sl||null,tp:r.tp||null,exit:r.exit,lots:r.lots,risk:null,pnl:net,grade:"B",emotion:"Calm",followed:true,mistakes:[],
      notes:`Imported from MT5 · position #${r.pos} · profit ${r.profit.toFixed(2)}, commission ${r.comm.toFixed(2)}, swap ${r.swap.toFixed(2)}`,link:"",shot:""})}
  return out}

/* ---------- monthly report (a page you can keep, print or save as PDF) ---------- */
function monthReport(mk){
  const rows=ledger().filter(x=>x.t.date.startsWith(mk)),list=rows.map(x=>x.t),s=stats(list),ret=twr(rows);
  const [y,m]=mk.split("-");const title=new Date(+y,+m-1,1).toLocaleString("en",{month:"long",year:"numeric"});
  const dd=ddSeries(rows),maxDD=dd.length?Math.min(...dd):0;const days=bucketReturns(rows,t=>t.date);
  const bestD=days.reduce((b,x)=>!b||x.pnl>b.pnl?x:b,null),worstD=days.reduce((b,x)=>!b||x.pnl<b.pnl?x:b,null);
  const tbl=(rs,h)=>rs.length?`<table><tr><th>${h}</th><th>Trades</th><th>Win rate</th><th>P&amp;L</th></tr>${rs.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.n}</td><td>${pct(r.wr)}</td><td class="${cls(r.pnl)}">${money(r.pnl)}</td></tr>`).join("")}</table>`:"<p>No trades.</p>";
  const broke=list.filter(t=>!t.followed);const mist=new Map();broke.forEach(t=>(t.mistakes||[]).forEach(x=>{const o=mist.get(x)||{label:x,n:0,pnl:0};o.n++;o.pnl+=t.pnl;mist.set(x,o)}));
  const notes=Object.keys(S.notes).filter(k=>k.startsWith(mk)&&S.notes[k].trim()).sort();
  const css="body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:860px;margin:24px auto;padding:0 16px}h1{margin:0}h2{margin-top:28px;border-bottom:2px solid #f0a63a;padding-bottom:4px}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.k div{border:1px solid #ddd;border-radius:8px;padding:10px}.k small{display:block;color:#666}.k b{font-size:18px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:6px;text-align:left}.pos{color:#13834f}.neg{color:#c62828}.note{border-left:3px solid #f0a63a;padding:4px 10px;margin:8px 0;white-space:pre-wrap}@media print{.np{display:none}}";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Triozizz Journal · ${esc(title)}</title><style>${css}</style></head><body>
  <button class="np" onclick="print()" style="float:right;padding:8px 14px">Print / save as PDF</button>
  <h1>Monthly report · ${esc(title)}</h1><p>${esc(PROFILE&&PROFILE.display_name||"")} · ${S.acct?esc(S.acct):"All accounts"} · made ${esc(new Date().toLocaleString("en"))}</p>
  <div class="k"><div><small>Net P&amp;L</small><b class="${cls(s.net)}">${money(s.net)}</b></div><div><small>Return</small><b class="${cls(ret)}">${spct(ret)}</b></div><div><small>Trades</small><b>${s.n}</b></div><div><small>Win rate</small><b>${pct(s.wr)}</b></div>
  <div><small>Profit factor</small><b>${s.pf===Infinity?"∞":fx(s.pf)}</b></div><div><small>Average R</small><b>${s.avgR==null?"–":fx(s.avgR)+"R"}</b></div><div><small>Max drawdown</small><b class="${cls(maxDD)}">${spct(maxDD,1)}</b></div><div><small>Plan followed</small><b>${pct(list.length?(list.length-broke.length)/list.length:null)}</b></div></div>
  <p>Best day: ${bestD?esc(bestD.label)+" "+money(bestD.pnl):"–"} · Worst day: ${worstD?esc(worstD.label)+" "+money(worstD.pnl):"–"}</p>
  <h2>By symbol</h2>${tbl(group(list,"symbol"),"Symbol")}<h2>By session</h2>${tbl(group(list,"session"),"Session")}<h2>By setup</h2>${tbl(group(list,"setup"),"Setup")}
  <h2>By weekday</h2>${tbl(group(list,t=>DOW[monIdx(parseDay(t.date))]).sort((a,b)=>DOW.indexOf(a.label)-DOW.indexOf(b.label)),"Day")}
  <h2>Rule breaks</h2>${mist.size?tbl([...mist.values()].map(o=>({...o,wr:null})).sort((a,b)=>a.pnl-b.pnl),"Mistake"):"<p>No rule breaks logged.</p>"}
  <h2>Days</h2>${days.length?`<table><tr><th>Date</th><th>Trades</th><th>Return</th><th>P&amp;L</th></tr>${days.map(d=>`<tr><td>${esc(d.label)}</td><td>${d.n}</td><td>${spct(d.ret)}</td><td class="${cls(d.pnl)}">${money(d.pnl)}</td></tr>`).join("")}</table>`:"<p>No trading days.</p>"}
  <h2>Notes</h2>${notes.length?notes.map(k=>`<div class="note"><b>${esc(k)}</b><br>${esc(S.notes[k])}</div>`).join(""):"<p>No notes this month.</p>"}
  </body></html>`}

async function mt5Preview(){const o=F("mtOut"),f=F("mtFile")&&F("mtFile").files[0];if(!o)return;if(!f){o.innerHTML="";S.mt5=null;return}
  o.innerHTML=`<p class="sub">Reading the report…</p>`;
  try{const r=parseMT5(await readTextFile(f));if(r.error){S.mt5=null;o.innerHTML=`<div class="warnline">⚠ ${esc(r.error)}</div>`;return}
    const trades=await mt5Build(r.rows,F("mtAcct").value,F("mtSrc").value,+F("mtOff").value);S.mt5={trades};
    const ex=new Set(S.trades.map(t=>t.id));const upd=trades.filter(t=>ex.has(t.id)).length;const net=trades.reduce((a,t)=>a+t.pnl,0);const ds=trades.map(t=>t.date).sort();
    o.innerHTML=`<div class="calcout"><div><small>Closed trades found</small><b>${trades.length}</b></div><div><small>Dates</small><b style="font-size:14px">${esc(ds[0]||"–")} → ${esc(ds[ds.length-1]||"–")}</b></div><div><small>Net P&amp;L</small><b class="${cls(net)}">${money(net)}</b></div><div><small>Already in journal</small><b>${upd}</b></div></div>
      <div class="inline mt"><button class="btn primary" data-act="mt5go">Import ${trades.length} trade${trades.length===1?"":"s"} into ${esc(F("mtAcct").value)}</button></div>`}
  catch(x){S.mt5=null;o.innerHTML=`<div class="warnline">⚠ That file couldn't be read. Save the report from MT5 as HTML and try again.</div>`}}

/* =====================================================================
   EVENTS
   ===================================================================== */
document.querySelectorAll(".tab[data-view]").forEach(b=>b.onclick=()=>go(b.dataset.view));
F("moreBtn").onclick=()=>{F("sheet").hidden=false};
F("sheet").addEventListener("click",e=>{const b=e.target.closest("[data-go],[data-act]");if(e.target.id==="sheet"||(b&&b.dataset.act==="close-sheet")){F("sheet").hidden=true;return}if(!b)return;if(b.dataset.go)go(b.dataset.go);else if(b.dataset.act==="lock")lockNow();else if(b.dataset.act==="backup"){F("sheet").hidden=true;download("trading-journal-backup-"+ymd(new Date())+".json",backupJSON(),"application/json")}});
F("railAdd").onclick=F("fab").onclick=()=>openTrade();
document.querySelectorAll(".rail [data-act=lock]").forEach(b=>b.onclick=()=>lockNow());
[F("acctFilter"),F("acctFilterM")].forEach(s=>s.addEventListener("change",e=>{S.acct=e.target.value;F("acctFilter").value=F("acctFilterM").value=S.acct;render()}));
F("main").addEventListener("click",async e=>{
  const b=e.target.closest("button,[data-day]");if(!b)return;
  if(b.dataset.period){S.period=b.dataset.period;render()}
  else if(b.dataset.hunit){S.hunit=b.dataset.hunit;render()}
  else if(b.dataset.cal!=null){const v=+b.dataset.cal;if(v===0){const d=new Date();S.calMonth=new Date(d.getFullYear(),d.getMonth(),1)}else S.calMonth=new Date(S.calMonth.getFullYear(),S.calMonth.getMonth()+v,1);render()}
  else if(b.dataset.day){S.noteDay=b.dataset.day;go("notes")}
  else if(b.dataset.noteday){noteSaveNow();S.noteDay=b.dataset.noteday;render();window.scrollTo(0,0)}
  else if(b.dataset.tradesday){S.tf={q:"",src:"",res:"",date:b.dataset.tradesday};go("trades")}
  else if(b.dataset.howto){const box=F("how_"+b.dataset.howto);if(box){box.hidden=!box.hidden;b.setAttribute("aria-expanded",String(!box.hidden));b.textContent=box.hidden?"How to use":"Hide guide"}}
  else if(b.dataset.clock){S.settings.clock=b.dataset.clock;render();saveSettings().catch(saveErr)}
  else if(b.dataset.report){download("triozizz-report-"+b.dataset.report+".html",monthReport(b.dataset.report),"text/html")}
  else if(b.dataset.editacct!=null){S.editAcct=+b.dataset.editacct;render();const c=F("acctCard");if(c)c.scrollIntoView({behavior:"smooth",block:"start"})}
  else if(b.dataset.act==="canceledit"){S.editAcct=null;render()}
  else if(b.dataset.act==="backup")download("trading-journal-backup-"+ymd(new Date())+".json",backupJSON(),"application/json");
  else if(b.dataset.act==="gomt5"){go("setup");setTimeout(()=>{const c=F("mt5");if(c)c.scrollIntoView({behavior:"smooth"})},50)}
  else if(b.dataset.act==="mt5go"){const m=S.mt5;if(!m||!m.trades.length)return;b.disabled=true;b.textContent="Importing…";
    try{for(const t of m.trades)await Store.saveTrade(t);S.mt5=null;await loadData();render();toast("Imported "+m.trades.length+" trades from MT5")}catch(x){b.disabled=false;b.textContent="Try again";saveErr(x)}}
  else if(b.dataset.edit){openTrade(S.trades.find(t=>t.id===b.dataset.edit))}
  else if(b.dataset.delrule!=null){S.settings.rules.splice(+b.dataset.delrule,1);render();saveSettings().catch(saveErr)}
  else if(b.dataset.delacct!=null){const a=S.settings.accounts[+b.dataset.delacct];confirmBox(`Remove "${a.name}"? Its trades stay in your journal and count under the first account until you add it back.`,async()=>{S.settings.accounts.splice(+b.dataset.delacct,1);fillAcctFilters();render();saveSettings().catch(saveErr)})}
  else if(b.dataset.delcash){const id=b.dataset.delcash;try{await Store.deleteCash(id);S.cash=S.cash.filter(c=>c.id!==id);render()}catch(x){saveErr(x)}}
  else if(b.dataset.act==="add")openTrade();
  else if(b.dataset.act==="signout")signOut();
  else if(b.dataset.act==="cleardate"){S.tf.date="";render()}
  else if(b.dataset.act==="csv")offer("trading-journal-"+ymd(new Date())+".csv",csv(),"text/csv");
  else if(b.dataset.act==="json")offer("trading-journal-backup-"+ymd(new Date())+".json",backupJSON(),"application/json");
  else if(b.dataset.act==="copy"){try{await navigator.clipboard.writeText(F("expTxt").value);toast("Copied")}catch(err){F("expTxt").select();toast("Select all and copy")}}
  else if(b.dataset.act==="wipe")confirmBox("Every trade in this journal will be deleted. Export a backup first if you might want them back.",async()=>{const ts=S.trades.slice();for(const t of ts){try{await Store.deleteTrade(t.id);if(t.shot)Store.deleteShot(t.shot).catch(()=>{})}catch(x){}}S.trades=makeSamples();S.sample=true;render();toast("All trades deleted")});
});
F("main").addEventListener("input",e=>{
  const id=e.target.id;
  if(id==="noteBody"){noteQueue(e.target.dataset.day,e.target.value);return}
  if(id==="tq"){S.tf.q=e.target.value;const pos=e.target.selectionStart;render();const q=F("tq");q.focus();try{q.setSelectionRange(pos,pos)}catch(_){}}
  const tool=e.target.closest("[data-tool]");if(tool)runTool(tool.dataset.tool);
});
F("main").addEventListener("change",e=>{
  const id=e.target.id,v=e.target.value;
  const tool=e.target.closest("[data-tool]");if(tool){runTool(tool.dataset.tool);return}
  if(id==="tsrc"){S.tf.src=v;render()}else if(id==="tres"){S.tf.res=v;render()}
  else if(id==="weekNote"){const k=isoWeek(new Date());if((S.weeks[k]||"")===v)return;S.weeks[k]=v;Store.saveWeek(k,v).then(()=>{const s=F("weekSaved");if(s)s.textContent="Saved."}).catch(saveErr)}
  else if(id==="imp"&&e.target.files[0])importFile(e.target.files[0]);
  else if(id==="noteBody"){noteQueue(e.target.dataset.day,v);noteSaveNow()}
  else if(id==="aType"){F("propF").hidden=v!=="Funded";const l=document.querySelector("label[for=aStart]");if(l)l.textContent=v==="Funded"?"Account size":"Starting balance"}
  else if(id==="aFirm"){F("aFirmOW").hidden=v!=="__other";if(v==="__other")F("aFirmO").focus()}
  else if(id==="sClock"){S.settings.clock=v==="12"?"12":"24";saveSettings().then(()=>toast("Saved")).catch(saveErr)}
  else if(["mtFile","mtAcct","mtSrc","mtOff"].includes(id)){mt5Preview()}
  else if(id==="sName"){const n=v.trim();if(n===PROFILE.display_name)return;PROFILE.display_name=n;Store.saveProfile({display_name:n}).then(()=>{toast("Saved");setSync()}).catch(saveErr)}
  else if(id==="sLock"){S.settings.autoLock=+v;bump();saveSettings().then(()=>toast("Saved")).catch(saveErr)}
  else if(/^s[A-Z]/.test(id)){const map={sCur:"currency",sLoss:"dailyLoss",sMax:"maxTrades",sRisk:"riskPct",sLev:"leverage",sSrc:"sources"};const k=map[id];if(!k)return;
    const nv=k==="currency"?(v.trim()||"$"):k==="sources"?[...new Set(v.split(",").map(x=>x.trim()).filter(Boolean))]:(num(v)??0);
    if(k==="sources"&&!nv.length)return;if(JSON.stringify(S.settings[k])===JSON.stringify(nv))return;S.settings[k]=nv;saveSettings().then(()=>toast("Saved")).catch(saveErr)}
});
F("main").addEventListener("submit",async e=>{
  e.preventDefault();const id=e.target.id;
  if(id==="ruleForm"){const v=F("newRule").value.trim();if(!v)return;S.settings.rules.push(v);render();saveSettings().catch(saveErr);F("newRule")&&F("newRule").focus()}
  else if(id==="acctForm"){const a=readAcctForm();if(!a.name||a.start==null)return toast("Enter an account name and "+(a.type==="Funded"?"account size.":"starting balance."));
    if(a.type==="Funded"&&!a.firm)return toast("Choose or type the prop firm's name.");
    const ed=S.editAcct;if(ed==null&&S.settings.accounts.some(x=>x.name===a.name))return toast("You already have an account with that name.");
    if(ed!=null){S.settings.accounts[ed]=a;S.editAcct=null}else S.settings.accounts.push(a);
    fillAcctFilters();render();saveSettings().then(()=>toast(ed!=null?"Account saved":"Account added")).catch(saveErr)}
  else if(id==="cashForm"){const a=num(F("cAmt").value);if(!(a>0))return toast("Enter an amount above zero.");const c={id:uuid(),date:F("cDate").value||ymd(new Date()),amount:a*(+F("cType").value),account:F("cAcct").value,note:""};
    try{await Store.saveCash(c);S.cash.push(c);render();toast(c.amount>0?"Deposit added":"Withdrawal added")}catch(x){saveErr(x)}}
  else if(id==="pinForm"){const err=F("pErr"),o=F("pOld").value.trim(),n=F("pNew").value.trim(),n2=F("pNew2").value.trim();err.textContent="";
    if(!(await checkPin(o)))return err.textContent="Current PIN is wrong.";
    if(!/^\d{6,8}$/.test(n))return err.textContent="New PIN must be 6 to 8 digits.";if(n!==n2)return err.textContent="The new PINs don't match.";
    try{const h=await makePin(n);await Store.saveProfile(h);Object.assign(PROFILE,h);F("pOld").value=F("pNew").value=F("pNew2").value="";toast("PIN changed")}catch(x){err.textContent=friendly(x)}}
});
window.addEventListener("hashchange",()=>{const v=location.hash.slice(1);if(UNLOCKED&&v&&v!==S.view&&VIEWS[v]){S.view=v;render()}});

/* =====================================================================
   BOOT
   ===================================================================== */
(async function boot(){
  S.view=VIEWS[location.hash.slice(1)]?location.hash.slice(1):"dashboard";
  if(!(window.crypto&&crypto.subtle)){F("gatebox").innerHTML=logoHTML+`<h1>Open this in a current browser</h1><p class="sub">The journal needs a secure connection (https) and a recent version of Chrome, Safari, Firefox or Edge.</p>`;return}
  if("serviceWorker" in navigator&&location.protocol==="https:"&&window.top===window.self){navigator.serviceWorker.register("sw.js").catch(()=>{})}
  if(!LIVE){G.tab="signin";gate("welcome");return}
  sb.auth.onAuthStateChange((event)=>{if(event==="PASSWORD_RECOVERY")setTimeout(()=>gate("newpass"),0)});
  const {data:{session}}=await sb.auth.getSession();
  if(location.hash.includes("type=recovery"))return gate("newpass");
  if(!session&&/error_description=/.test(location.hash)){const q=new URLSearchParams(location.hash.slice(1));history.replaceState(null,"",location.pathname);G.tab="signin";return gate("welcome",(q.get("error_description")||"Sign-in was cancelled.").replace(/\+/g," "))}
  if(session){USER=session.user;await afterAuth(false)}else gate("welcome");
})();
