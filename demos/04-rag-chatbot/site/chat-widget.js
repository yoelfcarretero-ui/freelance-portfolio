/* Clinic chat widget - RAG demo by Yoel Carretero */
"use strict";(()=>{var E=Object.defineProperty;var T=(s,t,e)=>t in s?E(s,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):s[t]=e;var c=(s,t,e)=>T(s,typeof t!="symbol"?t+"":t,e);var m={es:{open:"Abrir el chat",close:"Cerrar el chat",subtitle:"Respondo con la informaci\xF3n de la cl\xEDnica",welcome:"\xA1Hola! Soy el asistente virtual de la cl\xEDnica. Puedo responder preguntas sobre horarios, precios, seguros, urgencias y citas usando solo la informaci\xF3n oficial de la cl\xEDnica.",suggestions:["\xBFAbr\xEDs los s\xE1bados?","\xBFCu\xE1nto cuesta una limpieza?","Tengo un dolor muy fuerte, \xBFqu\xE9 hago?","\xBFTrabaj\xE1is con Sanitas?"],placeholder:"Escribe tu pregunta...",send:"Enviar",human:"Hablar con una persona",sources:s=>`Fuentes (${s})`,leaveDetails:"Dejar mis datos",thinking:"Buscando en los documentos...",error:"No he podido conectar con el asistente. Int\xE9ntalo de nuevo en un momento.",rateLimited:"Has enviado muchas preguntas seguidas. Espera un minuto, por favor.",disclaimer:"Asistente autom\xE1tico. Puede equivocarse y no sustituye la valoraci\xF3n de un dentista.",demoBadge:"DEMO",demoTitle:"Modo demo: sin IA generativa, respuestas citadas de los documentos",form:{title:"Te contactamos nosotros",intro:"D\xE9janos tus datos y el equipo de la cl\xEDnica te responder\xE1 en menos de 24 horas laborables.",name:"Nombre",email:"Correo electr\xF3nico",phone:"Tel\xE9fono (opcional)",question:"\xBFEn qu\xE9 podemos ayudarte?",consent:"Acepto que la cl\xEDnica use estos datos solo para responder a mi consulta.",submit:"Enviar",sending:"Enviando...",cancel:"Cancelar",success:"\xA1Gracias! Hemos recibido tus datos. La cl\xEDnica te contactar\xE1 pronto.",successDemo:"\xA1Gracias! (Modo demo: los datos no se guardan.)",failed:"No se ha podido enviar. Revisa los datos e int\xE9ntalo de nuevo."}},en:{open:"Open chat",close:"Close chat",subtitle:"I answer from the clinic's own information",welcome:"Hi! I'm the clinic's virtual assistant. I can answer questions about opening hours, prices, insurance, emergencies and appointments, using only the clinic's official information.",suggestions:["Are you open on Saturdays?","How much is a teeth cleaning?","I have severe tooth pain, what should I do?","Do you accept Sanitas?"],placeholder:"Type your question...",send:"Send",human:"Talk to a person",sources:s=>`Sources (${s})`,leaveDetails:"Leave my details",thinking:"Searching the documents...",error:"I couldn't reach the assistant. Please try again in a moment.",rateLimited:"You've sent a lot of questions in a row. Please wait a minute.",disclaimer:"Automated assistant. It can make mistakes and does not replace a dentist's assessment.",demoBadge:"DEMO",demoTitle:"Demo mode: no generative AI, answers are quoted from the documents",form:{title:"We'll get in touch",intro:"Leave your details and the clinic team will reply within 24 working hours.",name:"Name",email:"Email",phone:"Phone (optional)",question:"How can we help?",consent:"I agree that the clinic may use these details only to answer my enquiry.",submit:"Send",sending:"Sending...",cancel:"Cancel",success:"Thank you! We've received your details. The clinic will contact you soon.",successDemo:"Thank you! (Demo mode: details are not stored.)",failed:"Could not send. Please check your details and try again."}}};function a(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function b(s){return a(s).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\[(\d{1,2})\]/g,'<sup class="cite" aria-label="source $1">$1</sup>')}function x(s){let t=s.replace(/\r\n/g,`
`).split(`
`),e=[],n=[],o=[],i=()=>{n.length&&e.push(`<ul>${n.map(l=>`<li>${b(l)}</li>`).join("")}</ul>`),o.length&&e.push(`<blockquote>${o.map(l=>`<p>${b(l)}</p>`).join("")}</blockquote>`),n=[],o=[]};for(let l of t){let r=l.trim();/^>\s?/.test(r)?(n.length&&i(),o.push(r.replace(/^>\s?/,""))):/^[-*]\s+/.test(r)?(o.length&&i(),n.push(r.replace(/^[-*]\s+/,""))):(i(),r&&e.push(`<p>${b(r)}</p>`))}return i(),e.join("")}async function*y(s){let t=s.getReader(),e=new TextDecoder,n="";try{for(;;){let{value:i,done:l}=await t.read();if(l)break;n+=e.decode(i,{stream:!0}).replace(/\r\n/g,`
`);let r;for(;(r=n.indexOf(`

`))!==-1;){let d=n.slice(0,r);n=n.slice(r+2);let u=v(d);u&&(yield u)}}let o=v(n);o&&(yield o)}finally{t.releaseLock()}}function v(s){let t="message",e=[];for(let n of s.split(`
`))n.startsWith("event:")?t=n.slice(6).trim():n.startsWith("data:")&&e.push(n.slice(5).replace(/^ /,""));return e.length?{event:t,data:e.join(`
`)}:void 0}var w=`
:host {
  --brand: #0f766e;
  --brand-ink: #ffffff;
  --bg: #ffffff;
  --surface: #f4f6f8;
  --ink: #17202a;
  --muted: #5d6b79;
  --line: #e2e7ec;
  --radius: 18px;
  --shadow: 0 18px 50px rgba(16, 24, 40, 0.18), 0 4px 12px rgba(16, 24, 40, 0.08);
  all: initial;
  position: fixed;
  z-index: 2147483000;
  bottom: 20px;
  right: 20px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  color: var(--ink);
}
:host([data-position="left"]) { right: auto; left: 20px; }
* { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }

.launcher {
  width: 60px; height: 60px; border-radius: 50%;
  border: 0; cursor: pointer;
  background: var(--brand); color: var(--brand-ink);
  box-shadow: var(--shadow);
  display: grid; place-items: center;
  transition: transform .18s ease, box-shadow .18s ease;
}
.launcher:hover { transform: translateY(-2px) scale(1.03); }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--brand) 45%, white); outline-offset: 2px;
}
.launcher svg { width: 28px; height: 28px; }
.launcher .dot {
  position: absolute; top: 2px; right: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #f97316; border: 2px solid #fff;
}

.panel {
  position: absolute; bottom: 76px; right: 0;
  width: min(390px, calc(100vw - 24px));
  height: min(640px, calc(100vh - 110px));
  background: var(--bg);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex; flex-direction: column; overflow: hidden;
  transform-origin: bottom right;
  animation: pop .18s ease-out;
}
:host([data-position="left"]) .panel { right: auto; left: 0; transform-origin: bottom left; }
.panel[hidden] { display: none; }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

.header {
  background: var(--brand); color: var(--brand-ink);
  padding: 14px 14px 14px 16px; display: flex; align-items: center; gap: 12px;
}
.avatar {
  width: 38px; height: 38px; border-radius: 50%; flex: none;
  background: rgba(255,255,255,.18); display: grid; place-items: center;
}
.avatar svg { width: 22px; height: 22px; }
.titles { flex: 1; min-width: 0; }
.title { font-weight: 650; font-size: 15.5px; display: flex; align-items: center; gap: 8px; }
.subtitle { font-size: 12.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  background: #fde68a; color: #713f12; padding: 2px 7px; border-radius: 999px;
}
.icon-btn {
  border: 0; background: transparent; color: inherit; cursor: pointer;
  width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
}
.icon-btn:hover { background: rgba(255,255,255,.15); }
.icon-btn svg { width: 20px; height: 20px; }

.log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: var(--surface); scroll-behavior: smooth; }

.msg { max-width: 88%; padding: 10px 13px; border-radius: 16px; word-wrap: break-word; }
.msg p { margin: 0 0 6px; }
.msg p:last-child { margin-bottom: 0; }
.msg ul { margin: 4px 0 6px; padding-left: 18px; }
.msg blockquote {
  margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--brand);
  background: color-mix(in srgb, var(--brand) 6%, white); border-radius: 0 10px 10px 0;
}
.msg blockquote p { margin: 2px 0; }
.user { align-self: flex-end; background: var(--brand); color: var(--brand-ink); border-bottom-right-radius: 5px; }
.bot { align-self: flex-start; background: var(--bg); border: 1px solid var(--line); border-bottom-left-radius: 5px; }
.cite {
  display: inline-block; min-width: 17px; height: 17px; padding: 0 4px; margin-left: 2px;
  border-radius: 9px; background: color-mix(in srgb, var(--brand) 14%, white); color: var(--brand);
  font-size: 10.5px; font-weight: 700; line-height: 17px; text-align: center; vertical-align: 2px;
}
.typing { display: inline-flex; gap: 4px; align-items: center; color: var(--muted); font-size: 13px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

.notice { margin-top: 8px; font-size: 11.5px; color: var(--muted); font-style: italic; }
.sources { margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 6px; }
.sources summary { cursor: pointer; font-size: 12.5px; color: var(--brand); font-weight: 600; list-style: none; }
.sources summary::-webkit-details-marker { display: none; }
.sources summary::before { content: "\\25B8"; display: inline-block; margin-right: 5px; transition: transform .15s; }
.sources[open] summary::before { transform: rotate(90deg); }
.sources ol { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.sources li { font-size: 12.5px; background: var(--surface); border-radius: 10px; padding: 7px 9px; }
.sources .src-title { font-weight: 600; }
.sources .src-snippet { color: var(--muted); margin-top: 2px; }

.cta {
  margin-top: 10px; border: 1px solid var(--brand); color: var(--brand); background: transparent;
  padding: 7px 12px; border-radius: 999px; cursor: pointer; font-size: 13px; font-weight: 600;
}
.cta:hover { background: color-mix(in srgb, var(--brand) 8%, white); }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--line); background: var(--bg); padding: 7px 11px; border-radius: 999px;
  cursor: pointer; font-size: 13px; text-align: left;
}
.chip:hover { border-color: var(--brand); color: var(--brand); }

.card { align-self: stretch; background: var(--bg); border: 1px solid var(--line); border-radius: 16px; padding: 14px; }
.card h3 { margin: 0 0 4px; font-size: 15px; }
.card .intro { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
.field { display: grid; gap: 4px; margin-bottom: 9px; font-size: 12.5px; color: var(--muted); }
.field input, .field textarea {
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font-size: 14px; color: var(--ink); background: #fff; width: 100%;
}
.field textarea { resize: vertical; min-height: 64px; }
.consent { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--muted); margin: 4px 0 12px; }
.consent input { margin-top: 2px; accent-color: var(--brand); }
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.btn { border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; font-weight: 600; font-size: 14px; }
.btn-primary { background: var(--brand); color: var(--brand-ink); }
.btn-primary:disabled { opacity: .6; cursor: progress; }
.btn-ghost { background: transparent; color: var(--muted); }
.form-error { color: #b42318; font-size: 12.5px; margin: 0 0 8px; }
.success { color: #067647; font-weight: 600; }

.composer { border-top: 1px solid var(--line); padding: 10px 12px 8px; background: var(--bg); }
.input-row { display: flex; align-items: flex-end; gap: 8px; }
.input-row textarea {
  flex: 1; resize: none; border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px;
  max-height: 120px; min-height: 44px; font-size: 14.5px; line-height: 1.35; background: var(--surface);
}
.send {
  width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer; flex: none;
  background: var(--brand); color: var(--brand-ink); display: grid; place-items: center;
}
.send:disabled { opacity: .45; cursor: not-allowed; }
.send svg { width: 20px; height: 20px; }
.meta-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
.link { border: 0; background: none; color: var(--brand); cursor: pointer; font-size: 12.5px; font-weight: 600; padding: 2px 0; }
.disclaimer { font-size: 10.5px; color: var(--muted); text-align: right; }

@media (max-width: 480px) {
  :host { bottom: 14px; right: 14px; }
  .panel { position: fixed; inset: 0; width: 100vw; height: 100dvh; border-radius: 0; bottom: 0; }
  :host([data-position="left"]) .panel { left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .panel, .launcher, .typing span { animation: none; transition: none; }
}
`;var h={chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',tooth:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 5.5C10.3 4 8.6 3.5 7 3.8 4.4 4.3 3.4 7 4 9.8c.5 2.3 1.5 3.6 1.9 6 .4 2.5.8 5.2 2.3 5.2 1.6 0 1.6-3.4 2.2-5 .3-.8.8-1.2 1.6-1.2s1.3.4 1.6 1.2c.6 1.6.6 5 2.2 5 1.5 0 1.9-2.7 2.3-5.2.4-2.4 1.4-3.7 1.9-6 .6-2.8-.4-5.5-3-6-1.6-.3-3.3.2-5 1.7z"/></svg>'},k=500,f=class{constructor(t){c(this,"config",t);c(this,"host");c(this,"root");c(this,"t");c(this,"history",[]);c(this,"busy",!1);c(this,"lastQuestion","");c(this,"panel");c(this,"launcher");c(this,"log");c(this,"input");c(this,"sendBtn");c(this,"badge");this.t=m[t.lang],this.host=document.createElement("div"),this.host.setAttribute("data-clinic-chat",""),this.host.setAttribute("data-position",t.position),this.host.style.setProperty("--brand",t.color),this.root=this.host.attachShadow({mode:"open"})}mount(){let t=document.createElement("style");t.textContent=w,this.root.appendChild(t);let e=document.createElement("div");e.innerHTML=`
      <section class="panel" role="dialog" aria-label="${a(this.config.title)}" hidden>
        <header class="header">
          <div class="avatar">${h.tooth}</div>
          <div class="titles">
            <div class="title"><span>${a(this.config.title)}</span><span class="badge" hidden title="${a(this.t.demoTitle)}">${this.t.demoBadge}</span></div>
            <div class="subtitle">${a(this.t.subtitle)}</div>
          </div>
          <button class="icon-btn close" type="button" aria-label="${a(this.t.close)}">${h.close}</button>
        </header>
        <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
        <form class="composer">
          <div class="input-row">
            <textarea rows="1" maxlength="${k}" placeholder="${a(this.t.placeholder)}" aria-label="${a(this.t.placeholder)}"></textarea>
            <button class="send" type="submit" aria-label="${a(this.t.send)}" disabled>${h.send}</button>
          </div>
          <div class="meta-row">
            <button class="link human" type="button">${a(this.t.human)}</button>
            <span class="disclaimer">${a(this.t.disclaimer)}</span>
          </div>
        </form>
      </section>
      <button class="launcher" type="button" aria-label="${a(this.t.open)}" aria-expanded="false">${h.chat}</button>
    `,this.root.append(...Array.from(e.childNodes)),this.panel=this.$(".panel"),this.launcher=this.$(".launcher"),this.log=this.$(".log"),this.input=this.$("textarea"),this.sendBtn=this.$(".send"),this.badge=this.$(".badge"),this.launcher.addEventListener("click",()=>this.toggle()),this.$(".close").addEventListener("click",()=>this.toggle(!1)),this.$(".human").addEventListener("click",()=>this.showLeadForm()),this.$(".composer").addEventListener("submit",n=>{n.preventDefault(),this.ask(this.input.value)}),this.input.addEventListener("input",()=>this.syncComposer()),this.input.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),this.ask(this.input.value))}),this.root.addEventListener("keydown",n=>{n.key==="Escape"&&this.toggle(!1)}),this.addBotWelcome(),document.body.appendChild(this.host),this.config.open&&this.toggle(!0),this.fetchMode()}$(t){let e=this.root.querySelector(t);if(!e)throw new Error(`chat widget: missing ${t}`);return e}toggle(t){let e=t??this.panel.hidden;this.panel.hidden=!e,this.launcher.setAttribute("aria-expanded",String(e)),this.launcher.innerHTML=e?h.close:h.chat,this.launcher.setAttribute("aria-label",e?this.t.close:this.t.open),e?setTimeout(()=>this.input.focus(),50):this.launcher.focus()}syncComposer(){this.input.style.height="auto",this.input.style.height=`${Math.min(this.input.scrollHeight,120)}px`,this.sendBtn.disabled=this.busy||this.input.value.trim().length===0}async fetchMode(){try{let t=await fetch(`${this.config.apiUrl}/health`);t.ok&&this.setMode((await t.json()).mode)}catch{}}setMode(t){this.badge.hidden=t!=="demo"}scrollToEnd(){this.log.scrollTop=this.log.scrollHeight}addBotWelcome(){let t=this.addMessage("bot","");t.innerHTML=`<p>${a(this.t.welcome)}</p>`;let e=document.createElement("div");e.className="chips";for(let n of this.t.suggestions){let o=document.createElement("button");o.type="button",o.className="chip",o.textContent=n,o.addEventListener("click",()=>{e.remove(),this.ask(n)}),e.appendChild(o)}this.log.appendChild(e)}addMessage(t,e){let n=document.createElement("div");return n.className=`msg ${t}`,t==="user"&&(n.textContent=e),this.log.appendChild(n),this.scrollToEnd(),n}async ask(t){let e=t.trim().slice(0,k);if(!e||this.busy)return;this.busy=!0,this.lastQuestion=e,this.input.value="",this.syncComposer(),this.root.querySelector(".chips")?.remove(),this.addMessage("user",e);let n=this.addMessage("bot","");n.innerHTML=`<span class="typing" aria-label="${a(this.t.thinking)}"><span></span><span></span><span></span></span>`;let o=document.createElement("div"),i="",l,r=!1;try{let d=await fetch(`${this.config.apiUrl}/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:e,history:this.history.slice(-6),lang:this.config.lang,stream:!0})});if(d.status===429)throw new Error("rate_limited");if(!d.ok)throw new Error(`HTTP ${d.status}`);if((d.headers.get("content-type")??"").includes("text/event-stream")&&d.body)for await(let p of y(d.body)){let g=JSON.parse(p.data);if(p.event==="meta")l=g,this.setMode(l.mode);else if(p.event==="delta")i||n.replaceChildren(o),i+=g.text,o.innerHTML=x(i),this.scrollToEnd();else if(p.event==="done")r=!!g.handoff;else if(p.event==="error")throw new Error(g.error)}else{let p=await d.json();l=p,this.setMode(p.mode),i=p.answer??"",r=!!p.handoff,n.replaceChildren(o),o.innerHTML=x(i)}if(!i)throw new Error("empty answer");this.history.push({role:"user",content:e},{role:"assistant",content:i}),this.decorate(n,l,r)}catch(d){let u=d instanceof Error&&d.message==="rate_limited";n.innerHTML=`<p>${a(u?this.t.rateLimited:this.t.error)}</p>`,u||this.decorate(n,void 0,!0)}finally{this.busy=!1,this.syncComposer(),this.scrollToEnd()}}decorate(t,e,n){let o=e?.lang&&m[e.lang]?m[e.lang]:this.t;if(e?.sources?.length){let i=document.createElement("details");i.className="sources",i.innerHTML=`<summary>${a(o.sources(e.sources.length))}</summary><ol>${e.sources.map(l=>`<li><div class="src-title"><span class="cite">${l.n}</span> ${a(l.title)} &rsaquo; ${a(l.section)}</div><div class="src-snippet">${a(l.snippet)}</div></li>`).join("")}</ol>`,t.appendChild(i)}if(e?.notice){let i=document.createElement("div");i.className="notice",i.textContent=e.notice,t.appendChild(i)}if(n){let i=document.createElement("button");i.type="button",i.className="cta",i.textContent=o.leaveDetails,i.addEventListener("click",()=>{i.remove(),this.showLeadForm()}),t.appendChild(i)}}showLeadForm(){if(this.root.querySelector(".lead-form")){this.root.querySelector(".lead-form input[name=name]")?.focus();return}this.panel.hidden&&this.toggle(!0);let t=this.t.form,e=document.createElement("form");e.className="card lead-form",e.noValidate=!0,e.innerHTML=`
      <h3>${a(t.title)}</h3>
      <p class="intro">${a(t.intro)}</p>
      <p class="form-error" hidden></p>
      <label class="field">${a(t.name)}<input name="name" autocomplete="name" required maxlength="100"></label>
      <label class="field">${a(t.email)}<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
      <label class="field">${a(t.phone)}<input name="phone" type="tel" autocomplete="tel" maxlength="20"></label>
      <label class="field">${a(t.question)}<textarea name="question" required maxlength="1000"></textarea></label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="consent"><input type="checkbox" name="consent" required><span>${a(t.consent)}</span></label>
      <div class="row">
        <button class="btn btn-ghost" type="button" data-cancel>${a(t.cancel)}</button>
        <button class="btn btn-primary" type="submit">${a(t.submit)}</button>
      </div>`;let n=e.querySelector("textarea[name=question]");n.value=this.lastQuestion,e.querySelector("[data-cancel]").addEventListener("click",()=>e.remove()),e.addEventListener("submit",o=>{o.preventDefault(),this.submitLead(e)}),this.log.appendChild(e),this.scrollToEnd(),e.querySelector("input[name=name]").focus()}async submitLead(t){let e=this.t.form,n=new FormData(t),o=t.querySelector(".form-error"),i=t.querySelector("button[type=submit]"),l={name:String(n.get("name")??""),email:String(n.get("email")??""),phone:String(n.get("phone")??""),question:String(n.get("question")??""),consent:n.get("consent")==="on",website:String(n.get("website")??""),lang:this.config.lang,pageUrl:location.href,transcript:this.history.slice(-6).map(r=>`${r.role==="user"?"Patient":"Assistant"}: ${r.content}`).join(`
`)};i.disabled=!0,i.textContent=e.sending,o.hidden=!0;try{let r=await fetch(`${this.config.apiUrl}/lead`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(l)}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||e.failed);t.innerHTML=`<p class="success">${a(d.mode==="demo"?e.successDemo:e.success)}</p>`}catch(r){o.textContent=r instanceof Error&&r.message?r.message:e.failed,o.hidden=!1,i.disabled=!1,i.textContent=e.submit}this.scrollToEnd()}};function L(s){let t=s?.dataset??{},e=s?.src?new URL(s.src,location.href).origin:location.origin,n=(t.lang??"auto").toLowerCase(),o=(navigator.language||"es").toLowerCase().startsWith("es")?"es":"en",i=n==="es"||n==="en"?n:o,l=t.color&&/^#[0-9a-f]{3,8}$|^rgb|^hsl/i.test(t.color)?t.color:"#0f766e";return{apiUrl:(t.apiUrl||`${e}/api`).replace(/\/$/,""),title:t.title||(i==="es"?"Asistente de la cl\xEDnica":"Clinic assistant"),color:l,lang:i,position:t.position==="left"?"left":"right",open:t.open==="true"||location.hash==="#chat"}}(function(){if(window.ClinicChatWidget)return;let t=document.currentScript,e=()=>{let n=new f(L(t));n.mount(),window.ClinicChatWidget=n};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e):e()})();})();
