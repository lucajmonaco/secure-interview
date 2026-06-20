const $ = id => document.getElementById(id);

async function get(url){const r=await fetch(url,{method:'GET'});return r.json();}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
async function patch(url,body){const r=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}

function showModal(id){
  const el=document.getElementById(id);
  if(!el)return;
  el.style.cssText='display:flex!important;position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;background:rgba(0,0,0,0.85)!important;align-items:center!important;justify-content:center!important;z-index:99999!important;';
}
function hideModal(id){
  const el=document.getElementById(id);
  if(el)el.style.cssText='display:none!important;';
}

function toast(msg,type,duration){
  let c=document.getElementById('toast-container');
  if(!c){c=document.createElement('div');c.id='toast-container';Object.assign(c.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'99999',display:'flex',flexDirection:'column',gap:'10px',pointerEvents:'none'});document.body.appendChild(c);}
  const t=document.createElement('div');
  const colors={green:'#3fb950',red:'#f85149',amber:'#e3b341',blue:'#58a6ff'};
  const col=colors[type]||'#e6edf3';
  Object.assign(t.style,{background:'#1c2128',border:'1px solid '+(colors[type]||'#444c56'),borderRadius:'10px',padding:'12px 18px',fontSize:'13px',color:col,minWidth:'220px',maxWidth:'340px',boxShadow:'0 8px 24px rgba(0,0,0,0.6)',animation:'toastIn .2s ease',lineHeight:'1.4'});
  t.textContent=msg;
  c.appendChild(t);
  const ms=typeof duration==='number'?duration:3500;
  setTimeout(()=>{t.style.animation='toastOut .2s ease';setTimeout(()=>t.remove(),200);},ms);
}

function fmtDate(ts){
  if(!ts)return'-';
  return new Date(ts*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function fmtDateTime(ts){
  if(!ts)return'-';
  return new Date(ts*1000).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtDuration(secs){
  if(!secs)return'-';
  const m=Math.floor(secs/60),s=secs%60;
  return m+'m '+s+'s';
}

async function requireLogin(back){
  const me=await get('/api/auth/me');
  if(!me||!me.loggedIn){window.location.href=back||'/';return null;}
  return me;
}

function trustClass(score){return score>=80?'trust-hi':score>=60?'trust-mid':'trust-lo';}
function trustLabel(score){return score>=80?'Excellent':score>=60?'Good':score>=40?'Caution':'High Risk';}
