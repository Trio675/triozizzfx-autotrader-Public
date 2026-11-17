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
const DEF_SETTINGS={currency:"$",dailyLoss:5,maxTrades:5,riskPct:2,autoLock:5,leverage:500,
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
  tf:{q:"",src:"",res:"",date:""},view:"dashboard",editing:null};
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
    <div class="gor"><span>or</span></div>
    <button type="button" class="btn wide gbtn" data-g="google" ${LIVE?"":"disabled"}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>
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
    else if(a==="resend"){b.disabled=true;await sendOtp(G.target,G.otpType,G.purpose,G.purpose==="signup");toast("New code sent")}
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
        if(data.session){await afterAuth(true)}else{G.target=em;gate("check-email")}
      }else{
        busy(true,"Signing in…");const {error}=await sb.auth.signInWithPassword({email:em,password:pw});if(error)throw error;await afterAuth(true);
      }
    }
    else if(st==="code"){
      const code=v("gCode").replace(/\s/g,"");if(!/^\d{6,10}$/.test(code))return gErr("Enter the code from the message.");
      busy(true,"Checking…");
      const {error}=G.otpType==="sms"?await sb.auth.verifyOtp({phone:G.target,token:code,type:"sms"}):await sb.auth.verifyOtp({email:G.target,token:code,type:"email"});
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
function clearData(){S.trades=[];S.cash=[];S.weeks={};S.settings=structuredClone(DEF_SETTINGS);F("main").innerHTML=""}
let lastLoad=0;
async function loadData(){
  const [trades,cash,weeks]=await Promise.all([Store.listTrades(),Store.listCash(),Store.listWeeks()]);
  S.cash=cash;S.weeks=weeks;lastLoad=Date.now();
  if(trades.length){S.trades=trades;S.sample=false}else{S.trades=makeSamples();S.sample=true}
}
async function unlock(){
  gate("loading");
  try{await loadData()}catch(x){return gate("pin-unlock",friendly(x))}
  UNLOCKED=true;F("gate").hidden=true;F("app").hidden=false;F("fab").hidden=false;
  fillAcctFilters();setSync();go(S.view);bump();
}
function lockNow(msg){if(!UNLOCKED)return;F("sheet").hidden=true;clearData();S.settings=mergeSettings(PROFILE&&PROFILE.settings);gate("pin-unlock",msg||"")}
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
  return headHTML("Dashboard",`${s.n} trades · ${periodName()}`,periodSeg())+sampleBanner()+`
  <div class="card status" style="margin-bottom:14px"><span class="pill ${td.st}">${td.txt}</span>
    <span class="stat-line">Today <b class="${cls(td.pnl)}">${money(td.pnl)}</b>${td.lim?` of −${cur()}${(+td.lim).toFixed(2)} limit`:""}</span>
    <span class="stat-line">Trades <b>${td.ts.length}</b>${td.maxT?` / ${td.maxT}`:""}</span>
    ${td.lim?`<span class="meter" title="Daily loss used"><i class="${td.st==="stop"?"bad":""}" style="width:${Math.min(100,Math.max(0,-td.pnl/td.lim*100))}%"></i></span>`:""}</div>
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
    <div class="card"><h2>By session</h2>${bars(group(list,"session"))}</div>
    <div class="card"><h2>By weekday</h2>${bars(group(list,t=>DOW[monIdx(parseDay(t.date))]).sort((a,b)=>DOW.indexOf(a.label)-DOW.indexOf(b.label)))}</div>
    <div class="card"><h2>Discipline</h2>
      <div class="status" style="margin-bottom:12px"><span class="stat-line">Plan followed <b>${pct(list.length?followed.length/list.length:null)}</b></span></div>
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
      cells+=`<button class="day${inM?"":" out"}${k===today?" today":""}" data-day="${k}" style="${bg?"background:"+bg:""}" aria-label="${k}${o?", "+o.n+" trades, "+money(o.pnl):""}"><span class="dn">${d.getDate()}</span>${o?`<span><div class="dp ${cls(o.pnl)}">${money(o.pnl)}</div><div class="dc">${o.n} trade${o.n>1?"s":""}</div></span>`:""}</button>`;
      d.setDate(d.getDate()+1);
    }
    cells+=`<div class="wk"><span class="dc" style="color:var(--muted)">${wn} trade${wn===1?"":"s"}</span><span class="dp ${cls(wp)}">${wn?money(wp):"–"}</span></div>`;
    if(d.getMonth()!==mo&&w>=3)break;
  }
  const nav=`<div class="calhead"><button class="btn sm" data-cal="-1" aria-label="Previous month">‹</button><h3>${first.toLocaleString("en",{month:"long",year:"numeric"})}</h3><button class="btn sm" data-cal="1" aria-label="Next month">›</button><button class="btn sm ghost" data-cal="0">Today</button></div>`;
  return headHTML("Calendar",`Month <span class="num ${cls(ms.net)}">${money(ms.net)}</span> (<span class="num ${cls(mret)}">${spct(mret,1)}</span>) · ${ms.n} trades · ${greenDays} green days, ${redDays} red`,nav)+sampleBanner()+`<div class="cal">${cells}</div><p class="sub mt">Tap a day to see its trades.</p>`;
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
     <span class="c-date mono" style="font-size:13px">${esc(t.date.slice(5))}<br><span class="flat">${esc(t.time||"")}</span></span>
     <span class="sym">${esc(t.symbol)}${t.shot||t.link?" 📷":""}<small>${esc(t.date.slice(5))} · ${esc(t.source)} · <span class="${cls(ret)}">${spct(ret)}</span></small></span>
     <span class="c-dir dir ${t.dir==="Buy"?"buy":"sell"}">${esc(String(t.dir).toUpperCase())}</span>
     <span class="c-src ell">${esc(t.source)}</span>
     <span class="c-setup ell">${esc(t.setup||"—")}${!t.followed?`<br><span class="tag bad">${esc((t.mistakes||[])[0]||"Broke plan")}</span>`:""}</span>
     <span class="c-r r mono ${cls(r)}">${r==null?"–":(r>0?"+":"")+r.toFixed(1)+"R"}</span>
     <span class="c-ret r mono ${cls(ret)}">${spct(ret,1)}</span>
     <span class="r mono ${cls(t.pnl)}">${money(t.pnl)}</span></button>`}).join("");
  return headHTML("Trades",`${s.n} shown · net <span class="num ${cls(s.net)}">${money(s.net)}</span> · ${pct(s.wr)} win rate`,`<button class="btn primary" data-act="add">+ Log trade</button>`)+sampleBanner()+filters+
   (list.length?`<div class="rows"><div class="row th"><span class="c-date">Date</span><span>Symbol</span><span class="c-dir">Side</span><span class="c-src">Taken by</span><span class="c-setup">Setup</span><span class="c-r r">R</span><span class="c-ret r">Return</span><span class="r">P&amp;L</span></div>${rows}</div>`:`<div class="card empty">No trades match these filters.</div>`);
}

/* ---------- calculators ---------- */
function insOptions(sel){const g={};INS.forEach(i=>(g[i.grp]=g[i.grp]||[]).push(i));return Object.entries(g).map(([k,a])=>`<optgroup label="${esc(k)}">${a.map(i=>`<option value="${esc(i.s)}"${i.s===sel?" selected":""}>${esc(i.s)}</option>`).join("")}</optgroup>`).join("")}
const TS={ps:"EURUSD",pl:"EURUSD",pv:"EURUSD"};
function insBlock(p){return `<div class="f"><label for="${p}Ins">Instrument</label><select class="input" id="${p}Ins">${insOptions(TS[p])}</select></div>
  <div class="f" id="${p}CustW" hidden><label for="${p}Con">Contract size</label><input class="input num" id="${p}Con" inputmode="decimal" value="1"></div>
  <div class="f" id="${p}PipW" hidden><label for="${p}Pip">Pip / point size</label><input class="input num" id="${p}Pip" inputmode="decimal" value="1"></div>
  <div class="f" id="${p}ConvW" hidden><label for="${p}Conv" id="${p}ConvL">Rate</label><input class="input num" id="${p}Conv" inputmode="decimal"></div>`}
function vTools(){
  const bal=curBal();const st=S.settings;
  return headHTML("Calculators","Risk, lot size, pip value, profit and growth. Prices are in your account currency (USD).")+`
  <div class="grid tools">
   <div class="card tool" data-tool="ps"><h2>Position size &amp; risk</h2>
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

   <div class="card tool" data-tool="pl"><h2>Profit / loss</h2>
    <div class="form">${insBlock("pl")}
     <div class="f"><label for="plDir">Direction</label><select class="input" id="plDir"><option>Buy</option><option>Sell</option></select></div>
     <div class="f"><label for="plLots">Lots</label><input class="input num" id="plLots" inputmode="decimal" value="0.10"></div>
     <div class="f"><label for="plEntry">Entry</label><input class="input num" id="plEntry" inputmode="decimal" placeholder="1.08500"></div>
     <div class="f"><label for="plExit">Exit</label><input class="input num" id="plExit" inputmode="decimal" placeholder="1.08900"></div>
    </div><div class="calcout" id="plOut"></div></div>

   <div class="card tool" data-tool="pv"><h2>Pip value</h2>
    <div class="form">${insBlock("pv")}
     <div class="f"><label for="pvLots">Lots</label><input class="input num" id="pvLots" inputmode="decimal" value="1"></div>
     <div class="f"><label for="pvPrice">Current price</label><input class="input num" id="pvPrice" inputmode="decimal" placeholder="Needed for USD-base pairs"></div>
    </div><div class="calcout" id="pvOut"></div></div>

   <div class="card tool" data-tool="be"><h2>Break-even &amp; expectancy</h2>
    <div class="form">
     <div class="f"><label for="beRR">Reward : risk (1 : x)</label><input class="input num" id="beRR" inputmode="decimal" value="2"></div>
     <div class="f"><label for="beWR">Your win rate %</label><input class="input num" id="beWR" inputmode="decimal" value="${S.sample?45:Math.round((stats(scopedTrades()).wr||0.45)*100)}"></div>
     <div class="f"><label for="beRisk">Risk per trade (${esc(cur())})</label><input class="input num" id="beRisk" inputmode="decimal" value="${(bal*st.riskPct/100).toFixed(2)}"></div>
     <div class="f"><label for="beDD">Drawdown to recover %</label><input class="input num" id="beDD" inputmode="decimal" value="20"></div>
    </div><div class="calcout" id="beOut"></div></div>

   <div class="card tool" data-tool="cg" style="grid-column:1/-1"><h2>Compounding growth</h2>
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
function runAllTools(){["ps","pl","pv","be","cg"].forEach(runTool)}

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
  return headHTML("Setup","Profile, trading accounts, security and backups")+`
  <div class="grid two">
   <div class="card"><h2>Profile</h2><div class="form">
     <div class="f full"><label for="sName">Name</label><input class="input" id="sName" value="${esc(PROFILE.display_name||"")}"></div>
     <div class="f full"><label>Signed in as</label><div class="mono" style="font-size:14px">${esc(ident)}</div></div>
   </div>${LIVE?`<div class="inline mt"><button class="btn" data-act="signout">Sign out</button></div>`:""}</div>

   <div class="card"><h2>Trading accounts</h2>
     <div class="list">${st.accounts.map((a,i)=>`<div class="li"><span>${esc(a.name)}<small>Starting balance ${money(+a.start,false)}</small></span><span></span>${st.accounts.length>1?`<button class="btn sm ghost" data-delacct="${i}">Remove</button>`:"<span></span>"}</div>`).join("")}</div>
     <form class="form mt" id="acctForm" novalidate><div class="f"><label for="aName">Account name</label><input class="input" id="aName" placeholder="Deriv MT5 real"></div><div class="f"><label for="aStart">Starting balance</label><input class="input num" id="aStart" inputmode="decimal" placeholder="50"></div><div class="f" style="align-self:end"><button class="btn">Add account</button></div></form>
     <p class="sub">To change a starting balance, remove the account and add it again with the same name. Trades keep their account name.</p></div>

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
     <p class="sub">CSV opens in Excel or Google Sheets. The JSON backup restores trades, deposits, settings and weekly notes.</p>
     <div id="expOut"></div>
     <h2 class="mt">Danger zone</h2><button class="btn danger" data-act="wipe" ${S.sample?"disabled":""}>Delete all trades</button></div>
  </div>`;
}

const VIEWS={dashboard:vDashboard,returns:vReturns,calendar:vCalendar,trades:vTrades,tools:vTools,plan:vPlan,setup:vSetup};
function render(){
  if(!UNLOCKED)return;
  document.querySelectorAll(".tab[data-view]").forEach(b=>b.setAttribute("aria-current",b.dataset.view===S.view?"page":"false"));
  F("moreBtn").setAttribute("aria-current",S.view==="plan"||S.view==="setup"?"page":"false");
  F("main").innerHTML=VIEWS[S.view]();
  if(S.view==="tools")runAllTools();
  const syms=[...new Set([...S.trades.map(t=>t.symbol),...INS.filter(i=>!i.custom).map(i=>i.s)])];F("symList").innerHTML=syms.map(s=>`<option value="${esc(s)}">`).join("");
  const sets=[...new Set(S.trades.map(t=>t.setup).filter(Boolean))];F("setupList").innerHTML=sets.map(s=>`<option value="${esc(s)}">`).join("");
}
function go(v){if(!VIEWS[v])v="dashboard";S.view=v;F("sheet").hidden=true;if(location.hash!=="#"+v){try{history.replaceState(null,"","#"+v)}catch(e){}}render();window.scrollTo(0,0)}
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
  const now=new Date();const d=t||{date:ymd(now),time:pad(now.getHours())+":"+pad(now.getMinutes()),symbol:"",market:"Forex",dir:"Buy",source:sourcesList()[0]||"Manual",account:S.acct||S.settings.accounts[0]?.name,setup:"",session:"London",entry:"",sl:"",tp:"",exit:"",lots:"",risk:+(curBal()*S.settings.riskPct/100).toFixed(2),pnl:"",grade:"B",emotion:"Calm",followed:true,mistakes:[],notes:"",link:""};
  F("mTitle").textContent=readOnly?"Example trade (log your own to replace these)":S.editing?"Edit trade":"Log trade";
  F("fDate").value=d.date;F("fTime").value=d.time||"";F("fSym").value=d.symbol;F("fMarket").value=d.market;F("fDir").value=d.dir;F("fSrc").value=d.source;F("fAcct").value=acctOf(d);
  F("fSetup").value=d.setup||"";F("fSession").value=d.session;
  [["fEntry","entry"],["fSL","sl"],["fTP","tp"],["fExit","exit"],["fLots","lots"],["fRisk","risk"],["fPnl","pnl"]].forEach(([i,k])=>F(i).value=d[k]??"");
  F("fGrade").value=d.grade||"B";F("fEmo").value=d.emotion||"Calm";F("fPlan").value=d.followed===false?"0":"1";
  document.querySelectorAll("#fMistakes input").forEach(c=>c.checked=(d.mistakes||[]).includes(c.value));
  F("fNotes").value=d.notes||"";F("fLink").value=d.link||"";F("fErr").textContent="";F("fShot").value="";F("fShotName").textContent="";
  F("fDel").style.visibility=S.editing?"visible":"hidden";F("fSave").hidden=readOnly;
  F("fShotImg").hidden=true;F("fShotClear").hidden=!shotPath;
  if(shotPath){Store.shotUrl(shotPath).then(u=>{if(u&&!shotBlob&&!shotRemoved){F("fShotImg").src=u;F("fShotImg").hidden=false}})}
  preview();F("ov").classList.add("open");setTimeout(()=>F(S.editing?"fPnl":"fSym").focus(),30);
}
function closeTrade(){F("ov").classList.remove("open");S.editing=null}
function preview(){
  const e=num(F("fEntry").value),sl=num(F("fSL").value),tp=num(F("fTP").value),x=num(F("fExit").value),risk=num(F("fRisk").value),pnl=num(F("fPnl").value);
  const dist=e!=null&&sl!=null?Math.abs(e-sl):null;const rr=dist&&tp!=null?Math.abs(tp-e)/dist:null;
  const sgn=F("fDir").value==="Buy"?1:-1;const xr=dist&&x!=null?sgn*(x-e)/dist:null;const R=risk>0&&pnl!=null?pnl/risk:null;
  const bal=curBal();
  F("fPreview").innerHTML=`<span>Planned R:R <b>${rr==null?"–":"1 : "+rr.toFixed(2)}</b></span><span>Exit at <b class="${cls(xr)}">${xr==null?"–":(xr>0?"+":"")+xr.toFixed(2)+"R"}</b></span><span>Result <b class="${cls(R)}">${R==null?"–":(R>0?"+":"")+R.toFixed(2)+"R"}</b></span><span>Return <b class="${cls(pnl)}">${pnl==null||!(bal>0)?"–":spct(pnl/bal)}</b></span><span>Risk <b>${risk==null||!(bal>0)?"–":(risk/bal*100).toFixed(1)+"%"}</b> of balance</span>`;
  if(F("fPlan").value==="1"&&document.querySelectorAll("#fMistakes input:checked").length)F("fPlan").value="0";
}
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
    mistakes:[...document.querySelectorAll("#fMistakes input:checked")].map(c=>c.value),notes:F("fNotes").value.trim(),link:F("fLink").value.trim(),shot:shotRemoved?"":shotPath};
  F("fSave").disabled=true;F("fSave").textContent="Saving…";
  try{
    if(shotBlob){const old=shotPath;t.shot=await Store.uploadShot(shotBlob,id);if(old)Store.deleteShot(old).catch(()=>{})}
    else if(shotRemoved&&shotPath)Store.deleteShot(shotPath).catch(()=>{});
    await Store.saveTrade(t);
    if(S.sample){S.trades=[];S.sample=false}
    const i=S.trades.findIndex(x=>x.id===t.id);if(i>=0)S.trades[i]=t;else S.trades.push(t);
    closeTrade();render();toast(i>=0?"Trade updated":"Trade logged · "+money(t.pnl));
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
  if(!tr.length)return toast("No trades found in that file.");
  toast("Importing "+tr.length+" trades…");
  try{for(const t of tr)await Store.saveTrade(t);
    for(const c of (d.cash||[]))if(c&&c.date&&isFinite(c.amount))await Store.saveCash({...c,id:isU(c.id)?c.id:uuid()});
    if(d.settings){S.settings=mergeSettings(d.settings);await saveSettings();fillAcctFilters()}
    for(const [k,v] of Object.entries(d.weeks||{}))await Store.saveWeek(k,v);
    await loadData();render();toast("Imported "+tr.length+" trades")}catch(e){saveErr(e)}
}

/* =====================================================================
   EVENTS
   ===================================================================== */
document.querySelectorAll(".tab[data-view]").forEach(b=>b.onclick=()=>go(b.dataset.view));
F("moreBtn").onclick=()=>{F("sheet").hidden=false};
F("sheet").addEventListener("click",e=>{const b=e.target.closest("[data-go],[data-act]");if(e.target.id==="sheet"||(b&&b.dataset.act==="close-sheet")){F("sheet").hidden=true;return}if(!b)return;if(b.dataset.go)go(b.dataset.go);else if(b.dataset.act==="lock")lockNow()});
F("railAdd").onclick=F("fab").onclick=()=>openTrade();
document.querySelectorAll(".rail [data-act=lock]").forEach(b=>b.onclick=()=>lockNow());
[F("acctFilter"),F("acctFilterM")].forEach(s=>s.addEventListener("change",e=>{S.acct=e.target.value;F("acctFilter").value=F("acctFilterM").value=S.acct;render()}));
F("main").addEventListener("click",async e=>{
  const b=e.target.closest("button,[data-day]");if(!b)return;
  if(b.dataset.period){S.period=b.dataset.period;render()}
  else if(b.dataset.hunit){S.hunit=b.dataset.hunit;render()}
  else if(b.dataset.cal!=null){const v=+b.dataset.cal;if(v===0){const d=new Date();S.calMonth=new Date(d.getFullYear(),d.getMonth(),1)}else S.calMonth=new Date(S.calMonth.getFullYear(),S.calMonth.getMonth()+v,1);render()}
  else if(b.dataset.day){S.tf={q:"",src:"",res:"",date:b.dataset.day};go("trades")}
  else if(b.dataset.edit){openTrade(S.trades.find(t=>t.id===b.dataset.edit))}
  else if(b.dataset.delrule!=null){S.settings.rules.splice(+b.dataset.delrule,1);render();saveSettings().catch(saveErr)}
  else if(b.dataset.delacct!=null){const a=S.settings.accounts[+b.dataset.delacct];confirmBox(`Remove "${a.name}"? Its trades stay in your journal and count under the first account until you add it back.`,async()=>{S.settings.accounts.splice(+b.dataset.delacct,1);fillAcctFilters();render();saveSettings().catch(saveErr)})}
  else if(b.dataset.delcash){const id=b.dataset.delcash;try{await Store.deleteCash(id);S.cash=S.cash.filter(c=>c.id!==id);render()}catch(x){saveErr(x)}}
  else if(b.dataset.act==="add")openTrade();
  else if(b.dataset.act==="signout")signOut();
  else if(b.dataset.act==="cleardate"){S.tf.date="";render()}
  else if(b.dataset.act==="csv")offer("trading-journal-"+ymd(new Date())+".csv",csv(),"text/csv");
  else if(b.dataset.act==="json")offer("trading-journal-backup-"+ymd(new Date())+".json",JSON.stringify({version:3,trades:S.sample?[]:S.trades,cash:S.cash,settings:S.settings,weeks:S.weeks},null,1),"application/json");
  else if(b.dataset.act==="copy"){try{await navigator.clipboard.writeText(F("expTxt").value);toast("Copied")}catch(err){F("expTxt").select();toast("Select all and copy")}}
  else if(b.dataset.act==="wipe")confirmBox("Every trade in this journal will be deleted. Export a backup first if you might want them back.",async()=>{const ts=S.trades.slice();for(const t of ts){try{await Store.deleteTrade(t.id);if(t.shot)Store.deleteShot(t.shot).catch(()=>{})}catch(x){}}S.trades=makeSamples();S.sample=true;render();toast("All trades deleted")});
});
F("main").addEventListener("input",e=>{
  const id=e.target.id;
  if(id==="tq"){S.tf.q=e.target.value;const pos=e.target.selectionStart;render();const q=F("tq");q.focus();try{q.setSelectionRange(pos,pos)}catch(_){}}
  const tool=e.target.closest("[data-tool]");if(tool)runTool(tool.dataset.tool);
});
F("main").addEventListener("change",e=>{
  const id=e.target.id,v=e.target.value;
  const tool=e.target.closest("[data-tool]");if(tool){runTool(tool.dataset.tool);return}
  if(id==="tsrc"){S.tf.src=v;render()}else if(id==="tres"){S.tf.res=v;render()}
  else if(id==="weekNote"){const k=isoWeek(new Date());if((S.weeks[k]||"")===v)return;S.weeks[k]=v;Store.saveWeek(k,v).then(()=>{const s=F("weekSaved");if(s)s.textContent="Saved."}).catch(saveErr)}
  else if(id==="imp"&&e.target.files[0])importFile(e.target.files[0]);
  else if(id==="sName"){const n=v.trim();if(n===PROFILE.display_name)return;PROFILE.display_name=n;Store.saveProfile({display_name:n}).then(()=>{toast("Saved");setSync()}).catch(saveErr)}
  else if(id==="sLock"){S.settings.autoLock=+v;bump();saveSettings().then(()=>toast("Saved")).catch(saveErr)}
  else if(/^s[A-Z]/.test(id)){const map={sCur:"currency",sLoss:"dailyLoss",sMax:"maxTrades",sRisk:"riskPct",sLev:"leverage",sSrc:"sources"};const k=map[id];if(!k)return;
    const nv=k==="currency"?(v.trim()||"$"):k==="sources"?[...new Set(v.split(",").map(x=>x.trim()).filter(Boolean))]:(num(v)??0);
    if(k==="sources"&&!nv.length)return;if(JSON.stringify(S.settings[k])===JSON.stringify(nv))return;S.settings[k]=nv;saveSettings().then(()=>toast("Saved")).catch(saveErr)}
});
F("main").addEventListener("submit",async e=>{
  e.preventDefault();const id=e.target.id;
  if(id==="ruleForm"){const v=F("newRule").value.trim();if(!v)return;S.settings.rules.push(v);render();saveSettings().catch(saveErr);F("newRule")&&F("newRule").focus()}
  else if(id==="acctForm"){const n=F("aName").value.trim(),s=num(F("aStart").value);if(!n||s==null)return toast("Enter an account name and starting balance.");if(S.settings.accounts.some(a=>a.name===n))return toast("You already have an account with that name.");
    S.settings.accounts.push({name:n,start:s});fillAcctFilters();render();saveSettings().then(()=>toast("Account added")).catch(saveErr)}
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
