const SERVICE_NAMES={regular:"정기청소",deep:"일회성 대청소",aircon:"에어컨 분해청소",construction:"준공청소",window:"유리창청소",stair:"계단청소",other:"기타"};
const BUSINESS_NAMES={office:"사무실",factory:"공장",restroom:"화장실",academy:"학원",hospital:"병원·의원",cafe:"카페",store:"상가",screen:"스크린골프장",gym:"헬스장",shower:"샤워실",locker:"탈의실",bathhouse:"목욕탕"};
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function phoneOnly(v){return String(v||"").replace(/\D/g,"")}
function safe(v,max=500){return String(v||"").trim().slice(0,max)}
function describe(b){
  const region=[safe(b.city,20),safe(b.district,40)].filter(Boolean).join(" ");
  const svc=SERVICE_NAMES[b.service]||safe(b.service,40),biz=b.service==="regular"?(BUSINESS_NAMES[b.businessType]||""):"";
  return[
    `지역: ${region||"-"}`,
    `서비스: ${biz?biz+" "+svc:svc}`,
    b.frequency?`희망 방문: 주 ${b.frequency}회`:"",
    b.businessType==="restroom"?`화장실: ${b.restroomCount||0}개 / 소변기 ${b.urinals||0} / 좌변기 ${b.toilets||0} / 세면대 ${b.basins||0}`:"",
    b.service==="aircon"?`에어컨: ${safe(b.airconType,30)} ${b.airconCount||0}대`:"",
    safe(b.address,120)?`주소/건물: ${safe(b.address,120)}`:"",
    safe(b.details,500)?`추가내용: ${safe(b.details,500)}`:"",
    "견적: 무료 방문견적 필요"
  ].filter(Boolean).join("\n")
}
function hex(buf){return[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function auth(k,s){const d=new Date().toISOString(),salt=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().slice(0,8),e=new TextEncoder();const key=await crypto.subtle.importKey("raw",e.encode(s),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,e.encode(d+salt));return`HMAC-SHA256 apiKey=${k}, date=${d}, salt=${salt}, signature=${hex(sig)}`}
function sms(env,to,text){return{to,from:phoneOnly(env.SOLAPI_SENDER_NUMBER),text,autoTypeDetect:true}}
async function sendSms(env,b){
  if(!env.SOLAPI_API_KEY||!env.SOLAPI_API_SECRET||!env.SOLAPI_SENDER_NUMBER)return{skipped:true};
  const cp=phoneOnly(b.phone),op=phoneOnly(env.OWNER_PHONE||"01072465626");
  const owner=`[퍼펙트케어 새 무료방문견적]\n고객: ${safe(b.name,40)}\n연락처: ${cp}\n${describe(b)}`;
  const customer=`[퍼펙트케어] ${safe(b.name,40)}님 무료 방문견적 요청이 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.`;
  const messages=[];if(cp)messages.push(sms(env,cp,customer));if(op)messages.push(sms(env,op,owner));
  const a=await auth(env.SOLAPI_API_KEY,env.SOLAPI_API_SECRET);
  const r=await fetch("https://api.solapi.com/messages/v4/send-many/detail",{method:"POST",headers:{Authorization:a,"Content-Type":"application/json"},body:JSON.stringify({messages,showMessageList:true})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.errorMessage||d.message||"문자 전송 실패");return d
}
function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
async function sendEmail(env,b){
  if(!env.RESEND_API_KEY||!env.RESEND_FROM||!env.OWNER_EMAIL)return{skipped:true};
  const cp=phoneOnly(b.phone),details=describe(b);
  const arr=[{from:env.RESEND_FROM,to:[env.OWNER_EMAIL],subject:`[퍼펙트케어] 무료 방문견적 - ${safe(b.city,20)} ${safe(b.district,30)}`,html:`<h2>새 무료 방문견적 요청</h2><p><b>고객:</b> ${esc(b.name)}<br><b>연락처:</b> ${esc(cp)}</p><pre style="white-space:pre-wrap">${esc(details)}</pre>`}];
  if(b.email)arr.push({from:env.RESEND_FROM,to:[safe(b.email,120)],subject:"[퍼펙트케어] 무료 방문견적 요청이 접수되었습니다",html:`<h2>무료 방문견적 요청이 접수되었습니다.</h2><p>${esc(b.name)}님, 담당자가 확인 후 연락드리겠습니다.</p>`});
  for(const item of arr){const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(item)});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.message||"이메일 전송 실패")}}
}
export async function onRequestPost(context){
  let b;try{b=await context.request.json()}catch{return response({error:"잘못된 요청입니다."},400)}
  if(b.website)return response({ok:true});
  const name=safe(b.name,80),ph=phoneOnly(b.phone);
  if(!b.consent)return response({error:"개인정보 수집·이용 동의가 필요합니다."},400);
  if(!name||ph.length<10||ph.length>11)return response({error:"이름과 연락처를 확인해주세요."},400);
  if(!b.city||!b.district||!b.service)return response({error:"지역과 청소 종류를 확인해주세요."},400);
  b.name=name;b.phone=ph;b.email=safe(b.email,160);

  const jobs=[];if(context.env.SOLAPI_API_KEY)jobs.push(sendSms(context.env,b));if(context.env.RESEND_API_KEY)jobs.push(sendEmail(context.env,b));
  if(!jobs.length)return response({error:"알림 전송 설정이 아직 완료되지 않았습니다."},503);
  const r=await Promise.allSettled(jobs);if(!r.some(x=>x.status==="fulfilled"))return response({error:"접수 알림 전송에 실패했습니다. 010-7246-5626으로 연락해주세요."},502);
  return response({ok:true,message:"무료 방문견적 요청 접수 완료"})
}
export async function onRequestGet(){return response({ok:true,service:"perfectcare-free-visit-quote"})}
