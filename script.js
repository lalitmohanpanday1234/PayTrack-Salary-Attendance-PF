
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


