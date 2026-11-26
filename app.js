/* ============ 工具 ============ */
const $ = s => document.querySelector(s);
function parseAmount(v){
  if(typeof v==="number") return isFinite(v)?v:0;
  if(v==null) return 0;
  let s=String(v).trim(); if(s==="") return 0;
  const neg=/^\(.*\)$/.test(s);
  s=s.replace(/[,，\s]/g,"").replace(/[^\d.\-]/g,"");
  const n=parseFloat(s); if(!isFinite(n)) return 0;
  return neg?-n:n;
}
const fmtVND = n => Math.round(n||0).toLocaleString("en-US");
const fmtUSD = n => (n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function todayStr(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function monthLabel(m){const [y,mm]=m.split("-");return y+"年"+parseInt(mm)+"月";}
/* 发票统一排序：月份升序，再按发票号升序 */
function invOrder(a,b){
  return (a.month||"").localeCompare(b.month||"")||(a.invoiceNo||"").localeCompare(b.invoiceNo||"");
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(16).slice(2));
/* 删除操作密码（与登录密码一致）；Electron 不支持 prompt，用自定义弹窗 */
const DELETE_CODE = "858126";
function askPassword(){
  return new Promise(resolve=>{
    openModal(`
      <h3 style="margin:0 0 6px">删除验证</h3>
      <div class="muted" style="font-size:12.5px;margin-bottom:12px">删除操作受密码保护，请输入密码</div>
      <input id="delPwInput" type="password" placeholder="请输入密码" style="width:100%;padding:9px;box-sizing:border-box">
      <div id="delPwErr" style="color:#dc2626;font-size:12.5px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn sm" id="delPwCancel">取消</button>
        <button class="btn sm danger" id="delPwOk">确认</button>
      </div>`);
    const input=$("#delPwInput"), mask=$("#modalMask");
    setTimeout(()=>input.focus(),0);
    function cleanup(){
      $("#delPwOk").onclick=null;$("#delPwCancel").onclick=null;
      input.onkeydown=null;mask.removeEventListener("click",maskClick);
    }
    function done(val){cleanup();closeModal();resolve(val);}
    function maskClick(e){if(e.target.id==="modalMask")done(null);}
    mask.addEventListener("click",maskClick);
    $("#delPwCancel").onclick=()=>done(null);
    $("#delPwOk").onclick=()=>{
      if(input.value===""){$("#delPwErr").textContent="请输入密码";return;}
      done(input.value);
    };
    input.onkeydown=e=>{
      if(e.key==="Enter")$("#delPwOk").click();
      if(e.key==="Escape")done(null);
    };
  });
}
async function confirmDelete(actionText){
  const pw=await askPassword();
  if(pw===null)return false;
  if(pw!==DELETE_CODE){alert("密码错误，无法删除");return false;}
  return confirm(actionText);
}

/* ============ Firebase 云端存储（离线缓存由 SDK 负责） ============ */
function openDB(){return Promise.resolve();}
function dbPut(store,obj){return Cloud.upsert(store,obj);}
function dbDel(store,id){return Cloud.remove(store,id);}
async function kvGet(key,def){
  const row=Cloud.data.kv.find(x=>x.key===key);
  return row?row.value:def;
}
function kvSet(key,value){return Cloud.upsert("kv",{key,value});}

/* ============ 状态 ============ */
function readJSON(key,def){
  try{const v=localStorage.getItem(key);return v?JSON.parse(v):def;}catch(e){return def;}
}
const state={batches:[],invoices:[],payments:[],expenses:{},view:"dashboard",filter:{start:"",end:""},fxUSD:25000,wizard:null,openCustomers:new Set(),
  hideSettled:localStorage.getItem("ar_hide_settled")!=="0",
  monthSort:localStorage.getItem("ar_month_sort")==="desc"?"desc":"asc",
  statusFilter:localStorage.getItem("ar_status_filter")||"all",
  currencyFilter:localStorage.getItem("ar_currency_filter")||"all",
  q:"",custQ:"",
  custSort:readJSON("ar_cust_sort",{key:"unpaid",dir:"desc"}),
  invSort:readJSON("ar_inv_sort",{key:"month",dir:"asc"}),
  importTab:"excel",manualRows:null,manualMonth:""};
async function loadState(){
  state.batches=Cloud.data.batches.slice();
  state.invoices=Cloud.data.invoices.slice();
  state.payments=Cloud.data.payments.slice();
  state.fxUSD=await kvGet("fxUSD",25000);
  state.expenses={};
  Cloud.data.kv.forEach(row=>{
    if(row.key&&row.key.startsWith("expense_")){
      state.expenses[row.key.slice(8)]=parseAmount(row.value);
    }
  });
}
function expenseOf(month){return parseAmount(state.expenses[month]);}
function hasExpense(month){return Object.prototype.hasOwnProperty.call(state.expenses,month);}
function monthActualIncome(month){
  return state.invoices.filter(i=>i.month===month).reduce((s,i)=>s+invPaid(i),0);
}
function monthProfit(month){return monthActualIncome(month)-expenseOf(month);}
function invTotal(i){return i.currency==="USD"?i.total*state.fxUSD:i.total;}
function invPaid(i){return i.currency==="USD"?(i.paidAmount||0)*state.fxUSD:(i.paidAmount||0);}
function invFee(i){return i.currency==="USD"?(i.fee||0)*state.fxUSD:(i.fee||0);}
function invUnpaid(i){return Math.max(0,invTotal(i)-invPaid(i)-invFee(i));}
function invoiceStatus(i){
  if(i.cash) return "cash";
  if(invUnpaid(i)<=0) return "paid";
  if((i.paidAmount||0)>0) return "partial";
  return "unpaid";
}
function matchQuery(i,q){
  if(!q) return true;
  const hay=[i.customer,i.code,i.invoiceNo,i.taxNo,i.address,i.date]
    .map(x=>normStr(String(x??""))).join(" ");
  return hay.includes(normStr(q));
}
function filteredInvoices(){
  const {start,end}=state.filter;
  const q=state.q.trim().toLowerCase();
  return state.invoices.filter(i=>{
    if(start&&i.month<start) return false;
    if(end&&i.month>end) return false;
    if(state.statusFilter!=="all"&&invoiceStatus(i)!==state.statusFilter) return false;
    if(state.currencyFilter!=="all"&&(i.currency||"VND")!==state.currencyFilter) return false;
    if(!matchQuery(i,q)) return false;
    return true;
  });
}

/* ============ 排序 ============ */
function sortInvoices(list){
  const k=state.invSort.key, dir=state.invSort.dir==="asc"?1:-1;
  return list.slice().sort((a,b)=>{
    let r=0;
    if(k==="date") r=String(a.date||"").localeCompare(String(b.date||""));
    else if(k==="invoiceNo") r=String(a.invoiceNo||"").localeCompare(String(b.invoiceNo||""));
    else if(k==="total") r=invTotal(a)-invTotal(b);
    else if(k==="paid") r=invPaid(a)-invPaid(b);
    else if(k==="fee") r=invFee(a)-invFee(b);
    else if(k==="unpaid") r=invUnpaid(a)-invUnpaid(b);
    else r=invOrder(a,b);
    return r*dir;
  });
}
function toggleInvSort(key){
  if(state.invSort.key===key) state.invSort.dir=state.invSort.dir==="asc"?"desc":"asc";
  else state.invSort={key,dir:key==="date"||key==="invoiceNo"?"asc":"desc"};
  localStorage.setItem("ar_inv_sort",JSON.stringify(state.invSort));
  render();
}
function toggleCustSort(key){
  if(state.custSort.key===key) state.custSort.dir=state.custSort.dir==="asc"?"desc":"asc";
  else state.custSort={key,dir:key==="customer"||key==="code"?"asc":"desc"};
  localStorage.setItem("ar_cust_sort",JSON.stringify(state.custSort));
  render();
}
function sortArrow(key){
  return state.invSort.key===key?(state.invSort.dir==="asc"?" ▲":" ▼"):"";
}
function custSortArrow(key){
  return state.custSort.key===key?(state.custSort.dir==="asc"?" ▲":" ▼"):"";
}

/* ============ 同步状态徽章 ============ */
const SYNC_META={
  loading:["连接中",false],online:["已同步",false],syncing:["同步中…",false],
  offline:["离线·缓存",false],error:["同步出错",false],signedout:["未登录",false]
};
function updateSyncChip(status,lastAt){
  const chip=$("#syncChip"); if(!chip) return;
  const label=(SYNC_META[status]||SYNC_META.loading)[0];
  chip.className="sync "+status;
  $("#syncText").textContent=label;
  $("#syncTime").textContent=(lastAt&&(status==="online"||status==="syncing"))
    ?"· "+new Date(lastAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})
    :"";
  chip.title={loading:"正在连接云端…",online:"数据已与云端同步",syncing:"本地改动正在上传",offline:"当前离线，使用本机缓存数据",error:"同步出错，请检查网络后重试",signedout:"未登录"}[status]||"";
}

/* ============ 导航 ============ */
document.querySelectorAll(".nav button").forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("active"));
    b.classList.add("active"); state.view=b.dataset.view; render();
  };
});
$("#startMonth").onchange=e=>{state.filter.start=e.target.value;render();};
$("#endMonth").onchange=e=>{state.filter.end=e.target.value;render();};
$("#globalSearch").oninput=e=>{state.q=e.target.value;render();};
$("#statusFilter").onchange=e=>{
  state.statusFilter=e.target.value;localStorage.setItem("ar_status_filter",state.statusFilter);render();
};
$("#currencyFilter").onchange=e=>{
  state.currencyFilter=e.target.value;localStorage.setItem("ar_currency_filter",state.currencyFilter);render();
};
$("#resetFilter").onclick=()=>{
  state.filter={start:"",end:""};state.q="";state.statusFilter="all";state.currencyFilter="all";
  $("#startMonth").value="";$("#endMonth").value="";$("#globalSearch").value="";
  $("#statusFilter").value="all";$("#currencyFilter").value="all";
  localStorage.setItem("ar_status_filter","all");localStorage.setItem("ar_currency_filter","all");
  render();
};

function render(){
  const titles={dashboard:"总览看板",customers:"客户欠款",expenses:"月度支出与利润",import:"导入对账单",data:"数据管理",
    preview:state.previewMonth?"对账单预览 · "+monthLabel(state.previewMonth):"对账单预览"};
  $("#viewTitle").textContent=titles[state.view];
  const c=$("#content");
  if(state.view==="dashboard") renderDashboard(c);
  else if(state.view==="customers") renderCustomers(c);
  else if(state.view==="expenses") renderExpenses(c);
  else if(state.view==="import") renderImport(c);
  else if(state.view==="preview") renderMonthPreview(c);
  else renderData(c);
}

/* ============ 月度对账单预览 ============ */
function goDashboard(){document.querySelector('[data-view="dashboard"]').click();}
function openMonthPreview(m){state.previewMonth=m;state.view="preview";
  document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("active"));render();}
function renderMonthPreview(c){
  const m=state.previewMonth;
  const batch=state.batches.find(b=>b.month===m);
  const list=sortInvoices(filteredInvoices().filter(i=>i.month===m));
  const gSum=list.reduce((s,i)=>s+(i.currency==="USD"?i.goods*state.fxUSD:i.goods),0);
  const tSum=list.reduce((s,i)=>s+(i.currency==="USD"?i.tax*state.fxUSD:i.tax),0);
  const totSum=list.reduce((s,i)=>s+invTotal(i),0);
  const paidSum=list.reduce((s,i)=>s+invPaid(i),0);
  const feeSum=list.reduce((s,i)=>s+invFee(i),0);
  const unpSum=list.reduce((s,i)=>s+invUnpaid(i),0);
  c.innerHTML=`
    <div class="flex gap" style="margin-bottom:16px">
      <button class="btn" onclick="goDashboard()">← 返回看板</button>
      <b style="font-size:16px">${monthLabel(m)} 对账单</b>
      <span class="muted">${batch?esc(batch.fileName):""} · 导入于 ${batch?new Date(batch.importedAt).toLocaleString("zh-CN"):"—"}</span>
      <span class="result-count">${list.length} 张发票</span>
      <div class="spacer"></div>
      <button class="btn primary" onclick="exportMonthPreview('${m}')">导出该月 Excel</button>
    </div>
    <div class="muted" style="margin-bottom:10px;font-size:12.5px">行颜色标记：点击每行右侧色点标记（红/黄/蓝/绿），再点一次同色或 × 清除，标记自动保存；点击表头可排序。</div>
    <div class="panel">
      <div class="tbl-scroll">
        ${list.length?`<table>
          <thead><tr>
            <th>STT</th><th>客户代码</th><th class="sortable" onclick="toggleInvSort('date')">开票日期${sortArrow('date')}</th><th class="sortable" onclick="toggleInvSort('invoiceNo')">发票号${sortArrow('invoiceNo')}</th><th>公司名称</th><th>税号</th>
            <th>地址</th><th class="num">货款</th><th class="num">增值税</th><th class="num sortable" onclick="toggleInvSort('total')">含税总额${sortArrow('total')}</th>
            <th class="num sortable" onclick="toggleInvSort('paid')">实际收入${sortArrow('paid')}</th><th class="num sortable" onclick="toggleInvSort('fee')">手续费${sortArrow('fee')}</th><th class="num sortable" onclick="toggleInvSort('unpaid')">未收${sortArrow('unpaid')}</th><th>状态</th><th>标记</th>
          </tr></thead>
          <tbody>
            ${list.map((i,k)=>`<tr class="${i.mark?"mark-"+i.mark:""}">
              <td>${k+1}</td><td>${esc(i.code)}</td><td>${esc(i.date)}</td><td>${esc(i.invoiceNo)}</td><td class="name">${esc(i.customer)} ${i.currency==="USD"?'<span class="tag usd">USD</span>':""}</td>
              <td>${esc(i.taxNo)||"—"}</td><td class="name">${esc(i.address)||"—"}</td>
              <td class="num">${i.currency==="USD"?fmtUSD(i.goods):fmtVND(i.goods)}</td>
              <td class="num">${i.currency==="USD"?fmtUSD(i.tax):fmtVND(i.tax)}</td>
              <td class="num"><b>${i.currency==="USD"?fmtUSD(i.total):fmtVND(i.total)}</b></td>
              <td class="num green">${i.currency==="USD"?fmtUSD(i.paidAmount||0):fmtVND(i.paidAmount||0)}</td>
              <td class="num amber">${i.fee?(i.currency==="USD"?fmtUSD(i.fee):fmtVND(i.fee)):"0"}</td>
              <td class="num red">${i.currency==="USD"?fmtUSD(Math.max(0,i.total-(i.paidAmount||0)-(i.fee||0))):fmtVND(invUnpaid(i))}</td>
              <td>${i.cash?'<span class="tag" style="background:#fff7d6;color:#a16207">现金收入</span>':(invUnpaid(i)<=0?'<span class="tag paid">已清款</span>':((i.paidAmount||0)>0?'<span class="tag part">部分</span>':'<span class="tag unpaid">未收</span>'))}</td>
              <td style="white-space:nowrap">${markDotsHtml(i)}</td>
            </tr>`).join("")}
            <tr class="total-row"><td colspan="7">本月合计（VND 口径，外币已折算）</td>
              <td class="num">${fmtVND(gSum)}</td><td class="num">${fmtVND(tSum)}</td><td class="num">${fmtVND(totSum)}</td>
              <td class="num">${fmtVND(paidSum)}</td><td class="num">${fmtVND(feeSum)}</td><td class="num red">${fmtVND(unpSum)}</td><td></td><td></td></tr>
          </tbody></table>`:`<div class="empty">该月没有发票数据</div>`}
      </div></div>`;
}
function exportMonthPreview(m){
  const list=sortInvoices(state.invoices.filter(i=>i.month===m));
  const rows=list.map((i,k)=>({
    "STT":k+1,"客户代码":i.code,"开票日期":i.date,"发票号":i.invoiceNo,"公司名称":i.customer,
    "税号":i.taxNo||"","地址":i.address||"","币种":i.currency,
    "货款":i.goods,"增值税":i.tax,"含税总额":i.total,
    "实际收入":i.paidAmount||0,"手续费":i.fee||0,
    "未收金额":Math.max(0,i.total-(i.paidAmount||0)-(i.fee||0)),
    "状态":i.cash?"现金收入":(invUnpaid(i)<=0?"已清款":"未收"),
    "标记":i.mark?MARK_LABEL[i.mark]:""}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),monthLabel(m)+"对账单");
  XLSX.writeFile(wb,monthLabel(m)+"对账单.xlsx");
}

/* ============ 看板 ============ */
function toggleMonthSort(){
  state.monthSort=state.monthSort==="asc"?"desc":"asc";
  localStorage.setItem("ar_month_sort",state.monthSort);
  render();
}
function renderDashboard(c){
  const list=filteredInvoices();
  const totalAll=list.reduce((s,i)=>s+invTotal(i),0);
  const paidAll=list.reduce((s,i)=>s+invPaid(i),0);
  const feeAll=list.reduce((s,i)=>s+invFee(i),0);
  const unpaidAll=list.reduce((s,i)=>s+invUnpaid(i),0);
  const custSet=new Set(list.map(i=>i.customer));
  const months=[...new Set([...state.invoices.map(i=>i.month),...Object.keys(state.expenses)])].filter(Boolean).sort();
  const latest=months.length?months[months.length-1]:"";
  const latestUnpaid=state.invoices.filter(i=>i.month===latest).reduce((s,i)=>s+invUnpaid(i),0);
  const latestProfit=latest&&hasExpense(latest)?monthProfit(latest):null;
  const mStats=new Map();
  state.invoices.forEach(i=>{
    if(!mStats.has(i.month))mStats.set(i.month,{count:0,cust:new Set(),total:0,paid:0,fee:0,unpaid:0,expense:0});
    const s=mStats.get(i.month);
    s.count++;s.cust.add(i.customer);s.total+=invTotal(i);s.paid+=invPaid(i);s.fee+=invFee(i);s.unpaid+=invUnpaid(i);
  });
  Object.keys(state.expenses).forEach(m=>{
    if(!mStats.has(m))mStats.set(m,{count:0,cust:new Set(),total:0,paid:0,fee:0,unpaid:0,expense:0});
    mStats.get(m).expense=expenseOf(m);
  });
  const mRows=[...mStats.entries()].sort((a,b)=>state.monthSort==="desc"?b[0].localeCompare(a[0]):a[0].localeCompare(b[0]));
  c.innerHTML=`
    <div class="cards">
      <div class="kpi"><div class="label">全部未收货款总计</div><div class="num red">${fmtVND(unpaidAll)}</div><div class="hint">VND · ${state.filter.start||state.filter.end||state.q||state.statusFilter!=="all"||state.currencyFilter!=="all"?"筛选区间内":"所有月份"}</div></div>
      <div class="kpi"><div class="label">实际货款收入</div><div class="num green">${fmtVND(paidAll)}</div><div class="hint">发票总额 ${fmtVND(totalAll)} · 手续费 ${fmtVND(feeAll)}</div></div>
      <div class="kpi"><div class="label">未收客户数</div><div class="num purple">${custSet.size}</div><div class="hint">共 ${list.length} 张发票</div></div>
      <div class="kpi"><div class="label">最新月份未收（${latest?monthLabel(latest):"—"}）</div><div class="num green">${fmtVND(latestUnpaid)}</div><div class="hint">点击下方月份查看明细</div></div>
      <div class="kpi"><div class="label">最新月份利润（${latest?monthLabel(latest):"—"}）</div><div class="num ${latestProfit!==null&&latestProfit<0?"red":"blue"}">${latestProfit===null?"待填支出":fmtVND(latestProfit)}</div><div class="hint">实际收入 − 支出总金额</div></div>
    </div>
    <div class="panel">
      <div class="ph"><h3>月度汇总</h3><span class="result-count">${state.invoices.length} 张发票</span><div class="spacer"></div><button class="btn sm" onclick="exportDashboard()">导出 Excel</button></div>
      <div class="tbl-scroll">
        ${mRows.length?`<table>
          <thead><tr><th class="sortable" onclick="toggleMonthSort()">月份 ${state.monthSort==="desc"?"▼":"▲"}</th><th class="num">发票数</th><th class="num">客户数</th><th class="num">发票总额</th><th class="num">实际收入</th><th class="num">手续费</th><th class="num">支出</th><th class="num">利润</th><th class="num">未收</th><th></th></tr></thead>
          <tbody>
            ${mRows.map(([m,s])=>`<tr>
              <td><b>${monthLabel(m)}</b></td><td class="num">${s.count}</td><td class="num">${s.cust.size}</td>
              <td class="num">${fmtVND(s.total)}</td><td class="num green">${fmtVND(s.paid)}</td>
              <td class="num amber">${s.fee?fmtVND(s.fee):"0"}</td>
              <td class="num amber">${hasExpense(m)?fmtVND(s.expense):"—"}</td>
              <td class="num ${s.paid-s.expense>=0?"green":"red"}"><b>${hasExpense(m)?fmtVND(s.paid-s.expense):"—"}</b></td>
              <td class="num red">${fmtVND(s.unpaid)}</td>
              <td style="white-space:normal"><button class="btn sm" onclick="openMonthPreview('${m}')">预览对账单</button>
              <button class="btn sm" onclick="jumpMonth('${m}')">查看客户</button>
              <button class="btn sm primary" onclick="openExpenseMonth('${m}')">${hasExpense(m)?"修改支出":"填写支出"}</button></td></tr>`).join("")}
            <tr class="total-row"><td>合计</td><td class="num">${state.invoices.length}</td>
            <td class="num">${new Set(state.invoices.map(i=>i.customer)).size}</td>
            <td class="num">${fmtVND(state.invoices.reduce((s,i)=>s+invTotal(i),0))}</td>
            <td class="num">${fmtVND(state.invoices.reduce((s,i)=>s+invPaid(i),0))}</td>
            <td class="num">${fmtVND(state.invoices.reduce((s,i)=>s+invFee(i),0))}</td>
            <td class="num">${fmtVND(Object.values(state.expenses).reduce((s,v)=>s+parseAmount(v),0))}</td>
            <td class="num">${fmtVND(state.invoices.reduce((s,i)=>s+invPaid(i),0)-Object.values(state.expenses).reduce((s,v)=>s+parseAmount(v),0))}</td>
            <td class="num">${fmtVND(state.invoices.reduce((s,i)=>s+invUnpaid(i),0))}</td><td></td></tr>
          </tbody></table>`:`<div class="empty"><div class="e1">📄</div>还没有数据，请到「导入」拉入每月 Excel</div>`}
      </div></div>`;
}
function jumpMonth(m){
  state.filter={start:m,end:m};$("#startMonth").value=m;$("#endMonth").value=m;
  document.querySelector('[data-view="customers"]').click();
}

/* ============ 客户 ============ */
function renderCustomers(c){
  const list=filteredInvoices();
  const map=new Map();
  list.forEach(i=>{
    if(!map.has(i.customer))map.set(i.customer,{code:i.code,customer:i.customer,total:0,paid:0,fee:0,unpaid:0,items:[]});
    const s=map.get(i.customer);
    s.total+=invTotal(i);s.paid+=invPaid(i);s.fee+=invFee(i);s.unpaid+=invUnpaid(i);s.items.push(i);
  });
  map.forEach(s=>s.items=sortInvoices(s.items));
  let arr=[...map.values()];
  if(state.hideSettled)arr=arr.filter(s=>s.unpaid>0);
  arr.sort((a,b)=>{
    const k=state.custSort.key;let r=0;
    if(k==="customer") r=a.customer.localeCompare(b.customer,"vi");
    else if(k==="code") r=(a.code||"").localeCompare(b.code||"","vi");
    else if(k==="count") r=a.items.length-b.items.length;
    else if(k==="total") r=a.total-b.total;
    else if(k==="paid") r=a.paid-b.paid;
    else if(k==="fee") r=a.fee-b.fee;
    else r=a.unpaid-b.unpaid;
    return state.custSort.dir==="asc"?r:-r;
  });
  const grand=arr.reduce((s,x)=>s+x.unpaid,0);
  c.innerHTML=`
    <div class="panel">
      <div class="ph"><h3>客户未收明细</h3><span class="result-count">${arr.length} 个客户 · ${list.length} 张发票</span><div class="spacer"></div>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer">
          <input type="checkbox" id="hideSettledChk" style="width:auto;min-width:0">
          隐藏已清款
        </label>
        <input class="search" id="custSearch" placeholder="搜索公司 / 代码" value="${esc(state.custQ)}">
        <button class="btn sm" onclick="exportCustomers()">导出 Excel（含已清款）</button></div>
      <div class="tbl-scroll">
        ${arr.length?`<table>
          <thead><tr><th></th>
            <th class="sortable" onclick="toggleCustSort('customer')">客户${custSortArrow('customer')}</th>
            <th class="sortable" onclick="toggleCustSort('code')">代码${custSortArrow('code')}</th>
            <th class="sortable num" onclick="toggleCustSort('count')">发票数${custSortArrow('count')}</th>
            <th class="sortable num" onclick="toggleCustSort('total')">发票总额${custSortArrow('total')}</th>
            <th class="sortable num" onclick="toggleCustSort('paid')">实际收入${custSortArrow('paid')}</th>
            <th class="sortable num" onclick="toggleCustSort('fee')">手续费${custSortArrow('fee')}</th>
            <th class="sortable num" onclick="toggleCustSort('unpaid')">未收余额${custSortArrow('unpaid')}</th>
            <th>状态</th><th></th></tr></thead>
          <tbody id="custBody">
            ${arr.map(s=>{
              const st=s.unpaid<=0?'<span class="tag paid">已结清</span>':(s.paid>0?'<span class="tag part">部分收款</span>':'<span class="tag unpaid">未收</span>');
              return `
              <tr class="cust-row ${state.openCustomers.has(s.customer)?'open':''}" data-name="${esc(s.customer)}" data-code="${esc(s.code)}">
                <td><span class="caret">▶</span></td>
                <td class="name"><b>${esc(s.customer)}</b></td><td class="muted">${esc(s.code)||"—"}</td>
                <td class="num">${s.items.length}</td>
                <td class="num">${fmtVND(s.total)}</td><td class="num green">${fmtVND(s.paid)}</td>
                <td class="num amber">${s.fee?fmtVND(s.fee):"0"}</td>
                <td class="num red"><b>${fmtVND(s.unpaid)}</b></td><td>${st}</td>
                <td style="white-space:normal">
                  ${s.unpaid>0?`<button class="btn sm primary" onclick="collectCustomer('${esc(s.customer)}')">收款</button>
                  <button class="btn sm" onclick="quickSettleCustomer('${esc(s.customer)}')">清款</button>
                  <button class="btn sm" onclick="settleCustomer('${esc(s.customer)}')">全部结清</button>`:""}
                </td>
              </tr>
              <tr class="detail-row" style="display:${state.openCustomers.has(s.customer)?'table-row':'none'}">
                <td colspan="10"><div class="detail-inner"><div class="tbl-scroll"><table>
                  <thead><tr><th>月份</th><th>发票号</th><th>日期</th><th class="num">货款</th><th class="num">税额</th><th class="num">含税总额</th><th class="num">实际收入</th><th class="num">手续费</th><th class="num">未收</th><th>状态</th><th>标记</th><th></th></tr></thead>
                  <tbody>
                    ${s.items.filter(i=>!state.hideSettled||invUnpaid(i)>0).map(i=>`<tr class="${i.mark?"mark-"+i.mark:""}">
                      <td>${monthLabel(i.month)}</td><td>${esc(i.invoiceNo)||"—"}</td><td>${esc(i.date)}</td>
                      <td class="num">${i.currency==="USD"?fmtUSD(i.goods):fmtVND(i.goods)}</td>
                      <td class="num">${i.currency==="USD"?fmtUSD(i.tax):fmtVND(i.tax)}</td>
                      <td class="num">${i.currency==="USD"?fmtUSD(i.total)+' <span class="tag usd">USD</span>':fmtVND(i.total)}</td>
                      <td class="num green">${i.currency==="USD"?fmtUSD(i.paidAmount||0):fmtVND(i.paidAmount||0)}</td>
                      <td class="num amber">${i.fee?(i.currency==="USD"?fmtUSD(i.fee):fmtVND(i.fee)):"0"}</td>
                      <td class="num red">${i.currency==="USD"?fmtUSD(Math.max(0,i.total-(i.paidAmount||0)-(i.fee||0))):fmtVND(invUnpaid(i))}</td>
                      <td>${invUnpaid(i)<=0?'<span class="tag paid">已结清</span>':((i.paidAmount||0)>0?'<span class="tag part">部分</span>':'<span class="tag unpaid">未收</span>')}</td>
                      <td style="white-space:nowrap">${markDotsHtml(i)}</td>
                      <td style="white-space:normal">${invUnpaid(i)>0?`<button class="btn sm" onclick="collectInvoice('${i.id}')">收款</button>
                        <button class="btn sm" onclick="quickSettleInvoice('${i.id}')">清款</button>`:""}</td>
                    </tr>`).join("")}
                    ${state.hideSettled&&s.items.every(i=>invUnpaid(i)<=0)?'<tr><td colspan="12" class="muted">该客户发票均已清款，勾选上方“显示已清款”可查看</td></tr>':""}
                  </tbody></table>
                  ${payHistoryHtml(s.customer)}</div></div></td>
              </tr>`;
            }).join("")}
            <tr class="total-row"><td colspan="7">未收总计</td><td class="num red">${fmtVND(grand)}</td><td colspan="2"></td></tr>
          </tbody></table>`:`<div class="empty"><div class="e1">🏢</div>${state.hideSettled&&state.invoices.length?"当前发票均已清款，取消勾选“隐藏已清款”可查看全部":"当前区间内没有发票数据"}</div>`}
      </div></div>`;
  $("#hideSettledChk").checked=state.hideSettled;
  $("#hideSettledChk").onchange=e=>{
    state.hideSettled=e.target.checked;
    localStorage.setItem("ar_hide_settled",state.hideSettled?"1":"0");
    render();
  };
  $("#custSearch").oninput=e=>{
    state.custQ=e.target.value;
    const q=e.target.value.toLowerCase();
    document.querySelectorAll("#custBody .cust-row").forEach(tr=>{
      const hit=tr.dataset.name.toLowerCase().includes(q)||tr.dataset.code.toLowerCase().includes(q);
      tr.style.display=hit?"":"none";
      const next=tr.nextElementSibling;
      if(next&&next.classList.contains("detail-row"))next.style.display=(hit&&tr.classList.contains("open"))?"table-row":"none";
    });
  };
  document.querySelectorAll(".cust-row").forEach(tr=>{
    tr.onclick=e=>{
      if(e.target.tagName==="BUTTON")return;
      const name=tr.dataset.name,detail=tr.nextElementSibling;
      if(state.openCustomers.has(name)){state.openCustomers.delete(name);tr.classList.remove("open");detail.style.display="none";}
      else{state.openCustomers.add(name);tr.classList.add("open");detail.style.display="table-row";}
    };
  });
}

/* ============ 行颜色标记 ============ */
const MARK_COLORS=["red","yellow","blue","green"];
const MARK_LABEL={red:"红",yellow:"黄",blue:"蓝",green:"绿"};
function markDotsHtml(i){
  return MARK_COLORS.map(c=>`<span class="mark-dot ${c} ${i.mark===c?"sel":""}" title="${MARK_LABEL[c]}" onclick="setInvoiceMark('${i.id}','${c}')"></span>`).join("")+
    (i.mark?`<span class="mark-clear" title="清除标记" onclick="setInvoiceMark('${i.id}','')">×</span>`:"");
}
async function setInvoiceMark(id,color){
  const i=state.invoices.find(x=>x.id===id);if(!i)return;
  i.mark=color;await dbPut("invoices",i);render();
}
/* ============ 收款 ============ */
let invoicePayRows=[];
function collectInvoice(id){
  const i=state.invoices.find(x=>x.id===id);if(!i)return;
  const cur=i.currency||"VND";
  const unpaid=Math.max(0,i.total-(i.paidAmount||0)-(i.fee||0));
  invoicePayRows=[{date:todayStr(),amount:cur==="USD"?+unpaid.toFixed(2):Math.round(unpaid)}];
  openModal(`
    <h4>发票收款（可一次登记多笔）</h4>
    <div class="mline"><span>客户</span><b>${esc(i.customer)}</b></div>
    <div class="mline"><span>发票号</span><span>${esc(i.invoiceNo)}</span></div>
    <div class="mline"><span>含税总额</span><span>${cur==="USD"?fmtUSD(i.total)+" USD":fmtVND(i.total)+" VND"}</span></div>
    <div class="mline"><span>已收</span><span>${cur==="USD"?fmtUSD(i.paidAmount||0):fmtVND(i.paidAmount||0)}</span></div>
    <div class="mline"><span>未收</span><span class="red">${cur==="USD"?fmtUSD(unpaid):fmtVND(unpaid)}</span></div>
    <div style="margin-top:14px"><b style="font-size:13px">收款明细（每行一笔，各自日期和金额）</b></div>
    <div id="payRowsBox" style="margin-top:8px"></div>
    <button class="btn sm" style="margin-top:8px" onclick="addInvoicePayRow()">＋ 增加收款行</button>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;margin-top:12px">
      <input type="checkbox" id="feeMode" style="width:auto;min-width:0">
      最后一笔清款：剩余差额记为银行手续费，按实际到账结清
    </label>
    <div class="actions"><button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="confirmPay('${id}')">确认收款</button></div>`);
  renderInvoicePayRows();
}
function renderInvoicePayRows(){
  const box=$("#payRowsBox");if(!box)return;
  box.innerHTML=invoicePayRows.map((r,k)=>`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input type="date" class="pr-date" data-k="${k}" value="${esc(r.date)}" style="min-width:140px">
      <input type="number" step="0.01" class="pr-amt" data-k="${k}" value="${esc(r.amount)}" placeholder="收款金额" style="flex:1;min-width:120px">
      <button class="btn sm danger" onclick="removeInvoicePayRow(${k})">删</button>
    </div>`).join("");
  box.querySelectorAll(".pr-date").forEach(inp=>inp.onchange=()=>{invoicePayRows[+inp.dataset.k].date=inp.value;});
  box.querySelectorAll(".pr-amt").forEach(inp=>inp.oninput=()=>{invoicePayRows[+inp.dataset.k].amount=inp.value;});
}
function addInvoicePayRow(){invoicePayRows.push({date:todayStr(),amount:""});renderInvoicePayRows();}
function removeInvoicePayRow(k){invoicePayRows.splice(k,1);renderInvoicePayRows();}
async function confirmPay(id){
  const i=state.invoices.find(x=>x.id===id);
  const cur=i.currency||"VND";
  const remain=i.total-(i.paidAmount||0)-(i.fee||0);
  const rows=invoicePayRows.map(r=>({date:r.date,amount:parseAmount(r.amount)}));
  if(rows.some(r=>!r.date)){alert("每笔收款都要选择日期");return;}
  if(rows.some(r=>r.amount<=0)){alert("每笔收款金额都要大于 0");return;}
  const sum=rows.reduce((s,r)=>s+r.amount,0);
  const feeMode=$("#feeMode").checked;
  const cap=feeMode?remain:remain;
  if(sum>cap+0.001){alert("收款合计不能超过未收余额 "+remain);return;}
  let fee=0;
  if(feeMode)fee=remain-sum;
  i.paidAmount=(i.paidAmount||0)+sum;
  i.fee=(i.fee||0)+fee;
  if((i.paidAmount||0)+(i.fee||0)>=i.total-0.001)i.paidAt=rows.map(r=>r.date).sort().slice(-1)[0];
  for(let k=0;k<rows.length;k++){
    const r=rows[k];
    const rowFee=(k===rows.length-1)?fee:0;
    await dbPut("payments",{id:uid(),customer:i.customer,code:i.code,
      currency:cur,amount:r.amount,date:r.date,fee:rowFee,
      note:rowFee>0?"银行手续费 "+(cur==="USD"?fmtUSD(rowFee):fmtVND(rowFee)):"",
      allocations:[{invoiceId:i.id,amount:r.amount,fee:rowFee}]});
  }
  await dbPut("invoices",i);closeModal();await loadState();render();
}
/* 发票级快捷清款：按实际到账记账，差额自动手续费 */
function quickSettleInvoice(id){
  const i=state.invoices.find(x=>x.id===id);if(!i)return;
  const cur=i.currency||"VND";
  const remain=i.total-(i.paidAmount||0)-(i.fee||0);
  openModal(`
    <h4>清款（按实际收款记账）</h4>
    <div class="mline"><span>发票号</span><span>${esc(i.invoiceNo)}</span></div>
    <div class="mline"><span>未收余额</span><span class="red">${cur==="USD"?fmtUSD(remain):fmtVND(remain)} ${cur}</span></div>
    <label style="font-size:12px;color:var(--sub);display:block;margin-top:14px">实际到账金额（差额自动记为银行手续费）</label>
    <input id="qsInput" type="number" step="0.01" value="${cur==="USD"?remain.toFixed(2):Math.round(remain)}">
    <div class="actions"><button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="confirmQuickSettle('${id}')">确认清款</button></div>`);
}
async function confirmQuickSettle(id){
  const i=state.invoices.find(x=>x.id===id);
  const cur=i.currency||"VND";
  const v=parseAmount($("#qsInput").value);
  const remain=i.total-(i.paidAmount||0)-(i.fee||0);
  if(v<=0||v>remain+0.001){alert("金额需在 0 到 "+remain+" 之间");return;}
  const fee=remain-v;
  i.fee=(i.fee||0)+fee;i.paidAmount=(i.paidAmount||0)+v;i.paidAt=todayStr();
  await dbPut("payments",{id:uid(),customer:i.customer,code:i.code,
    currency:cur,amount:v,date:todayStr(),fee,
    note:fee>0?"清款-银行手续费 "+(cur==="USD"?fmtUSD(fee):fmtVND(fee)):"清款",
    allocations:[{invoiceId:i.id,amount:v,fee:0}]});
  await dbPut("invoices",i);closeModal();await loadState();render();
}

/* 客户级分批收款 */
function customerCurrency(name){
  const i=state.invoices.find(x=>x.customer===name);
  return i?(i.currency||"VND"):"VND";
}
/* 客户级快捷清款：实际到账 + 手续费，一次结清 */
function quickSettleCustomer(name){
  const cur=customerCurrency(name);
  const list=state.invoices.filter(i=>i.customer===name);
  const total=list.reduce((s,i)=>s+i.total,0);
  const paid=list.reduce((s,i)=>s+(i.paidAmount||0),0);
  const oldFee=list.reduce((s,i)=>s+(i.fee||0),0);
  const remain=total-paid-oldFee;
  openModal(`
    <h4>客户清款（按实际收款记账）</h4>
    <div class="mline"><span>客户</span><b>${esc(name)}</b></div>
    <div class="mline"><span>未收余额</span><span class="red">${cur==="USD"?fmtUSD(remain):fmtVND(remain)} ${cur}</span></div>
    <label style="font-size:12px;color:var(--sub);display:block;margin-top:14px">实际到账总额（剩余差额自动记为银行手续费）</label>
    <input id="qscInput" type="number" step="0.01" value="${cur==="USD"?remain.toFixed(2):Math.round(remain)}">
    <div class="actions"><button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="confirmQuickSettleCustomer('${esc(name)}')">确认清款</button></div>`);
}
async function confirmQuickSettleCustomer(name){
  const cur=customerCurrency(name);
  const v=parseAmount($("#qscInput").value);
  const invs=state.invoices.filter(i=>i.customer===name&&i.total-(i.paidAmount||0)-(i.fee||0)>0).sort(invOrder);
  const remainAll=invs.reduce((s,i)=>s+i.total-(i.paidAmount||0)-(i.fee||0),0);
  if(v<=0||v>remainAll+0.001){alert("金额需在 0 到 "+remainAll+" 之间");return;}
  let left=v,totalFee=0;const allocations=[];
  for(let k=0;k<invs.length;k++){
    const i=invs[k],cap=i.total-(i.paidAmount||0)-(i.fee||0);
    const pay=Math.min(cap,left);let fee=0;
    if(k===invs.length-1){fee=cap-pay;i.fee=(i.fee||0)+fee;totalFee+=fee;}
    i.paidAmount=(i.paidAmount||0)+pay;i.paidAt=todayStr();
    allocations.push({invoiceId:i.id,amount:pay,fee});left-=pay;
    await dbPut("invoices",i);
  }
  await dbPut("payments",{id:uid(),customer:name,code:customerCode(name),
    currency:cur,amount:v,date:todayStr(),fee:totalFee,
    note:"客户清款-手续费 "+(cur==="USD"?fmtUSD(totalFee):fmtVND(totalFee)),allocations});
  closeModal();await loadState();render();
}
function collectCustomer(name){
  const cur=customerCurrency(name);
  const list=state.invoices.filter(i=>i.customer===name);
  const total=list.reduce((s,i)=>s+i.total,0);
  const paid=list.reduce((s,i)=>s+(i.paidAmount||0),0);
  const unpaid=total-paid;
  openModal(`
    <h4>登记收款（可分多次）</h4>
    <div class="mline"><span>客户</span><b>${esc(name)}</b></div>
    <div class="mline"><span>发票总额</span><span>${cur==="USD"?fmtUSD(total):fmtVND(total)} ${cur}</span></div>
    <div class="mline"><span>累计已收</span><span class="green">${cur==="USD"?fmtUSD(paid):fmtVND(paid)}</span></div>
    <div class="mline"><span>未收</span><span class="red">${cur==="USD"?fmtUSD(unpaid):fmtVND(unpaid)}</span></div>
    <label style="font-size:12px;color:var(--sub);display:block;margin-top:14px">本次收款金额（${cur}）</label>
    <input id="custPayAmount" type="number" step="0.01" value="${cur==="USD"?unpaid.toFixed(2):Math.round(unpaid)}">
    <label style="font-size:12px;color:var(--sub);display:block">收款日期</label>
    <input id="custPayDate" type="date" value="${todayStr()}">
    <label style="font-size:12px;color:var(--sub);display:block">备注（如现金/银行转账，可选）</label>
    <input id="custPayNote" type="text" placeholder="备注">
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer">
      <input type="checkbox" id="custFeeMode" style="width:auto;min-width:0">
      最后一笔清款：剩余差额记为银行手续费，按实际到账结清
    </label>
    <div class="actions"><button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="confirmCustomerPay('${esc(name)}')">确认收款</button></div>`);
}
async function confirmCustomerPay(name){
  const cur=customerCurrency(name);
  const amount=parseAmount($("#custPayAmount").value);
  const date=$("#custPayDate").value||todayStr();
  const note=$("#custPayNote").value;
  if(amount<=0){alert("请输入收款金额");return;}
  const feeMode=$("#custFeeMode").checked;
  const invs=state.invoices.filter(i=>i.customer===name&&i.total-(i.paidAmount||0)-(i.fee||0)>0)
    .sort(invOrder);
  let remain=amount;const allocations=[];let totalFee=0;
  for(let k=0;k<invs.length;k++){
    const i=invs[k];
    if(remain<=0&&!feeMode)break;
    const cap=i.total-(i.paidAmount||0)-(i.fee||0);
    const pay=Math.min(cap,remain);
    let fee=0;
    if(feeMode&&k===invs.length-1){
      // 最后一张发票承担手续费差额
      fee=cap-pay;
      i.fee=(i.fee||0)+fee;totalFee+=fee;
    }
    i.paidAmount=(i.paidAmount||0)+pay;
    if((i.paidAmount||0)+(i.fee||0)>=i.total-0.001)i.paidAt=date;
    allocations.push({invoiceId:i.id,amount:pay,fee});
    remain-=pay;
    await dbPut("invoices",i);
  }
  const recorded=amount-remain;
  await dbPut("payments",{id:uid(),customer:name,code:customerCode(name),
    currency:cur,amount:recorded,date,note,fee:totalFee,allocations});
  if(remain>0.001)alert("提示：收款金额超出未收余额，已登记 "+(cur==="USD"?fmtUSD(recorded):fmtVND(recorded)));
  closeModal();await loadState();render();
}
function customerCode(name){
  const i=state.invoices.find(x=>x.customer===name);return i?(i.code||""):"";
}
function payHistoryHtml(name){
  const pays=state.payments.filter(p=>p.customer===name)
    .sort((a,b)=>b.date.localeCompare(a.date));
  if(!pays.length)return "";
  return `<div style="margin-top:14px">
    <b style="font-size:13px">收款记录（分批次）</b>
    <div class="tbl-scroll" style="margin-top:8px"><table>
      <thead><tr><th>收款日期</th><th class="num">本次收款</th><th>备注</th><th></th></tr></thead>
      <tbody>${pays.map(p=>`<tr>
        <td>${esc(p.date)}</td>
        <td class="num green">${p.currency==="USD"?fmtUSD(p.amount)+" USD":fmtVND(p.amount)+" VND"}</td>
        <td>${esc(p.note||"")}</td>
        <td><button class="btn sm danger" onclick="deletePayment('${p.id}')">撤销</button></td>
      </tr>`).join("")}
      <tr class="total-row"><td>合计</td>
        <td class="num">${fmtVND(pays.reduce((s,p)=>s+(p.currency==="USD"?p.amount*state.fxUSD:p.amount),0))} VND</td>
        <td colspan="2"></td></tr></tbody>
    </table></div></div>`;
}
async function deletePayment(id){
  const p=state.payments.find(x=>x.id===id);
  if(!p)return;
  if(!await confirmDelete("确认撤销该笔收款？对应发票将恢复为未收状态。"))return;
  for(const a of p.allocations||[]){
    const i=state.invoices.find(x=>x.id===a.invoiceId);
    if(i){
      i.paidAmount=Math.max(0,(i.paidAmount||0)-a.amount);
      i.fee=Math.max(0,(i.fee||0)-(a.fee||0));
      i.paidAt="";await dbPut("invoices",i);
    }
  }
  await dbDel("payments",id);
  await loadState();render();
}
async function settleCustomer(name){
  if(!confirm("确认将「"+name+"」当前区间内所有未收发票全部标记为已收？"))return;
  const ids=filteredInvoices().filter(i=>i.customer===name&&invUnpaid(i)>0);
  for(const i of ids){i.paidAmount=i.total;i.paidAt=todayStr();await dbPut("invoices",i);}
  render();
}

/* ============ 月度支出与利润 ============ */
function openExpenseMonth(month){
  state.expenseMonth=month;
  document.querySelector('[data-view="expenses"]').click();
}
function renderExpenses(c){
  if(!state.expenseMonth)state.expenseMonth=todayStr().slice(0,7);
  const selected=state.expenseMonth;
  const months=[...new Set([...state.invoices.map(i=>i.month),...Object.keys(state.expenses)])]
    .filter(Boolean).sort((a,b)=>b.localeCompare(a));
  const rows=months.map(m=>{
    const inv=state.invoices.filter(i=>i.month===m);
    const income=inv.reduce((s,i)=>s+invPaid(i),0);
    const unpaid=inv.reduce((s,i)=>s+invUnpaid(i),0);
    const expense=expenseOf(m);
    return {m,income,unpaid,expense,profit:income-expense,recorded:hasExpense(m)};
  });
  const incomeAll=rows.reduce((s,r)=>s+r.income,0);
  const expenseAll=rows.reduce((s,r)=>s+r.expense,0);
  const profitAll=incomeAll-expenseAll;
  c.innerHTML=`
    <div class="note-line">每月只需填写一次支出总金额（VND），之后可直接修改。<b>当月利润 = 当月实际收入（含现金，USD 按当前汇率折算）− 当月支出总金额</b>；银行手续费不重复扣除。</div>
    <div class="panel">
      <div class="ph"><h3>填写 / 修改月度支出</h3><span class="result-count">保存后三端自动同步</span></div>
      <div class="pb">
        <div class="row2" style="margin-bottom:0">
          <div class="field"><label>支出月份 *</label><input type="month" id="expMonth" value="${esc(selected)}"></div>
          <div class="field"><label>当月支出总金额（VND）*</label><input type="number" id="expAmount" min="0" step="1" inputmode="numeric" placeholder="例如：150000000" value="${hasExpense(selected)?expenseOf(selected):""}"></div>
          <button class="btn primary" onclick="saveExpense()">保存支出</button>
          ${hasExpense(selected)?`<button class="btn danger" onclick="deleteExpense('${selected}')">清除该月支出</button>`:""}
        </div>
      </div>
    </div>
    <div class="cards profit-cards">
      <div class="kpi"><div class="label">累计实际收入</div><div class="num green">${fmtVND(incomeAll)}</div><div class="hint">下列月份合计 · VND</div></div>
      <div class="kpi"><div class="label">累计支出</div><div class="num amber">${fmtVND(expenseAll)}</div><div class="hint">已填写 ${rows.filter(r=>r.recorded).length} 个月</div></div>
      <div class="kpi"><div class="label">累计利润</div><div class="num ${profitAll>=0?"blue":"red"}">${fmtVND(profitAll)}</div><div class="hint">实际收入 − 支出</div></div>
    </div>
    <div class="panel">
      <div class="ph"><h3>每月利润明细</h3><span class="result-count">${rows.length} 个月</span><div class="spacer"></div><button class="btn sm" onclick="exportExpenses()">导出利润表 Excel</button></div>
      <div class="tbl-scroll">
        ${rows.length?`<table>
          <thead><tr><th>月份</th><th class="num">实际收入</th><th class="num">支出总金额</th><th class="num">当月利润</th><th class="num">未收货款</th><th>支出状态</th><th></th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td><b>${monthLabel(r.m)}</b></td>
            <td class="num green">${fmtVND(r.income)}</td>
            <td class="num amber">${r.recorded?fmtVND(r.expense):"—"}</td>
            <td class="num ${r.profit>=0?"green":"red"}"><b>${r.recorded?fmtVND(r.profit):"—"}</b></td>
            <td class="num red">${fmtVND(r.unpaid)}</td>
            <td>${r.recorded?'<span class="tag paid">已填写</span>':'<span class="tag unpaid">待填写</span>'}</td>
            <td style="white-space:normal"><button class="btn sm primary" onclick="openExpenseMonth('${r.m}')">${r.recorded?"修改支出":"填写支出"}</button>
              <button class="btn sm" onclick="openMonthPreview('${r.m}')">查看收入明细</button></td>
          </tr>`).join("")}
          <tr class="total-row"><td>合计</td><td class="num">${fmtVND(incomeAll)}</td><td class="num">${fmtVND(expenseAll)}</td><td class="num ${profitAll>=0?"green":"red"}">${fmtVND(profitAll)}</td><td class="num">${fmtVND(rows.reduce((s,r)=>s+r.unpaid,0))}</td><td colspan="2"></td></tr>
          </tbody></table>`:`<div class="empty"><div class="e1">💰</div>还没有月度数据，请先在上方选择月份并填写支出</div>`}
      </div></div>`;
  $("#expMonth").onchange=e=>{state.expenseMonth=e.target.value;render();};
}
async function saveExpense(){
  const month=$("#expMonth").value;
  const raw=$("#expAmount").value.trim();
  if(!month){alert("请选择支出月份");return;}
  if(raw===""){alert("请输入当月支出总金额；没有支出可填写 0");return;}
  const amount=parseAmount(raw);
  if(amount<0){alert("支出总金额不能小于 0");return;}
  state.expenseMonth=month;
  await kvSet("expense_"+month,amount);
  state.expenses[month]=amount;
  await loadState();render();
}
async function deleteExpense(month){
  if(!await confirmDelete("确认清除 "+monthLabel(month)+" 的支出记录？利润将重新计算。"))return;
  await dbDel("kv","expense_"+month);
  delete state.expenses[month];
  await loadState();render();
}
function exportExpenses(){
  const months=[...new Set([...state.invoices.map(i=>i.month),...Object.keys(state.expenses)])]
    .filter(Boolean).sort((a,b)=>a.localeCompare(b));
  const rows=months.map(m=>{
    const inv=state.invoices.filter(i=>i.month===m);
    const income=inv.reduce((s,i)=>s+invPaid(i),0);
    const expense=expenseOf(m);
    return {"月份":monthLabel(m),"实际收入(VND)":Math.round(income),
      "支出总金额(VND)":hasExpense(m)?Math.round(expense):"",
      "当月利润(VND)":hasExpense(m)?Math.round(income-expense):"",
      "未收货款(VND)":Math.round(inv.reduce((s,i)=>s+invUnpaid(i),0)),
      "支出状态":hasExpense(m)?"已填写":"待填写"};
  });
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"月度支出与利润");
  XLSX.writeFile(wb,"月度支出与利润_"+todayStr()+".xlsx");
}

/* ============ 导入 ============ */
function renderImport(c){
  c.innerHTML=`
    <div class="flex gap" style="margin-bottom:18px">
      <button class="btn primary" id="tabExcel">📥 导入 Excel</button>
      <button class="btn" id="tabManual">✍️ 手工新增对账单（现金客户）</button>
    </div>
    <div id="excelPane">
      <div class="drop" id="dropZone">
        <div class="big">📥</div><h3>点击选择 或 拖入月度对账单 Excel</h3>
        <p>支持 .xlsx / .xls，数据保存在云端，三端实时同步</p>
        <input type="file" id="fileInput" accept=".xlsx,.xls" style="display:none">
      </div><div class="wizard" id="wizard"></div>
    </div>
    <div id="manualPane" style="display:none"></div>`;
  $("#tabExcel").onclick=()=>{state.importTab="excel";renderImport(c);};
  $("#tabManual").onclick=()=>{state.importTab="manual";renderManual();};
  if(state.importTab==="manual"){renderManual();}
  else{
    const dz=$("#dropZone"),fi=$("#fileInput");
    dz.onclick=()=>fi.click();
    fi.onchange=e=>{if(e.target.files[0])handleFile(e.target.files[0]);};
    dz.ondragover=e=>{e.preventDefault();dz.classList.add("over");};
    dz.ondragleave=()=>dz.classList.remove("over");
    dz.ondrop=e=>{e.preventDefault();dz.classList.remove("over");if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);};
    if(state.wizard)renderWizard();
  }
}

/* ============ 手工新增对账单 ============ */
function blankManualRow(){
  return {code:"",customer:"",invoiceNo:"",date:todayStr(),
    goods:"",tax:"",total:"",taxNo:"",address:"",currency:"VND",settled:false};
}
function renderManual(){
  if(!state.manualRows||!state.manualRows.length)state.manualRows=[blankManualRow()];
  const months=[...new Set(state.invoices.map(i=>i.month))].sort();
  const d=new Date();defM=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  $("#manualPane").style.display="block";$("#excelPane").style.display="none";
  $("#tabExcel").classList.remove("primary");$("#tabManual").classList.add("primary");
  $("#manualPane").innerHTML=`
    <div class="note-line">✍️ 手工录入对账单，适合现金客户或补录。同一月份已有 Excel 数据时，手工行会追加到该月，不会覆盖。</div>
    <div class="row2">
      <div class="field"><label>对账月份 *</label><input type="month" id="manMonth" value="${state.manualMonth||defM}"></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer">
        <input type="checkbox" id="manCashAll" style="width:auto;min-width:0"> 全部按现金已收保存（录入即清款）
      </label>
    </div>
    <div class="panel"><div class="tbl-scroll"><table id="manTable">
      <thead><tr>
        <th></th><th>客户代码</th><th>客户名称 *</th><th>发票号</th><th>日期</th>
        <th class="num">货款</th><th class="num">税额</th><th class="num">含税总额</th>
        <th>币种</th><th>税号</th><th>地址</th><th>现金已收</th><th></th>
      </tr></thead>
      <tbody>${state.manualRows.map((r,idx)=>manRowHtml(r,idx)).join("")}</tbody>
    </table></div></div>
    <div class="flex gap">
      <button class="btn" onclick="addManualRow()">＋ 增加一行</button>
      <button class="btn primary" onclick="saveManual()">保存对账单</button>
      <span class="muted" id="manSummary"></span>
    </div>`;
  bindManualEvents();updateManSummary();
}
function manRowHtml(r,idx){
  return `<tr data-idx="${idx}">
    <td>${idx+1}</td>
    <td><input class="mcell" data-f="code" value="${esc(r.code)}" style="min-width:110px"></td>
    <td><div class="man-cust-wrap"><input class="mcell" data-f="customer" value="${esc(r.customer)}" autocomplete="off" style="min-width:180px"><div class="man-cust-list" id="custList${idx}"></div></div></td>
    <td><input class="mcell" data-f="invoiceNo" value="${esc(r.invoiceNo)}" style="min-width:100px"></td>
    <td><input class="mcell" data-f="date" type="date" value="${esc(r.date)}" style="min-width:130px"></td>
    <td><input class="mcell man-amt" data-f="goods" type="number" step="0.01" value="${esc(r.goods)}" style="min-width:110px"></td>
    <td><input class="mcell man-amt" data-f="tax" type="number" step="0.01" value="${esc(r.tax)}" style="min-width:100px"></td>
    <td><input class="mcell man-amt" data-f="total" type="number" step="0.01" value="${esc(r.total)}" placeholder="自动" style="min-width:120px"></td>
    <td><select class="mcell" data-f="currency" style="min-width:80px">
      <option value="VND" ${r.currency!=="USD"?"selected":""}>VND</option>
      <option value="USD" ${r.currency==="USD"?"selected":""}>USD</option></select></td>
    <td><input class="mcell" data-f="taxNo" value="${esc(r.taxNo)}" style="min-width:110px"></td>
    <td><input class="mcell" data-f="address" value="${esc(r.address)}" style="min-width:180px"></td>
    <td style="text-align:center"><input type="checkbox" class="mcell man-settled" data-f="settled" style="width:auto;min-width:0" ${r.settled?"checked":""}></td>
    <td><button class="btn sm danger" onclick="removeManualRow(${idx})">删</button></td>
  </tr>`;
}
function bindManualEvents(){
  document.querySelectorAll("#manTable .mcell").forEach(inp=>{
    inp.addEventListener("input",e=>{
      const tr=e.target.closest("tr");const idx=parseInt(tr.dataset.idx);
      const f=e.target.dataset.f;
      state.manualRows[idx][f]=e.target.type==="checkbox"?e.target.checked:e.target.value;
      if(["goods","tax"].includes(f))autoCalcTotal(idx);
      if(f==="customer")showCustSuggest(idx);
      updateManSummary();
    });
    inp.addEventListener("change",e=>{
      const idx=parseInt(e.target.closest("tr").dataset.idx);
      const f=e.target.dataset.f;
      state.manualRows[idx][f]=e.target.type==="checkbox"?e.target.checked:e.target.value;
    });
    if(inp.dataset.f==="customer"){
      inp.addEventListener("focus",()=>showCustSuggest(parseInt(inp.closest("tr").dataset.idx)));
      inp.addEventListener("blur",()=>{
        const l=inp.closest(".man-cust-wrap").querySelector(".man-cust-list");
        setTimeout(()=>l.classList.remove("open"),150);
      });
    }
  });
  document.querySelectorAll(".man-cust-list").forEach(list=>{
    list.addEventListener("mousedown",e=>{
      e.preventDefault();
      const item=e.target.closest(".man-cust-item");if(!item)return;
      pickCustomer(parseInt(list.id.replace("custList","")),item.dataset.name);
    });
  });
  const scrollBox=document.querySelector("#manTable")?.closest(".tbl-scroll");
  if(scrollBox)scrollBox.addEventListener("scroll",()=>{
    document.querySelectorAll(".man-cust-list.open").forEach(l=>l.classList.remove("open"));
  });
  $("#manCashAll").onchange=e=>{
    state.manualRows.forEach((r,idx)=>{r.settled=e.target.checked;
      const cb=document.querySelector(`tr[data-idx="${idx}"] .man-settled`);if(cb)cb.checked=e.target.checked;});
    updateManSummary();
  };
}
function normStr(s){return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D");}
function customerDir(){
  const m=new Map();
  state.invoices.forEach(i=>{
    if(!i.customer)return;
    const cur=m.get(i.customer)||{code:"",taxNo:"",address:""};
    if(!cur.code&&i.code)cur.code=i.code;
    if(!cur.taxNo&&i.taxNo)cur.taxNo=i.taxNo;
    if(!cur.address&&i.address)cur.address=i.address;
    m.set(i.customer,cur);
  });
  return m;
}
function showCustSuggest(idx){
  const list=$("#custList"+idx);if(!list)return;
  const q=normStr(state.manualRows[idx].customer);
  const dir=customerDir();
  let names=[...dir.keys()].sort((a,b)=>a.localeCompare(b));
  if(q)names=names.filter(n=>normStr(n).includes(q));
  if(!names.length){
    list.innerHTML=`<div class="man-cust-empty">${q?"没有匹配的已保存客户，可直接录入新客户":"暂无已保存客户"}</div>`;
  }else{
    list.innerHTML=names.slice(0,50).map(n=>{
      const d=dir.get(n);
      return `<div class="man-cust-item" data-name="${esc(n)}"><div class="ci-code">${esc(d.code||"—")}</div><div class="ci-name">${esc(n)}</div></div>`;
    }).join("");
  }
  list.classList.add("open");
  const inp=document.querySelector(`tr[data-idx="${idx}"] input[data-f="customer"]`);
  const rc=inp.getBoundingClientRect();
  list.style.left=rc.left+"px";list.style.top=(rc.bottom+2)+"px";
  list.style.width=Math.max(rc.width,260)+"px";
}
function pickCustomer(idx,name){
  const d=customerDir().get(name);if(!d)return;
  const r=state.manualRows[idx];
  r.customer=name;
  if(d.code)r.code=d.code;
  if(d.taxNo)r.taxNo=d.taxNo;
  if(d.address)r.address=d.address;
  const tr=document.querySelector(`tr[data-idx="${idx}"]`);
  const set=(f,v)=>{const inp=tr.querySelector(`[data-f="${f}"]`);if(inp)inp.value=v;};
  set("customer",name);set("code",r.code);set("taxNo",r.taxNo);set("address",r.address);
  const list=$("#custList"+idx);if(list)list.classList.remove("open");
  updateManSummary();
}
function autoCalcTotal(idx){
  const r=state.manualRows[idx];
  const g=parseAmount(r.goods),t=parseAmount(r.tax);
  if(g>0){r.total=Math.round((g+t)*100)/100;
    const inp=document.querySelector(`tr[data-idx="${idx}"] input[data-f="total"]`);
    if(inp)inp.value=r.total;}
}
function addManualRow(){state.manualRows.push(blankManualRow());renderManual();}
function removeManualRow(idx){state.manualRows.splice(idx,1);renderManual();}
function updateManSummary(){
  const valid=state.manualRows.filter(r=>r.customer&&parseAmount(r.total)>0);
  const sum=valid.reduce((s,r)=>s+(r.currency==="USD"?parseAmount(r.total)*state.fxUSD:parseAmount(r.total)),0);
  const el=$("#manSummary");if(el)el.textContent=`有效 ${valid.length} 行 · 合计约 ${fmtVND(sum)} VND`;
}
async function saveManual(){
  const month=$("#manMonth").value;
  if(!month){alert("请选择对账月份");return;}
  const rows=state.manualRows.filter(r=>r.customer&&parseAmount(r.total)>0);
  if(!rows.length){alert("请至少填写一行：客户名称和含税总额");return;}
  let batch=state.batches.find(b=>b.month===month);
  let batchId;
  if(batch){batchId=batch.id;}
  else{
    batchId=uid();
    batch={id:batchId,month,fileName:"手工录入",importedAt:new Date().toISOString(),count:0};
    await dbPut("batches",batch);
  }
  const allocNow=[];
  for(const r of rows){
    const inv={id:uid(),batchId,month,
      code:r.code.trim(),customer:r.customer.trim(),
      invoiceNo:r.invoiceNo.trim(),date:r.date,
      taxNo:r.taxNo.trim(),address:r.address.trim(),
      goods:parseAmount(r.goods),tax:parseAmount(r.tax),total:parseAmount(r.total),
      currency:r.currency,paidAmount:r.settled?parseAmount(r.total):0,
      fee:0,paidAt:r.settled?todayStr():""};
    await dbPut("invoices",inv);allocNow.push(inv);
    if(r.settled){
      await dbPut("payments",{id:uid(),customer:inv.customer,code:inv.code,
        currency:inv.currency,amount:inv.total,date:todayStr(),fee:0,
        note:"手工录入-现金",allocations:[{invoiceId:inv.id,amount:inv.total,fee:0}]});
    }
  }
  // 更新批次计数
  const allCount=state.invoices.length+allocNow.length;
  batch.count=allCount;
  await dbPut("batches",batch);
  state.manualRows=[blankManualRow()];
  await loadState();
  // 重新计算批次真实计数
  const real=state.invoices.filter(i=>i.batchId===batchId).length;
  await dbPut("batches",{...batch,count:real});
  await loadState();
  openMonthPreview(month);
}
function handleFile(file){
  const reader=new FileReader();
  reader.onload=async e=>{
    const buf=e.target.result;
    const yellowBySheet=await detectYellowRows(buf);
    const wb=XLSX.read(new Uint8Array(buf),{type:"array"});
    const fallbackMonth=guessMonth(file.name);
    const sheets=wb.SheetNames.map((name,si)=>{
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:""});
      const headerRow=findHeaderRow(rows);
      const headers=rows[headerRow].map((h,idx)=>String(h||"列"+(idx+1)));
      const mapping={code:matchCol(headers,COL_KEYS.code),customer:matchCol(headers,COL_KEYS.customer),
        invoiceNo:matchCol(headers,COL_KEYS.invoiceNo),date:matchCol(headers,COL_KEYS.date),
        goods:matchCol(headers,COL_KEYS.goods),tax:matchCol(headers,COL_KEYS.tax),total:matchCol(headers,COL_KEYS.total),
        taxNo:matchCol(headers,COL_KEYS.taxNo),address:matchCol(headers,COL_KEYS.address)};
      const month=guessSheetMonth(name,rows,headerRow,mapping,fallbackMonth);
      return {name,rows,headerRow,headers,mapping,month,yellowRows:yellowBySheet[si]||new Set()};
    });
    state.wizard={fileName:file.name,sheets,activeSheet:0};
    renderWizard();
  };
  reader.readAsArrayBuffer(file);
}
/* 解析 xlsx 内部 XML，按工作簿 sheet 顺序返回各表黄色填充行（1 基行号集合） */
async function detectYellowRows(buf){
  try{
    const u8=new Uint8Array(buf),dv=new DataView(buf);
    let p=u8.length-22;
    while(p>=0&&!(u8[p]===0x50&&u8[p+1]===0x4b&&u8[p+2]===0x05&&u8[p+3]===0x06))p--;
    if(p<0)return [];
    const cdCount=dv.getUint16(p+10,true);
    let cd=dv.getUint32(p+16,true);
    const files={};
    for(let n=0;n<cdCount;n++){
      const method=dv.getUint16(cd+10,true),csize=dv.getUint32(cd+20,true);
      const nlen=dv.getUint16(cd+28,true),elen=dv.getUint16(cd+30,true),clen=dv.getUint16(cd+32,true);
      const name=new TextDecoder().decode(u8.subarray(cd+46,cd+46+nlen));
      const lho=dv.getUint32(cd+42,true);
      const lnlen=dv.getUint16(lho+26,true),lelen=dv.getUint16(lho+28,true);
      const start=lho+30+lnlen+lelen;
      files[name]={method,data:u8.subarray(start,start+csize)};
      cd+=46+nlen+elen+clen;
    }
    const inflate=async en=>{
      if(en.method===0)return new Uint8Array(en.data);
      const out=await new Response(new Blob([en.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return new Uint8Array(out);
    };
    const txtOf=async name=>{
      const key=Object.keys(files).find(k=>k.toLowerCase()===name.toLowerCase());
      if(!key)return null;
      return new TextDecoder().decode(await inflate(files[key]));
    };
    const stylesTxt=await txtOf("xl/styles.xml");
    const wbTxt=await txtOf("xl/workbook.xml");
    const relsTxt=await txtOf("xl/_rels/workbook.xml.rels");
    if(!stylesTxt||!wbTxt)return wb.SheetNames?[]:[];
    const sx=new DOMParser().parseFromString(stylesTxt,"text/xml");
    const isYellowEl=el=>{
      if(!el)return false;
      const rgb=(el.getAttribute("rgb")||"").toUpperCase();
      if(rgb.length>=6&&rgb.slice(-6)==="FFFF00")return true;
      if(el.getAttribute("indexed")==="5")return true;
      return false;
    };
    const yellowFillIds=new Set();
    [...(sx.getElementsByTagName("fills")[0]?.children||[])].forEach((fill,i)=>{
      const pf=fill.getElementsByTagName("patternFill")[0];
      if(!pf)return;
      if(isYellowEl(pf.getElementsByTagName("fgColor")[0])||isYellowEl(pf.getElementsByTagName("bgColor")[0]))yellowFillIds.add(i);
    });
    const xfFills=[...(sx.getElementsByTagName("cellXfs")[0]?.children||[])].map(xf=>parseInt(xf.getAttribute("fillId")||"0"));
    // sheet 顺序 → 工作表文件路径
    const relMap={};
    if(relsTxt){
      [...new DOMParser().parseFromString(relsTxt,"text/xml").getElementsByTagName("Relationship")].forEach(r=>{
        relMap[r.getAttribute("Id")]=r.getAttribute("Target");
      });
    }
    const wbx=new DOMParser().parseFromString(wbTxt,"text/xml");
    const sheetEls=[...wbx.getElementsByTagName("sheet")];
    const result=[];
    for(const se of sheetEls){
      const rid=se.getAttribute("r:id")||[...se.attributes].find(a=>a.localName==="id")?.value;
      let target=relMap[rid]||"";
      if(target.startsWith("/"))target=target.slice(1);
      else if(target&&!target.startsWith("xl/"))target="xl/"+target;
      const key=target?Object.keys(files).find(k=>k.toLowerCase()===target.toLowerCase()):
        Object.keys(files).find(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k));
      const set=new Set();
      if(key&&yellowFillIds.size){
        const wx=new DOMParser().parseFromString(new TextDecoder().decode(await inflate(files[key])),"text/xml");
        [...wx.getElementsByTagName("row")].forEach(row=>{
          const rn=parseInt(row.getAttribute("r"));let hit=false;
          [...row.getElementsByTagName("c")].forEach(c=>{
            const si=parseInt(c.getAttribute("s")||"0");
            if(yellowFillIds.has(xfFills[si]))hit=true;
          });
          if(hit)set.add(rn);
        });
      }
      result.push(set);
    }
    return result;
  }catch(err){console.warn("黄色行识别失败：",err);return [];}
}
const COL_KEYS={
  code:["Mã khách hàng","客户代码","客户编号","客户编码","Mã KH"],
  customer:["Tên công ty","公司名","客户名称","公司","客户","Tên KH","Tên đơn vị"],
  invoiceNo:["Số hóa đơn","发票号","单据号","单号","Số HĐ","Hóa đơn"],
  date:["Ngày lập","日期","开票日期","Ngày","Ngày chứng từ"],
  goods:["Cộng tiền hàng","货款","不含税","Tiền hàng","金额"],
  tax:["Tiền thuế GTGT","税额","增值税","Thuế GTGT","Thuế"],
  total:["Tổng cộng tiền thanh toán","总额","价税合计","应付总额","未收金额","Tổng cộng","Tổng tiền","Thành tiền"],
  taxNo:["Mã số thuế","税号","纳税人识别号","MST"],
  address:["Địa chỉ","地址","ĐC"]
};
function matchCol(headers,kw){for(const k of kw){const i=headers.findIndex(h=>String(h).toLowerCase().includes(k.toLowerCase()));if(i>=0)return i;}return -1;}
function findHeaderRow(rows){
  for(let i=0;i<Math.min(10,rows.length);i++){
    const r=rows[i].map(x=>String(x).toLowerCase());
    if(r.some(c=>c.includes("tên công ty")||c.includes("公司")||c.includes("客户"))&&
       r.some(c=>c.includes("hóa đơn")||c.includes("发票")||c.includes("总额")||c.includes("thành tiền")))return i;
  }return 0;
}
function guessMonth(fileName){
  let m=fileName.match(/(\d{4})[-_.年]?(\d{1,2})月?/);
  if(m)return m[1]+"-"+m[2].padStart(2,"0");
  m=fileName.match(/(\d{1,2})月/);
  if(m)return new Date().getFullYear()+"-"+m[1].padStart(2,"0");
  const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}
function guessSheetMonth(sheetName,rows,headerRow,mapping,fallback){
  const year=fallback.slice(0,4);
  const n=String(sheetName||"").trim();
  let m=n.match(/(\d{4})[-_.年](\d{1,2})/);
  if(m)return m[1]+"-"+m[2].padStart(2,"0");
  m=n.match(/(?:thang|month)\s*(\d{1,2})/i)||n.match(/(\d{1,2})\s*月/);
  if(m)return year+"-"+m[1].padStart(2,"0");
  if(/^\d{1,2}$/.test(n))return year+"-"+n.padStart(2,"0");
  // 从数据行日期里识别（dd/mm/yyyy），取出现次数最多的月份
  if(mapping.date>=0){
    const cnt={};
    for(let i=headerRow+1;i<rows.length;i++){
      const d=String(rows[i][mapping.date]||"");
      const mm=d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
      if(mm){const key=mm[3].slice(-4)+"-"+mm[2].padStart(2,"0");cnt[key]=(cnt[key]||0)+1;}
    }
    const best=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];
    if(best)return best;
  }
  return fallback;
}
function renderWizard(){
  const w=state.wizard;
  $("#dropZone").style.display="none";
  const wz=$("#wizard");wz.style.display="block";
  const monthCount={};
  w.sheets.forEach(s=>{monthCount[s.month]=(monthCount[s.month]||0)+1;});
  const dupMonths=new Set(Object.keys(monthCount).filter(m=>monthCount[m]>1));
  const existingMonths=new Set(w.sheets.map(s=>s.month).filter(m=>state.batches.find(b=>b.month===m)));
  const sheetRows=w.sheets.map((s,i)=>{
    const {out,ignored}=buildParsed(s);
    const sum=out.reduce((a,x)=>a+(x.currency==="USD"?x.total*state.fxUSD:x.total),0);
    const paid=out.filter(x=>x.settled&&!x.cash).length;
    const cash=out.filter(x=>x.cash).length;
    return {i,out,ignored,sum,paid,cash,month:s.month,dup:dupMonths.has(s.month)};
  });
  const totalInv=sheetRows.reduce((a,x)=>a+x.out.length,0);
  const totalPaid=sheetRows.reduce((a,x)=>a+x.paid,0);
  const totalCash=sheetRows.reduce((a,x)=>a+x.cash,0);
  wz.innerHTML=`
    <div class="note-line">📄 ${esc(w.fileName)}，检测到 <b>${w.sheets.length}</b> 个工作表，自动识别月份并逐表导入；<b>黄色底纹行自动标记已收款</b>，<b>无发票号的现金行按现金收入记账</b>，仅无客户无金额的合计行跳过。</div>
    ${[...dupMonths].length?`<div class="warn-line">⚠️ 存在重复月份：${[...dupMonths].map(monthLabel).join("、")}，请修改后再保存。</div>`:""}
    ${[...existingMonths].length?`<div class="warn-line">⚠️ ${[...existingMonths].map(monthLabel).join("、")} 已导入过，确认保存将<b>替换</b>对应月份数据。</div>`:""}
    <div class="panel"><div class="tbl-scroll"><table>
      <thead><tr><th>工作表</th><th>对账月份</th><th class="num">有效记录</th><th class="num">黄色已收</th><th class="num">现金收入</th><th class="num">跳过</th><th class="num">合计(VND口径)</th></tr></thead>
      <tbody>${sheetRows.map(x=>`
        <tr class="sheet-pick ${x.i===w.activeSheet?"active":""}" data-i="${x.i}" style="cursor:pointer">
          <td><b>${esc(w.sheets[x.i].name)}</b></td>
          <td><input type="month" class="sheet-month" data-i="${x.i}" value="${x.month}" style="min-width:150px"> ${x.dup?'<span class="tag unpaid">重复</span>':""}</td>
          <td class="num">${x.out.length}</td>
          <td class="num">${x.paid}</td>
          <td class="num">${x.cash}</td>
          <td class="num">${x.ignored.length}</td>
          <td class="num">${fmtVND(x.sum)}</td>
        </tr>`).join("")}</tbody>
    </table></div></div>
    <div class="muted" style="margin-bottom:10px">共 ${totalInv} 条记录 · 黄色已收 ${totalPaid} 张 · 现金收入 ${totalCash} 条，点击工作表行可查看明细和列映射</div>
    <div id="sheetDetail"></div>
    <div class="flex gap mt">
      <button class="btn primary" onclick="saveWizard()">确认保存全部工作表</button>
      <button class="btn" onclick="cancelWizard()">取消</button>
    </div>`;
  document.querySelectorAll(".sheet-pick").forEach(tr=>{
    tr.addEventListener("click",e=>{
      if(e.target.classList.contains("sheet-month"))return;
      w.activeSheet=parseInt(tr.dataset.i);renderWizard();
    });
  });
  document.querySelectorAll(".sheet-month").forEach(inp=>{
    inp.addEventListener("change",()=>{w.sheets[parseInt(inp.dataset.i)].month=inp.value;renderWizard();});
  });
  renderSheetDetail();
}
function renderSheetDetail(){
  const w=state.wizard,s=w.sheets[w.activeSheet];
  const colOpts=sel=>s.headers.map((h,i)=>`<option value="${i}" ${i===sel?"selected":""}>${esc(h)}</option>`).join("");
  const el=$("#sheetDetail");
  el.innerHTML=`
    <div class="panel"><div class="ph"><h3>工作表「${esc(s.name)}」列映射与预览</h3></div>
    <div class="pb">
      <div class="row2">
        <div class="field"><label>客户代码列</label><select id="m_code">${colOpts(s.mapping.code)}</select></div>
        <div class="field"><label>客户名称列 *</label><select id="m_customer">${colOpts(s.mapping.customer)}</select></div>
        <div class="field"><label>发票号列</label><select id="m_invoiceNo">${colOpts(s.mapping.invoiceNo)}</select></div>
        <div class="field"><label>日期列</label><select id="m_date">${colOpts(s.mapping.date)}</select></div>
        <div class="field"><label>货款列</label><select id="m_goods">${colOpts(s.mapping.goods)}</select></div>
        <div class="field"><label>税额列</label><select id="m_tax">${colOpts(s.mapping.tax)}</select></div>
        <div class="field"><label>含税总额列 *</label><select id="m_total">${colOpts(s.mapping.total)}</select></div>
        <div class="field"><label>税号列</label><select id="m_taxNo">${colOpts(s.mapping.taxNo)}</select></div>
        <div class="field"><label>地址列</label><select id="m_address">${colOpts(s.mapping.address)}</select></div>
      </div>
      <div class="preview-wrap" id="preview"></div>
    </div></div>`;
  ["code","customer","invoiceNo","date","goods","tax","total","taxNo","address"].forEach(k=>{
    $("#m_"+k).onchange=e=>{s.mapping[k]=parseInt(e.target.value);updatePreview(s);};
  });
  updatePreview(s);
}
function buildParsed(s){
  const out=[],ignored=[];
  s.rows.slice(s.headerRow+1).forEach((r,k)=>{
    const sheetRow=s.headerRow+2+k;
    const get=k=>s.mapping[k]>=0?r[s.mapping[k]]:"";
    const invoiceNo=String(get("invoiceNo")||"").trim();
    const customer=String(get("customer")||"").trim();
    const total=parseAmount(get("total"));
    const tail=String(r[r.length-1]||"");
    const currency=/美金|USD/i.test(tail)?"USD":"VND";
    const yellow=(s.yellowRows||new Set()).has(sheetRow);
    if(total===0){ignored.push({reason:"金额为0"});return;}
    // 无发票号但有客户名和金额：现金收入（不开票），直接清款
    if(!invoiceNo){
      if(!customer){ignored.push({reason:"无客户名（合计行）"});return;}
      out.push({code:String(get("code")||"").trim(),customer,invoiceNo:"",date:String(get("date")||"").trim(),
        taxNo:String(get("taxNo")||"").trim(),address:String(get("address")||"").trim(),
        goods:parseAmount(get("goods")),tax:parseAmount(get("tax")),total,currency,settled:true,cash:true,sheetRow});
      return;
    }
    if(!customer){ignored.push({reason:"无客户名"});return;}
    out.push({code:String(get("code")||"").trim(),customer,invoiceNo,date:String(get("date")||"").trim(),
      taxNo:String(get("taxNo")||"").trim(),address:String(get("address")||"").trim(),
      goods:parseAmount(get("goods")),tax:parseAmount(get("tax")),total,currency,settled:yellow,cash:false});
  });
  return {out,ignored};
}
function updatePreview(s){
  const {out,ignored}=buildParsed(s);
  const show=s.rows.slice(s.headerRow+1).slice(0,60);
  const invKeys=new Set(out.filter(x=>!x.cash).map(x=>x.invoiceNo+"|"+x.customer));
  const paidKeys=new Set(out.filter(x=>x.settled&&!x.cash).map(x=>x.invoiceNo+"|"+x.customer));
  const cashRows=new Set(out.filter(x=>x.cash).map(x=>x.sheetRow));
  $("#preview").innerHTML=`<table><thead><tr><th>#</th><th>状态</th>${s.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${show.map((r,idx)=>{
      const sheetRow=s.headerRow+2+idx;
      const inv=String(s.mapping.invoiceNo>=0?r[s.mapping.invoiceNo]:"").trim();
      const cust=String(s.mapping.customer>=0?r[s.mapping.customer]:"").trim();
      const k=inv+"|"+cust;
      let tag,cls;
      if(cashRows.has(sheetRow)){tag='<span class="tag" style="background:#fff7d6;color:#a16207">现金收入</span>';cls="cash-row";}
      else if(invKeys.has(k)){
        const paid=paidKeys.has(k);
        tag=paid?'<span class="tag paid">已收款</span>':'<span class="tag unpaid">未收</span>';
        cls=paid?"yellow-row":"";
      }else{tag='<span class="tag unpaid">跳过</span>';cls="ignored";}
      return `<tr class="${cls}"><td>${idx+1}</td><td>${tag}</td>${s.headers.map((h,ci)=>`<td>${esc(r[ci])}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table>`;
}
async function saveWizard(){
  const w=state.wizard;
  const monthSeen=new Set();
  for(const s of w.sheets){
    if(monthSeen.has(s.month)){alert(monthLabel(s.month)+" 被多个工作表使用，请先修改月份");return;}
    monthSeen.add(s.month);
  }
  await kvSet("fxUSD",state.fxUSD);
  let savedMonths=0;
  for(const s of w.sheets){
    const {out}=buildParsed(s);
    if(!out.length)continue;
    const old=state.batches.find(b=>b.month===s.month);
    if(old){
      const oldIds=new Set(state.invoices.filter(i=>i.batchId===old.id).map(i=>i.id));
      for(const p of state.payments.filter(p=>p.allocations.some(a=>oldIds.has(a.invoiceId))))await dbDel("payments",p.id);
      await dbDel("batches",old.id);
      for(const i of state.invoices.filter(i=>i.batchId===old.id))await dbDel("invoices",i.id);
      state.batches=state.batches.filter(b=>b.id!==old.id);
      state.invoices=state.invoices.filter(i=>i.batchId!==old.id);
      state.payments=state.payments.filter(p=>!p.allocations.some(a=>oldIds.has(a.invoiceId)));
    }
    const batch={id:uid(),month:s.month,fileName:w.fileName+" / "+s.name,importedAt:new Date().toISOString(),count:out.length};
    await dbPut("batches",batch);
    for(const o of out){
      const invId=uid();
      const settled=!!o.settled;
      const {sheetRow,...rest}=o;
      await dbPut("invoices",{id:invId,batchId:batch.id,month:s.month,
        fee:0,paidAmount:settled?o.total:0,paidAt:settled?todayStr():"",...rest,settled:undefined});
      if(settled){
        await dbPut("payments",{id:uid(),customer:o.customer,code:o.code,
          currency:o.currency,amount:o.total,date:todayStr(),fee:0,
          note:o.cash?"Excel现金收入-无发票":"Excel黄色标记-已收款",
          allocations:[{invoiceId:invId,amount:o.total,fee:0}]});
      }
    }
    savedMonths++;
  }
  state.wizard=null;await loadState();
  document.querySelector('[data-view="dashboard"]').click();
}
function cancelWizard(){state.wizard=null;$("#dropZone").style.display="block";$("#wizard").style.display="none";}

/* ============ 数据管理 ============ */
function renderData(c){
  c.innerHTML=`
    <div class="panel">
      <div class="ph"><h3>已导入批次</h3><div class="spacer"></div>
        <button class="btn sm" onclick="backupData()">导出备份</button>
        <button class="btn sm" onclick="$('#restoreFile').click()">恢复备份</button>
        <button class="btn sm danger" onclick="doLogout()">退出登录</button>
        <input type="file" id="restoreFile" accept=".json" style="display:none"></div>
      <div class="tbl-scroll">
        ${state.batches.length?`<table>
          <thead><tr><th>月份</th><th>原始文件</th><th>导入时间</th><th class="num">发票数</th><th class="num">总额</th><th class="num">未收</th><th></th></tr></thead>
          <tbody>${state.batches.slice().sort((a,b)=>b.month.localeCompare(a.month)).map(b=>{
            const inv=state.invoices.filter(i=>i.batchId===b.id);
            return `<tr><td><b>${monthLabel(b.month)}</b></td><td>${esc(b.fileName)}</td>
              <td class="muted">${new Date(b.importedAt).toLocaleString("zh-CN")}</td>
              <td class="num">${b.count}</td>
              <td class="num">${fmtVND(inv.reduce((s,i)=>s+invTotal(i),0))}</td>
              <td class="num red">${fmtVND(inv.reduce((s,i)=>s+invUnpaid(i),0))}</td>
              <td style="white-space:normal"><button class="btn sm" onclick="openMonthPreview('${b.month}')">预览</button>
              <button class="btn sm danger" onclick="deleteBatch('${b.id}')">删除</button></td></tr>`;
          }).join("")}</tbody></table>`:`<div class="empty"><div class="e1">🗂️</div>暂无导入批次</div>`}
      </div></div>
    <div class="panel">
      <div class="ph"><h3>参数设置</h3></div>
      <div class="pb">
        <div class="flex gap">
          <div class="field"><label>美元汇率（USD→VND）</label><input type="number" id="setFx" value="${state.fxUSD}"></div>
          <button class="btn" onclick="saveFx()">保存汇率</button>
        </div>
      </div></div>`;
  $("#restoreFile").onchange=e=>{if(e.target.files[0])restoreData(e.target.files[0]);};
}
async function deleteBatch(id){
  const b=state.batches.find(x=>x.id===id);
  if(!await confirmDelete("确认删除 "+monthLabel(b.month)+" 全部数据（含收款记录）？"))return;
  const invIds=new Set(state.invoices.filter(i=>i.batchId===id).map(i=>i.id));
  for(const p of state.payments.filter(p=>p.allocations.some(a=>invIds.has(a.invoiceId))))await dbDel("payments",p.id);
  await dbDel("batches",id);
  for(const i of state.invoices.filter(i=>i.batchId===id))await dbDel("invoices",i.id);
  await loadState();render();
}
async function saveFx(){
  const v=parseAmount($("#setFx").value);if(!v)return;
  state.fxUSD=v;await kvSet("fxUSD",v);alert("已保存");render();
}
function backupData(){
  const data={version:3,exportedAt:new Date().toISOString(),fxUSD:state.fxUSD,
    batches:state.batches,invoices:state.invoices,payments:state.payments,expenses:state.expenses};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="未收货款备份_"+todayStr()+".json";a.click();
}
async function restoreData(file){
  const text=await file.text();
  if(!confirm("恢复将覆盖当前全部数据，确认？"))return;
  let d;try{d=JSON.parse(text);}catch(err){alert("备份文件无法识别");return;}
  if(!Array.isArray(d.batches)||!Array.isArray(d.invoices)){alert("备份文件无法识别");return;}
  for(const b of d.batches)await dbPut("batches",b);
  for(const i of d.invoices)await dbPut("invoices",i);
  for(const p of d.payments||[])await dbPut("payments",p);
  for(const [month,amount] of Object.entries(d.expenses||{}))await kvSet("expense_"+month,parseAmount(amount));
  if(d.fxUSD)state.fxUSD=d.fxUSD;
  await loadState();render();alert("恢复完成");
}

/* ============ Excel 导出 ============ */
function exportDashboard(){
  const rows=[],mStats=new Map();
  state.invoices.forEach(i=>{
    if(!mStats.has(i.month))mStats.set(i.month,{count:0,cust:new Set(),total:0,paid:0,fee:0,unpaid:0,expense:0});
    const s=mStats.get(i.month);
    s.count++;s.cust.add(i.customer);s.total+=invTotal(i);s.paid+=invPaid(i);s.fee+=invFee(i);s.unpaid+=invUnpaid(i);
  });
  Object.keys(state.expenses).forEach(m=>{
    if(!mStats.has(m))mStats.set(m,{count:0,cust:new Set(),total:0,paid:0,fee:0,unpaid:0,expense:0});
    mStats.get(m).expense=expenseOf(m);
  });
  [...mStats.entries()].sort((a,b)=>state.monthSort==="desc"?b[0].localeCompare(a[0]):a[0].localeCompare(b[0])).forEach(([m,s])=>{
    rows.push({"月份":monthLabel(m),"发票数":s.count,"客户数":s.cust.size,
      "发票总额(VND)":Math.round(s.total),"实际收入(VND)":Math.round(s.paid),
      "手续费(VND)":Math.round(s.fee),"支出总金额(VND)":hasExpense(m)?Math.round(s.expense):"",
      "当月利润(VND)":hasExpense(m)?Math.round(s.paid-s.expense):"","未收(VND)":Math.round(s.unpaid)});
  });
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"月度汇总");
  XLSX.writeFile(wb,"未收货款月度汇总_"+todayStr()+".xlsx");
}
function exportCustomers(){
  const list=filteredInvoices(),map=new Map();
  list.forEach(i=>{
    if(!map.has(i.customer))map.set(i.customer,{code:i.code,customer:i.customer,total:0,paid:0,unpaid:0,fee:0,count:0});
    const s=map.get(i.customer);
    s.total+=invTotal(i);s.paid+=Math.min(invPaid(i),invTotal(i));s.unpaid+=invUnpaid(i);s.fee+=invFee(i);s.count++;
  });
  const summary=[...map.values()].sort((a,b)=>b.unpaid-a.unpaid).map(s=>({
    "客户代码":s.code,"客户名称":s.customer,"发票数":s.count,"发票总额(VND)":Math.round(s.total),
    "实际收入(VND)":Math.round(s.paid),"手续费(VND)":Math.round(s.fee),
    "未收余额(VND)":Math.round(s.unpaid)}));
  const detail=list.map(i=>({"月份":monthLabel(i.month),"客户代码":i.code,"客户名称":i.customer,
    "发票号":i.invoiceNo,"开票日期":i.date,"币种":i.currency,"货款":i.goods,"税额":i.tax,
    "含税总额":i.total,"实际收入":i.paidAmount||0,"手续费":i.fee||0,
    "未收金额":Math.max(0,i.total-(i.paidAmount||0)-(i.fee||0)),
    "状态":i.cash?"现金收入":(invUnpaid(i)<=0?"已清款":((i.paidAmount||0)>0?"部分收款":"未收")),
    "标记":i.mark?MARK_LABEL[i.mark]:""}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),"客户汇总");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),"发票明细");
  XLSX.writeFile(wb,"客户未收明细_"+todayStr()+".xlsx");
}

/* ============ 弹窗 ============ */
function openModal(h){$("#modalBox").innerHTML=h;$("#modalMask").style.display="flex";}
function closeModal(){$("#modalMask").style.display="none";}
$("#modalMask").onclick=e=>{if(e.target.id==="modalMask")closeModal();};

/* ============ 登录与启动 ============ */
async function doLogin(){
  const email=$("#loginEmail").value.trim(), pw=$("#loginPassword").value;
  $("#loginErr").textContent="";
  if(!email||!pw){$("#loginErr").textContent="请输入账号和密码";return;}
  try{ await Cloud.login(email,pw); }
  catch(e){
    const code=e&&e.code||"";
    $("#loginErr").textContent=code.includes("invalid-credential")||code.includes("wrong-password")
      ?"账号或密码错误":(code.includes("network")?"网络不可用，请检查连接":"登录失败，请重试");
  }
}
async function doLogout(){
  if(!confirm("确认退出登录？离线缓存仍保留，重新登录后继续同步。"))return;
  await Cloud.logout();
}
let renderTimer=null;
function scheduleRender(){
  clearTimeout(renderTimer);
  renderTimer=setTimeout(async()=>{await loadState();render();},120);
}
function refreshSideAccount(){
  const el=$("#sideAccount");
  if(el)el.textContent=Cloud.user?Cloud.user.email:"";
}
document.addEventListener("auth-changed",async e=>{
  if(e.detail.user){
    $("#loginMask").style.display="none";
    refreshSideAccount();
    if(!window._dataBound){
      window._dataBound=true;
      Cloud.onData(scheduleRender);
      Cloud.onStatus(updateSyncChip);
    }
  }else{
    $("#loginMask").style.display="flex";
    $("#loginPassword").value="";
    refreshSideAccount();
  }
});
(async function init(){
  while(!window.Cloud) await new Promise(r=>setTimeout(r,50));
  $("#statusFilter").value=state.statusFilter;
  $("#currencyFilter").value=state.currencyFilter;
  await openDB();
  Cloud.onStatus(updateSyncChip);
  if(Cloud.user){await loadState();}
  refreshSideAccount();
  render();
})();
