// src/components/BudgetApp.jsx - v5 (إصلاحات شاملة)

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LayoutDashboard, Calendar, CreditCard, Wallet,
  Target, Settings, Plus, ChevronRight, ChevronLeft,
  DollarSign, ArrowUpCircle, ArrowDownCircle, PiggyBank,
  AlertCircle, CheckCircle, X, Trash2,
  BarChart2, Moon, Sun, Menu,
  Building2, RefreshCw, LogOut, AlertTriangle,
  HandCoins, HandHeart, Repeat, Edit2, ListChecks
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, AreaChart, Area,
  PieChart as RechartsPie, Pie, Cell
} from "recharts";
import { useAuth } from "../lib/auth";
import {
  incomeApi, fixedExpenseApi, variableExpenseApi, savingsApi,
  monthSettingsApi, loansApi, goalsApi,
  recurringIncomeApi, loanPaymentsApi,
  debtsOwedToMeApi, debtsIOweApi,
  balanceConfigApi, priorSavingsV2Api,
  dangerZoneApi, profileApi,
  loanMonthAmountsApi,
  recurringObligationsApi, recurringObligationPaymentsApi,
  balanceTransactionsApi,
} from "../lib/supabase";

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                   "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const EXPENSE_CATEGORIES = ["بنزين","مطعم","بقالة","فواتير وخدمات","ملابس وتسوق شخصي","صحة وأدوية","ترفيه واشتراكات","نقل وتوصيل","تعليم ودورات","هدايا ومناسبات","حلاقة","طلعة شباب","أخرى"];
const GOAL_CATEGORIES = ["احتياج","حاجة","رغبة"];
const GOAL_PRIORITIES = ["عالية","متوسطة","منخفضة"];
const GOAL_STATUS = ["لم يُشترى","قيد التوفير","تم الشراء"];
const DEBT_CATEGORIES = ["بطاقة ائتمانية","تابي","تمارا","مدفوع","أخرى"];
const PALETTE = {
  income:"#22c55e", fixed:"#3b82f6", variable:"#f97316", savings:"#a855f7",
  debt:"#ef4444", remaining:"#14b8a6", owedToMe:"#10b981", iOwe:"#f43f5e", obligation:"#6366f1",
};

let _numberLocale = "en-US";
export const setNumberLocale = (format) => { _numberLocale = format==="arabic" ? "ar-SA-u-nu-arab" : "en-US"; };
const fmt = (n, currency="SAR") => new Intl.NumberFormat(_numberLocale,{style:"currency",currency,minimumFractionDigits:2}).format(n??0);
const fmtPct = (n) => new Intl.NumberFormat(_numberLocale,{style:"percent",minimumFractionDigits:1,maximumFractionDigits:1}).format(n??0);
const fmtNum = (n) => new Intl.NumberFormat(_numberLocale).format(n??0);
const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const diff = Math.round((new Date(dateStr)-new Date())/86400000);
  if (diff<0) return `منتهي منذ ${fmtNum(Math.abs(diff))} يوم`;
  if (diff===0) return "اليوم";
  return `${fmtNum(diff)} يوم`;
};
const addMonths = (dateStr, n) => { const d=new Date(dateStr); d.setMonth(d.getMonth()+n); return d.toISOString().slice(0,10); };
const formatMonthYear = (year, month) => `${MONTHS_AR[month]} ${year}`;
const getLoanMonths = (startDate, count) => {
  if (!startDate||!count) return [];
  const months=[]; const base=new Date(startDate);
  for (let i=0;i<count;i++) {
    const d=new Date(base.getFullYear(),base.getMonth()+i,1);
    months.push({year:d.getFullYear(),month:d.getMonth(),label:formatMonthYear(d.getFullYear(),d.getMonth())});
  }
  return months;
};

// ── حساب ملخص الشهر: لا تضاف الأقساط هنا (تضاف خارجياً بشكل صريح)
const computeMonthSummary = (monthData, prevRemaining=0) => {
  const pureIncome   = monthData.incomeEntries.reduce((s,e)=>s+(e.actual||0),0);
  const carry        = prevRemaining;
  const totalAvail   = pureIncome+carry;
  const fixedTotal   = monthData.fixedExpenses.reduce((s,e)=>s+(e.actual||0),0);
  const varTotal     = monthData.variableExpenses.reduce((s,e)=>s+(e.actual||0),0);
  const savingsTotal = monthData.savingsEntries.reduce((s,e)=>s+(e.actual||0),0);
  const remaining    = totalAvail-fixedTotal-varTotal-savingsTotal;
  const savingsPct   = pureIncome>0 ? savingsTotal/pureIncome : 0;
  const targetMet    = monthData.savingsTargetType==='amount'
    ? savingsTotal>=(monthData.savingsTargetAmount??0)
    : savingsPct>=(monthData.savingsTarget??0);
  return {pureIncome,carry,totalAvail,fixedTotal,varTotal,savingsTotal,remaining,savingsPct,targetMet};
};

// ── حساب القسط المستحق لقرض في شهر/سنة معينة بدقة
const computeLoanMonthlyDue = (loan, year, month, loanMonthAmounts) => {
  if (!loan.start_date||!loan.end_date) return 0;
  // التحقق الصريح: هل هذا الشهر يقع ضمن نطاق القرض؟
  const loanStart = new Date(loan.start_date);
  const loanEnd   = new Date(loan.end_date);
  const checkStart = new Date(year, month, 1);
  const checkEnd   = new Date(year, month+1, 0); // آخر يوم في الشهر
  // القسط يُحتسب فقط إذا كان الشهر المعني داخل [start, end] بالكامل
  const startYM = loanStart.getFullYear()*12 + loanStart.getMonth();
  const endYM   = loanEnd.getFullYear()*12   + loanEnd.getMonth();
  const checkYM = year*12+month;
  if (checkYM < startYM || checkYM > endYM) return 0;
  // تخصيص مبلغ شهري؟
  if (loan.custom_monthly_amounts && loanMonthAmounts?.[loan.id]) {
    const monthDiff = checkYM - startYM;
    const customAmt = loanMonthAmounts[loan.id]?.[monthDiff];
    if (customAmt!==undefined) return customAmt;
  }
  return loan.monthly_payment||0;
};

const debtCategoryLabel = (loan) => loan.debt_category==="أخرى"&&loan.debt_category_custom?loan.debt_category_custom:loan.debt_category||"أخرى";
const toDbRow = (field, entry) => {
  const row={name:entry.name??"",actual:entry.actual??0};
  if (field==="savingsEntries") row.planned=entry.estimated??entry.planned??0;
  else row.estimated=entry.estimated??0;
  if (field==="variableExpenses") row.category=entry.category||null;
  return row;
};
const fromDbRow = (field, row) => field==="savingsEntries"?{...row,estimated:row.planned??0}:row;

// ══════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════
const StatCard=({label,value,sub,color,icon:Icon})=>(
  <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      {Icon&&<div className="p-2 rounded-xl" style={{background:color+"22"}}><Icon size={16} style={{color}}/></div>}
    </div>
    <div className="text-2xl font-bold dark:text-white" style={{color}}>{value}</div>
    {sub&&<div className="text-xs text-gray-400">{sub}</div>}
  </div>
);
const ProgressBar=({value,max,color,label,pct})=>{
  const percent=max>0?Math.min((value/max)*100,100):0;
  return(<div className="flex flex-col gap-1">
    {label&&<div className="flex justify-between text-xs text-gray-500"><span>{label}</span><span>{pct??`${percent.toFixed(0)}%`}</span></div>}
    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{width:`${percent}%`,background:color}}/>
    </div>
  </div>);
};
const Modal=({open,onClose,title,children})=>{
  if (!open) return null;
  return(<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
    <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
        <h3 className="text-lg font-bold text-gray-800 dark:text-white">{title}</h3>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"><X size={20} className="text-gray-400"/></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>);
};
const Field=({label,type="text",value,onChange,placeholder,suffix,options,required,hint})=>(
  <div className="flex flex-col gap-1.5">
    {label&&<label className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}{required&&<span className="text-red-400 mr-1">*</span>}</label>}
    {hint&&<p className="text-xs text-gray-400">{hint}</p>}
    {options
      ?<select value={value} onChange={e=>onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"><option value="">اختر...</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
      :<div className="relative"><input type={type} value={type==="number"&&value===0?"":(value??"")} onChange={e=>onChange(type==="number"?parseFloat(e.target.value)||0:e.target.value)} placeholder={placeholder} min={type==="number"?0:undefined} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"/>{suffix&&<span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{suffix}</span>}</div>}
  </div>
);
const EntryRow=({entry,onUpdate,onDelete,showCategory})=>(
  <div className="grid grid-cols-12 gap-2 items-center py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
    <div className="col-span-4"><input value={entry.name||""} onChange={e=>onUpdate({...entry,name:e.target.value})} placeholder="البند" className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400"/></div>
    <div className="col-span-3"><input type="number" value={entry.estimated||""} onChange={e=>onUpdate({...entry,estimated:parseFloat(e.target.value)||0})} placeholder="المتوقع" className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400"/></div>
    <div className="col-span-3"><input type="number" value={entry.actual||""} onChange={e=>onUpdate({...entry,actual:parseFloat(e.target.value)||0})} placeholder="الفعلي" className={`w-full px-2 py-1.5 text-sm rounded-lg border bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400 ${showCategory&&entry.actual>entry.estimated&&entry.estimated>0?"border-red-400":"border-gray-200 dark:border-gray-700"}`}/></div>
    <div className="col-span-2 flex justify-end"><button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button></div>
    {showCategory&&<div className="col-span-12"><select value={entry.category||""} onChange={e=>onUpdate({...entry,category:e.target.value})} className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none"><option value="">التصنيف...</option>{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>}
  </div>
);
function SectionTable({title,color,icon:Icon,entries,onUpdate,onDelete,onAdd,total,showCategory}){
  const [open,setOpen]=useState(true);
  const normalEntries=entries.filter(e=>!e._isLoan);
  const loanEntries=entries.filter(e=>e._isLoan);
  return(<div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
    <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between p-5 hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <div className="flex items-center gap-2"><div className="p-1.5 rounded-lg" style={{background:color+"22"}}><Icon size={16} style={{color}}/></div><span className="font-semibold text-gray-700 dark:text-white text-sm">{title}</span></div>
      <div className="flex items-center gap-3"><span className="font-bold text-sm" style={{color}}>{fmt(total)}</span><ChevronRight size={16} className={`text-gray-400 transition-transform ${open?"rotate-90":""}`}/></div>
    </button>
    {open&&<div className="px-5 pb-5">
      <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-gray-400 px-1"><div className="col-span-4">البند</div><div className="col-span-3">المتوقع</div><div className="col-span-3">الفعلي</div></div>
      {normalEntries.map(e=><EntryRow key={e.id} entry={e} onUpdate={onUpdate} onDelete={()=>onDelete(e.id)} showCategory={showCategory}/>)}
      {loanEntries.length>0&&<>
        <div className="my-2 flex items-center gap-2"><div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"/><span className="text-xs text-gray-400 shrink-0 px-2">أقساط مستحقة هذا الشهر</span><div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"/></div>
        {loanEntries.map(e=>(
          <div key={e.id} className={`flex items-center justify-between py-2.5 px-3 rounded-xl mb-1.5 ${e._paid&&e._prepaid?"bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900":e._paid?"bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900":"bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900"}`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${e._paid&&e._prepaid?"bg-blue-400":e._paid?"bg-green-500":"bg-orange-400"}`}/>
              <span className="text-sm text-gray-700 dark:text-white">{e.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-gray-700 dark:text-white">{fmt(e.actual)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${e._paid&&e._prepaid?"bg-blue-100 dark:bg-blue-900/30 text-blue-600":e._paid?"bg-green-100 dark:bg-green-900/30 text-green-600":"bg-orange-100 dark:bg-orange-900/30 text-orange-600"}`}>
                {e._paid&&e._prepaid?"مسدد مسبقاً":e._paid?"مسدد":"غير مسدد"}
              </span>
            </div>
          </div>
        ))}
      </>}
      <button onClick={onAdd} className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 hover:border-indigo-300 hover:text-indigo-400 text-sm"><Plus size={14}/>إضافة بند</button>
      <div className="flex justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700"><span className="text-sm font-medium text-gray-500">الإجمالي</span><span className="font-bold text-sm" style={{color}}>{fmt(total)}</span></div>
    </div>}
  </div>);
}

// ── دوائر السداد - مع منطق صحيح للعكس
function MonthCircles({payments, onToggle, loanMonths}){
  const [pendingMonth, setPendingMonth] = useState(null);
  return(<div className="flex gap-1.5 flex-wrap mt-3">
    {loanMonths.map((m,i)=>{
      const pData = payments?.[i];
      const paid  = pData?.is_paid;
      const isPrepaid = pData?.payment_type==='prepaid';
      return(
        <button key={i}
          onClick={()=>{ if (!paid) setPendingMonth(i); else onToggle(i, false, pData?.payment_type||'now'); }}
          title={`${m.label}${paid?(isPrepaid?" (مسبق)":" (مسدد)"):""}`}
          className={`w-9 h-9 rounded-full flex flex-col items-center justify-center transition-all
            ${paid&&isPrepaid?"bg-blue-400 text-white":paid?"bg-green-500 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}>
          <span className="text-[9px] font-bold leading-tight">{MONTHS_AR[m.month].slice(0,3)}</span>
          <span className="text-[8px] opacity-70">{String(m.year).slice(2)}</span>
        </button>
      );
    })}
    {pendingMonth!==null&&(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 w-80 shadow-2xl">
          <h3 className="font-bold text-gray-800 dark:text-white mb-1 text-sm">{loanMonths[pendingMonth]?.label}</h3>
          <p className="text-xs text-gray-400 mb-4">كيف تم تسديد هذه الدفعة؟</p>
          <div className="space-y-2">
            <button onClick={()=>{onToggle(pendingMonth,true,'prepaid');setPendingMonth(null);}}
              className="w-full py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 text-sm font-medium text-right px-4">
              ✓ تم تسديدها مسبقاً <span className="text-xs opacity-60">(لا تؤثر على رصيدك)</span>
            </button>
            <button onClick={()=>{onToggle(pendingMonth,true,'now');setPendingMonth(null);}}
              className="w-full py-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 text-sm font-medium text-right px-4">
              ✓ تم توك تسديدها الآن <span className="text-xs opacity-60">(تُخصم من رصيدك)</span>
            </button>
            <button onClick={()=>setPendingMonth(null)} className="w-full py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300 text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">إلغاء</button>
          </div>
        </div>
      </div>
    )}
  </div>);
}

function ConfirmDangerModal({open,onClose,onConfirm,title,message,confirmWord}){
  const [typed,setTyped]=useState(""); const [step,setStep]=useState(1);
  useEffect(()=>{if(open){setStep(1);setTyped("");}},[open]);
  return(<Modal open={open} onClose={onClose} title={title}>
    {step===1&&<div className="space-y-4"><div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100"><AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5"/><p className="text-sm text-red-600 dark:text-red-400">{message}</p></div><div className="flex gap-3"><button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm">إلغاء</button><button onClick={()=>setStep(2)} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm">متابعة الحذف</button></div></div>}
    {step===2&&<div className="space-y-4"><p className="text-sm text-gray-600 dark:text-gray-300">للتأكيد اكتب <span className="font-bold text-red-500">{confirmWord}</span>:</p><input value={typed} onChange={e=>setTyped(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-red-200 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none" placeholder={confirmWord}/><div className="flex gap-3"><button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm">إلغاء</button><button disabled={typed!==confirmWord} onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm">حذف كل شيء نهائياً</button></div></div>}
  </Modal>);
}

// ── نموذج القرض المحدّث: خيارين واضحين (متساوي / غير متساوي)
function LoanForm({initial, onSave}){
  const def = {
    name:"", total_amount:0, start_date:"",
    payment_type_mode:"equal",        // 'equal' | 'custom'
    months_count:"", monthly_payment_input:"",
    debt_category:"أخرى", debt_category_custom:"",
    payment_day_of_month:"", notes:"",
    has_first_payment:false, first_payment_amount:0,
  };
  const [form, setForm] = useState(initial ? {
    ...def, ...initial,
    months_count: initial.months_count||"",
    monthly_payment_input: initial.monthly_payment_input||"",
    payment_type_mode: initial.custom_monthly_amounts ? "custom" : "equal",
  } : def);
  const [customAmounts, setCustomAmounts] = useState([]);
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  // حساب تلقائي
  // إذا كانت هناك دفعة أولى: المبلغ المتبقي يوزّع على باقي الأشهر
  const remainingAfterFirst = form.has_first_payment
    ? Math.max(0, (form.total_amount||0)-(form.first_payment_amount||0))
    : (form.total_amount||0);

  const monthlyPayment = (() => {
    const months = parseFloat(form.months_count)||0;
    if (months > 0 && remainingAfterFirst > 0) {
      const installMonths = form.has_first_payment ? Math.max(1, months-1) : months;
      return remainingAfterFirst / installMonths;
    }
    if (form.monthly_payment_input) return parseFloat(form.monthly_payment_input)||0;
    return 0;
  })();

  const effectiveMonths = (() => {
    if (form.months_count) return parseFloat(form.months_count)||0;
    if (form.monthly_payment_input && remainingAfterFirst) {
      const installMonthsCalc = Math.ceil(remainingAfterFirst / (parseFloat(form.monthly_payment_input)||1));
      return form.has_first_payment ? installMonthsCalc + 1 : installMonthsCalc;
    }
    return 0;
  })();

  const endDate = form.start_date && effectiveMonths ? addMonths(form.start_date, effectiveMonths-1) : "";
  const loanMonths = getLoanMonths(form.start_date, effectiveMonths);

  useEffect(()=>{
    if (form.payment_type_mode==="custom" && loanMonths.length>0 && customAmounts.length!==loanMonths.length) {
      setCustomAmounts(loanMonths.map((_,i)=>{
        if (form.has_first_payment && i===0) return form.first_payment_amount||0;
        return customAmounts[i] ?? monthlyPayment;
      }));
    }
  },[form.payment_type_mode, loanMonths.length, form.has_first_payment]);

  const installMonths = form.has_first_payment ? Math.max(1, effectiveMonths-1) : effectiveMonths;

  return(<div className="space-y-4">
    <Field label="اسم الدين / القرض" value={form.name} onChange={v=>f("name",v)} required/>
    <Field label="نوع الدين" value={form.debt_category} options={DEBT_CATEGORIES} onChange={v=>f("debt_category",v)}/>
    {form.debt_category==="أخرى"&&<Field label="حدد النوع" value={form.debt_category_custom} onChange={v=>f("debt_category_custom",v)} placeholder="اكتب نوع الدين..."/>}
    <Field label="المبلغ الإجمالي" type="number" value={form.total_amount} onChange={v=>f("total_amount",v)} suffix="ر.س"/>
    <Field label="تاريخ بداية التقسيط (أول دفعة)" type="date" value={form.start_date} onChange={v=>f("start_date",v)}/>
    <Field label="يوم السداد من كل شهر (اختياري)" type="number" value={form.payment_day_of_month} onChange={v=>f("payment_day_of_month",v)} placeholder="مثال: 5"/>

    {/* خيار نوع الدفعات */}
    <div>
      <label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-2">نوع الدفعات</label>
      <div className="flex gap-2">
        {[{v:"equal",l:"دفعات متساوية"},{v:"custom",l:"دفعات غير متساوية"}].map(opt=>(
          <button key={opt.v} onClick={()=>f("payment_type_mode",opt.v)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${form.payment_type_mode===opt.v?"bg-indigo-600 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>
            {opt.l}
          </button>
        ))}
      </div>
    </div>

    {/* دفعة أولى */}
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.has_first_payment} onChange={e=>f("has_first_payment",e.target.checked)} className="rounded"/>
        <span className="text-sm font-medium text-gray-700 dark:text-white">يوجد دفعة أولى (Down Payment)</span>
      </label>
      {form.has_first_payment&&(
        <div className="space-y-2">
          <Field label="مبلغ الدفعة الأولى" type="number" value={form.first_payment_amount} onChange={v=>f("first_payment_amount",v)} suffix="ر.س"/>
          <p className="text-xs text-gray-400">الدفعة الأولى تُعامَل كباقي الدفعات — ستُسأل عن طريقة سدادها عند الضغط على الدائرة الخاصة بها.</p>
          {form.total_amount>0&&form.first_payment_amount>0&&(
            <div className="text-xs p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
              المتبقي للتقسيط: {fmt(remainingAfterFirst)}
            </div>
          )}
        </div>
      )}
    </div>

    {/* عدد الأشهر / المبلغ الشهري */}
    {form.payment_type_mode==="equal"&&(
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="عدد الأشهر (إجمالي)" type="number" value={form.months_count} onChange={v=>f("months_count",v)} placeholder="مثال: 12"/>
          <Field label="القسط الشهري" type="number" value={form.monthly_payment_input} onChange={v=>f("monthly_payment_input",v)} placeholder="أو المبلغ..."/>
        </div>
        <p className="text-xs text-gray-400">يكفي إدخال واحد — النظام يحسب الآخر تلقائياً.</p>
      </>
    )}

    {/* ملخص الحساب */}
    {(monthlyPayment>0||effectiveMonths>0)&&(
      <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl text-sm space-y-1">
        {form.has_first_payment&&<div className="flex justify-between"><span className="text-gray-500">الدفعة الأولى:</span><span className="font-bold text-indigo-600">{fmt(form.first_payment_amount)}</span></div>}
        <div className="flex justify-between"><span className="text-gray-500">{form.has_first_payment?"القسط الشهري (باقي الأشهر):":"الدفعة الشهرية:"}</span><span className="font-bold text-indigo-600">{fmt(monthlyPayment)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">إجمالي عدد الأشهر:</span><span className="font-bold text-indigo-600">{effectiveMonths}</span></div>
        {form.has_first_payment&&<div className="flex justify-between"><span className="text-gray-500">أشهر التقسيط:</span><span className="font-bold text-indigo-600">{installMonths}</span></div>}
        {endDate&&<div className="flex justify-between"><span className="text-gray-500">تاريخ الانتهاء:</span><span className="font-bold text-indigo-600">{endDate}</span></div>}
      </div>
    )}

    {/* تخصيص مبالغ الأشهر (للدفعات غير المتساوية) */}
    {form.payment_type_mode==="custom"&&effectiveMonths>0&&(
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-medium text-gray-700 dark:text-white">مبلغ كل شهر على حدة</h4>
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {loanMonths.map((m,i)=>(
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">{m.label}{i===0&&form.has_first_payment&&<span className="text-indigo-400"> (أولى)</span>}</span>
              <input type="number" value={customAmounts[i]??0}
                onChange={e=>{const a=[...customAmounts];a[i]=parseFloat(e.target.value)||0;setCustomAmounts(a);}}
                className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white focus:outline-none"/>
              <span className="text-xs text-gray-400">ر.س</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-700">
          الإجمالي: <span className="font-bold text-indigo-600">{fmt(customAmounts.reduce((s,a)=>s+(a||0),0))}</span>
          {" / المطلوب: "}<span className="font-bold">{fmt(form.total_amount)}</span>
        </div>
      </div>
    )}

    <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)} placeholder="اختياري..."/>
    <button onClick={()=>{
      const isCustom = form.payment_type_mode==="custom";
      onSave({
        ...form,
        monthly_payment: monthlyPayment,
        months_count: effectiveMonths,
        end_date: endDate,
        payment_day_of_month: form.payment_day_of_month ? parseInt(form.payment_day_of_month) : null,
        custom_monthly_amounts: isCustom,
        _customAmounts: isCustom ? customAmounts.map((amount,i)=>({month_index:i,amount})) : [],
      });
    }} disabled={!form.name||!form.total_amount||!form.start_date||effectiveMonths<1} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors">
      حفظ
    </button>
  </div>);
}

// ── نماذج الديون الشخصية - مع سؤال أثر الرصيد عند التسجيل
function DebtOwedToMeForm({initial, onSave}){
  const [form, setForm] = useState(initial||{debtor_name:"",amount:0,given_date:"",due_date:"",notes:"",deduct_on_create:false});
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(<div className="space-y-4">
    <Field label="اسم المدين (من أقرضته)" value={form.debtor_name} onChange={v=>f("debtor_name",v)} required/>
    <Field label="المبلغ" type="number" value={form.amount} onChange={v=>f("amount",v)} suffix="ر.س"/>
    <Field label="تاريخ الإعطاء" type="date" value={form.given_date} onChange={v=>f("given_date",v)}/>
    <Field label="تاريخ السداد المتوقع" type="date" value={form.due_date} onChange={v=>f("due_date",v)}/>
    <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/>
    {!initial&&(
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">هل تريد خصم هذا المبلغ من رصيدك الحالي؟</p>
        <div className="flex gap-2">
          <button onClick={()=>f("deduct_on_create",true)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${form.deduct_on_create?"bg-amber-500 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>نعم، اخصم</button>
          <button onClick={()=>f("deduct_on_create",false)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${!form.deduct_on_create?"bg-amber-500 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>لا</button>
        </div>
      </div>
    )}
    <button onClick={()=>onSave(form)} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium">حفظ</button>
  </div>);
}

function DebtIOweForm({initial, onSave}){
  const [form, setForm] = useState(initial||{creditor_name:"",amount:0,received_date:"",due_date:"",notes:"",add_on_create:false});
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(<div className="space-y-4">
    <Field label="اسم الدائن (من اقترضت منه)" value={form.creditor_name} onChange={v=>f("creditor_name",v)} required/>
    <Field label="المبلغ" type="number" value={form.amount} onChange={v=>f("amount",v)} suffix="ر.س"/>
    <Field label="تاريخ الاستلام" type="date" value={form.received_date} onChange={v=>f("received_date",v)}/>
    <Field label="تاريخ السداد المتوقع" type="date" value={form.due_date} onChange={v=>f("due_date",v)}/>
    <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/>
    {!initial&&(
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">هل تريد إضافة هذا المبلغ إلى رصيدك الحالي؟</p>
        <div className="flex gap-2">
          <button onClick={()=>f("add_on_create",true)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${form.add_on_create?"bg-amber-500 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>نعم، أضف</button>
          <button onClick={()=>f("add_on_create",false)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${!form.add_on_create?"bg-amber-500 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>لا</button>
        </div>
      </div>
    )}
    <button onClick={()=>onSave(form)} className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium">حفظ</button>
  </div>);
}

function GoalForm({initial,onSave}){
  const [form,setForm]=useState(initial||{name:"",estimated_cost:0,category:"رغبة",priority:"متوسطة",status:"لم يُشترى",notes:""});
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(<div className="space-y-4"><Field label="اسم الشيء" value={form.name} onChange={v=>f("name",v)} required/><Field label="التكلفة التقديرية" type="number" value={form.estimated_cost} onChange={v=>f("estimated_cost",v)} suffix="ر.س"/><div className="grid grid-cols-3 gap-3"><Field label="النوع" value={form.category} options={GOAL_CATEGORIES} onChange={v=>f("category",v)}/><Field label="الأولوية" value={form.priority} options={GOAL_PRIORITIES} onChange={v=>f("priority",v)}/><Field label="الحالة" value={form.status} options={GOAL_STATUS} onChange={v=>f("status",v)}/></div><Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/><button onClick={()=>onSave(form)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium">حفظ</button></div>);
}
function RecurringIncomeForm({initial,onSave}){
  const [form,setForm]=useState(initial||{name:"الراتب الشهري",amount:0,payment_day_of_month:""});
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(<div className="space-y-4"><Field label="اسم الدخل الثابت" value={form.name} onChange={v=>f("name",v)} required/><Field label="المبلغ الشهري" type="number" value={form.amount} onChange={v=>f("amount",v)} suffix="ر.س"/><Field label="يوم النزول (اختياري)" type="number" value={form.payment_day_of_month} onChange={v=>f("payment_day_of_month",v)} placeholder="مثال: 27"/><button onClick={()=>onSave({...form,payment_day_of_month:form.payment_day_of_month?parseInt(form.payment_day_of_month):null})} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium">حفظ</button></div>);
}
function RecurringObligationForm({initial,onSave}){
  const [form,setForm]=useState(initial||{name:"",estimated_amount:0,due_day:"",start_date:"",recurrence_type:"infinite",recurrence_months:"",notes:""});
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(<div className="space-y-4">
    <Field label="اسم الالتزام" value={form.name} onChange={v=>f("name",v)} required placeholder="مثال: فاتورة النت..."/>
    <Field label="المبلغ التقديري" type="number" value={form.estimated_amount} onChange={v=>f("estimated_amount",v)} suffix="ر.س"/>
    <Field label="يوم الاستحقاق (اختياري)" type="number" value={form.due_day} onChange={v=>f("due_day",v)} placeholder="مثال: 15"/>
    <Field label="تاريخ البداية" type="date" value={form.start_date} onChange={v=>f("start_date",v)}/>
    <div><label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-2">نوع التكرار</label>
      <div className="flex gap-2">{[{v:"infinite",l:"إلى ما لا نهاية"},{v:"count",l:"عدد أشهر محدد"}].map(opt=>(<button key={opt.v} onClick={()=>f("recurrence_type",opt.v)} className={`flex-1 py-2 rounded-xl text-xs font-medium ${form.recurrence_type===opt.v?"bg-indigo-600 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>{opt.l}</button>))}</div>
      {form.recurrence_type==="count"&&<Field label="عدد الأشهر" type="number" value={form.recurrence_months} onChange={v=>f("recurrence_months",v)} placeholder="مثال: 12"/>}
    </div>
    <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/>
    <button onClick={()=>onSave({...form,due_day:form.due_day?parseInt(form.due_day):null,recurrence_months:form.recurrence_months?parseInt(form.recurrence_months):null})} disabled={!form.name||!form.start_date} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl font-medium">حفظ</button>
  </div>);
}
function QuickAdd({onAdd}){
  const [type,setType]=useState("variableExpenses");
  const [form,setForm]=useState({name:"",actual:0,estimated:0,category:""});
  const types=[{value:"incomeEntries",label:"دخل",color:PALETTE.income},{value:"fixedExpenses",label:"التزام",color:PALETTE.fixed},{value:"variableExpenses",label:"مصروف",color:PALETTE.variable},{value:"savingsEntries",label:"ادخار",color:PALETTE.savings}];
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(<div className="space-y-4"><div className="grid grid-cols-4 gap-2">{types.map(t=>(<button key={t.value} onClick={()=>{setType(t.value);setForm({name:"",actual:0,estimated:0,category:"",});}} className="py-2.5 rounded-xl text-sm font-medium" style={type===t.value?{background:t.color,color:"white"}:{background:"#f3f4f6",color:"#6b7280"}}>{t.label}</button>))}</div><Field label="اسم البند" value={form.name} onChange={v=>f("name",v)} required/><Field label="المبلغ الفعلي" type="number" value={form.actual} onChange={v=>f("actual",v)} suffix="ر.س"/><Field label="المبلغ المتوقع" type="number" value={form.estimated} onChange={v=>f("estimated",v)} suffix="ر.س"/>{type==="variableExpenses"&&<Field label="التصنيف" value={form.category} options={EXPENSE_CATEGORIES} onChange={v=>f("category",v)}/>}<button onClick={()=>{if(!form.name) return;onAdd(type,form);setForm({name:"",actual:0,estimated:0,category:"",});}} disabled={!form.name} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl font-medium">إضافة</button></div>);
}

// ── Obligations Sidebar مع إصلاح عكس العملية
function ObligationsSidebar({open,onClose,obligations,obligationPayments,onAddObligation,onEditObligation,onDeleteObligation,onTogglePayment,currentYear,currentMonth}){
  const [showForm,setShowForm]=useState(false);
  const [editingObl,setEditingObl]=useState(null);
  const isActive=(obl)=>{
    if(!obl.start_date||!obl.active) return false;
    const startD=new Date(obl.start_date);
    const checkYM=currentYear*12+currentMonth;
    const startYM=startD.getFullYear()*12+startD.getMonth();
    if(checkYM<startYM) return false;
    if(obl.recurrence_type==='count'&&obl.recurrence_months){
      const endYM=startYM+obl.recurrence_months-1;
      if(checkYM>endYM) return false;
    }
    return true;
  };
  const activeObls=obligations.filter(o=>isActive(o));
  const estTotal=activeObls.reduce((s,o)=>s+(o.estimated_amount||0),0);
  const actTotal=activeObls.reduce((s,o)=>{const p=obligationPayments[`${o.id}-${currentYear}-${currentMonth}`];return s+(p?.is_paid?(p.actual_amount??o.estimated_amount??0):0);},0);
  return(<>
    {open&&<div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose}/>}
    <aside className={`fixed inset-y-0 left-0 z-40 w-80 bg-white dark:bg-gray-900 shadow-2xl transform transition-transform duration-300 ${open?"translate-x-0":"-translate-x-full"}`} dir="rtl">
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2"><ListChecks size={18} className="text-indigo-500"/><h2 className="font-bold text-gray-800 dark:text-white">الالتزامات المتكررة</h2></div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} className="text-gray-400"/></button>
        </div>
        <div className="px-4 py-3 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800">
          <p className="text-xs text-indigo-500 font-medium">{formatMonthYear(currentYear,currentMonth)}</p>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-500">تقديري: <span className="font-bold text-indigo-600">{fmt(estTotal)}</span></span>
            <span className="text-gray-500">فعلي: <span className="font-bold text-green-600">{fmt(actTotal)}</span></span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {obligations.length===0&&!showForm&&<div className="text-center py-8 text-gray-400 text-sm">لا توجد التزامات مضافة</div>}
          {obligations.map(obl=>{
            const active=isActive(obl);
            const pKey=`${obl.id}-${currentYear}-${currentMonth}`;
            const pData=obligationPayments[pKey];
            const isPaid=pData?.is_paid;
            return(<div key={obl.id} className={`rounded-xl border p-3 ${active?"border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800":"border-gray-100 dark:border-gray-800 opacity-50"}`}>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-1"><span className="text-sm font-medium text-gray-700 dark:text-white">{obl.name}</span>{!active&&<span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded">غير نشط</span>}</div>
                  {obl.due_day&&<div className="text-[11px] text-gray-400">يوم {fmtNum(obl.due_day)} من كل شهر</div>}
                  <div className="text-[11px] text-gray-400">{obl.recurrence_type==='infinite'?'متكرر باستمرار':`${obl.recurrence_months} شهر`}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-indigo-600">{fmt(obl.estimated_amount)}</span>
                  <button onClick={()=>{setEditingObl(obl);setShowForm(false);}} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-300 hover:text-indigo-400"><Edit2 size={13}/></button>
                  <button onClick={()=>onDeleteObligation(obl.id)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={13}/></button>
                </div>
              </div>
              {active&&(
                <div className="mt-2 flex items-center gap-2">
                  {/* زر السداد - مع عكس العملية عند الإلغاء */}
                  <button
                    onClick={()=>onTogglePayment(obl, !isPaid, pData?.actual_amount??obl.estimated_amount)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${isPaid?"bg-green-100 dark:bg-green-900/30 text-green-600":"bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"}`}>
                    {isPaid?"✓ مسدّد — اضغط لإلغاء السداد":"تأكيد السداد"}
                  </button>
                  {isPaid&&(
                    <input type="number" value={pData?.actual_amount??obl.estimated_amount}
                      onChange={e=>onTogglePayment(obl,true,parseFloat(e.target.value)||0)}
                      className="w-24 px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white focus:outline-none"/>
                  )}
                </div>
              )}
            </div>);
          })}
          {(showForm||editingObl)&&(
            <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 bg-indigo-50 dark:bg-indigo-900/10">
              <h4 className="text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-3">{editingObl?"تعديل الالتزام":"التزام جديد"}</h4>
              <RecurringObligationForm initial={editingObl||undefined} onSave={async data=>{
                if (editingObl) { await onEditObligation(editingObl.id,data); setEditingObl(null); }
                else { await onAddObligation(data); setShowForm(false); }
              }}/>
              <button onClick={()=>{setShowForm(false);setEditingObl(null);}} className="mt-2 text-xs text-gray-400 w-full text-center">إلغاء</button>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={()=>{setShowForm(true);setEditingObl(null);}} className="w-full py-2.5 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium">
            <Plus size={16}/>إضافة التزام
          </button>
        </div>
      </div>
    </aside>
  </>);
}

// ── موديل تأكيد سداد / استلام الديون الشخصية
function SettlementModal({open,debt,debtType,onConfirm,onClose}){
  const [affectsBalance,setAffectsBalance]=useState(false);
  if (!open||!debt) return null;
  const isOwedToMe=debtType==='owed_to_me';
  return(<Modal open={open} onClose={onClose} title={isOwedToMe?"تأكيد استلام الدين":"تأكيد سداد الدين"}>
    <div className="space-y-4">
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
        <div className="text-sm text-gray-500">{isOwedToMe?debt.debtor_name:debt.creditor_name}</div>
        <div className="text-2xl font-bold mt-1" style={{color:isOwedToMe?PALETTE.owedToMe:PALETTE.iOwe}}>{fmt(debt.amount)}</div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-white mb-2">
          هل تريد {isOwedToMe?"إضافة المبلغ إلى":"خصم المبلغ من"} رصيدك الفعلي؟
        </p>
        <div className="flex gap-2">
          <button onClick={()=>setAffectsBalance(true)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${affectsBalance?"bg-indigo-600 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>
            نعم، {isOwedToMe?"أضف للرصيد":"اخصم من الرصيد"}
          </button>
          <button onClick={()=>setAffectsBalance(false)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${!affectsBalance?"bg-indigo-600 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>
            لا، بدون تأثير
          </button>
        </div>
      </div>
      <button onClick={()=>onConfirm(affectsBalance)} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium">تأكيد</button>
    </div>
  </Modal>);
}

// ══════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════
export default function BudgetApp(){
  const {user,profile,signOut}=useAuth();
  const userId=user?.id;
  const [dark,setDark]=useState(false);
  const [numberFormat,setNumberFormatState]=useState("western");
  const [nav,setNav]=useState("dashboard");
  const [sideOpen,setSideOpen]=useState(false);
  const [obligationsSideOpen,setObligationsSideOpen]=useState(false);
  const [currentYear,setCurrentYear]=useState(new Date().getFullYear());
  const [currentMonth,setCurrentMonth]=useState(new Date().getMonth());
  const [dataLoading,setDataLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [toast,setToast]=useState(null);
  const [monthCache,setMonthCache]=useState({});
  const [loans,setLoans]=useState([]);
  const [loanPaymentsMap,setLoanPaymentsMap]=useState({});
  const [loanMonthAmountsMap,setLoanMonthAmountsMap]=useState({});
  const [debtsOwedToMe,setDebtsOwedToMe]=useState([]);
  const [debtsIOwe,setDebtsIOwe]=useState([]);
  const [goals,setGoals]=useState([]);
  const [recurringIncomes,setRecurringIncomes]=useState([]);
  const [recurringOverrides,setRecurringOverrides]=useState({});
  const [balanceConfig,setBalanceConfig]=useState({start_month:0,start_year:new Date().getFullYear(),start_balance:0,current_balance:0});
  const [priorSavings,setPriorSavings]=useState([]);
  const [obligations,setObligations]=useState([]);
  const [obligationPayments,setObligationPayments]=useState({});
  const [settlementModal,setSettlementModal]=useState(null);

  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),3000);};

  useEffect(()=>{
    if(!profile) return;
    setDark(!!profile.dark_mode);
    const sf=profile.number_format||"western";
    setNumberFormatState(sf); setNumberLocale(sf);
  },[profile]);

  const toggleDark=async()=>{const v=!dark;setDark(v);try{await profileApi.update(userId,{dark_mode:v});}catch(e){}};
  const changeNumberFormat=async(f)=>{setNumberFormatState(f);setNumberLocale(f);try{await profileApi.update(userId,{number_format:f});}catch(e){}};

  // ── الرصيد الفعلي الحالي
  const currentBalance = balanceConfig.current_balance ?? balanceConfig.start_balance ?? 0;

  // ── تحديث الرصيد مع عكس العملية عند الإلغاء
  // نستخدم ref للرصيد الحالي لتفادي stale closure
  const balanceRef = useRef(currentBalance);
  useEffect(()=>{ balanceRef.current = currentBalance; },[currentBalance]);

  const adjustBalance = useCallback(async(delta, reason, type, refId)=>{
    const newBalance = balanceRef.current + delta;
    try {
      await balanceConfigApi.upsert(userId,{current_balance: newBalance});
      setBalanceConfig(c=>({...c, current_balance: newBalance}));
      if (reason) await balanceTransactionsApi.add(userId,{amount:delta,reason,transaction_type:type,reference_id:refId});
    } catch(err){ showToast("تعذّر تحديث الرصيد","error"); }
  },[userId]);

  // ── تحميل البيانات
  useEffect(()=>{
    if(!userId) return;
    (async()=>{
      setDataLoading(true);
      try{
        const [loansData,goalsData,recIncomeData,owedToMe,iOwe,balCfg,prior,oblData]=await Promise.all([
          loansApi.list(userId),goalsApi.list(userId),recurringIncomeApi.list(userId),
          debtsOwedToMeApi.list(userId),debtsIOweApi.list(userId),
          balanceConfigApi.get(userId),priorSavingsV2Api.list(userId),
          recurringObligationsApi.list(userId)
        ]);
        setLoans(loansData||[]);setGoals(goalsData||[]);setRecurringIncomes(recIncomeData||[]);
        setDebtsOwedToMe(owedToMe||[]);setDebtsIOwe(iOwe||[]);setPriorSavings(prior||[]);setObligations(oblData||[]);
        if(balCfg) setBalanceConfig(balCfg);

        const pEntries=await Promise.all((loansData||[]).map(l=>loanPaymentsApi.listForLoan(l.id)));
        const pMap={};
        (loansData||[]).forEach((l,i)=>{pMap[l.id]={};(pEntries[i]||[]).forEach(p=>{if(!pMap[l.id][p.year])pMap[l.id][p.year]={};pMap[l.id][p.year][p.month]=p;});});
        setLoanPaymentsMap(pMap);

        const amtsEntries=await Promise.all((loansData||[]).filter(l=>l.custom_monthly_amounts).map(l=>loanMonthAmountsApi.listForLoan(l.id)));
        const amtsMap={};
        (loansData||[]).filter(l=>l.custom_monthly_amounts).forEach((l,i)=>{amtsMap[l.id]={};(amtsEntries[i]||[]).forEach(a=>{amtsMap[l.id][a.month_index]=a.amount;});});
        setLoanMonthAmountsMap(amtsMap);

        const opEntries=await Promise.all((oblData||[]).map(o=>recurringObligationPaymentsApi.listForObligation(o.id)));
        const opMap={};
        (oblData||[]).forEach((o,i)=>{(opEntries[i]||[]).forEach(p=>{opMap[`${o.id}-${p.year}-${p.month}`]=p;});});
        setObligationPayments(opMap);
      }catch(err){console.error(err);showToast("حدث خطأ أثناء تحميل البيانات","error");}
      finally{setDataLoading(false);}
    })();
  },[userId]);

  const monthKey=`${currentYear}-${currentMonth}`;
  useEffect(()=>{
    if(!userId||monthCache[monthKey]) return;
    (async()=>{
      try{
        const [income,fixed,variable,savings,settings]=await Promise.all([
          incomeApi.list(userId,currentYear,currentMonth),
          fixedExpenseApi.list(userId,currentYear,currentMonth),
          variableExpenseApi.list(userId,currentYear,currentMonth),
          savingsApi.list(userId,currentYear,currentMonth),
          monthSettingsApi.get(userId,currentYear,currentMonth)
        ]);
        setMonthCache(c=>({...c,[monthKey]:{
          incomeEntries:income||[],
          fixedExpenses:fixed||[],
          variableExpenses:variable||[],
          savingsEntries:(savings||[]).map(s=>fromDbRow("savingsEntries",s)),
          savingsTarget:settings?.savings_target_pct??0.20,
          savingsTargetType:settings?.savings_target_type??'pct',
          savingsTargetAmount:settings?.savings_target_amount??0,
        }}));
      }catch(err){showToast("تعذّر تحميل بيانات هذا الشهر","error");}
    })();
  },[userId,monthKey]);

  const getEffectiveMonthData=useCallback((year,month)=>{
    const key=`${year}-${month}`;
    const base=monthCache[key]||{incomeEntries:[],fixedExpenses:[],variableExpenses:[],savingsEntries:[],savingsTarget:0.20,savingsTargetType:'pct',savingsTargetAmount:0};
    const today=new Date();
    const recurringAsEntries=recurringIncomes.map(r=>{
      const ov=recurringOverrides[`${r.id}-${year}-${month}`];
      const started=(year>r.start_year)||(year===r.start_year&&month>=r.start_month);
      if(!started) return null;
      let dayArrived=true;
      if(r.payment_day_of_month){
        const isPast=(year<today.getFullYear())||(year===today.getFullYear()&&month<today.getMonth());
        const isFuture=(year>today.getFullYear())||(year===today.getFullYear()&&month>today.getMonth());
        if(isPast) dayArrived=true;
        else if(isFuture) dayArrived=false;
        else dayArrived=today.getDate()>=r.payment_day_of_month;
      }
      const actual=ov?.actual_amount??r.amount;
      const received=ov?.received??true;
      return {id:`recurring-${r.id}`,name:r.name,estimated:r.amount,actual:(received&&dayArrived)?actual:0,isRecurring:true,recurringId:r.id,received,dayArrived,paymentDay:r.payment_day_of_month};
    }).filter(Boolean);
    return {...base,incomeEntries:[...recurringAsEntries,...base.incomeEntries]};
  },[monthCache,recurringIncomes,recurringOverrides]);

  // ── حساب السنة: الأقساط تُضاف فقط في شهرها المستحق بدقة
  const computedYearData=useMemo(()=>{
    const result={};
    const years=new Set([currentYear,currentYear-1,currentYear+1,balanceConfig.start_year]);
    for(const yrNum of [...years].sort((a,b)=>a-b)){
      const summaries=[];
      let prevRemaining=0;
      if(result[yrNum-1]) prevRemaining=result[yrNum-1].summaries[11]?.remaining??0;
      if(yrNum===balanceConfig.start_year) prevRemaining+=(balanceConfig.start_balance||0);
      for(let m=0;m<12;m++){
        const monthData=getEffectiveMonthData(yrNum,m);
        // القسط يُحتسب فقط إذا كان هذا الشهر ضمن نطاق القرض بالضبط
        const loanDue=loans.reduce((s,l)=>s+computeLoanMonthlyDue(l,yrNum,m,loanMonthAmountsMap),0);
        const effectiveMonth={
          ...monthData,
          fixedExpenses:[
            ...monthData.fixedExpenses,
            ...(loanDue>0?[{id:`loan-due-${yrNum}-${m}`,name:"أقساط ديون",actual:loanDue,estimated:loanDue}]:[])
          ],
        };
        summaries.push(computeMonthSummary(effectiveMonth,m===0?prevRemaining:summaries[m-1]?.remaining??0));
      }
      result[yrNum]={
        summaries,
        yearPureIncome:summaries.reduce((s,m)=>s+m.pureIncome,0),
        yearSavings:summaries.reduce((s,m)=>s+m.savingsTotal,0),
        yearFixed:summaries.reduce((s,m)=>s+m.fixedTotal,0),
        yearVar:summaries.reduce((s,m)=>s+m.varTotal,0),
        yearRemaining:summaries[11]?.remaining??0,
      };
    }
    return result;
  },[getEffectiveMonthData,loans,balanceConfig,currentYear,loanMonthAmountsMap]);

  const curSummary=computedYearData[currentYear]?.summaries[currentMonth];
  const _rawMonthData=getEffectiveMonthData(currentYear,currentMonth);
  // إضافة الأقساط المستحقة هذا الشهر لبيانات الشهر (لعرضها في جدول الالتزامات)
  const curMonthData = useMemo(()=>{
    const loanDue=loans.reduce((s,l)=>s+computeLoanMonthlyDue(l,currentYear,currentMonth,loanMonthAmountsMap),0);
    if(loanDue<=0) return _rawMonthData;
    // أنشئ entries للأقساط مقسمة لكل قرض
    const loanEntries=loans
      .map(l=>{
        const due=computeLoanMonthlyDue(l,currentYear,currentMonth,loanMonthAmountsMap);
        if(due<=0) return null;
        const pData=loanPaymentsMap[l.id]?.[currentYear]?.[currentMonth];
        const paid=pData?.is_paid||false;
        const isPrepaid=pData?.payment_type==='prepaid';
        return {
          id:`loan-entry-${l.id}`,
          name:`قسط: ${l.name}`,
          actual:due,
          estimated:due,
          _isLoan:true,
          _paid:paid,
          _prepaid:isPrepaid,
        };
      })
      .filter(Boolean);
    return {..._rawMonthData, fixedExpenses:[..._rawMonthData.fixedExpenses,...loanEntries]};
  },[_rawMonthData,loans,loanPaymentsMap,loanMonthAmountsMap,currentYear,currentMonth]);

  // ── الالتزامات غير المسددة هذا الشهر (للرصيد القابل للصرف)
  const unpaidLoanDue=useMemo(()=>loans.reduce((s,l)=>{
    const due=computeLoanMonthlyDue(l,currentYear,currentMonth,loanMonthAmountsMap);
    if(due<=0) return s;
    const pData=loanPaymentsMap[l.id]?.[currentYear]?.[currentMonth];
    if(pData?.is_paid) return s; // مسدد سواء كان مسبقاً أو الآن
    return s+due;
  },0),[loans,loanPaymentsMap,loanMonthAmountsMap,currentYear,currentMonth]);

  const unpaidObligations=useMemo(()=>{
    const today=new Date();
    return obligations.filter(o=>{
      if(!o.active) return false;
      const startD=new Date(o.start_date);
      const startYM=startD.getFullYear()*12+startD.getMonth();
      const checkYM=currentYear*12+currentMonth;
      if(checkYM<startYM) return false;
      if(o.recurrence_type==='count'&&o.recurrence_months){
        if(checkYM>startYM+o.recurrence_months-1) return false;
      }
      return !obligationPayments[`${o.id}-${currentYear}-${currentMonth}`]?.is_paid;
    }).reduce((s,o)=>s+(o.estimated_amount||0),0);
  },[obligations,obligationPayments,currentYear,currentMonth]);

  // الالتزامات الكلية غير المسددة (أقساط + التزامات متكررة)
  const totalUnpaidObligations = unpaidLoanDue + unpaidObligations;
  const spendableBalance = currentBalance - totalUnpaidObligations;

  const refreshMonth=(year,month,patch)=>{
    const key=`${year}-${month}`;
    setMonthCache(c=>({...c,[key]:{...c[key],...patch}}));
  };

  const addEntryRow=async(field)=>{
    const apiMap={incomeEntries:incomeApi,fixedExpenses:fixedExpenseApi,variableExpenses:variableExpenseApi,savingsEntries:savingsApi};
    try{
      const row=await apiMap[field].create({user_id:userId,year:currentYear,month:currentMonth,...toDbRow(field,{name:"",estimated:0,actual:0})});
      refreshMonth(currentYear,currentMonth,{[field]:[...(monthCache[monthKey]?.[field]||[]),fromDbRow(field,row)]});
    }catch(err){showToast("تعذّر الإضافة","error");}
  };

  const updateEntry=async(field,entry)=>{
    if(entry.isRecurring){
      try{
        await recurringIncomeApi.upsertOverride(userId,entry.recurringId,currentYear,currentMonth,{actualAmount:entry.actual,received:entry.received});
        setRecurringOverrides(o=>({...o,[`${entry.recurringId}-${currentYear}-${currentMonth}`]:{actual_amount:entry.actual,received:entry.received}}));
      }catch(err){showToast("تعذّر التحديث","error");}
      return;
    }
    const apiMap={incomeEntries:incomeApi,fixedExpenses:fixedExpenseApi,variableExpenses:variableExpenseApi,savingsEntries:savingsApi};
    try{
      await apiMap[field].update(entry.id,toDbRow(field,entry));
      refreshMonth(currentYear,currentMonth,{[field]:(monthCache[monthKey]?.[field]||[]).map(e=>e.id===entry.id?entry:e)});
    }catch(err){showToast("تعذّر التحديث","error");}
  };

  const deleteEntry=async(field,id)=>{
    const apiMap={incomeEntries:incomeApi,fixedExpenses:fixedExpenseApi,variableExpenses:variableExpenseApi,savingsEntries:savingsApi};
    try{
      await apiMap[field].remove(id);
      refreshMonth(currentYear,currentMonth,{[field]:(monthCache[monthKey]?.[field]||[]).filter(e=>e.id!==id)});
    }catch(err){showToast("تعذّر الحذف","error");}
  };

  const updateSavingsTarget=async(pct)=>{
    try{await monthSettingsApi.upsert(userId,currentYear,currentMonth,pct);refreshMonth(currentYear,currentMonth,{savingsTarget:pct});}
    catch(err){}
  };

  // ── منطق سداد القرض مع عكس صحيح
  const handleLoanToggle=useCallback(async(loan, loanMonths, monthIdx, isPaid, paymentType)=>{
    const m=loanMonths[monthIdx];
    if(!m) return;
    try{
      // الدفعة المستحقة (مع مراعاة التخصيص الشهري)
      const startYM = new Date(loan.start_date).getFullYear()*12 + new Date(loan.start_date).getMonth();
      const checkYM = m.year*12+m.month;
      const monthDiff = checkYM - startYM;
      const dueAmt = loanMonthAmountsMap[loan.id]?.[monthDiff] ?? loan.monthly_payment ?? 0;

      // الحالة السابقة
      const prevData = loanPaymentsMap[loan.id]?.[m.year]?.[m.month];
      const wasPaid = !!prevData?.is_paid;
      const wasPrepaid = prevData?.payment_type === 'prepaid';
      const wasNow = prevData?.payment_type === 'now';

      // حفظ في DB أولاً
      await loanPaymentsApi.togglePaid(userId, loan.id, m.year, m.month, isPaid, isPaid ? paymentType : null);

      // تأثير الرصيد - منطق دقيق لا يكرر الخصم:
      if (isPaid && !wasPaid && paymentType === 'now') {
        // سداد جديد "الآن": اخصم
        await adjustBalance(-dueAmt, `سداد دفعة ${loan.name} - ${m.label}`, 'loan_payment', loan.id);
      } else if (!isPaid && wasPaid && wasNow) {
        // إلغاء سداد كان "الآن": أعد المبلغ
        await adjustBalance(+dueAmt, `إلغاء سداد ${loan.name} - ${m.label}`, 'loan_payment_cancel', loan.id);
      }
      // مسبق أو إلغاء مسبق: لا يؤثر على الرصيد الفعلي

      setLoanPaymentsMap(m2=>({
        ...m2,
        [loan.id]:{
          ...m2[loan.id],
          [m.year]:{...(m2[loan.id]?.[m.year]||{}),[m.month]:{is_paid:isPaid,payment_type:isPaid?paymentType:null}}
        }
      }));
    }catch(err){console.error(err);showToast("تعذّر التحديث","error");}
  },[userId,loanPaymentsMap,loanMonthAmountsMap,adjustBalance]);

  // ── منطق الالتزامات مع عكس العملية
  const handleObligationToggle=useCallback(async(obl, isPaid, actualAmount)=>{
    try{
      const prevData=obligationPayments[`${obl.id}-${currentYear}-${currentMonth}`];
      const wasPaid=prevData?.is_paid;

      const p=await recurringObligationPaymentsApi.togglePaid(userId,obl.id,currentYear,currentMonth,isPaid,actualAmount);
      setObligationPayments(m=>({...m,[`${obl.id}-${currentYear}-${currentMonth}`]:p}));

      const amt=actualAmount??obl.estimated_amount??0;
      if (isPaid && !wasPaid) {
        // سداد جديد
        await adjustBalance(-amt, `سداد التزام ${obl.name}`, 'obligation_payment', obl.id);
        showToast("✓ تم تسجيل السداد");
      } else if (!isPaid && wasPaid) {
        // إلغاء السداد: أعد المبلغ
        const prevAmt=prevData?.actual_amount??obl.estimated_amount??0;
        await adjustBalance(+prevAmt, `إلغاء سداد ${obl.name}`, 'obligation_cancel', obl.id);
        showToast("تم إلغاء السداد وإعادة المبلغ للرصيد");
      }
    }catch(err){showToast("تعذّر التحديث","error");}
  },[userId,obligationPayments,currentYear,currentMonth,adjustBalance]);

  const categoryData=useMemo(()=>{
    const map={};
    curMonthData.variableExpenses.forEach(e=>{const cat=e.category||"أخرى";map[cat]=(map[cat]||0)+(e.actual||0);});
    return Object.entries(map).map(([name,value])=>({name,value})).filter(x=>x.value>0);
  },[curMonthData]);

  const yearChartData=useMemo(()=>{
    const yd=computedYearData[currentYear];
    if(!yd) return [];
    return MONTHS_AR.map((m,i)=>({month:m.slice(0,3),دخل:yd.summaries[i]?.pureIncome??0,مصاريف:(yd.summaries[i]?.fixedTotal??0)+(yd.summaries[i]?.varTotal??0),مدخرات:yd.summaries[i]?.savingsTotal??0}));
  },[computedYearData,currentYear]);

  const cumulativeSavings=useMemo(()=>{
    let cum=priorSavings.reduce((s,p)=>s+(p.amount||0),0);
    const data=[];
    for(const [yr,yd] of Object.entries(computedYearData).sort((a,b)=>a[0]-b[0])){
      cum+=yd.yearSavings;
      data.push({سنة:yr,تراكمي:cum,سنوي:yd.yearSavings});
    }
    return data;
  },[computedYearData,priorSavings]);

  const totalOwedToMe=useMemo(()=>debtsOwedToMe.filter(d=>!d.is_settled).reduce((s,d)=>s+d.amount,0),[debtsOwedToMe]);
  const totalIOwe=useMemo(()=>debtsIOwe.filter(d=>!d.is_settled).reduce((s,d)=>s+d.amount,0),[debtsIOwe]);

  const navItems=[
    {id:"dashboard",label:"الرئيسية",icon:LayoutDashboard},
    {id:"month",label:"الشهر",icon:Calendar},
    {id:"year",label:"السنة",icon:BarChart2},
    {id:"savings",label:"المدخرات",icon:PiggyBank},
    {id:"loans",label:"الديون",icon:CreditCard},
    {id:"goals",label:"الأهداف",icon:Target},
    {id:"settings",label:"الإعدادات",icon:Settings},
  ];

  if(dataLoading) return(
    <div className={dark?"dark":""} dir="rtl">
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse">
            <Wallet size={24} className="text-white"/>
          </div>
          <span className="text-sm text-gray-400">جاري تحميل بياناتك...</span>
        </div>
      </div>
    </div>
  );

  return(
    <div className={dark?"dark":""} dir="rtl">
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950" style={{fontFamily:"'IBM Plex Sans Arabic','Tajawal',sans-serif"}}>

      {toast&&<div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type==="error"?"bg-red-500":"bg-green-500"}`}>{toast.msg}</div>}

      <ObligationsSidebar
        open={obligationsSideOpen} onClose={()=>setObligationsSideOpen(false)}
        obligations={obligations} obligationPayments={obligationPayments}
        currentYear={currentYear} currentMonth={currentMonth}
        onAddObligation={async(data)=>{
          try{const saved=await recurringObligationsApi.create({...data,user_id:userId});setObligations(os=>[...os,saved]);showToast("تم إضافة الالتزام");}
          catch(e){showToast("تعذّر الحفظ","error");}
        }}
        onEditObligation={async(id,data)=>{
          try{const updated=await recurringObligationsApi.update(id,data);setObligations(os=>os.map(o=>o.id===id?updated:o));showToast("تم التحديث");}
          catch(e){showToast("تعذّر التحديث","error");}
        }}
        onDeleteObligation={async(id)=>{
          try{await recurringObligationsApi.remove(id);setObligations(os=>os.filter(o=>o.id!==id));}
          catch(e){showToast("تعذّر الحذف","error");}
        }}
        onTogglePayment={handleObligationToggle}
      />

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 right-0 z-40 w-64 bg-white dark:bg-gray-900 shadow-2xl transform transition-transform duration-300 ${sideOpen?"translate-x-0":"translate-x-full"} lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><Wallet size={20} className="text-white"/></div>
              <div><div className="font-bold text-gray-800 dark:text-white text-lg">ميزانيتي</div><div className="text-xs text-gray-400">{profile?.username?`أهلاً ${profile.username}`:"إدارة مالية ذكية"}</div></div>
            </div>
          </div>
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map(item=>(
              <button key={item.id} onClick={()=>{setNav(item.id);setSideOpen(false);}}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${nav===item.id?"bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400":"text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                <item.icon size={18}/>{item.label}
              </button>
            ))}
            <button onClick={()=>{setObligationsSideOpen(true);setSideOpen(false);}}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
              <ListChecks size={18}/>الالتزامات
              {obligations.length>0&&<span className="mr-auto bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 text-xs px-1.5 py-0.5 rounded-full">{obligations.length}</span>}
            </button>
          </nav>
          <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-1">
            <button onClick={toggleDark} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">
              {dark?<Sun size={18}/>:<Moon size={18}/>}{dark?"الوضع النهاري":"الوضع الليلي"}
            </button>
            <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
              <LogOut size={18}/>تسجيل الخروج
            </button>
          </div>
        </div>
      </aside>
      {sideOpen&&<div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={()=>setSideOpen(false)}/>}

      <div className="lg:mr-64 min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
          <button onClick={()=>setSideOpen(!sideOpen)} className="lg:hidden p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"><Menu size={20} className="text-gray-600 dark:text-gray-300"/></button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{MONTHS_AR[currentMonth]} {currentYear}</span>
            <div className="flex gap-1">
              <button onClick={()=>{if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else{setCurrentMonth(m=>m-1);}}} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><ChevronRight size={16}/></button>
              <button onClick={()=>{if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else{setCurrentMonth(m=>m+1);}}} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><ChevronLeft size={16}/></button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>setObligationsSideOpen(true)} className="flex items-center gap-1 px-3 py-2 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-medium"><ListChecks size={14}/>الالتزامات</button>
            <button onClick={()=>setModal({type:"quickAdd"})} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium"><Plus size={16}/>إدخال سريع</button>
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-7xl mx-auto">

        {/* ── DASHBOARD ── */}
        {nav==="dashboard"&&curSummary&&(
          <div className="space-y-6">
            <div><h1 className="text-2xl font-bold text-gray-800 dark:text-white">مرحباً {profile?.username||""} 👋</h1><p className="text-gray-400 text-sm mt-1">ملخص {MONTHS_AR[currentMonth]} {currentYear}</p></div>
            {curSummary.remaining<0&&<div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-800"><AlertCircle size={20} className="text-red-500 shrink-0"/><div><div className="font-medium text-red-700 text-sm">تجاوزت ميزانيتك هذا الشهر</div><div className="text-xs text-red-500">{fmt(Math.abs(curSummary.remaining))} مبلغ الزيادة</div></div></div>}
            {!curSummary.targetMet&&curSummary.pureIncome>0&&<div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-800"><AlertCircle size={20} className="text-amber-500 shrink-0"/><div><div className="font-medium text-amber-700 text-sm">لم تحقق هدف الادخار</div><div className="text-xs text-amber-500">{curMonthData.savingsTargetType==='amount'?`المستهدف ${fmt(curMonthData.savingsTargetAmount)} — الفعلي ${fmt(curSummary.savingsTotal)}`:`المستهدف ${fmt(curSummary.pureIncome*(curMonthData?.savingsTarget??0.2))} — الفعلي ${fmt(curSummary.savingsTotal)}`}</div></div></div>}

            {/* ── الخانات المالية الرئيسية (الترتيب الجديد) ── */}
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="الرصيد الفعلي (الحالي)" value={fmt(currentBalance)} icon={Wallet} color={PALETTE.remaining} sub="رصيدك الفعلي في البنك/اليد"/>
              <div className={`bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border flex flex-col gap-2 ${spendableBalance<0?"border-red-200 dark:border-red-800":"border-gray-100 dark:border-gray-700"}`}>
                <div className="flex items-center justify-between"><span className="text-xs text-gray-400 font-medium">الرصيد القابل للصرف</span><div className="p-2 rounded-xl" style={{background:(spendableBalance>=0?"#14b8a6":PALETTE.debt)+"22"}}><DollarSign size={16} style={{color:spendableBalance>=0?"#14b8a6":PALETTE.debt}}/></div></div>
                <div className="text-2xl font-bold dark:text-white" style={{color:spendableBalance>=0?"#14b8a6":PALETTE.debt}}>{fmt(spendableBalance)}</div>
                <div className="text-xs text-gray-400">الرصيد الفعلي - الالتزامات غير المسددة</div>
                {spendableBalance<0&&<div className="text-xs text-red-500 font-medium">⚠️ الالتزامات تتجاوز رصيدك</div>}
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="الدخل الفعلي" value={fmt(curSummary.pureIncome)} icon={ArrowUpCircle} color={PALETTE.income} sub="بدون الرصيد المرحل"/>
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-medium">إجمالي المصاريف</span>
                  <div className="p-2 rounded-xl" style={{background:PALETTE.variable+"22"}}><ArrowDownCircle size={16} style={{color:PALETTE.variable}}/></div>
                </div>
                <div className="text-2xl font-bold" style={{color:PALETTE.variable}}>{fmt(curSummary.fixedTotal+curSummary.varTotal)}</div>
                <div className="text-[10px] text-gray-400">تشمل المسددة وغير المسددة معاً</div>
              </div>
              <StatCard label="المدخرات" value={fmt(curSummary.savingsTotal)} icon={PiggyBank} color={PALETTE.savings} sub={fmtPct(curSummary.savingsPct)+" من الدخل"}/>
              <StatCard label="الالتزامات غير المسددة" value={fmt(totalUnpaidObligations)} icon={AlertCircle} color={totalUnpaidObligations>0?PALETTE.debt:"#94a3b8"} sub={`أقساط: ${fmt(unpaidLoanDue)} • متكررة: ${fmt(unpaidObligations)}`}/>
            </div>

            {(totalOwedToMe>0||totalIOwe>0)&&<div className="grid grid-cols-2 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-green-100 dark:border-green-900 flex items-center gap-3"><div className="p-2 rounded-xl bg-green-50"><HandHeart size={18} className="text-green-500"/></div><div><div className="text-xs text-gray-400">ديون لي</div><div className="font-bold text-green-600">{fmt(totalOwedToMe)}</div></div></div>
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-red-100 dark:border-red-900 flex items-center gap-3"><div className="p-2 rounded-xl bg-red-50"><HandCoins size={18} className="text-red-500"/></div><div><div className="text-xs text-gray-400">ديون عليّ</div><div className="font-bold text-red-600">{fmt(totalIOwe)}</div></div></div>
            </div>}

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
              <h3 className="font-semibold text-gray-700 dark:text-white text-sm">توزيع الميزانية</h3>
              <ProgressBar value={curSummary.fixedTotal} max={curSummary.pureIncome} color={PALETTE.fixed} label="الالتزامات الثابتة" pct={fmtPct(curSummary.fixedTotal/Math.max(curSummary.pureIncome,1))}/>
              <ProgressBar value={curSummary.varTotal} max={curSummary.pureIncome} color={PALETTE.variable} label="المصاريف المتغيرة" pct={fmtPct(curSummary.varTotal/Math.max(curSummary.pureIncome,1))}/>
              <ProgressBar value={curSummary.savingsTotal} max={curSummary.pureIncome} color={PALETTE.savings} label="المدخرات" pct={fmtPct(curSummary.savingsPct)}/>
            </div>
            {categoryData.length>0&&<div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700"><h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">تصنيف المصاريف المتغيرة</h3><ResponsiveContainer width="100%" height={220}><RechartsPie><Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>{categoryData.map((_,i)=><Cell key={i} fill={["#6366f1","#f97316","#22c55e","#a855f7","#ef4444","#14b8a6","#f59e0b","#3b82f6","#ec4899","#84cc16","#8b5cf6","#06b6d4","#64748b"][i%13]}/>)}</Pie><Tooltip formatter={v=>fmt(v)}/><Legend/></RechartsPie></ResponsiveContainer></div>}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700"><h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">اتجاه السنة {currentYear}</h3><ResponsiveContainer width="100%" height={220}><AreaChart data={yearChartData}><defs><linearGradient id="gI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={PALETTE.income} stopOpacity={0.3}/><stop offset="95%" stopColor={PALETTE.income} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/><XAxis dataKey="month" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip formatter={v=>fmt(v)}/><Legend/><Area type="monotone" dataKey="دخل" stroke={PALETTE.income} fill="url(#gI)" strokeWidth={2}/><Area type="monotone" dataKey="مصاريف" stroke={PALETTE.variable} fill="none" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>
          </div>
        )}

        {/* ── MONTH VIEW ── */}
        {nav==="month"&&curMonthData&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h1 className="text-xl font-bold text-gray-800 dark:text-white">تفاصيل {MONTHS_AR[currentMonth]} {currentYear}</h1>
              <div className="flex gap-2 flex-wrap">{[{field:"incomeEntries",label:"+ دخل",color:PALETTE.income},{field:"fixedExpenses",label:"+ التزام",color:PALETTE.fixed},{field:"variableExpenses",label:"+ مصروف",color:PALETTE.variable},{field:"savingsEntries",label:"+ ادخار",color:PALETTE.savings}].map(({field,label,color})=>(<button key={field} onClick={()=>addEntryRow(field)} className="px-3 py-1.5 rounded-xl text-xs font-medium text-white" style={{background:color}}>{label}</button>))}</div>
            </div>
            {curSummary&&<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[{l:"الدخل الفعلي",v:curSummary.pureIncome,c:PALETTE.income},{l:"الالتزامات",v:curSummary.fixedTotal,c:PALETTE.fixed},{l:"المصاريف",v:curSummary.varTotal,c:PALETTE.variable},{l:"المدخرات",v:curSummary.savingsTotal,c:PALETTE.savings}].map(x=>(<div key={x.l} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700"><div className="text-xs text-gray-400">{x.l}</div><div className="text-sm font-bold mt-1" style={{color:x.c}}>{fmt(x.v)}</div></div>))}</div>}
            {curSummary&&<div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800"><RefreshCw size={16} className="text-indigo-400 shrink-0"/><div className="text-sm text-indigo-600 dark:text-indigo-300"><span className="font-medium">الرصيد المرحل:</span> {fmt(curSummary.carry)} (إجمالي المتاح: {fmt(curSummary.totalAvail)})</div></div>}

            {/* جدول الدخل */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="p-5 flex items-center justify-between"><div className="flex items-center gap-2"><div className="p-1.5 rounded-lg" style={{background:PALETTE.income+"22"}}><ArrowUpCircle size={16} style={{color:PALETTE.income}}/></div><span className="font-semibold text-gray-700 dark:text-white text-sm">جدول الدخل</span></div><span className="font-bold text-sm" style={{color:PALETTE.income}}>{fmt(curSummary?.pureIncome??0)}</span></div>
              <div className="px-5 pb-5 space-y-2">
                {curMonthData.incomeEntries.filter(e=>e.isRecurring).map(e=>(
                  <div key={e.id} className={`flex items-center gap-2 p-3 rounded-xl border ${e.dayArrived?"bg-green-50 dark:bg-green-900/10 border-green-100":"bg-amber-50 dark:bg-amber-900/10 border-amber-100"}`}>
                    <Repeat size={14} className={e.dayArrived?"text-green-500 shrink-0":"text-amber-500 shrink-0"}/>
                    <div className="flex-1"><span className="text-sm font-medium text-gray-700 dark:text-white">{e.name}</span>{e.paymentDay&&<div className="text-[11px] text-gray-400">يوم {fmtNum(e.paymentDay)} من كل شهر</div>}</div>
                    {!e.dayArrived?<span className="text-xs px-2 py-1 rounded-lg font-medium bg-amber-100 text-amber-600">لم يحن موعده</span>
                    :<><input type="number" value={e.actual} disabled={!e.received} onChange={ev=>updateEntry("incomeEntries",{...e,actual:parseFloat(ev.target.value)||0})} className="w-28 px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white disabled:opacity-40 focus:outline-none"/>
                    <button onClick={()=>updateEntry("incomeEntries",{...e,received:!e.received,actual:!e.received?e.estimated:0})} className={`text-xs px-2 py-1 rounded-lg font-medium ${e.received?"bg-green-100 text-green-600":"bg-red-100 text-red-500"}`}>{e.received?"مُستلم":"لم يُستلم"}</button></>}
                  </div>
                ))}
                {curMonthData.incomeEntries.filter(e=>!e.isRecurring).map(e=>(<EntryRow key={e.id} entry={e} onUpdate={en=>updateEntry("incomeEntries",en)} onDelete={()=>deleteEntry("incomeEntries",e.id)}/>))}
                <button onClick={()=>addEntryRow("incomeEntries")} className="mt-1 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 hover:border-indigo-300 hover:text-indigo-400 text-sm"><Plus size={14}/>إضافة دخل إضافي</button>
              </div>
            </div>

            <SectionTable title="الالتزامات الثابتة" color={PALETTE.fixed} icon={Building2} entries={curMonthData.fixedExpenses} onUpdate={e=>updateEntry("fixedExpenses",e)} onDelete={id=>deleteEntry("fixedExpenses",id)} onAdd={()=>addEntryRow("fixedExpenses")} total={curSummary?.fixedTotal??0}/>
            <SectionTable title="المصاريف المتغيرة" color={PALETTE.variable} icon={ArrowDownCircle} entries={curMonthData.variableExpenses} onUpdate={e=>updateEntry("variableExpenses",e)} onDelete={id=>deleteEntry("variableExpenses",id)} onAdd={()=>addEntryRow("variableExpenses")} total={curSummary?.varTotal??0} showCategory/>
            <SectionTable title="المدخرات الشهرية" color={PALETTE.savings} icon={PiggyBank} entries={curMonthData.savingsEntries} onUpdate={e=>updateEntry("savingsEntries",e)} onDelete={id=>deleteEntry("savingsEntries",id)} onAdd={()=>addEntryRow("savingsEntries")} total={curSummary?.savingsTotal??0}/>

            {/* هدف الادخار */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-3">هدف الادخار</h3>
              <div className="flex gap-2 mb-3">{[{v:'pct',l:'نسبة %'},{v:'amount',l:'مبلغ ثابت'}].map(opt=>(<button key={opt.v} onClick={async()=>{refreshMonth(currentYear,currentMonth,{savingsTargetType:opt.v});try{await monthSettingsApi.upsert(userId,currentYear,currentMonth,curMonthData.savingsTarget??0.2,opt.v,curMonthData.savingsTargetAmount??0);}catch(e){console.error(e);}}} className={`px-3 py-1.5 rounded-xl text-xs font-medium ${(curMonthData.savingsTargetType||'pct')===opt.v?"bg-purple-600 text-white":"bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>{opt.l}</button>))}</div>
              {(curMonthData.savingsTargetType||'pct')==='pct'
                ?<div className="flex items-center gap-4"><div className="flex-1"><input type="range" min={0} max={100} value={(curMonthData.savingsTarget??0.2)*100} onChange={e=>updateSavingsTarget(e.target.value/100)} className="w-full accent-purple-500"/></div><div className="text-lg font-bold text-purple-500">{((curMonthData.savingsTarget??0.2)*100).toFixed(0)}%</div><div className={`text-xs px-2 py-1 rounded-lg ${curSummary?.targetMet?"bg-green-50 text-green-600":"bg-red-50 text-red-600"}`}>{curSummary?.targetMet?"✓ محقق":"✗ لم يحقق"}</div></div>
                :<div className="flex items-center gap-3"><input type="number" value={curMonthData.savingsTargetAmount||0} onChange={async e=>{const amt=parseFloat(e.target.value)||0;refreshMonth(currentYear,currentMonth,{savingsTargetAmount:amt});try{await monthSettingsApi.upsert(userId,currentYear,currentMonth,curMonthData.savingsTarget,'amount',amt);}catch(err){}}} placeholder="المبلغ المستهدف..." className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none"/><span className="text-xs text-gray-400">ر.س</span><div className={`text-xs px-2 py-1 rounded-lg ${curSummary?.savingsTotal>=(curMonthData.savingsTargetAmount||0)?"bg-green-50 text-green-600":"bg-red-50 text-red-600"}`}>{curSummary?.savingsTotal>=(curMonthData.savingsTargetAmount||0)?"✓ محقق":"✗ لم يحقق"}</div></div>}
            </div>
          </div>
        )}

        {/* ── YEAR ── */}
        {nav==="year"&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-gray-800 dark:text-white">ملخص سنة {currentYear}</h1><div className="flex gap-2 items-center"><button onClick={()=>setCurrentYear(y=>y-1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><ChevronRight size={16}/></button><span className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded-xl text-sm font-medium">{currentYear}</span><button onClick={()=>setCurrentYear(y=>y+1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><ChevronLeft size={16}/></button></div></div>
            {computedYearData[currentYear]&&(<>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="إجمالي الدخل" value={fmt(computedYearData[currentYear].yearPureIncome)} icon={ArrowUpCircle} color={PALETTE.income}/>
                <StatCard label="إجمالي المصاريف" value={fmt(computedYearData[currentYear].yearFixed+computedYearData[currentYear].yearVar)} icon={ArrowDownCircle} color={PALETTE.variable}/>
                <StatCard label="إجمالي المدخرات" value={fmt(computedYearData[currentYear].yearSavings)} icon={PiggyBank} color={PALETTE.savings}/>
                <StatCard label="الرصيد المحاسبي النهائي" value={fmt(computedYearData[currentYear].yearRemaining)} icon={Wallet} color={PALETTE.remaining}/>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700"><h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">مقارنة شهرية</h3><ResponsiveContainer width="100%" height={280}><BarChart data={yearChartData} barGap={4}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/><XAxis dataKey="month" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip formatter={v=>fmt(v)}/><Legend/><Bar dataKey="دخل" fill={PALETTE.income} radius={[4,4,0,0]}/><Bar dataKey="مصاريف" fill={PALETTE.variable} radius={[4,4,0,0]}/><Bar dataKey="مدخرات" fill={PALETTE.savings} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden"><div className="p-5 border-b border-gray-100 dark:border-gray-700"><h3 className="font-semibold text-gray-700 dark:text-white text-sm">تفاصيل الأشهر</h3></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 dark:bg-gray-700/50"><tr>{["الشهر","الدخل","الالتزامات","المصاريف","المدخرات","% المدخرات"].map(h=><th key={h} className="px-4 py-3 text-xs font-medium text-gray-500 text-right">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50 dark:divide-gray-800">{MONTHS_AR.map((m,i)=>{const s=computedYearData[currentYear].summaries[i];return(<tr key={i} onClick={()=>{setCurrentMonth(i);setNav("month");}} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30"><td className="px-4 py-3 font-medium text-gray-700 dark:text-white">{m}</td><td className="px-4 py-3 text-green-600">{fmt(s.pureIncome)}</td><td className="px-4 py-3 text-blue-600">{fmt(s.fixedTotal)}</td><td className="px-4 py-3 text-orange-600">{fmt(s.varTotal)}</td><td className="px-4 py-3 text-purple-600">{fmt(s.savingsTotal)}</td><td className="px-4 py-3 text-gray-400">{fmtPct(s.savingsPct)}</td></tr>);})}</tbody></table></div></div>
            </>)}
          </div>
        )}

        {/* ── SAVINGS ── */}
        {nav==="savings"&&(
          <div className="space-y-6">
            <h1 className="text-xl font-bold text-gray-800 dark:text-white">المدخرات والمحفظة</h1>
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700"><h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">الرصيد التراكمي</h3><ResponsiveContainer width="100%" height={240}><AreaChart data={cumulativeSavings}><defs><linearGradient id="gSav" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={PALETTE.savings} stopOpacity={0.4}/><stop offset="95%" stopColor={PALETTE.savings} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/><XAxis dataKey="سنة" tick={{fontSize:12}}/><YAxis tick={{fontSize:11}}/><Tooltip formatter={v=>fmt(v)}/><Area type="monotone" dataKey="تراكمي" stroke={PALETTE.savings} fill="url(#gSav)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden"><div className="p-5 border-b border-gray-100 dark:border-gray-700"><h3 className="font-semibold text-gray-700 dark:text-white text-sm">مدخرات كل سنة</h3></div><div className="divide-y divide-gray-50 dark:divide-gray-800">{cumulativeSavings.map(row=>(<div key={row.سنة} className="px-5 py-4 flex justify-between items-center"><span className="font-medium text-gray-700 dark:text-white">{row.سنة}</span><div className="text-left"><div className="text-sm font-bold text-purple-600">{fmt(row.تراكمي)}</div><div className="text-xs text-gray-400">+ {fmt(row.سنوي)} هذه السنة</div></div></div>))}</div></div>
          </div>
        )}

        {/* ── LOANS ── */}
        {nav==="loans"&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-gray-800 dark:text-white">الديون والقروض</h1><button onClick={()=>setModal({type:"addLoan"})} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium"><Plus size={16}/>إضافة قرض</button></div>
            <div className="space-y-3">
              {loans.length===0&&<div className="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700"><CreditCard size={40} className="text-gray-200 mx-auto mb-3"/><div className="text-gray-400 text-sm">لا توجد قروض مضافة</div><div className="text-xs text-gray-300 mt-1">اضغط "إضافة قرض" لتسجيل قرض أو تقسيط</div></div>}
              {loans.map((loan,loanIdx)=>{
                const loanMonths=getLoanMonths(loan.start_date,loan.months_count||0);
                const paidCountGlobal=Object.values(loanPaymentsMap[loan.id]||{}).reduce((s,yr)=>s+Object.values(yr).filter(p=>p.is_paid).length,0);
                // الأشهر المسددة الآن فقط (لحساب المبلغ المخصوم فعلاً)
                const paidNowCount=Object.values(loanPaymentsMap[loan.id]||{}).reduce((s,yr)=>s+Object.values(yr).filter(p=>p.is_paid&&p.payment_type==='now').length,0);
                const remaining=Math.max(0,(loan.total_amount||0)-(loan.monthly_payment||0)*paidCountGlobal);
                const status=loan.end_date?new Date()>new Date(loan.end_date)?"منتهي":new Date()<new Date(loan.start_date)?"لم يبدأ بعد":"نشط":"—";
                const paymentsByIndex={};
                loanMonths.forEach((m,i)=>{const yr=loanPaymentsMap[loan.id]?.[m.year]||{};paymentsByIndex[i]=yr[m.month];});
                return(
                  <div key={loan.id} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="flex items-center gap-2"><span className="font-semibold text-gray-800 dark:text-white">{loan.name}</span><span className="text-xs px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500">{debtCategoryLabel(loan)}</span></div>
                        <div className="text-xs text-gray-400 mt-0.5">{loan.start_date||"—"} ← {loan.end_date||"—"}{loan.payment_day_of_month&&` • يوم ${fmtNum(loan.payment_day_of_month)} من كل شهر`}</div>
                        {loan.has_first_payment&&<div className="text-xs text-indigo-400 mt-0.5">دفعة أولى: {fmt(loan.first_payment_amount)}</div>}
                        {loan.custom_monthly_amounts&&<div className="text-xs text-orange-400 mt-0.5">دفعات غير متساوية</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-lg ${status==="نشط"?"bg-green-50 text-green-600":status==="منتهي"?"bg-gray-100 text-gray-400":"bg-blue-50 text-blue-600"}`}>{status}</span>
                        {/* زر التعديل - يفتح موديل التعديل مع البيانات الحالية */}
                        <button onClick={()=>setModal({type:"editLoan",loan})} className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-400"><Edit2 size={14}/></button>
                        <button onClick={async()=>{await loansApi.remove(loan.id);setLoans(l=>l.filter(x=>x.id!==loan.id));}} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-center">
                      <div><div className="text-xs text-gray-400">الإجمالي</div><div className="font-bold text-gray-700 dark:text-white text-sm">{fmt(loan.total_amount)}</div></div>
                      <div><div className="text-xs text-gray-400">الدفعة الشهرية</div><div className="font-bold text-red-500 text-sm">{fmt(loan.monthly_payment)}</div></div>
                      <div><div className="text-xs text-gray-400">مسددة</div><div className="font-bold text-blue-500 text-sm">{fmtNum(paidCountGlobal)} / {fmtNum(Math.round(loan.months_count||0))}</div></div>
                      <div><div className="text-xs text-gray-400">المتبقي</div><div className="font-bold text-orange-500 text-sm">{fmt(remaining)}</div></div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-400">الأشهر:</span>
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-full bg-green-500 inline-block mr-0.5"/>سُدِّد الآن</span>
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-400"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block mr-0.5"/>مسبق</span>
                      </div>
                      <MonthCircles
                        payments={loanMonths.map((_,i)=>paymentsByIndex[i])}
                        loanMonths={loanMonths}
                        onToggle={(monthIdx, isPaid, paymentType)=>handleLoanToggle(loan, loanMonths, monthIdx, isPaid, paymentType)}
                      />
                    </div>
                    {loan.end_date&&<div className="text-xs text-gray-400 mt-2 text-left">{daysUntil(loan.end_date)}</div>}
                  </div>
                );
              })}
            </div>

            {/* ديون لي */}
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2"><HandHeart size={18} className="text-green-500"/><h2 className="text-lg font-bold text-gray-800 dark:text-white">ديون لي (أنا الدائن)</h2></div>
              <button onClick={()=>setModal({type:"addDebtOwedToMe"})} className="flex items-center gap-1 text-sm text-green-600"><Plus size={16}/>إضافة</button>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              {debtsOwedToMe.length===0&&<div className="text-center py-8 text-gray-400 text-sm">لا توجد ديون مسجّلة لك</div>}
              {debtsOwedToMe.map(d=>(
                <div key={d.id} className={`px-5 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center justify-between ${d.is_settled?"opacity-50":""}`}>
                  <div><div className="font-medium text-gray-700 dark:text-white text-sm">{d.debtor_name}</div><div className="text-xs text-gray-400">{d.due_date?`السداد: ${daysUntil(d.due_date)}`:"بدون تاريخ"}</div></div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-green-600">{fmt(d.amount)}</span>
                    <button onClick={()=>setModal({type:"editDebtOwedToMe",debt:d})} className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-400"><Edit2 size={14}/></button>
                    <button onClick={()=>{
                      if(!d.is_settled) setSettlementModal({debt:d,debtType:'owed_to_me'});
                      else debtsOwedToMeApi.update(d.id,{is_settled:false}).then(u=>setDebtsOwedToMe(ds=>ds.map(x=>x.id===d.id?u:x)));
                    }} className={`p-1.5 rounded-lg ${d.is_settled?"bg-green-100 text-green-500":"hover:bg-gray-100 text-gray-300"}`}><CheckCircle size={16}/></button>
                    <button onClick={async()=>{await debtsOwedToMeApi.remove(d.id);setDebtsOwedToMe(ds=>ds.filter(x=>x.id!==d.id));}} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                  </div>
                </div>
              ))}
              {totalOwedToMe>0&&<div className="px-5 py-3 bg-green-50 dark:bg-green-900/20 rounded-b-2xl flex justify-between"><span className="text-sm font-medium text-green-600">إجمالي غير مسدد لك</span><span className="font-bold text-green-600">{fmt(totalOwedToMe)}</span></div>}
            </div>

            {/* ديون عليّ */}
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2"><HandCoins size={18} className="text-red-500"/><h2 className="text-lg font-bold text-gray-800 dark:text-white">ديون عليّ (أنا المدين)</h2></div>
              <button onClick={()=>setModal({type:"addDebtIOwe"})} className="flex items-center gap-1 text-sm text-red-500"><Plus size={16}/>إضافة</button>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              {debtsIOwe.length===0&&<div className="text-center py-8 text-gray-400 text-sm">لا توجد ديون عليك</div>}
              {debtsIOwe.map(d=>(
                <div key={d.id} className={`px-5 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center justify-between ${d.is_settled?"opacity-50":""}`}>
                  <div><div className="font-medium text-gray-700 dark:text-white text-sm">{d.creditor_name}</div><div className="text-xs text-gray-400">{d.due_date?`السداد: ${daysUntil(d.due_date)}`:"بدون تاريخ"}</div></div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-red-500">{fmt(d.amount)}</span>
                    <button onClick={()=>setModal({type:"editDebtIOwe",debt:d})} className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-400"><Edit2 size={14}/></button>
                    <button onClick={()=>{
                      if(!d.is_settled) setSettlementModal({debt:d,debtType:'i_owe'});
                      else debtsIOweApi.update(d.id,{is_settled:false}).then(u=>setDebtsIOwe(ds=>ds.map(x=>x.id===d.id?u:x)));
                    }} className={`p-1.5 rounded-lg ${d.is_settled?"bg-green-100 text-green-500":"hover:bg-gray-100 text-gray-300"}`}><CheckCircle size={16}/></button>
                    <button onClick={async()=>{await debtsIOweApi.remove(d.id);setDebtsIOwe(ds=>ds.filter(x=>x.id!==d.id));}} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                  </div>
                </div>
              ))}
              {totalIOwe>0&&<div className="px-5 py-3 bg-red-50 dark:bg-red-900/20 rounded-b-2xl flex justify-between"><span className="text-sm font-medium text-red-600">إجمالي عليك غير مسدد</span><span className="font-bold text-red-600">{fmt(totalIOwe)}</span></div>}
            </div>
          </div>
        )}

        {/* ── GOALS ── */}
        {nav==="goals"&&(
          <div className="space-y-6">
            <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-gray-800 dark:text-white">الأهداف والمشتريات</h1><button onClick={()=>setModal({type:"addGoal"})} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium"><Plus size={16}/>إضافة</button></div>
            {goals.length===0&&<div className="text-center py-16"><Target size={48} className="text-gray-200 mx-auto mb-3"/><div className="text-gray-400 text-sm">لا توجد أهداف مضافة</div></div>}
            <div className="space-y-3">{goals.map(goal=>(
              <div key={goal.id} className={`bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border ${goal.status==="تم الشراء"?"border-green-200 dark:border-green-800 opacity-70":"border-gray-100 dark:border-gray-700"}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-gray-800 dark:text-white">{goal.name}</div>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-lg ${goal.category==="احتياج"?"bg-red-50 text-red-500":goal.category==="حاجة"?"bg-orange-50 text-orange-500":"bg-blue-50 text-blue-500"}`}>{goal.category}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-lg ${goal.priority==="عالية"?"bg-red-50 text-red-500":goal.priority==="متوسطة"?"bg-amber-50 text-amber-500":"bg-gray-100 text-gray-400"}`}>{goal.priority}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-left"><div className="font-bold text-indigo-600">{fmt(goal.estimated_cost)}</div><div className={`text-xs ${goal.status==="تم الشراء"?"text-green-500":"text-gray-400"}`}>{goal.status}</div></div>
                    <button onClick={()=>setModal({type:"editGoal",goal})} className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-400"><Edit2 size={14}/></button>
                    <button onClick={async()=>{const ns=goal.status==="تم الشراء"?"لم يُشترى":"تم الشراء";const u=await goalsApi.update(goal.id,{status:ns});setGoals(g=>g.map(x=>x.id===goal.id?u:x));}} className={`p-1.5 rounded-lg ${goal.status==="تم الشراء"?"bg-green-100 text-green-500":"hover:bg-gray-100 text-gray-300"}`}><CheckCircle size={16}/></button>
                    <button onClick={async()=>{await goalsApi.remove(goal.id);setGoals(g=>g.filter(x=>x.id!==goal.id));}} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                  </div>
                </div>
              </div>
            ))}</div>
            {goals.length>0&&<div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl p-4 flex justify-between"><span className="text-sm text-indigo-600 font-medium">إجمالي التكلفة (غير مشتراة)</span><span className="font-bold text-indigo-700">{fmt(goals.filter(g=>g.status!=="تم الشراء").reduce((s,g)=>s+(g.estimated_cost||0),0))}</span></div>}
          </div>
        )}

        {nav==="settings"&&<SettingsPage userId={userId} profile={profile} balanceConfig={balanceConfig} setBalanceConfig={setBalanceConfig} currentBalance={currentBalance} adjustBalance={adjustBalance} priorSavings={priorSavings} setPriorSavings={setPriorSavings} recurringIncomes={recurringIncomes} setRecurringIncomes={setRecurringIncomes} setModal={setModal} showToast={showToast} numberFormat={numberFormat} onChangeNumberFormat={changeNumberFormat}/>}

        </main>
      </div>

      {/* ─── MODALS ─── */}
      <Modal open={modal?.type==="addLoan"} onClose={()=>setModal(null)} title="إضافة قرض أو تقسيط">
        <LoanForm onSave={async loan=>{
          try{
            const saved=await loansApi.create({...loan,user_id:userId});
            if(loan._customAmounts?.length){
              await loanMonthAmountsApi.bulkUpsert(userId,saved.id,loan._customAmounts);
              const m={};loan._customAmounts.forEach(a=>{m[a.month_index]=a.amount;});
              setLoanMonthAmountsMap(x=>({...x,[saved.id]:m}));
            }
            setLoans(l=>[...l,saved]);
            setLoanPaymentsMap(m=>({...m,[saved.id]:{}}));
            setModal(null);
          }catch(err){showToast("تعذّر الحفظ","error");}
        }}/>
      </Modal>

      {/* التعديل: يُرسل البيانات الجديدة ويُحدّث الـ state مباشرة */}
      <Modal open={modal?.type==="editLoan"} onClose={()=>setModal(null)} title="تعديل القرض">
        <LoanForm initial={modal?.loan} onSave={async loan=>{
          try{
            const updated=await loansApi.update(modal.loan.id, loan);
            if(loan._customAmounts?.length){
              await loanMonthAmountsApi.bulkUpsert(userId,modal.loan.id,loan._customAmounts);
              const m={};loan._customAmounts.forEach(a=>{m[a.month_index]=a.amount;});
              setLoanMonthAmountsMap(x=>({...x,[modal.loan.id]:m}));
            }
            // تحديث الـ state مباشرة بالبيانات الجديدة من قاعدة البيانات
            setLoans(l=>l.map(x=>x.id===modal.loan.id?updated:x));
            setModal(null);
            showToast("✓ تم تحديث القرض");
          }catch(err){showToast("تعذّر التحديث","error");}
        }}/>
      </Modal>

      <Modal open={modal?.type==="addDebtOwedToMe"} onClose={()=>setModal(null)} title="إضافة دين لي (أنا الدائن)">
        <DebtOwedToMeForm onSave={async d=>{
          try{
            const {deduct_on_create, ...rest}=d;
            const saved=await debtsOwedToMeApi.create({...rest,user_id:userId});
            setDebtsOwedToMe(ds=>[...ds,saved]);
            // أثر الرصيد عند التسجيل
            if(deduct_on_create) await adjustBalance(-d.amount, `إقراض ${d.debtor_name}`, 'debt_created', saved.id);
            setModal(null);
          }catch(err){showToast("تعذّر الحفظ","error");}
        }}/>
      </Modal>
      <Modal open={modal?.type==="editDebtOwedToMe"} onClose={()=>setModal(null)} title="تعديل الدين">
        <DebtOwedToMeForm initial={modal?.debt} onSave={async d=>{
          try{
            const {deduct_on_create,...rest}=d;
            const u=await debtsOwedToMeApi.update(modal.debt.id,rest);
            setDebtsOwedToMe(ds=>ds.map(x=>x.id===modal.debt.id?u:x));
            setModal(null);showToast("✓ تم التحديث");
          }catch(err){showToast("تعذّر التحديث","error");}
        }}/>
      </Modal>

      <Modal open={modal?.type==="addDebtIOwe"} onClose={()=>setModal(null)} title="إضافة دين عليّ (أنا المدين)">
        <DebtIOweForm onSave={async d=>{
          try{
            const {add_on_create, ...rest}=d;
            const saved=await debtsIOweApi.create({...rest,user_id:userId});
            setDebtsIOwe(ds=>[...ds,saved]);
            // أثر الرصيد عند التسجيل
            if(add_on_create) await adjustBalance(+d.amount, `استلام قرض من ${d.creditor_name}`, 'debt_received', saved.id);
            setModal(null);
          }catch(err){showToast("تعذّر الحفظ","error");}
        }}/>
      </Modal>
      <Modal open={modal?.type==="editDebtIOwe"} onClose={()=>setModal(null)} title="تعديل الدين">
        <DebtIOweForm initial={modal?.debt} onSave={async d=>{
          try{
            const {add_on_create,...rest}=d;
            const u=await debtsIOweApi.update(modal.debt.id,rest);
            setDebtsIOwe(ds=>ds.map(x=>x.id===modal.debt.id?u:x));
            setModal(null);showToast("✓ تم التحديث");
          }catch(err){showToast("تعذّر التحديث","error");}
        }}/>
      </Modal>

      <Modal open={modal?.type==="addGoal"} onClose={()=>setModal(null)} title="إضافة هدف">
        <GoalForm onSave={async g=>{try{const saved=await goalsApi.create({...g,user_id:userId});setGoals(gs=>[...gs,saved]);setModal(null);}catch(err){showToast("تعذّر الحفظ","error");}}}/>
      </Modal>
      <Modal open={modal?.type==="editGoal"} onClose={()=>setModal(null)} title="تعديل الهدف">
        <GoalForm initial={modal?.goal} onSave={async g=>{try{const u=await goalsApi.update(modal.goal.id,g);setGoals(gs=>gs.map(x=>x.id===modal.goal.id?u:x));setModal(null);showToast("تم التحديث");}catch(err){showToast("تعذّر التحديث","error");}}}/>
      </Modal>
      <Modal open={modal?.type==="quickAdd"} onClose={()=>setModal(null)} title="إدخال سريع">
        <QuickAdd onAdd={async(field,entry)=>{
          const apiMap={incomeEntries:incomeApi,fixedExpenses:fixedExpenseApi,variableExpenses:variableExpenseApi,savingsEntries:savingsApi};
          try{const row=await apiMap[field].create({user_id:userId,year:currentYear,month:currentMonth,...toDbRow(field,entry)});refreshMonth(currentYear,currentMonth,{[field]:[...(monthCache[monthKey]?.[field]||[]),fromDbRow(field,row)]});setModal(null);}
          catch(err){showToast("تعذّر الإضافة","error");}
        }}/>
      </Modal>
      <Modal open={modal?.type==="addRecurringIncome"} onClose={()=>setModal(null)} title="إضافة دخل ثابت شهري">
        <RecurringIncomeForm onSave={async r=>{try{const saved=await recurringIncomeApi.create({...r,user_id:userId,start_year:currentYear,start_month:currentMonth});setRecurringIncomes(rs=>[...rs,saved]);setModal(null);}catch(err){showToast("تعذّر الحفظ","error");}}}/>
      </Modal>

      {/* موديل تأكيد سداد الديون الشخصية */}
      <SettlementModal open={!!settlementModal} debt={settlementModal?.debt} debtType={settlementModal?.debtType} onClose={()=>setSettlementModal(null)}
        onConfirm={async(affectsBalance)=>{
          const {debt,debtType}=settlementModal;
          try{
            if(debtType==='owed_to_me'){
              const u=await debtsOwedToMeApi.update(debt.id,{is_settled:true});
              setDebtsOwedToMe(ds=>ds.map(x=>x.id===debt.id?u:x));
              if(affectsBalance) await adjustBalance(+debt.amount, `استلام دين من ${debt.debtor_name}`, 'debt_settled', debt.id);
              showToast(affectsBalance?"✓ تم الاستلام وأضيف للرصيد":"✓ تم تسجيل الاستلام");
            }else{
              const u=await debtsIOweApi.update(debt.id,{is_settled:true});
              setDebtsIOwe(ds=>ds.map(x=>x.id===debt.id?u:x));
              if(affectsBalance) await adjustBalance(-debt.amount, `سداد دين لـ ${debt.creditor_name}`, 'debt_settled', debt.id);
              showToast(affectsBalance?"✓ تم السداد وخُصم من الرصيد":"✓ تم تسجيل السداد");
            }
            setSettlementModal(null);
          }catch(err){showToast("تعذّر التحديث","error");}
        }}
      />
    </div>
    </div>
  );
}

// ── Settings Page
function SettingsPage({userId,profile,balanceConfig,setBalanceConfig,currentBalance,adjustBalance,priorSavings,setPriorSavings,recurringIncomes,setRecurringIncomes,setModal,showToast,numberFormat,onChangeNumberFormat}){
  const [localConfig,setLocalConfig]=useState(balanceConfig);
  const [localCurrentBalance,setLocalCurrentBalance]=useState(currentBalance);
  const [dangerOpen,setDangerOpen]=useState(false);
  const [newPriorSaving,setNewPriorSaving]=useState({name:"",place:"",amount:0});
  useEffect(()=>{setLocalCurrentBalance(currentBalance);},[currentBalance]);

  const saveConfig=async()=>{
    try{
      const saved=await balanceConfigApi.upsert(userId,{
        start_month:localConfig.start_month,
        start_year:localConfig.start_year,
        start_balance:localConfig.start_balance,
        current_balance:localCurrentBalance,
      });
      setBalanceConfig(saved);
      showToast("تم حفظ الإعدادات");
    }catch(err){showToast("تعذّر الحفظ","error");}
  };

  const addPriorSaving=async()=>{
    if(!newPriorSaving.name) return;
    try{const saved=await priorSavingsV2Api.create({...newPriorSaving,user_id:userId});setPriorSavings(p=>[...p,saved]);setNewPriorSaving({name:"",place:"",amount:0});}
    catch(err){showToast("تعذّر الحفظ","error");}
  };
  const removePriorSaving=async(id)=>{
    try{await priorSavingsV2Api.remove(id);setPriorSavings(p=>p.filter(x=>x.id!==id));}
    catch(err){showToast("تعذّر الحذف","error");}
  };
  const totalPrior=priorSavings.reduce((s,x)=>s+(x.amount||0),0);

  return(<div className="space-y-6">
    <h1 className="text-xl font-bold text-gray-800 dark:text-white">الإعدادات</h1>

    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-2">
      <h3 className="font-semibold text-gray-700 dark:text-white text-sm">معلومات الحساب</h3>
      <div className="text-sm text-gray-500">اسم المستخدم: <span className="font-medium text-gray-700 dark:text-white">{profile?.username||"—"}</span></div>
    </div>

    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
      <h3 className="font-semibold text-gray-700 dark:text-white text-sm">صيغة الأرقام</h3>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={()=>onChangeNumberFormat("western")} className={`py-2.5 rounded-xl text-sm font-medium ${numberFormat==="western"?"bg-indigo-600 text-white":"bg-gray-50 dark:bg-gray-700 text-gray-500"}`}>123 (إنجليزية)</button>
        <button onClick={()=>onChangeNumberFormat("arabic")} className={`py-2.5 rounded-xl text-sm font-medium ${numberFormat==="arabic"?"bg-indigo-600 text-white":"bg-gray-50 dark:bg-gray-700 text-gray-500"}`}>١٢٣ (عربية)</button>
      </div>
    </div>

    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2"><Repeat size={16} className="text-green-500"/><h3 className="font-semibold text-gray-700 dark:text-white text-sm">الدخل الثابت الشهري</h3></div>
        <button onClick={()=>setModal({type:"addRecurringIncome"})} className="flex items-center gap-1 text-xs text-green-600"><Plus size={14}/>إضافة</button>
      </div>
      {recurringIncomes.length===0&&<div className="text-center py-4 text-gray-400 text-sm">لم تضف دخلاً ثابتاً بعد</div>}
      <div className="space-y-2">{recurringIncomes.map(r=>(
        <div key={r.id} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/10 rounded-xl">
          <div><span className="text-sm font-medium text-gray-700 dark:text-white">{r.name}</span>{r.payment_day_of_month&&<div className="text-[11px] text-gray-400">يوم {fmtNum(r.payment_day_of_month)} من كل شهر</div>}</div>
          <div className="flex items-center gap-3"><span className="font-bold text-green-600 text-sm">{fmt(r.amount)}</span><button onClick={async()=>{await recurringIncomeApi.remove(r.id);setRecurringIncomes(rs=>rs.filter(x=>x.id!==r.id));}} className="p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button></div>
        </div>
      ))}</div>
    </div>

    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
      <h3 className="font-semibold text-gray-700 dark:text-white text-sm">الرصيد ونقطة البداية</h3>
      <Field label="شهر بداية الاستخدام" value={MONTHS_AR[localConfig.start_month]} options={MONTHS_AR} onChange={v=>setLocalConfig(c=>({...c,start_month:MONTHS_AR.indexOf(v)}))}/>
      <Field label="سنة البداية" type="number" value={localConfig.start_year} onChange={v=>setLocalConfig(c=>({...c,start_year:v}))}/>
      <Field label="الرصيد عند نقطة البداية" type="number" value={localConfig.start_balance} onChange={v=>setLocalConfig(c=>({...c,start_balance:v}))} suffix="ر.س"/>
      <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
        <label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-1.5">الرصيد الفعلي الحالي</label>
        <p className="text-xs text-gray-400 mb-2">رصيدك الحقيقي الآن. يُحدَّث تلقائياً عند تسجيل السداد.</p>
        <div className="flex gap-2">
          <input type="number" value={localCurrentBalance} onChange={e=>setLocalCurrentBalance(parseFloat(e.target.value)||0)} className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
          <span className="flex items-center text-xs text-gray-400 px-2">ر.س</span>
        </div>
      </div>
      <button onClick={saveConfig} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium">حفظ الإعدادات</button>
    </div>

    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
      <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">المدخرات السابقة</h3>
      <div className="space-y-2 mb-4">{priorSavings.map(s=>(
        <div key={s.id} className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/10 rounded-xl">
          <div><div className="text-sm font-medium text-gray-700 dark:text-white">{s.name}</div>{s.place&&<div className="text-xs text-gray-400">{s.place}</div>}</div>
          <div className="flex items-center gap-3"><span className="font-bold text-purple-600 text-sm">{fmt(s.amount)}</span><button onClick={()=>removePriorSaving(s.id)} className="p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button></div>
        </div>
      ))}</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input value={newPriorSaving.name} onChange={e=>setNewPriorSaving(p=>({...p,name:e.target.value}))} placeholder="الاسم" className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none"/>
        <input value={newPriorSaving.place} onChange={e=>setNewPriorSaving(p=>({...p,place:e.target.value}))} placeholder="مكان الادخار" className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none"/>
      </div>
      <div className="flex gap-2">
        <input type="number" value={newPriorSaving.amount} onChange={e=>setNewPriorSaving(p=>({...p,amount:parseFloat(e.target.value)||0}))} placeholder="المبلغ" className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none"/>
        <button onClick={addPriorSaving} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium">إضافة</button>
      </div>
      {totalPrior>0&&<div className="flex justify-between pt-3 mt-3 border-t border-gray-100 dark:border-gray-700"><span className="text-sm font-medium text-gray-600 dark:text-gray-300">الإجمالي</span><span className="text-sm font-bold text-purple-600">{fmt(totalPrior)}</span></div>}
    </div>

    <div className="bg-red-50 dark:bg-red-900/10 rounded-2xl p-5 border border-red-100 dark:border-red-900">
      <div className="flex items-center gap-2 mb-2"><AlertTriangle size={18} className="text-red-500"/><h3 className="font-semibold text-red-700 dark:text-red-400 text-sm">منطقة الخطر</h3></div>
      <p className="text-xs text-red-500 mb-4">حذف كل سجلاتك المالية نهائياً. لا يمكن التراجع.</p>
      <button onClick={()=>setDangerOpen(true)} className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium">مسح السجل بالكامل</button>
    </div>
    <ConfirmDangerModal open={dangerOpen} onClose={()=>setDangerOpen(false)}
      onConfirm={async()=>{
        try{await dangerZoneApi.deleteAllFinancialData(userId);showToast("تم حذف كل البيانات");setDangerOpen(false);setTimeout(()=>window.location.reload(),1000);}
        catch(err){showToast("تعذّر الحذف","error");}
      }}
      title="مسح السجل بالكامل" message="سيتم حذف كل بياناتك المالية نهائياً. لا يمكن التراجع." confirmWord="حذف"
    />
  </div>);
}
