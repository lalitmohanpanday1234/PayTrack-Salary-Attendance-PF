
(() => {
"use strict";

const $ = id => document.getElementById(id);

const money = n => new Intl.NumberFormat("en-IN", {
  style:"currency",
  currency:"INR",
  maximumFractionDigits:0
}).format(Number(n)||0);

const monthKey = d =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

const today = new Date();

const defaultSettings = {
  theme:"light",
  language:"en",
  method:"calendar",
  travelMode:"none",
  clickAction:"absent",
  advanced:false,
  ceiling:true,
  ceilingAmount:25000,
  employeeRate:12,
  employerRate:12,
  epsRate:8.33,
  companyRate:8.33,
  nonWorking:[0]
};

const defaultSalary = {
  gross:0,
  basic:0,
  employeePF:0,
  other:0,
  travel:0,
  travelMode:"none",
  method:"calendar"
};

const state = {
  settings:{...defaultSettings},
  salary:{...defaultSalary},
  pfWages:15000,
  attendance:{},
  salaryHistory:{},
  attendanceHistory:{},
  logs:{},
  notes:[],
  undo:[]
};

let db=null, toastTimer=null, modalResolve=null;

function toast(message) {
  const el=$("toast");
  el.textContent=message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
}

function persistLocal() {
  try {
    localStorage.setItem("paytrack_settings",JSON.stringify(state.settings));
    localStorage.setItem("paytrack_ui",JSON.stringify({
      salary:state.salary,
      pfWages:state.pfWages,
      notes:state.notes
    }));
    $("saveIndicator").innerHTML="<i></i> Saved locally";
  } catch(e) {
    $("saveIndicator").textContent="Storage full";
  }
}

function openDB() {
  return new Promise(resolve=>{
    if(!("indexedDB" in window)) {
      resolve(null);
      return;
    }

    const req=indexedDB.open("PayTrackDB",1);

    req.onupgradeneeded=()=>{
      const d=req.result;
      ["attendance","salaryHistory","attendanceHistory","logs"].forEach(n=>{
        if(!d.objectStoreNames.contains(n))
          d.createObjectStore(n,{keyPath:"key"});
      });
    };

    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>resolve(null);
  });
}

function txPut(store,obj) {
  return new Promise(resolve=>{
    if(!db) {
      resolve(false);
      return;
    }

    try {
      const tx=db.transaction(store,"readwrite");
      tx.objectStore(store).put(obj);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>resolve(false);
    } catch(e) {
      resolve(false);
    }
  });
}

function txAll(store) {
  return new Promise(resolve=>{
    if(!db) {
      resolve([]);
      return;
    }

    try {
      const r=db.transaction(store,"readonly")
        .objectStore(store).getAll();

      r.onsuccess=()=>resolve(r.result||[]);
      r.onerror=()=>resolve([]);
    } catch(e) {
      resolve([]);
    }
  });
}

async function loadData() {
  db=await openDB();

  try {
    const s=JSON.parse(localStorage.getItem("paytrack_settings")||"{}");
    state.settings={...defaultSettings,...s};

    const ui=JSON.parse(localStorage.getItem("paytrack_ui")||"{}");
    state.salary={...defaultSalary,...(ui.salary||{})};
    state.pfWages=Number(ui.pfWages)||15000;
    state.notes=ui.notes||[];
  } catch(e) {}

  if(db) {
    for(const n of ["attendance","salaryHistory","attendanceHistory","logs"]) {
      const rows=await txAll(n);
      state[n]=Object.fromEntries(rows.map(x=>[x.key,x.value]));
    }
  }

  applyTheme();
  syncSettingsUI();
  syncSalaryUI();
  syncPFUI();
  renderAll();
}

function applyTheme() {
  document.body.classList.toggle("dark",state.settings.theme==="dark");
}

function saveAllPrefs() {
  persistLocal();
}

function currentKey() {
  return $("salaryMonth").value||monthKey(today);
}

function currentAttKey() {
  return $("attendanceMonth").value||monthKey(today);
}

function monthDate(key) {
  const [y,m]=key.split("-").map(Number);
  return new Date(y,m-1,1);
}

function daysIn(key) {
  const d=monthDate(key);
  return new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
}

function isNonWorking(date) {
  return state.settings.nonWorking.includes(date.getDay());
}

function getStatus(key,day) {
  const map=state.attendance[key]||{};
  const d=monthDate(key);
  const date=new Date(d.getFullYear(),d.getMonth(),day);

  if(map[day]) return map[day];

  return isNonWorking(date)?"off":"present";
}

function countAttendance(key) {
  const days=daysIn(key);
  const c={
    present:0,
    absent:0,
    paid:0,
    unpaid:0,
    off:0,
    working:0
  };

  for(let i=1;i<=days;i++) {
    const s=getStatus(key,i);
    c[s]=(c[s]||0)+1;
    if(s!=="off") c.working++;
  }

  c.payable=c.present+c.paid;
  c.percent=c.working?
    Math.round((c.present+c.paid)/c.working*100):0;

  return c;
}

function workingDays(key) {
  let n=0;

  for(let i=1;i<=daysIn(key);i++) {
    const d=monthDate(key);

    if(!isNonWorking(new Date(d.getFullYear(),d.getMonth(),i)))
      n++;
  }

  return n;
}

function pfCalc() {
  const s=state.settings;
  const raw=Math.max(0,Number(state.pfWages)||0);

  const base=s.ceiling?
    Math.min(raw,Number(s.ceilingAmount)||25000):raw;

  const employee=Math.round(base*s.employeeRate/100);
  const employer=Math.round(base*s.employerRate/100);

  const eps=Math.min(
    employer,
    Math.round(base*s.epsRate/100)
  );

  const epfEmployer=employer-eps;

  return {
    raw,
    base,
    employee,
    employer,
    eps,
    epfEmployer,
    total:employee+employer
  };
}

function calculate(key=currentKey()) {
  const s=state.salary;
  const c=countAttendance(key);
  const days=daysIn(key);

  const denom=s.method==="working"?
    workingDays(key):days;

  const paidRatio=denom?
    Math.min(1,c.payable/denom):0;

  const daily=denom?
    Number(s.gross)/denom:0;

  const earned=Math.round(Number(s.gross)*paidRatio);

  const pf=pfCalc();
  const pfProrated=Math.round(pf.employee*paidRatio);

  const pfDed=Number(s.employeePF)>0?
    Math.round(Number(s.employeePF)*paidRatio):pfProrated;

  const other=Math.round(Number(s.other)*paidRatio);
  const travel=Number(s.travel)||0;

  const travelEffect=
    s.travelMode==="deduct"?-travel:
    s.travelMode==="add"?travel:0;

  const inHand=earned-pfDed-other+travelEffect;

  const absentPay=Math.round(daily*(c.absent+c.unpaid));
  const paidPay=Math.round(daily*c.paid);

  return {
    key,c,days,denom,daily,earned,pfDed,other,
    travel,travelEffect,inHand,absentPay,paidPay,paidRatio
  };
}

function syncSalaryUI() {
  const s=state.salary;

  ["grossSalary","basicSalary","employeePF","otherDeductions","travelAmount"]
    .forEach((id,i)=>{
      $(id).value=[s.gross,s.basic,s.employeePF,s.other,s.travel][i]??0;
    });

  $("salaryMethod").value=s.method||state.settings.method;
  $("travelMode").value=s.travelMode||state.settings.travelMode;
}

function readSalaryUI() {
  state.salary={
    gross:Math.max(0,+$("grossSalary").value||0),
    basic:Math.max(0,+$("basicSalary").value||0),
    employeePF:Math.max(0,+$("employeePF").value||0),
    other:Math.max(0,+$("otherDeductions").value||0),
    travel:Math.max(0,+$("travelAmount").value||0),
    travelMode:$("travelMode").value,
    method:$("salaryMethod").value
  };

  persistLocal();
  renderSalary();
}

function syncPFUI() {
  const s=state.settings;

  $("pfWages").value=state.pfWages;
  $("ceilingToggle").checked=s.ceiling;
  $("employeeRate").value=s.employeeRate;
  $("employerRate").value=s.employerRate;
  $("epsRate").value=s.epsRate;
  $("companyRate").value=s.companyRate;

  $("ceilingLabel").textContent=s.ceiling?
    `ON · ${money(s.ceilingAmount)}`:"OFF · Full wages";
}

function readPFUI() {
  const oldDefault=pfCalc().employee;
  const autoPF=!state.salary.employeePF||
    state.salary.employeePF===oldDefault;

  state.pfWages=Math.max(0,+$("pfWages").value||0);
  state.settings.ceiling=$("ceilingToggle").checked;

  state.settings.employeeRate=clamp(+$("employeeRate").value,0,100,12);
  state.settings.employerRate=clamp(+$("employerRate").value,0,100,12);
  state.settings.epsRate=clamp(+$("epsRate").value,0,100,8.33);
  state.settings.companyRate=clamp(+$("companyRate").value,0,100,8.33);

  if(autoPF) {
    state.salary.employeePF=pfCalc().employee;
    $("employeePF").value=state.salary.employeePF;
  }

  persistLocal();
  renderPF();
  renderSalary();
}

function clamp(n,min,max,fallback) {
  return Number.isFinite(n)?
    Math.max(min,Math.min(max,n)):fallback;
}

function statCard(label,value,foot,icon,tint,accent) {
  return `<div class="stat-card" style="--tint:${tint||'var(--blue-soft)'};--accent:${accent||'var(--primary)'}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-foot">${foot||""}</div>
    <span class="stat-icon">${icon||"•"}</span>
  </div>`;
}

function renderDashboard() {
  const key=currentKey();
  const r=calculate(key);
  const c=r.c;
  const stats=$("dashboardStats");

  stats.innerHTML=
    statCard("In-hand salary",money(r.inHand),"Estimated this month","₹","#e5f0ff","#286bb0")+
    statCard("Gross salary",money(r.earned),"Earned gross","↗","#e5f7ef","#21966d")+
    statCard("Present days",c.present,"Including default present days","✓","#e5f7ef","#21966d")+
    statCard("Employee PF",money(r.pfDed),"Salary deduction","◉","#f1eaff","#8a68ca");

  $("dashMonth").textContent=monthDate(key).toLocaleDateString("en-IN",{
    month:"long",
    year:"numeric"
  });

  $("donutValue").textContent=money(r.inHand);

  const total=Math.max(1,r.earned);
  const ded=r.pfDed+r.other;
  const a=Math.max(0,r.inHand)/total*100;
  const b=Math.max(0,r.pfDed)/total*100;

  $("salaryDonut").style.background=
    `conic-gradient(#398cda 0 ${a}%,#a8d9f2 ${a}% ${a+b}%,#d8cafa ${a+b}% 100%)`;

  $("salaryLegend").innerHTML=[
    ["In-hand",money(r.inHand),"#398cda"],
    ["Employee PF",money(r.pfDed),"#a8d9f2"],
    ["Other deductions",money(r.other),"#d8cafa"]
  ].map(x=>`<div class="legend-row">
    <i style="background:${x[2]}"></i>${x[0]}<b>${x[1]}</b>
  </div>`).join("");

  $("attendancePercent").textContent=c.percent+"%";
  $("attendanceRing").style.setProperty("--pct",c.percent+"%");

  $("attendanceMini").innerHTML=`
    <div>Present <b>${c.present}</b></div>
    <div>Absent <b>${c.absent}</b></div>
    <div>Paid holidays <b>${c.paid}</b></div>
    <div>Unpaid holidays <b>${c.unpaid}</b></div>`;

  const rows=Object.values(state.salaryHistory)
    .sort((a,b)=>a.key.localeCompare(b.key))
    .slice(-6);

  if(!rows.length) {
    $("salaryTrend").innerHTML=
      '<div class="empty-state">Save monthly salary records to see your trend.</div>';
    return;
  }

  const max=Math.max(1,...rows.map(x=>x.inHand));

  $("salaryTrend").innerHTML=rows.map(x=>`
    <div class="bar-item" title="${x.key}: ${money(x.inHand)}">
      <b>${money(x.inHand)}</b>
      <div class="bar" style="height:${Math.max(4,x.inHand/max*115)}px"></div>
      <small>${monthDate(x.key).toLocaleDateString("en-IN",{month:"short"})}</small>
    </div>`).join("");
}

function renderSalary() {
  const r=calculate();
  const c=r.c;

  $("paidHolidayPay").value=r.paidPay;
  $("unpaidHolidayPay").value=r.absentPay;
  $("inHand").textContent=money(r.inHand);
  $("inHandBottom").textContent=money(r.inHand);

  $("salaryBreakdown").innerHTML=[
    ["Monthly gross salary",money(state.salary.gross)],
    ["Daily wage",money(r.daily)],
    ["Present days",c.present],
    ["Absent days",c.absent],
    ["Paid holidays",c.paid],
    ["Unpaid holidays",c.unpaid],
    ["Total payable days",c.payable],
    ["Earned gross salary",money(r.earned)],
    ["Employee PF deduction","− "+money(r.pfDed)],
    ["Other deductions","− "+money(r.other)],
    ["Travel adjustment",(r.travelEffect<0?"− ":r.travelEffect>0?"+ ":"")+money(Math.abs(r.travelEffect))]
  ].map((x,i)=>`
    <div class="result-line ${i===7?'total-line':''}">
      <span>${x[0]}</span><b>${x[1]}</b>
    </div>`).join("");

  $("salaryMeta").textContent=
    `${state.salary.method==="calendar"?"Calendar-day":"Working-day"} method · ${r.denom} calculation days · Attendance ${c.percent}% · Employer PF is not deducted from this amount.`;

  $("salaryStats").innerHTML=
    statCard("Daily wage",money(r.daily),"Based on selected method","◷")+
    statCard("Payable days",c.payable,"Present + paid holidays","✓")+
    statCard("Total deductions",money(r.pfDed+r.other+(r.travelEffect<0?Math.abs(r.travelEffect):0)),"Employee-side deductions","−")+
    statCard("Attendance",c.percent+"%","For selected month","▦");

  renderDashboard();
}

function renderAttendance() {
  const key=currentAttKey();
  const [y,m]=key.split("-").map(Number);
  const first=new Date(y,m-1,1).getDay();
  const n=daysIn(key);
  const c=countAttendance(key);

  $("calendarTitle").textContent=
    monthDate(key).toLocaleDateString("en-IN",{month:"long",year:"numeric"});

  $("attendanceStats").innerHTML=
    statCard("Present days",c.present,"Working days marked present","✓","#e5f7ef","#21966d")+
    statCard("Absent days",c.absent,"Unpaid absence","×","#fff0f0","#d65f6a")+
    statCard("Paid holidays",c.paid,"Included in payable days","★","#fff6df","#c18a28")+
    statCard("Attendance rate",c.percent+"%","Present + paid holidays","◉");

  let html="";

  for(let i=0;i<first;i++)
    html+='<div class="calendar-day empty"></div>';

  for(let d=1;d<=n;d++) {
    const status=getStatus(key,d);
    const todayFlag=key===monthKey(today)&&d===today.getDate();

    const label={
      present:"Present",
      absent:"Absent",
      paid:"Paid holiday",
      unpaid:"Unpaid holiday",
      off:"Non-working"
    }[status];

    html+=`<button class="calendar-day ${status} ${todayFlag?'today':''}"
      data-day="${d}" title="${d}: ${label}">
      <span class="day-num">${d}</span>
      <span class="day-status">${label}</span>
    </button>`;
  }

  $("calendarGrid").innerHTML=html;
  renderLogs(key);
}

function renderLogs(key) {
  const logs=(state.logs[key]||[]).slice().reverse().slice(0,12);

  $("attendanceLog").innerHTML=logs.length?
    logs.map(x=>`<div class="log-item">
      <span><b>${x.day} ${monthDate(key).toLocaleDateString("en-IN",{month:"short"})}</b> · ${x.from} → ${x.to}</span>
      <small>${new Date(x.at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</small>
    </div>`).join("") :
    '<div class="empty-state">No changes yet.</div>';
}

function renderPF() {
  const p=pfCalc();

  $("ceilingLabel").textContent=state.settings.ceiling?
    `ON · ${money(state.settings.ceilingAmount)}`:"OFF · Full wages";

  $("pfTotal").textContent=money(p.total);
  $("pfEmployee").textContent=money(p.employee);
  $("pfEmployer").textContent=money(p.employer);

  $("pfStats").innerHTML=
    statCard("Employee contribution",money(p.employee),"12% default · salary deduction","↓")+
    statCard("Employer contribution",money(p.employer),"Employer-side amount","↑")+
    statCard("Annual employee share",money(p.employee*12),"12-month estimate","₹")+
    statCard("Annual employer share",money(p.employer*12),"12-month estimate","₹");

  $("pfTable").innerHTML=[
    ["Employee EPF",state.settings.employeeRate+"%",money(p.base),money(p.employee)],
    ["Employer contribution",state.settings.employerRate+"%",money(p.base),money(p.employer)],
    ["EPS portion (within employer)",state.settings.epsRate+"%",money(p.base),money(p.eps)],
    ["Employer EPF balance","—","—",money(p.epfEmployer)]
  ].map(x=>`<tr>
    <td>${x[0]}</td>
    <td>${x[1]}</td>
    <td>${x[2]}</td>
    <td class="amount">${x[3]}</td>
  </tr>`).join("");
}

function renderHistory() {
  const a=Object.values(state.salaryHistory)
    .sort((x,y)=>y.key.localeCompare(x.key));

  $("salaryHistoryTable").innerHTML=a.map(x=>`
    <tr>
      <td><b>${monthDate(x.key).toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</b></td>
      <td>${money(x.earned)}</td>
      <td>${money(x.pfDed)}</td>
      <td>${money(x.other)}</td>
      <td class="amount">${money(x.inHand)}</td>
      <td><button class="text-btn" data-salary-load="${x.key}">Load</button></td>
    </tr>`).join("");

  $("salaryHistoryEmpty").style.display=a.length?"none":"block";

  const b=Object.values(state.attendanceHistory)
    .sort((x,y)=>y.key.localeCompare(x.key));

  $("attendanceHistoryTable").innerHTML=b.map(x=>`
    <tr>
      <td><b>${monthDate(x.key).toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</b></td>
      <td>${x.present}</td>
      <td>${x.absent}</td>
      <td>${x.paid}</td>
      <td>${x.unpaid}</td>
      <td>${x.percent}%</td>
      <td><button class="text-btn" data-att-load="${x.key}">Load</button></td>
    </tr>`).join("");

  $("attendanceHistoryEmpty").style.display=b.length?"none":"block";
}

function renderNotes() {
  $("feedbackList").innerHTML=state.notes.length?
    state.notes.slice().reverse().map((n,i)=>`
      <div class="log-item">
        <span>
          <b>${escapeHtml(n.title||n.type)}</b><br>
          <small>${escapeHtml(n.type)} · ${new Date(n.at).toLocaleDateString("en-IN")}</small>
          <p>${escapeHtml(n.body).slice(0,180)}</p>
        </span>
        <button class="text-btn" data-note-delete="${state.notes.length-1-i}">Delete</button>
      </div>`).join("") :
    '<div class="empty-state">No saved notes yet.</div>';
}

function escapeHtml(s) {
  return String(s||"").replace(/[&<>"']/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[c]));
}

function renderAll() {
  renderSalary();
  renderAttendance();
  renderPF();
  renderHistory();
  renderNotes();
}

function syncSettingsUI() {
  const s=state.settings;

  $("languageSetting").value=s.language;
  $("themeSetting").value=s.theme;
  $("defaultMethod").value=s.method;
  $("defaultTravel").value=s.travelMode;
  $("clickAction").value=s.clickAction;
  $("settingsAdvanced").checked=s.advanced;
  $("advancedToggle").checked=s.advanced;
  $("settingsCeiling").checked=s.ceiling;
  $("ceilingAmount").value=s.ceilingAmount;

  document.querySelectorAll("#weekdayPicks input")
    .forEach(x=>x.checked=s.nonWorking.includes(+x.value));
}

function saveAttendanceChange(key,day,to) {
  const from=getStatus(key,day);

  if(from===to) return;

  const date=monthDate(key);
  date.setDate(day);

  const past=date<new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  if(past&&!state.settings.advanced) {
    toast("Enable Advanced Attendance Mode to enter or edit previous dates.");
    return;
  }

  const commit=()=>{
    state.undo.push({
      key,
      day,
      had:!!(state.attendance[key]||{})[day],
      old:(state.attendance[key]||{})[day]
    });

    state.attendance[key]=state.attendance[key]||{};

    if(to==="present"||to==="off")
      delete state.attendance[key][day];
    else
      state.attendance[key][day]=to;

    state.logs[key]=state.logs[key]||[];

    state.logs[key].push({
      day,
      from,
      to,
      at:Date.now()
    });

    txPut("attendance",{
      key,
      value:state.attendance[key]
    });

    txPut("logs",{
      key,
      value:state.logs[key]
    });

    renderAttendance();
    renderSalary();
    toast("Attendance updated and saved.");
  };

  if(state.attendance[key]&&
    Object.prototype.hasOwnProperty.call(state.attendance[key],day)) {
    confirmModal(
      "Change saved attendance?",
      "This date already has a saved status. Changing it may affect your salary calculation.",
      commit
    );
  } else {
    commit();
  }
}

function confirmModal(title,text,yes) {
  $("modalTitle").textContent=title;
  $("modalText").textContent=text;
  $("modalBackdrop").classList.add("show");
  modalResolve=yes;
}

function closeModal(ok) {
  $("modalBackdrop").classList.remove("show");

  const fn=modalResolve;
  modalResolve=null;

  if(ok&&fn) fn();
}

function undo() {
  const x=state.undo.pop();

  if(!x) {
    toast("Nothing to undo.");
    return;
  }

  state.attendance[x.key]=state.attendance[x.key]||{};

  if(x.had)
    state.attendance[x.key][x.day]=x.old;
  else
    delete state.attendance[x.key][x.day];

  txPut("attendance",{
    key:x.key,
    value:state.attendance[x.key]
  });

  renderAttendance();
  renderSalary();
  toast("Last attendance change restored.");
}

function nav(view) {
  document.querySelectorAll(".page").forEach(p=>
    p.classList.toggle("active",p.id==="page-"+view)
  );

  document.querySelectorAll(".bottom-nav button").forEach(b=>
    b.classList.toggle("active",b.dataset.view===view)
  );

  closeDrawer();
  window.scrollTo({top:0,behavior:"smooth"});

  if(view==="salaryHistory"||view==="attendanceHistory")
    renderHistory();
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawerBackdrop").classList.remove("show");
}

function saveSalaryMonth() {
  readSalaryUI();

  const r=calculate();

  const snapshot={
    key:r.key,
    gross:state.salary.gross,
    earned:r.earned,
    pfDed:r.pfDed,
    other:r.other,
    inHand:r.inHand,
    attendance:{...r.c},
    method:state.salary.method,
    savedAt:Date.now(),
    pf:{...pfCalc()}
  };

  state.salaryHistory[r.key]=snapshot;

  state.attendanceHistory[r.key]={
    key:r.key,
    ...r.c,
    savedAt:Date.now()
  };

  txPut("salaryHistory",{
    key:r.key,
    value:snapshot
  });

  txPut("attendanceHistory",{
    key:r.key,
    value:state.attendanceHistory[r.key]
  });

  renderHistory();
  toast("Salary and attendance summary saved for "+r.key);
}

function parseDays(input,max) {
  const set=new Set();

  input.split(",")
    .map(x=>x.trim())
    .filter(Boolean)
    .forEach(part=>{
      if(part.includes("-")) {
        const [a,b]=part.split("-").map(Number);

        if(Number.isInteger(a)&&Number.isInteger(b)&&a<=b)
          for(let i=a;i<=b&&i<=max;i++)
            if(i>=1) set.add(i);
      } else {
        const n=Number(part);

        if(Number.isInteger(n)&&n>=1&&n<=max)
          set.add(n);
      }
    });

  return [...set];
}

function csvDownload(filename,rows) {
  const csv=rows.map(r=>
    r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")
  ).join("\r\n");

  const blob=new Blob(["\ufeff"+csv],{
    type:"text/csv;charset=utf-8"
  });

  downloadBlob(filename,blob);
}

function downloadBlob(filename,blob) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");

  a.href=url;
  a.download=filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function salaryRows(key) {
  const r=calculate(key);

  return [
    ["Field","Value"],
    ["Month",key],
    ["Monthly gross salary",state.salary.gross],
    ["Daily wage",r.daily],
    ["Present days",r.c.present],
    ["Absent days",r.c.absent],
    ["Paid holidays",r.c.paid],
    ["Unpaid holidays",r.c.unpaid],
    ["Payable days",r.c.payable],
    ["Earned gross salary",r.earned],
    ["Employee PF deduction",r.pfDed],
    ["Other deductions",r.other],
    ["Travel adjustment",r.travelEffect],
    ["Estimated in-hand",r.inHand]
  ];
}

function attendanceRows(key) {
  const rows=[["Date","Status"]];

  for(let d=1;d<=daysIn(key);d++)
    rows.push([
      `${key}-${String(d).padStart(2,"0")}`,
      getStatus(key,d)
    ]);

  return rows;
}

function backupObject() {
  return {
    app:"PayTrack",
    version:1,
    exportedAt:new Date().toISOString(),
    settings:state.settings,
    salary:state.salary,
    pfWages:state.pfWages,
    attendance:state.attendance,
    salaryHistory:state.salaryHistory,
    attendanceHistory:state.attendanceHistory,
    logs:state.logs,
    notes:state.notes
  };
}

function exportBackup() {
  downloadBlob(
    `paytrack-backup-${monthKey(today)}.json`,
    new Blob([JSON.stringify(backupObject(),null,2)],{
      type:"application/json"
    })
  );

  toast("Backup downloaded. Keep it in a safe place.");
}

async function importBackup(file) {
  try {
    const data=JSON.parse(await file.text());

    if(data.app!=="PayTrack"||!data.version)
      throw Error("This is not a valid PayTrack backup.");

    let added=0;

    for(const bucket of [
      "attendance",
      "salaryHistory",
      "attendanceHistory",
      "logs"
    ]) {
      const incoming=data[bucket]||{};

      for(const [key,value] of Object.entries(incoming)) {
        if(!state[bucket][key]) {
          state[bucket][key]=value;
          await txPut(bucket,{key,value});
          added++;
        }
      }
    }

    if(data.settings)
      state.settings={...state.settings,...data.settings};

    if(data.salary)
      state.salary={...state.salary,...data.salary};

    if(Number.isFinite(+data.pfWages))
      state.pfWages=+data.pfWages;

    if(Array.isArray(data.notes))
      state.notes=[
        ...state.notes,
        ...data.notes.filter(n=>
          !state.notes.some(x=>x.at===n.at&&x.title===n.title)
        )
      ];

    persistLocal();
    syncSettingsUI();
    syncSalaryUI();
    syncPFUI();
    renderAll();

    toast(`Import complete. ${added} new record groups merged; existing months were kept.`);
  } catch(e) {
    toast("Import failed: "+e.message);
  }
}

function syncSettingsChange() {
  const s=state.settings;

  s.language=$("languageSetting").value;
  s.theme=$("themeSetting").value;
  s.method=$("defaultMethod").value;
  s.travelMode=$("defaultTravel").value;
  s.clickAction=$("clickAction").value;
  s.advanced=$("settingsAdvanced").checked;
  s.ceiling=$("settingsCeiling").checked;
  s.ceilingAmount=Math.max(0,+$("ceilingAmount").value||25000);

  s.nonWorking=[
    ...document.querySelectorAll("#weekdayPicks input:checked")
  ].map(x=>+x.value);

  applyTheme();
  persistLocal();

  $("advancedToggle").checked=s.advanced;

  renderAll();
  toast("Settings saved automatically.");
}

function openFeedbackEmail() {
  const type=$("feedbackType").value;
  const title=$("feedbackTitle").value.trim();
  const body=$("feedbackBody").value.trim();

  if(!title&&!body) {
    toast("Please add a title or some details.");
    return;
  }

  const subject=encodeURIComponent(`[PayTrack] ${type}: ${title}`);

  const content=encodeURIComponent(
    `${type}\n\n${title}\n\n${body}\n\nSent from PayTrack.`
  );

  location.href=
    `mailto:lalitmohanpanday1234@gmail.com?subject=${subject}&body=${content}`;
}

function saveNote() {
  const title=$("feedbackTitle").value.trim();
  const body=$("feedbackBody").value.trim();

  if(!title&&!body) {
    toast("Write a title or note first.");
    return;
  }

  state.notes.push({
    type:$("feedbackType").value,
    title,
    body,
    at:Date.now()
  });

  persistLocal();
  renderNotes();

  $("feedbackTitle").value="";
  $("feedbackBody").value="";

  toast("Note saved on this device.");
}

function printAttendance() {
  const key=currentAttKey();

  let html=`<h1>PayTrack Attendance Report</h1>
    <p>${key}</p>
    <table border="1" cellspacing="0" cellpadding="8">
    <tr><th>Date</th><th>Status</th></tr>`;

  for(let d=1;d<=daysIn(key);d++)
    html+=`<tr><td>${d}</td><td>${getStatus(key,d)}</td></tr>`;

  html+="</table>";

  const w=window.open("","_blank");

  if(!w) {
    toast("Allow pop-ups to print this report.");
    return;
  }

  w.document.write(`
    <html>
    <head><title>Attendance ${key}</title></head>
    <body>
      ${html}
      <script>window.onload=()=>window.print()<\/script>
    </body>
    </html>
  `);

  w.document.close();
}

function bind() {
  document.querySelectorAll("[data-view]").forEach(b=>
    b.addEventListener("click",()=>nav(b.dataset.view))
  );

  document.querySelectorAll("[data-nav]").forEach(b=>
    b.addEventListener("click",()=>nav(b.dataset.nav))
  );

  $("menuBtn").onclick=()=>{
    $("drawer").classList.add("open");
    $("drawerBackdrop").classList.add("show");
  };

  $("closeDrawer").onclick=closeDrawer;
  $("drawerBackdrop").onclick=closeDrawer;

  $("salaryMonth").onchange=()=>{
    const k=$("salaryMonth").value;
    $("attendanceMonth").value=k;
    renderAll();
  };

  $("attendanceMonth").onchange=()=>{
    const k=$("attendanceMonth").value;
    $("salaryMonth").value=k;
    renderAll();
  };

  [
    "grossSalary",
    "basicSalary",
    "employeePF",
    "otherDeductions",
    "travelAmount",
    "salaryMethod",
    "travelMode"
  ].forEach(id=>
    $(id).addEventListener("input",readSalaryUI)
  );

  $("saveSalary").onclick=saveSalaryMonth;

  $("resetSalary").onclick=()=>{
    state.salary={
      ...defaultSalary,
      method:state.settings.method,
      travelMode:state.settings.travelMode
    };

    syncSalaryUI();
    readSalaryUI();
    toast("Salary inputs reset.");
  };

  [
    "pfWages",
    "ceilingToggle",
    "employeeRate",
    "employerRate",
    "epsRate",
    "companyRate"
  ].forEach(id=>
    $(id).addEventListener("input",readPFUI)
  );

  $("savePF").onclick=()=>{
    readPFUI();
    toast("PF settings saved.");
  };

  $("resetPF").onclick=()=>{
    state.settings.employeeRate=12;
    state.settings.employerRate=12;
    state.settings.epsRate=8.33;
    state.settings.companyRate=8.33;

    syncPFUI();
    renderPF();
    persistLocal();

    toast("Default PF rates restored.");
  };

  $("calendarGrid").addEventListener("click",e=>{
    const b=e.target.closest("[data-day]");
    if(!b) return;

    const day=+b.dataset.day;

    saveAttendanceChange(
      currentAttKey(),
      day,
      state.settings.clickAction
    );
  });

  $("prevMonth").onclick=()=>shiftMonth(-1);
  $("nextMonth").onclick=()=>shiftMonth(1);
  $("undoAttendance").onclick=undo;

  $("applyBulk").onclick=()=>{
    const key=currentAttKey();
    const days=parseDays($("bulkDates").value,daysIn(key));

    if(!days.length) {
      toast("Enter valid day numbers, such as 1, 2, 5-8.");
      return;
    }

    if(!state.settings.advanced&&days.some(day=>{
      const d=monthDate(key);
      d.setDate(day);

      return d<new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
    })) {
      toast("Enable Advanced Attendance Mode for previous dates.");
      return;
    }

    const to=$("bulkMode").value;

    confirmModal(
      "Apply attendance to multiple dates?",
      `This will mark ${days.length} date(s) as ${to}. Existing statuses may change.`,
      ()=>{
        days.forEach(day=>{
          state.attendance[key]=state.attendance[key]||{};

          const from=getStatus(key,day);

          if(to==="present")
            delete state.attendance[key][day];
          else
            state.attendance[key][day]=to;

          if(from!==to) {
            state.undo.push({
              key,
              day,
              had:from!=="present"&&from!=="off",
              old:from
            });

            state.logs[key]=state.logs[key]||[];

            state.logs[key].push({
              day,
              from,
              to,
              at:Date.now()
            });
          }
        });

        txPut("attendance",{
          key,
          value:state.attendance[key]
        });

        txPut("logs",{
          key,
          value:state.logs[key]
        });

        renderAll();
        toast(`${days.length} date(s) updated.`);
      }
    );
  };

  $("advancedToggle").onchange=()=>{
    toggleAdvanced($("advancedToggle").checked);
  };

  $("settingsAdvanced").onchange=()=>{
    toggleAdvanced($("settingsAdvanced").checked);
  };

  [
    "languageSetting",
    "themeSetting",
    "defaultMethod",
    "defaultTravel",
    "clickAction",
    "settingsAdvanced",
    "settingsCeiling",
    "ceilingAmount"
  ].forEach(id=>
    $(id).addEventListener("change",syncSettingsChange)
  );

  document.querySelectorAll("#weekdayPicks input")
    .forEach(x=>x.addEventListener("change",syncSettingsChange));

  $("modalClose").onclick=()=>closeModal(false);
  $("modalCancel").onclick=()=>closeModal(false);
  $("modalConfirm").onclick=()=>closeModal(true);

  $("modalBackdrop").addEventListener("click",e=>{
    if(e.target===$("modalBackdrop"))
      closeModal(false);
  });

  $("exportBackup").onclick=exportBackup;

  $("importFile").onchange=e=>{
    if(e.target.files[0]) {
      confirmModal(
        "Merge this backup?",
        "New records will be added. Existing months with the same key will be kept and not overwritten.",
        ()=>importBackup(e.target.files[0])
      );
    }

    e.target.value="";
  };

  $("exportSalaryCsv").onclick=()=>{
    csvDownload(
      "paytrack-salary-history.csv",
      [
        ["Month","Gross earned","Employee PF","Other deductions","In-hand"],
        ...Object.values(state.salaryHistory).map(x=>[
          x.key,x.earned,x.pfDed,x.other,x.inHand
        ])
      ]
    );
  };

  $("exportAttendanceCsv").onclick=()=>{
    csvDownload(
      "paytrack-attendance-history.csv",
      [
        ["Month","Present","Absent","Paid holiday","Unpaid holiday","Attendance %"],
        ...Object.values(state.attendanceHistory).map(x=>[
          x.key,x.present,x.absent,x.paid,x.unpaid,x.percent
        ])
      ]
    );
  };

  $("downloadCurrentSalary").onclick=()=>{
    csvDownload(
      `salary-${currentKey()}.csv`,
      salaryRows(currentKey())
    );
  };

  $("downloadCurrentAttendance").onclick=()=>{
    csvDownload(
      `attendance-${currentAttKey()}.csv`,
      attendanceRows(currentAttKey())
    );
  };

  $("printAttendance").onclick=printAttendance;

  $("shareBackup").onclick=async()=>{
    const blob=new Blob(
      [JSON.stringify(backupObject(),null,2)],
      {type:"application/json"}
    );

    const file=new File(
      [blob],
      `paytrack-backup-${monthKey(today)}.json`,
      {type:"application/json"}
    );

    if(navigator.canShare&&
      navigator.canShare({files:[file]})&&
      navigator.share) {

      try {
        await navigator.share({
          title:"PayTrack backup",
          files:[file]
        });
      } catch(e) {
        if(e.name!=="AbortError")
          toast("Sharing unavailable; downloading backup instead.");
      }

    } else {
      exportBackup();
      toast("Native share is unavailable; backup downloaded.");
    }
  };

  $("saveNote").onclick=saveNote;
  $("sendFeedback").onclick=openFeedbackEmail;

  $("feedbackList").addEventListener("click",e=>{
    const b=e.target.closest("[data-note-delete]");
    if(!b) return;

    const i=+b.dataset.noteDelete;

    state.notes.splice(i,1);
    persistLocal();
    renderNotes();

    toast("Note deleted.");
  });

  $("salaryHistoryTable").addEventListener("click",e=>{
    const b=e.target.closest("[data-salary-load]");
    if(!b) return;

    const key=b.dataset.salaryLoad;
    const rec=state.salaryHistory[key];

    if(!rec) return;

    confirmModal(
      "Load saved month?",
      "This loads the saved month into the calculator view. It does not alter the stored historical snapshot.",
      ()=>{
        $("salaryMonth").value=key;
        $("attendanceMonth").value=key;
        nav("salary");
        renderAll();
      }
    );
  });

  $("attendanceHistoryTable").addEventListener("click",e=>{
    const b=e.target.closest("[data-att-load]");
    if(!b) return;

    $("attendanceMonth").value=b.dataset.attLoad;
    $("salaryMonth").value=b.dataset.attLoad;

    nav("attendance");
    renderAll();
  });
}

function shiftMonth(delta) {
  const d=monthDate(currentAttKey());

  d.setMonth(d.getMonth()+delta);

  const k=monthKey(d);

  $("attendanceMonth").value=k;
  $("salaryMonth").value=k;

  renderAll();
}

function toggleAdvanced(enabled) {
  if(enabled) {
    confirmModal(
      "Enable Advanced Attendance Mode?",
      "This unlocks previous-date attendance entry, previous-month edits and bulk changes. Changes can affect historical salary calculations.",
      ()=>{
        state.settings.advanced=true;
        syncSettingsUI();
        persistLocal();
        toast("Advanced mode enabled.");
      }
    );

    $("advancedToggle").checked=false;
    $("settingsAdvanced").checked=false;

  } else {
    state.settings.advanced=false;
    syncSettingsUI();
    persistLocal();
    toast("Advanced mode disabled.");
  }
}

function init() {
  const k=monthKey(today);

  $("salaryMonth").value=k;
  $("attendanceMonth").value=k;

  bind();

  loadData().then(()=>{
    if(!state.salary.method)
      state.salary.method=state.settings.method;

    if(!state.salary.employeePF)
      state.salary.employeePF=pfCalc().employee;

    syncSalaryUI();
    renderAll();
  });
}

init();

})();
