import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { Html5Qrcode } from "html5-qrcode";
import "../style.css";
import { APP_NAME } from "../config.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const app = document.querySelector("#app");
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

let currentProfile = null;
let eventsCache = [];
let scanner = null;
let activeTab = "dashboard";

const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dateText = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-PT") : "Data por definir";
function notify(message, kind = "info") {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.remove("show"), 3500);
}
function shell(content) {
  app.innerHTML = content;
}
function loginView(message = "") {
  shell(`<main class="auth-layout"><section class="auth-card">
    <div class="brand-lockup"><span class="brand-mark">M</span><span><b>${APP_NAME}</b><small>Convites inteligentes</small></span></div>
    <p class="eyebrow">GESTÃO DE EVENTOS</p><h1>Bem-vindo.</h1>
    <p class="muted">Organize convidados, emita convites únicos e controle cada entrada com segurança.</p>
    <form id="login-form" class="form-stack">
      <label>Email<input name="email" type="email" autocomplete="username" placeholder="admin@oseuevento.com" required></label>
      <label>Palavra-passe<input name="password" type="password" autocomplete="current-password" placeholder="A sua palavra-passe" required></label>
      <button class="btn btn-primary" type="submit">Entrar na plataforma</button>
      <p class="form-error">${esc(message)}</p>
    </form><p class="auth-foot">Acesso reservado à equipa do evento.</p>
  </section><aside class="auth-art"><div class="art-orb"></div><div class="art-copy"><span>WELCOME TO</span><h2>Every guest.<br>One unique pass.</h2><p>Uma experiência simples, elegante e segura do convite à entrada.</p></div></aside></main><div id="toast"></div>`);
  document.querySelector("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const button = e.currentTarget.querySelector("button");
    button.disabled = true; button.textContent = "A entrar…";
    const { error } = await supabase.auth.signInWithPassword(data);
    if (error) { loginView(error.message === "Invalid login credentials" ? "Email ou palavra-passe incorrectos." : error.message); return; }
    await start();
  });
}
function navButton(id, label, icon) {
  return `<button class="nav-item ${activeTab===id?"active":""}" data-tab="${id}"><span>${icon}</span>${label}</button>`;
}
function dashboardShell() {
  const isAdmin = currentProfile?.role === "admin";
  shell(`<div class="layout">
    <aside class="sidebar"><div class="brand-lockup"><span class="brand-mark">M</span><span><b>My Guest</b><small>EVENT MANAGEMENT</small></span></div>
      <div class="nav-label">MENU PRINCIPAL</div><nav>
        ${navButton("dashboard","Visão geral","⌂")}
        ${isAdmin ? navButton("events","Eventos","▦") : ""}
        ${isAdmin ? navButton("guests","Convidados","♧") : ""}
        ${navButton("scanner","Leitor QR","▣")}
        ${isAdmin ? navButton("reports","Relatórios","▤") : ""}
      </nav><div class="sidebar-bottom"><div class="user-chip"><div class="avatar">${esc((currentProfile?.full_name||"U").slice(0,1).toUpperCase())}</div><div><b>${esc(currentProfile?.full_name||"Utilizador")}</b><small>${isAdmin?"Administrador":"Operador"}</small></div></div><button id="logout" class="logout">↗ Terminar sessão</button></div>
    </aside>
    <main class="main-area"><header class="topbar"><div><span class="eyebrow">MY GUEST / ${activeTab.toUpperCase()}</span><h1 id="page-title">Visão geral</h1></div><div class="top-date">${new Date().toLocaleDateString("pt-PT",{weekday:"long",day:"numeric",month:"long"})}</div></header>
      <div id="view"></div>
    </main></div><div id="toast"></div>`);
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.tab)));
  document.querySelector("#logout").addEventListener("click",async()=>{await supabase.auth.signOut();currentProfile=null;loginView();});
}
async function start() {
  if (!supabase) { loginView("Falta configurar VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. Consulte o README."); return; }
  const {data:{user}} = await supabase.auth.getUser();
  if (!user) { loginView(); return; }
  const {data:profile,error} = await supabase.from("profiles").select("id,full_name,role").eq("id",user.id).single();
  if (error || !profile) { await supabase.auth.signOut(); loginView("O seu utilizador ainda não tem perfil. Peça ao administrador para configurar o acesso."); return; }
  currentProfile = profile;
  activeTab = "dashboard";
  dashboardShell();
  await navigate("dashboard");
}
async function navigate(tab) {
  if (tab !== "scanner" && currentProfile?.role !== "admin" && tab !== "dashboard") return;
  activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  const titles={dashboard:"Visão geral",events:"Eventos",guests:"Convidados",scanner:"Validação de entradas",reports:"Relatórios"};
  document.querySelector("#page-title").textContent=titles[tab]||"My Guest";
  const view=document.querySelector("#view");
  view.innerHTML='<div class="loading">A carregar…</div>';
  if(tab==="dashboard") await renderDashboard(view);
  if(tab==="events") await renderEvents(view);
  if(tab==="guests") await renderGuests(view);
  if(tab==="scanner") renderScanner(view);
  if(tab==="reports") await renderReports(view);
}
async function getEvents() {
  const {data,error}=await supabase.from("events").select("*").order("created_at",{ascending:false});
  if(error) throw error; eventsCache=data||[]; return eventsCache;
}
async function renderDashboard(view) {
  if(currentProfile.role!=="admin"){view.innerHTML=`<section class="welcome-panel"><p class="eyebrow">CONTROLO DE ACESSO</p><h2>Pronto para receber os convidados?</h2><p>Abra o leitor QR para validar os convites à entrada.</p><button class="btn btn-primary" id="go-scan">Abrir leitor QR</button></section>`;view.querySelector("#go-scan").onclick=()=>navigate("scanner");return;}
  const [events,invites]=await Promise.all([getEvents(),supabase.from("invitations").select("id,used_at")]);
  if(invites.error){view.innerHTML=`<p class="error">${esc(invites.error.message)}</p>`;return;}
  const rows=invites.data||[],used=rows.filter(x=>x.used_at).length;
  view.innerHTML=`<section class="welcome-panel"><div><p class="eyebrow">BEM-VINDO AO MY GUEST</p><h2>Os seus eventos,<br>sob controlo.</h2><p>Uma gestão de convidados organizada, com validação de entrada em tempo real.</p><button class="btn btn-light" id="new-event">＋ Criar evento</button></div><div class="welcome-decoration">MG</div></section>
  <div class="stats-grid"><article class="stat-card"><span>EVENTOS</span><b>${events.length}</b><small>Eventos criados</small></article><article class="stat-card"><span>CONVITES EMITIDOS</span><b>${rows.length}</b><small>Total de convidados</small></article><article class="stat-card"><span>ENTRADAS VALIDADAS</span><b>${used}</b><small>${rows.length-used} por utilizar</small></article></div>
  <section class="section-block"><div class="section-heading"><div><p class="eyebrow">ACTIVIDADE</p><h3>Eventos recentes</h3></div><button class="text-button" id="all-events">Ver todos →</button></div><div class="event-grid">${events.slice(0,3).map(eventCard).join("")||'<div class="empty-state">Ainda não criou nenhum evento.</div>'}</div></section>`;
  view.querySelector("#new-event").onclick=()=>navigate("events");view.querySelector("#all-events").onclick=()=>navigate("events");
}
function eventCard(e){return `<article class="event-card"><div class="event-icon">✦</div><div><h4>${esc(e.name)}</h4><p>${dateText(e.event_date)} · ${esc(e.venue||"Local por definir")}</p></div></article>`;}
async function renderEvents(view) {
  const events=await getEvents();
  view.innerHTML=`<div class="section-heading"><div><p class="eyebrow">ORGANIZAÇÃO</p><h3>Os seus eventos</h3></div></div>
  <form id="event-form" class="panel form-grid"><label>Nome do evento<input name="name" placeholder="Ex.: Gala de celebração" required></label><label>Data<input name="event_date" type="date"></label><label>Local<input name="venue" placeholder="Local do evento"></label><button class="btn btn-primary">Criar evento</button></form>
  <div class="event-list">${events.map(e=>`<article class="list-card"><div><h4>${esc(e.name)}</h4><p>${dateText(e.event_date)} · ${esc(e.venue||"Local por definir")}</p></div><span class="pill">Activo</span></article>`).join("")||'<div class="empty-state">Ainda não existem eventos. Crie o primeiro acima.</div>'}</div>`;
  view.querySelector("#event-form").onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));const {error}=await supabase.from("events").insert(body);if(error){notify(error.message,"error");return;}notify("Evento criado com sucesso.","success");await renderEvents(view);};
}
async function renderGuests(view) {
  const events=await getEvents();
  const {data:guests,error}=await supabase.from("invitations").select("id,guest_name,guest_email,token,used_at,created_at,event_id,events(name)").order("created_at",{ascending:false}).limit(300);
  if(error){view.innerHTML=`<p class="error">${esc(error.message)}</p>`;return;}
  view.innerHTML=`<div class="section-heading"><div><p class="eyebrow">LISTA DE CONVIDADOS</p><h3>Emitir convites individuais</h3></div></div>
  <form id="guest-form" class="panel form-grid"><label>Evento<select name="event_id" required>${events.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></label><label>Nomes dos convidados <small>Um nome por linha</small><textarea name="names" rows="5" placeholder="Ana Manuel&#10;João Pedro" required></textarea></label><button class="btn btn-primary" ${events.length?"":"disabled"}>Gerar convites</button></form>
  <div class="section-heading"><div><p class="eyebrow">CONVITES GERADOS</p><h3>Convidados</h3></div><button class="btn btn-outline" id="export-all">Exportar lista CSV</button></div>
  <div class="table-panel"><table><thead><tr><th>CONVIDADO</th><th>EVENTO</th><th>ESTADO</th><th>CONVITE</th></tr></thead><tbody>${(guests||[]).map(g=>`<tr><td><b>${esc(g.guest_name)}</b><small>${esc(g.guest_email||"")}</small></td><td>${esc(g.events?.name||"—")}</td><td><span class="status ${g.used_at?"used":"pending"}">${g.used_at?"Utilizado":"Disponível"}</span></td><td><button class="mini-button" data-id="${g.id}">PDF</button></td></tr>`).join("")||'<tr><td colspan="4" class="empty-cell">Ainda não há convidados.</td></tr>'}</tbody></table></div>`;
  view.querySelector("#guest-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),names=String(f.get("names")).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!names.length)return;const rows=names.map(name=>({event_id:f.get("event_id"),guest_name:name,token:crypto.randomUUID()}));const {error}=await supabase.from("invitations").insert(rows);if(error){notify(error.message,"error");return;}notify(`${rows.length} convite(s) emitido(s).`,"success");await renderGuests(view);};
  view.querySelectorAll("[data-id]").forEach(b=>b.onclick=()=>makePdf((guests||[]).find(g=>g.id===b.dataset.id)));
  view.querySelector("#export-all").onclick=()=>downloadCsv(guests||[]);
}
async function makePdf(guest) {
  if(!guest)return;
  const {data:event}=await supabase.from("events").select("*").eq("id",guest.event_id).single();
  const qrData=await QRCode.toDataURL(`${location.origin}/?scan=${guest.token}`,{width:500,margin:2});
  const pdf=new jsPDF({unit:"mm",format:"a6"});
  pdf.setFillColor(32,59,54);pdf.roundedRect(8,8,89,132,5,5,"F");
  pdf.setTextColor(255,255,255);pdf.setFont("helvetica","bold");pdf.setFontSize(18);pdf.text("MY GUEST",52.5,24,{align:"center"});
  pdf.setFontSize(8);pdf.setFont("helvetica","normal");pdf.text("CONVITE INDIVIDUAL",52.5,32,{align:"center"});
  pdf.setFontSize(16);pdf.setFont("helvetica","bold");pdf.text(pdf.splitTextToSize(guest.guest_name,75),52.5,48,{align:"center"});
  pdf.setFontSize(10);pdf.text(pdf.splitTextToSize(event?.name||"Evento",75),52.5,64,{align:"center"});
  pdf.setFontSize(8);pdf.text(dateText(event?.event_date),52.5,72,{align:"center"});pdf.text(event?.venue||"",52.5,78,{align:"center",maxWidth:75});
  pdf.addImage(qrData,"PNG",30,85,45,45);pdf.setFontSize(6);pdf.text("Válido para uma única entrada",52.5,135,{align:"center"});
  pdf.save(`my-guest-${guest.guest_name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}.pdf`);
}
function downloadCsv(rows){const data=[["Convidado","Email","Evento","Estado"],...rows.map(g=>[g.guest_name,g.guest_email||"",g.events?.name||"",g.used_at?"Utilizado":"Disponível"])];const csv=data.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="my-guest-convidados.csv";a.click();URL.revokeObjectURL(a.href);}
function renderScanner(view) {
  view.innerHTML=`<div class="scanner-layout"><section class="panel scanner-panel"><p class="eyebrow">LEITURA DE CONVITES</p><h3>Validar entrada</h3><p class="muted">Aponte a câmara para o QR Code do convidado.</p><div id="qr-reader"></div><button id="start-camera" class="btn btn-primary full-width">Activar câmara</button><div class="or-divider"><span>OU INTRODUZA O CÓDIGO</span></div><form id="manual-form" class="manual-form"><input name="code" placeholder="Código do convite" required><button class="btn btn-outline">Validar</button></form></section><section class="panel result-panel"><p class="eyebrow">RESULTADO DA VALIDAÇÃO</p><div id="scan-result" class="scan-placeholder"><div class="result-symbol">✓</div><h3>A aguardar leitura</h3><p>O resultado da validação aparecerá aqui.</p></div></section></div>`;
  const validate=async raw=>{const code=extractToken(raw);const {data,error}=await supabase.rpc("validate_invitation",{p_token:code,p_operator:currentProfile.full_name||"Operador"});const box=view.querySelector("#scan-result");const row=Array.isArray(data)?data[0]:data;if(error||!row){box.innerHTML=`<div class="result-symbol bad">×</div><h3>Não foi possível validar</h3><p>${esc(error?.message||"Convite inválido.")}</p>`;return;}box.innerHTML=`<div class="result-symbol ${row.valid?"good":"bad"}">${row.valid?"✓":"×"}</div><h3>${row.valid?"Entrada autorizada":"Entrada recusada"}</h3><p><b>${esc(row.guest_name||"")}</b></p><p>${esc(row.message||"")}</p><span class="status ${row.valid?"used":"pending"}">${row.valid?"ACEITE":"RECUSADO"}</span>`;};
  view.querySelector("#manual-form").onsubmit=e=>{e.preventDefault();validate(new FormData(e.currentTarget).get("code"));};
  view.querySelector("#start-camera").onclick=async()=>{try{scanner?.stop().catch(()=>{});scanner=new Html5Qrcode("qr-reader");await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},decoded=>{scanner.pause(true);validate(decoded).finally(()=>setTimeout(()=>scanner?.resume(),2500));},()=>{});}catch{notify("Não foi possível abrir a câmara. Verifique as permissões e use HTTPS.","error");}};
}
function extractToken(raw){try{const u=new URL(raw);return u.searchParams.get("scan")||raw;}catch{return String(raw||"").trim();}}
async function renderReports(view) {
  const {data:invitations,error}=await supabase.from("invitations").select("id,guest_name,used_at,event_id,events(name)").order("created_at",{ascending:false});
  if(error){view.innerHTML=`<p class="error">${esc(error.message)}</p>`;return;}
  const rows=invitations||[],used=rows.filter(r=>r.used_at).length;
  const {data:scans}=await supabase.from("scan_logs").select("id,scanned_at,result,operator,invitations(guest_name,events(name))").order("scanned_at",{ascending:false}).limit(500);
  view.innerHTML=`<div class="stats-grid"><article class="stat-card"><span>CONVITES EMITIDOS</span><b>${rows.length}</b></article><article class="stat-card"><span>ENTRADAS ACEITES</span><b>${used}</b></article><article class="stat-card"><span>POR UTILIZAR</span><b>${rows.length-used}</b></article></div><div class="section-heading"><div><p class="eyebrow">AUDITORIA</p><h3>Histórico de leituras</h3></div><button id="report-csv" class="btn btn-outline">Exportar CSV</button></div><div class="table-panel"><table><thead><tr><th>CONVIDADO</th><th>EVENTO</th><th>DATA</th><th>OPERADOR</th><th>RESULTADO</th></tr></thead><tbody>${(scans||[]).map(s=>`<tr><td>${esc(s.invitations?.guest_name||"—")}</td><td>${esc(s.invitations?.events?.name||"—")}</td><td>${new Date(s.scanned_at).toLocaleString("pt-PT")}</td><td>${esc(s.operator||"—")}</td><td>${esc(s.result)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty-cell">Ainda não existem leituras.</td></tr>'}</tbody></table></div>`;
  view.querySelector("#report-csv").onclick=()=>downloadCsv(rows);
}
supabase?.auth.onAuthStateChange((event)=>{if(event==="SIGNED_OUT")loginView();});
if(new URLSearchParams(location.search).has("scan")){
  // O operador entra primeiro; depois de autenticado, abre o separador do leitor.
  const scanToken=new URLSearchParams(location.search).get("scan");
  sessionStorage.setItem("mg_pending_scan",scanToken);
}
start().then(()=>{const pending=sessionStorage.getItem("mg_pending_scan");if(pending&&currentProfile){navigate("scanner").then(()=>{const input=document.querySelector('#manual-form input[name="code"]');if(input)input.value=pending;});sessionStorage.removeItem("mg_pending_scan");}});
