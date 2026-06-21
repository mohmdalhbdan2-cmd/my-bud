// src/components/BudgetApp.jsx
// التطبيق الرئيسي بعد تسجيل الدخول - يحمّل ويحفظ البيانات من/إلى Supabase

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Calendar, TrendingUp, CreditCard, Users,
  Target, Settings, Plus, ChevronRight, ChevronLeft,
  DollarSign, ArrowUpCircle, ArrowDownCircle, PiggyBank,
  AlertCircle, CheckCircle, Clock, X, Save, Trash2,
  BarChart2, PieChart, ArrowRight, Moon, Sun, Menu,
  Wallet, Building2, RefreshCw, LogOut, AlertTriangle,
  HandCoins, HandHeart, Repeat, Circle, CheckCircle2
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
} from "../lib/supabase";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                   "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const EXPENSE_CATEGORIES = [
  "بنزين","مطعم","بقالة","فواتير وخدمات","ملابس وتسوق شخصي",
  "صحة وأدوية","ترفيه واشتراكات","نقل وتوصيل","تعليم ودورات",
  "هدايا ومناسبات","حلاقة","طلعة شباب","أخرى"
];

const GOAL_CATEGORIES = ["احتياج","حاجة","رغبة"];
const GOAL_PRIORITIES = ["عالية","متوسطة","منخفضة"];
const GOAL_STATUS = ["لم يُشترى","قيد التوفير","تم الشراء"];

const DEBT_CATEGORIES = ["بطاقة ائتمانية", "تابي", "تمارا", "مدفوع", "أخرى"];

const PALETTE = {
  income:   "#22c55e",
  fixed:    "#3b82f6",
  variable: "#f97316",
  savings:  "#a855f7",
  debt:     "#ef4444",
  remaining:"#14b8a6",
  owedToMe: "#10b981",
  iOwe:     "#f43f5e",
};

// صيغة الأرقام المفضّلة للمستخدم: "western" = 123, "arabic" = ١٢٣
// تُحدَّث من داخل BudgetApp عند تحميل تفضيل المستخدم أو تغييره، وتُقرأ مباشرة هنا
// لأن fmt/fmtPct تُستدعى أثناء كل render فتعكس القيمة الحالية تلقائياً
let _numberLocale = "en-US";
export const setNumberLocale = (format) => {
  _numberLocale = format === "arabic" ? "ar-SA-u-nu-arab" : "en-US";
};

const fmt = (n, currency = "SAR") =>
  new Intl.NumberFormat(_numberLocale, { style:"currency", currency, minimumFractionDigits:2 })
    .format(n ?? 0);

const fmtPct = (n) =>
  new Intl.NumberFormat(_numberLocale, { style:"percent", minimumFractionDigits:1, maximumFractionDigits:1 })
    .format(n ?? 0);

const fmtNum = (n) => new Intl.NumberFormat(_numberLocale).format(n ?? 0);

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const diff = Math.round((new Date(dateStr) - new Date()) / 86400000);
  if (diff < 0) return `منتهي منذ ${fmtNum(Math.abs(diff))} يوم`;
  if (diff === 0) return "اليوم";
  return `${fmtNum(diff)} يوم`;
};

const addMonths = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0,10);
};

// ─── COMPUTATION HELPERS ─────────────────────────────────────────────────────
const computeMonthSummary = (monthData, prevRemaining = 0) => {
  const pureIncome    = monthData.incomeEntries.reduce((s,e) => s + (e.actual||0), 0);
  const carry         = prevRemaining;
  const totalAvail    = pureIncome + carry;
  const fixedTotal    = monthData.fixedExpenses.reduce((s,e) => s + (e.actual||0), 0);
  const varTotal      = monthData.variableExpenses.reduce((s,e) => s + (e.actual||0), 0);
  const savingsTotal  = monthData.savingsEntries.reduce((s,e) => s + (e.actual||0), 0);
  const remaining     = totalAvail - fixedTotal - varTotal - savingsTotal;
  const savingsPct    = pureIncome > 0 ? savingsTotal / pureIncome : 0;
  const targetMet     = savingsPct >= (monthData.savingsTarget ?? 0);
  return { pureIncome, carry, totalAvail, fixedTotal, varTotal, savingsTotal, remaining, savingsPct, targetMet };
};

const computeLoanMonthlyDue = (loan, year, month) => {
  if (!loan.start_date || !loan.end_date) return 0;
  const mStart = new Date(loan.start_date);
  const mEnd   = new Date(loan.end_date);
  const mCheck = new Date(year, month, 1);
  const mCheckEnd = new Date(year, month+1, 0);
  if (mCheck <= mEnd && mCheckEnd >= mStart) return loan.monthly_payment || 0;
  return 0;
};

const debtCategoryLabel = (loan) =>
  loan.debt_category === "أخرى" && loan.debt_category_custom
    ? loan.debt_category_custom
    : loan.debt_category || "أخرى";

// تحويل بيانات الواجهة (estimated/actual/category) لأسماء الأعمدة الصحيحة في قاعدة البيانات
// لأن جدول savings_entries يستخدم "planned" بدل "estimated"، وincome/fixed ما فيهم عمود category
const toDbRow = (field, entry) => {
  const row = {
    name: entry.name ?? "",
    actual: entry.actual ?? 0,
  };
  if (field === "savingsEntries") {
    row.planned = entry.estimated ?? entry.planned ?? 0;
  } else {
    row.estimated = entry.estimated ?? 0;
  }
  if (field === "variableExpenses") {
    row.category = entry.category || null;
  }
  return row;
};

// تحويل صف قادم من قاعدة البيانات لصيغة موحّدة تفهمها الواجهة (estimated بدل planned)
const fromDbRow = (field, row) => {
  if (field === "savingsEntries") {
    return { ...row, estimated: row.planned ?? 0 };
  }
  return row;
};

// ─── SHARED UI COMPONENTS ────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color, icon: Icon }) => (
  <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      {Icon && <div className="p-2 rounded-xl" style={{ background: color + "22" }}>
        <Icon size={16} style={{ color }} />
      </div>}
    </div>
    <div className="text-2xl font-bold text-gray-800 dark:text-white" style={{ color }}>{value}</div>
    {sub && <div className="text-xs text-gray-400">{sub}</div>}
  </div>
);

const ProgressBar = ({ value, max, color, label, pct }) => {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      {label && <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span>{pct ?? `${percent.toFixed(0)}%`}</span>
      </div>}
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, background: color }} />
      </div>
    </div>
  );
};

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

const Field = ({ label, type="text", value, onChange, placeholder, suffix, options, required }) => (
  <div className="flex flex-col gap-1.5">
    {label && <label className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}{required && <span className="text-red-400 mr-1">*</span>}</label>}
    {options ? (
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
        <option value="">اختر...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <div className="relative">
        <input type={type} value={value ?? ""} onChange={e => onChange(type==="number" ? parseFloat(e.target.value)||0 : e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        {suffix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{suffix}</span>}
      </div>
    )}
  </div>
);

const EntryRow = ({ entry, onUpdate, onDelete, showCategory }) => (
  <div className="grid grid-cols-12 gap-2 items-center py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
    <div className="col-span-4">
      <input value={entry.name||""} onChange={e => onUpdate({...entry, name:e.target.value})}
        placeholder="البند"
        className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
    </div>
    <div className="col-span-3">
      <input type="number" value={entry.estimated||""} onChange={e => onUpdate({...entry, estimated:parseFloat(e.target.value)||0})}
        placeholder="المتوقع"
        className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
    </div>
    <div className="col-span-3">
      <input type="number" value={entry.actual||""} onChange={e => onUpdate({...entry, actual:parseFloat(e.target.value)||0})}
        placeholder="الفعلي"
        className={`w-full px-2 py-1.5 text-sm rounded-lg border bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400
          ${showCategory && entry.actual > entry.estimated && entry.estimated > 0
            ? "border-red-400 bg-red-50 dark:bg-red-900/20"
            : "border-gray-200 dark:border-gray-700"}`} />
    </div>
    <div className="col-span-2 flex justify-end">
      <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-300 hover:text-red-400 transition-colors">
        <Trash2 size={14} />
      </button>
    </div>
    {showCategory && (
      <div className="col-span-12">
        <select value={entry.category||""} onChange={e => onUpdate({...entry, category:e.target.value})}
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:outline-none">
          <option value="">التصنيف...</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    )}
  </div>
);

function SectionTable({ title, color, icon:Icon, entries, onUpdate, onDelete, onAdd, total, showCategory }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between p-5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{background:color+"22"}}>
            <Icon size={16} style={{color}}/>
          </div>
          <span className="font-semibold text-gray-700 dark:text-white text-sm">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm" style={{color}}>{fmt(total)}</span>
          <ChevronRight size={16} className={`text-gray-400 transition-transform ${open?"rotate-90":""}`}/>
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-gray-400 px-1">
            <div className="col-span-4">البند</div>
            <div className="col-span-3">المتوقع</div>
            <div className="col-span-3">الفعلي</div>
          </div>
          {entries.map(e=>(
            <EntryRow key={e.id} entry={e} onUpdate={onUpdate} onDelete={()=>onDelete(e.id)} showCategory={showCategory}/>
          ))}
          <button onClick={onAdd} className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 hover:border-indigo-300 hover:text-indigo-400 transition-colors text-sm">
            <Plus size={14}/> إضافة بند
          </button>
          <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-500">الإجمالي</span>
            <span className="font-bold text-sm" style={{color}}>{fmt(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// دوائر السداد الشهرية لقرض معين - 12 دائرة، تُضغط يدوياً
function MonthCircles({ payments, onToggle, currentYear }) {
  return (
    <div className="flex gap-1.5 flex-wrap mt-3">
      {MONTHS_AR.map((m, i) => {
        const paid = payments?.[i]?.is_paid;
        return (
          <button
            key={i}
            onClick={() => onToggle(i, !paid)}
            title={`${m} ${currentYear}`}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-all
              ${paid
                ? "bg-green-500 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}>
            {m.slice(0,1)}
          </button>
        );
      })}
    </div>
  );
}

// تأكيد مزدوج لعمليات الحذف الخطيرة
function ConfirmDangerModal({ open, onClose, onConfirm, title, message, confirmWord }) {
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState(1);

  useEffect(() => { if (open) { setStep(1); setTyped(""); } }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800">
            <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5"/>
            <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium">إلغاء</button>
            <button onClick={()=>setStep(2)} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium">متابعة الحذف</button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            للتأكيد النهائي، اكتب <span className="font-bold text-red-500">{confirmWord}</span> في الخانة أدناه:
          </p>
          <input value={typed} onChange={e=>setTyped(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder={confirmWord} />
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium">إلغاء</button>
            <button
              disabled={typed !== confirmWord}
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium">
              حذف كل شيء نهائياً
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── FORMS ────────────────────────────────────────────────────────────────────
function LoanForm({ onSave }) {
  const [form, setForm] = useState({
    name:"", total_amount:0, start_date:"", months_count:"", monthly_payment_input:"",
    debt_category:"أخرى", debt_category_custom:"", payment_day_of_month:"", notes:"",
  });
  const monthlyPayment = form.months_count ? (form.total_amount / form.months_count) : form.monthly_payment_input;
  const effectiveMonths = form.months_count || (form.total_amount && form.monthly_payment_input ? Math.ceil(form.total_amount / form.monthly_payment_input) : 0);
  const endDate = form.start_date && effectiveMonths ? addMonths(form.start_date, effectiveMonths - 1) : "";
  const f = (k,v) => setForm(p=>({...p,[k]:v}));

  return (
    <div className="space-y-4">
      <Field label="اسم الدين / القرض" value={form.name} onChange={v=>f("name",v)} required/>

      <Field label="نوع الدين" value={form.debt_category} options={DEBT_CATEGORIES} onChange={v=>f("debt_category",v)}/>
      {form.debt_category === "أخرى" && (
        <Field label="حدد النوع" value={form.debt_category_custom} onChange={v=>f("debt_category_custom",v)} placeholder="اكتب نوع الدين..."/>
      )}

      <Field label="المبلغ الإجمالي" type="number" value={form.total_amount} onChange={v=>f("total_amount",v)} suffix="ر.س"/>
      <Field label="تاريخ بداية التقسيط" type="date" value={form.start_date} onChange={v=>f("start_date",v)}/>
      <Field label="يوم السداد من كل شهر (اختياري)" type="number" value={form.payment_day_of_month} onChange={v=>f("payment_day_of_month",v)} placeholder="مثال: 5"/>

      <div className="grid grid-cols-2 gap-3">
        <Field label="عدد الأشهر (إدخال)" type="number" value={form.months_count} onChange={v=>f("months_count",v)} placeholder="اكتب الأشهر..."/>
        <Field label="المبلغ الشهري (إدخال)" type="number" value={form.monthly_payment_input} onChange={v=>f("monthly_payment_input",v)} placeholder="أو المبلغ..."/>
      </div>

      {(monthlyPayment > 0 || effectiveMonths > 0) && (
        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">الدفعة الشهرية:</span><span className="font-bold text-indigo-600">{fmt(monthlyPayment)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">عدد الأشهر:</span><span className="font-bold text-indigo-600">{effectiveMonths}</span></div>
          {endDate && <div className="flex justify-between"><span className="text-gray-500">تاريخ الانتهاء:</span><span className="font-bold text-indigo-600">{endDate}</span></div>}
        </div>
      )}

      <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)} placeholder="اختياري..."/>
      <button
        onClick={()=>onSave({
          ...form,
          monthly_payment: monthlyPayment||parseFloat(form.monthly_payment_input)||0,
          months_count: effectiveMonths,
          end_date: endDate,
          payment_day_of_month: form.payment_day_of_month ? parseInt(form.payment_day_of_month) : null,
        })}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors">
        حفظ
      </button>
    </div>
  );
}

// دين "لي" (أنا الدائن - شخص يدين لي)
function DebtOwedToMeForm({ onSave }) {
  const [form, setForm] = useState({ debtor_name:"", amount:0, given_date:"", due_date:"", notes:"" });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div className="space-y-4">
      <Field label="اسم المدين (الشخص الذي يدين لك)" value={form.debtor_name} onChange={v=>f("debtor_name",v)} required/>
      <Field label="المبلغ" type="number" value={form.amount} onChange={v=>f("amount",v)} suffix="ر.س"/>
      <Field label="تاريخ الإعطاء" type="date" value={form.given_date} onChange={v=>f("given_date",v)}/>
      <Field label="تاريخ السداد المتوقع (اختياري)" type="date" value={form.due_date} onChange={v=>f("due_date",v)}/>
      <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/>
      <button onClick={()=>onSave(form)} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors">حفظ</button>
    </div>
  );
}

// دين "عليّ" (أنا المدين - أدين لشخص)
function DebtIOweForm({ onSave }) {
  const [form, setForm] = useState({ creditor_name:"", amount:0, received_date:"", due_date:"", notes:"" });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div className="space-y-4">
      <Field label="اسم الدائن (الشخص الذي تدين له)" value={form.creditor_name} onChange={v=>f("creditor_name",v)} required/>
      <Field label="المبلغ" type="number" value={form.amount} onChange={v=>f("amount",v)} suffix="ر.س"/>
      <Field label="تاريخ الاستلام" type="date" value={form.received_date} onChange={v=>f("received_date",v)}/>
      <Field label="تاريخ السداد المتوقع (اختياري)" type="date" value={form.due_date} onChange={v=>f("due_date",v)}/>
      <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/>
      <button onClick={()=>onSave(form)} className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-colors">حفظ</button>
    </div>
  );
}

function GoalForm({ onSave }) {
  const [form, setForm] = useState({ name:"", estimated_cost:0, category:"رغبة", priority:"متوسطة", status:"لم يُشترى", notes:"" });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div className="space-y-4">
      <Field label="اسم الشيء المطلوب" value={form.name} onChange={v=>f("name",v)} required/>
      <Field label="التكلفة التقديرية" type="number" value={form.estimated_cost} onChange={v=>f("estimated_cost",v)} suffix="ر.س"/>
      <div className="grid grid-cols-3 gap-3">
        <Field label="النوع" value={form.category} options={GOAL_CATEGORIES} onChange={v=>f("category",v)}/>
        <Field label="الأولوية" value={form.priority} options={GOAL_PRIORITIES} onChange={v=>f("priority",v)}/>
        <Field label="الحالة" value={form.status} options={GOAL_STATUS} onChange={v=>f("status",v)}/>
      </div>
      <Field label="ملاحظات" value={form.notes} onChange={v=>f("notes",v)}/>
      <button onClick={()=>onSave(form)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors">حفظ</button>
    </div>
  );
}

function RecurringIncomeForm({ initial, onSave }) {
  const [form, setForm] = useState(initial || { name:"الراتب الشهري", amount:0 });
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div className="space-y-4">
      <Field label="اسم الدخل الثابت" value={form.name} onChange={v=>f("name",v)} placeholder="مثال: الراتب" required/>
      <Field label="المبلغ الشهري" type="number" value={form.amount} onChange={v=>f("amount",v)} suffix="ر.س"/>
      <p className="text-xs text-gray-400">سيظهر هذا المبلغ تلقائياً في كل شهر بدون الحاجة لإعادة إدخاله. تقدر تعدّل المبلغ أو تعلّمه "لم يُستلم" لأي شهر محدد دون ما يأثر على باقي الأشهر.</p>
      <button onClick={()=>onSave(form)} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors">حفظ</button>
    </div>
  );
}

function QuickAdd({ onAdd }) {
  const [type, setType] = useState("variableExpenses");
  const [form, setForm] = useState({ name:"", actual:0, estimated:0, category:"" });
  const types = [
    { value:"incomeEntries",      label:"دخل",     color:PALETTE.income },
    { value:"fixedExpenses",      label:"التزام",   color:PALETTE.fixed },
    { value:"variableExpenses",   label:"مصروف",   color:PALETTE.variable },
    { value:"savingsEntries",     label:"ادخار",   color:PALETTE.savings },
  ];
  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {types.map(t=>(
          <button key={t.value} onClick={()=>setType(t.value)}
            className="py-2.5 rounded-xl text-sm font-medium transition-all"
            style={type===t.value?{background:t.color,color:"white"}:{background:"#f3f4f6",color:"#6b7280"}}>
            {t.label}
          </button>
        ))}
      </div>
      <Field label="اسم البند" value={form.name} onChange={v=>f("name",v)} placeholder="مثال: بنزين، إيجار..." required/>
      <Field label="المبلغ الفعلي" type="number" value={form.actual} onChange={v=>f("actual",v)} suffix="ر.س"/>
      <Field label="المبلغ المتوقع / المخطط" type="number" value={form.estimated} onChange={v=>f("estimated",v)} suffix="ر.س"/>
      {type==="variableExpenses" && (
        <Field label="التصنيف" value={form.category} options={EXPENSE_CATEGORIES} onChange={v=>f("category",v)}/>
      )}
      <button onClick={()=>form.name && onAdd(type,form)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors">
        إضافة
      </button>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function BudgetApp() {
  const { user, profile, signOut } = useAuth();
  const userId = user?.id;

  const [dark, setDark] = useState(false);
  const [numberFormat, setNumberFormatState] = useState("western");
  const [nav, setNav] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(false);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [dataLoading, setDataLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  // ── DATA STATE ──
  const [monthCache, setMonthCache] = useState({}); // key `${year}-${month}` -> { incomeEntries, fixedExpenses, variableExpenses, savingsEntries, savingsTarget }
  const [loans, setLoans] = useState([]);
  const [loanPaymentsMap, setLoanPaymentsMap] = useState({}); // loanId -> { [year]: { [month]: {is_paid} } }
  const [debtsOwedToMe, setDebtsOwedToMe] = useState([]);
  const [debtsIOwe, setDebtsIOwe] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurringIncomes, setRecurringIncomes] = useState([]);
  const [recurringOverrides, setRecurringOverrides] = useState({}); // `${recId}-${year}-${month}` -> override
  const [balanceConfig, setBalanceConfig] = useState({ start_month:0, start_year:new Date().getFullYear(), start_balance:0 });
  const [priorSavings, setPriorSavings] = useState([]);

  const showToast = (msg, type="success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── تحميل تفضيلات المستخدم (الوضع الليلي وصيغة الأرقام) من الحساب عند الدخول ──
  useEffect(() => {
    if (!profile) return;
    setDark(!!profile.dark_mode);
    const savedFormat = profile.number_format || "western";
    setNumberFormatState(savedFormat);
    setNumberLocale(savedFormat);
  }, [profile]);

  const toggleDark = async () => {
    const newVal = !dark;
    setDark(newVal);
    try { await profileApi.update(userId, { dark_mode: newVal }); }
    catch (err) { console.error(err); }
  };

  const changeNumberFormat = async (fmt) => {
    setNumberFormatState(fmt);
    setNumberLocale(fmt);
    try { await profileApi.update(userId, { number_format: fmt }); }
    catch (err) { console.error(err); }
  };

  // ── INITIAL LOAD ──
  useEffect(() => {
    if (!userId) return;
    (async () => {
      setDataLoading(true);
      try {
        const [loansData, goalsData, recIncomeData, owedToMe, iOwe, balCfg, prior] = await Promise.all([
          loansApi.list(userId),
          goalsApi.list(userId),
          recurringIncomeApi.list(userId),
          debtsOwedToMeApi.list(userId),
          debtsIOweApi.list(userId),
          balanceConfigApi.get(userId),
          priorSavingsV2Api.list(userId),
        ]);
        setLoans(loansData || []);
        setGoals(goalsData || []);
        setRecurringIncomes(recIncomeData || []);
        setDebtsOwedToMe(owedToMe || []);
        setDebtsIOwe(iOwe || []);
        setPriorSavings(prior || []);
        if (balCfg) setBalanceConfig(balCfg);

        const paymentsEntries = await Promise.all(
          (loansData||[]).map(l => loanPaymentsApi.listForLoan(l.id))
        );
        const pMap = {};
        (loansData||[]).forEach((l, i) => {
          pMap[l.id] = {};
          (paymentsEntries[i]||[]).forEach(p => {
            if (!pMap[l.id][p.year]) pMap[l.id][p.year] = {};
            pMap[l.id][p.year][p.month] = p;
          });
        });
        setLoanPaymentsMap(pMap);
      } catch (err) {
        console.error(err);
        showToast("حدث خطأ أثناء تحميل البيانات", "error");
      } finally {
        setDataLoading(false);
      }
    })();
  }, [userId]);

  // ── LOAD MONTH DATA ON DEMAND ──
  const monthKey = `${currentYear}-${currentMonth}`;
  useEffect(() => {
    if (!userId) return;
    if (monthCache[monthKey]) return;
    (async () => {
      try {
        const [income, fixed, variable, savings, settings] = await Promise.all([
          incomeApi.list(userId, currentYear, currentMonth),
          fixedExpenseApi.list(userId, currentYear, currentMonth),
          variableExpenseApi.list(userId, currentYear, currentMonth),
          savingsApi.list(userId, currentYear, currentMonth),
          monthSettingsApi.get(userId, currentYear, currentMonth),
        ]);
        setMonthCache(c => ({
          ...c,
          [monthKey]: {
            incomeEntries: income || [],
            fixedExpenses: fixed || [],
            variableExpenses: variable || [],
            savingsEntries: (savings || []).map(s => fromDbRow("savingsEntries", s)),
            savingsTarget: settings?.savings_target_pct ?? 0.20,
          }
        }));
      } catch (err) {
        console.error(err);
        showToast("تعذّر تحميل بيانات هذا الشهر", "error");
      }
    })();
  }, [userId, monthKey]);

  // ── EFFECTIVE MONTH DATA (merges recurring income into the month) ──
  const getEffectiveMonthData = useCallback((year, month) => {
    const key = `${year}-${month}`;
    const base = monthCache[key] || { incomeEntries:[], fixedExpenses:[], variableExpenses:[], savingsEntries:[], savingsTarget:0.20 };

    const recurringAsEntries = recurringIncomes
      .map(r => {
        const overrideKey = `${r.id}-${year}-${month}`;
        const ov = recurringOverrides[overrideKey];
        const started = (year > r.start_year) || (year === r.start_year && month >= r.start_month);
        if (!started) return null;
        const actual = ov?.actual_amount ?? r.amount;
        const received = ov?.received ?? true;
        return {
          id: `recurring-${r.id}`,
          name: r.name,
          estimated: r.amount,
          actual: received ? actual : 0,
          isRecurring: true,
          recurringId: r.id,
          received,
        };
      })
      .filter(Boolean);

    return {
      ...base,
      incomeEntries: [...recurringAsEntries, ...base.incomeEntries],
    };
  }, [monthCache, recurringIncomes, recurringOverrides]);

  // ── COMPUTED YEAR DATA ──
  const computedYearData = useMemo(() => {
    const result = {};
    const years = new Set([currentYear, currentYear-1, currentYear+1, balanceConfig.start_year]);
    const sortedYears = [...years].sort((a,b) => a-b);

    for (const yrNum of sortedYears) {
      const summaries = [];
      let prevRemaining = 0;
      if (result[yrNum-1]) prevRemaining = result[yrNum-1].summaries[11]?.remaining ?? 0;
      if (yrNum === balanceConfig.start_year) prevRemaining += (balanceConfig.start_balance || 0);

      for (let m = 0; m < 12; m++) {
        const monthData = getEffectiveMonthData(yrNum, m);
        const loanDue = loans.reduce((s, l) => s + computeLoanMonthlyDue(l, yrNum, m), 0);
        const effectiveMonth = {
          ...monthData,
          fixedExpenses: [
            ...monthData.fixedExpenses,
            ...(loanDue > 0 ? [{ name: "أقساط ديون", actual: loanDue, estimated: loanDue }] : []),
          ],
        };
        const summary = computeMonthSummary(effectiveMonth, m === 0 ? prevRemaining : summaries[m-1]?.remaining ?? 0);
        summaries.push(summary);
      }

      const yearPureIncome = summaries.reduce((s,m) => s + m.pureIncome, 0);
      const yearSavings    = summaries.reduce((s,m) => s + m.savingsTotal, 0);
      const yearFixed      = summaries.reduce((s,m) => s + m.fixedTotal, 0);
      const yearVar        = summaries.reduce((s,m) => s + m.varTotal, 0);
      const yearRemaining  = summaries[11]?.remaining ?? 0;

      result[yrNum] = { summaries, yearPureIncome, yearSavings, yearFixed, yearVar, yearRemaining };
    }
    return result;
  }, [getEffectiveMonthData, loans, balanceConfig, currentYear]);

  const curSummary = computedYearData[currentYear]?.summaries[currentMonth];
  const curMonthData = getEffectiveMonthData(currentYear, currentMonth);

  // ── MUTATIONS ──
  const refreshMonth = (year, month, patch) => {
    const key = `${year}-${month}`;
    setMonthCache(c => ({ ...c, [key]: { ...c[key], ...patch } }));
  };

  const addEntryRow = async (field) => {
    const apiMap = { incomeEntries: incomeApi, fixedExpenses: fixedExpenseApi, variableExpenses: variableExpenseApi, savingsEntries: savingsApi };
    const api = apiMap[field];
    try {
      const dbRow = toDbRow(field, { name: "", estimated: 0, actual: 0 });
      const row = await api.create({ user_id: userId, year: currentYear, month: currentMonth, ...dbRow });
      refreshMonth(currentYear, currentMonth, { [field]: [...(monthCache[monthKey]?.[field]||[]), fromDbRow(field, row)] });
    } catch (err) { console.error(err); showToast("تعذّر الإضافة", "error"); }
  };

  const updateEntry = async (field, entry) => {
    if (entry.isRecurring) {
      try {
        await recurringIncomeApi.upsertOverride(userId, entry.recurringId, currentYear, currentMonth, {
          actualAmount: entry.actual, received: entry.received,
        });
        setRecurringOverrides(o => ({ ...o, [`${entry.recurringId}-${currentYear}-${currentMonth}`]: { actual_amount: entry.actual, received: entry.received } }));
      } catch (err) { showToast("تعذّر التحديث", "error"); }
      return;
    }
    const apiMap = { incomeEntries: incomeApi, fixedExpenses: fixedExpenseApi, variableExpenses: variableExpenseApi, savingsEntries: savingsApi };
    const api = apiMap[field];
    try {
      const dbRow = toDbRow(field, entry);
      await api.update(entry.id, dbRow);
      refreshMonth(currentYear, currentMonth, {
        [field]: (monthCache[monthKey]?.[field]||[]).map(e => e.id === entry.id ? entry : e)
      });
    } catch (err) { console.error(err); showToast("تعذّر التحديث", "error"); }
  };

  const deleteEntry = async (field, id) => {
    const apiMap = { incomeEntries: incomeApi, fixedExpenses: fixedExpenseApi, variableExpenses: variableExpenseApi, savingsEntries: savingsApi };
    try {
      await apiMap[field].remove(id);
      refreshMonth(currentYear, currentMonth, {
        [field]: (monthCache[monthKey]?.[field]||[]).filter(e => e.id !== id)
      });
    } catch (err) { showToast("تعذّر الحذف", "error"); }
  };

  const updateSavingsTarget = async (pct) => {
    try {
      await monthSettingsApi.upsert(userId, currentYear, currentMonth, pct);
      refreshMonth(currentYear, currentMonth, { savingsTarget: pct });
    } catch (err) { showToast("تعذّر الحفظ", "error"); }
  };

  // ── CATEGORY DATA FOR CHARTS ──
  const categoryData = useMemo(() => {
    const map = {};
    curMonthData.variableExpenses.forEach(e => {
      const cat = e.category || "أخرى";
      map[cat] = (map[cat]||0) + (e.actual||0);
    });
    return Object.entries(map).map(([name,value]) => ({ name, value })).filter(x => x.value > 0);
  }, [curMonthData]);

  const yearChartData = useMemo(() => {
    const yd = computedYearData[currentYear];
    if (!yd) return [];
    return MONTHS_AR.map((m, i) => ({
      month: m.slice(0,3),
      دخل: yd.summaries[i]?.pureIncome ?? 0,
      مصاريف: (yd.summaries[i]?.fixedTotal ?? 0) + (yd.summaries[i]?.varTotal ?? 0),
      مدخرات: yd.summaries[i]?.savingsTotal ?? 0,
      رصيد: yd.summaries[i]?.remaining ?? 0,
    }));
  }, [computedYearData, currentYear]);

  const cumulativeSavings = useMemo(() => {
    let cum = priorSavings.reduce((s,p) => s + (p.amount||0), 0);
    const data = [];
    for (const [yr, yd] of Object.entries(computedYearData).sort((a,b) => a[0]-b[0])) {
      cum += yd.yearSavings;
      data.push({ سنة: yr, تراكمي: cum, سنوي: yd.yearSavings });
    }
    return data;
  }, [computedYearData, priorSavings]);

  const totalOwedToMe = useMemo(() => debtsOwedToMe.filter(d=>!d.is_settled).reduce((s,d)=>s+d.amount,0), [debtsOwedToMe]);
  const totalIOwe = useMemo(() => debtsIOwe.filter(d=>!d.is_settled).reduce((s,d)=>s+d.amount,0), [debtsIOwe]);

  // ── NAV ITEMS ──
  const navItems = [
    { id:"dashboard", label:"الرئيسية", icon: LayoutDashboard },
    { id:"month",     label:"الشهر",    icon: Calendar },
    { id:"year",      label:"السنة",     icon: BarChart2 },
    { id:"savings",   label:"المدخرات",  icon: PiggyBank },
    { id:"loans",     label:"الديون",    icon: CreditCard },
    { id:"goals",     label:"الأهداف",   icon: Target },
    { id:"settings",  label:"الإعدادات", icon: Settings },
  ];

  if (dataLoading) {
    return (
      <div className={dark ? "dark" : ""} dir="rtl">
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse">
              <Wallet size={24} className="text-white" />
            </div>
            <span className="text-sm text-gray-400">جاري تحميل بياناتك...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={dark ? "dark" : ""} dir="rtl">
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950" style={{fontFamily:"'IBM Plex Sans Arabic','Tajawal',sans-serif"}}>

        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type==="error"?"bg-red-500":"bg-green-500"}`}>
            {toast.msg}
          </div>
        )}

        {/* Sidebar */}
        <aside className={`fixed inset-y-0 right-0 z-40 w-64 bg-white dark:bg-gray-900 shadow-2xl transform transition-transform duration-300
          ${sideOpen ? "translate-x-0" : "translate-x-full"} lg:translate-x-0`}>
          <div className="flex flex-col h-full">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <Wallet size={20} className="text-white" />
                </div>
                <div>
                  <div className="font-bold text-gray-800 dark:text-white text-lg">ميزانيتي</div>
                  <div className="text-xs text-gray-400">{profile?.username ? `أهلاً ${profile.username}` : "إدارة مالية ذكية"}</div>
                </div>
              </div>
            </div>

            <nav className="flex-1 p-4 space-y-1">
              {navItems.map(item => (
                <button key={item.id} onClick={() => { setNav(item.id); setSideOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all
                    ${nav===item.id
                      ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                  <item.icon size={18} />
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-1">
              <button onClick={toggleDark} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                {dark ? <Sun size={18}/> : <Moon size={18}/>}
                {dark ? "الوضع النهاري" : "الوضع الليلي"}
              </button>
              <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <LogOut size={18}/>
                تسجيل الخروج
              </button>
            </div>
          </div>
        </aside>

        {sideOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSideOpen(false)} />}

        <div className="lg:mr-64 min-h-screen">
          <header className="sticky top-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
            <button onClick={() => setSideOpen(!sideOpen)} className="lg:hidden p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800">
              <Menu size={20} className="text-gray-600 dark:text-gray-300" />
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                {MONTHS_AR[currentMonth]} {currentYear}
              </span>
              <div className="flex gap-1">
                <button onClick={() => { const m=currentMonth-1; setCurrentMonth(m<0?11:m); if(m<0)setCurrentYear(y=>y-1); }} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
                  <ChevronRight size={16}/>
                </button>
                <button onClick={() => { const m=currentMonth+1; setCurrentMonth(m>11?0:m); if(m>11)setCurrentYear(y=>y+1); }} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
                  <ChevronLeft size={16}/>
                </button>
              </div>
            </div>
            <button onClick={() => setModal({type:"quickAdd"})} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors">
              <Plus size={16}/> إدخال سريع
            </button>
          </header>

          <main className="p-4 sm:p-6 max-w-7xl mx-auto">
            {/* ── DASHBOARD ── */}
            {nav==="dashboard" && curSummary && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-800 dark:text-white">مرحباً {profile?.username || ""} 👋</h1>
                  <p className="text-gray-400 text-sm mt-1">ملخص {MONTHS_AR[currentMonth]} {currentYear}</p>
                </div>

                {curSummary.remaining < 0 && (
                  <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-800">
                    <AlertCircle size={20} className="text-red-500 shrink-0"/>
                    <div>
                      <div className="font-medium text-red-700 dark:text-red-400 text-sm">تجاوزت ميزانيتك هذا الشهر</div>
                      <div className="text-xs text-red-500">{fmt(Math.abs(curSummary.remaining))} مبلغ الزيادة في الصرف</div>
                    </div>
                  </div>
                )}

                {!curSummary.targetMet && curSummary.pureIncome > 0 && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-800">
                    <AlertCircle size={20} className="text-amber-500 shrink-0"/>
                    <div>
                      <div className="font-medium text-amber-700 dark:text-amber-400 text-sm">لم تحقق هدف الادخار بعد</div>
                      <div className="text-xs text-amber-500">
                        المستهدف {fmt(curSummary.pureIncome * (curMonthData?.savingsTarget??0.2))} — الفعلي {fmt(curSummary.savingsTotal)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard label="الدخل الفعلي" value={fmt(curSummary.pureIncome)} icon={ArrowUpCircle} color={PALETTE.income} sub="بدون الرصيد المرحل"/>
                  <StatCard label="إجمالي المصاريف" value={fmt(curSummary.fixedTotal + curSummary.varTotal)} icon={ArrowDownCircle} color={PALETTE.variable} sub={`${fmtPct((curSummary.fixedTotal+curSummary.varTotal)/Math.max(curSummary.pureIncome,1))} من الدخل`}/>
                  <StatCard label="المدخرات" value={fmt(curSummary.savingsTotal)} icon={PiggyBank} color={PALETTE.savings} sub={fmtPct(curSummary.savingsPct) + " من الدخل"}/>
                  <StatCard label="الرصيد المتبقي" value={fmt(curSummary.remaining)} icon={Wallet} color={curSummary.remaining >= 0 ? PALETTE.remaining : PALETTE.debt} sub={curSummary.remaining < 0 ? "⚠️ رصيد سالب" : "قابل للصرف"}/>
                </div>

                {/* ديون لي / عليّ ملخص سريع */}
                {(totalOwedToMe > 0 || totalIOwe > 0) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-green-100 dark:border-green-900 flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-green-50 dark:bg-green-900/30"><HandHeart size={18} className="text-green-500"/></div>
                      <div>
                        <div className="text-xs text-gray-400">ديون لي (دائن)</div>
                        <div className="font-bold text-green-600">{fmt(totalOwedToMe)}</div>
                      </div>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-red-100 dark:border-red-900 flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-red-50 dark:bg-red-900/30"><HandCoins size={18} className="text-red-500"/></div>
                      <div>
                        <div className="text-xs text-gray-400">ديون عليّ (مدين)</div>
                        <div className="font-bold text-red-600">{fmt(totalIOwe)}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
                  <h3 className="font-semibold text-gray-700 dark:text-white text-sm">توزيع الميزانية</h3>
                  <ProgressBar value={curSummary.fixedTotal} max={curSummary.pureIncome} color={PALETTE.fixed} label="الالتزامات الثابتة" pct={fmtPct(curSummary.fixedTotal/Math.max(curSummary.pureIncome,1))}/>
                  <ProgressBar value={curSummary.varTotal} max={curSummary.pureIncome} color={PALETTE.variable} label="المصاريف المتغيرة" pct={fmtPct(curSummary.varTotal/Math.max(curSummary.pureIncome,1))}/>
                  <ProgressBar value={curSummary.savingsTotal} max={curSummary.pureIncome} color={PALETTE.savings} label="المدخرات" pct={fmtPct(curSummary.savingsPct)}/>
                </div>

                {categoryData.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">تصنيف المصاريف المتغيرة</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <RechartsPie>
                        <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name,percent}) => `${name} ${(percent*100).toFixed(0)}%`}>
                          {categoryData.map((_,i) => (
                            <Cell key={i} fill={["#6366f1","#f97316","#22c55e","#a855f7","#ef4444","#14b8a6","#f59e0b","#3b82f6","#ec4899","#84cc16","#8b5cf6","#06b6d4","#64748b"][i%13]}/>
                          ))}
                        </Pie>
                        <Tooltip formatter={v => fmt(v)}/>
                        <Legend/>
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">اتجاه السنة {currentYear}</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={yearChartData}>
                      <defs>
                        <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={PALETTE.income} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={PALETTE.income} stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="gRemaining" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={PALETTE.remaining} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={PALETTE.remaining} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                      <XAxis dataKey="month" tick={{fontSize:11}}/>
                      <YAxis tick={{fontSize:11}}/>
                      <Tooltip formatter={v=>fmt(v)}/>
                      <Legend/>
                      <Area type="monotone" dataKey="دخل" stroke={PALETTE.income} fill="url(#gIncome)" strokeWidth={2}/>
                      <Area type="monotone" dataKey="رصيد" stroke={PALETTE.remaining} fill="url(#gRemaining)" strokeWidth={2}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── MONTH VIEW ── */}
            {nav==="month" && curMonthData && (
              <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h1 className="text-xl font-bold text-gray-800 dark:text-white">
                    تفاصيل {MONTHS_AR[currentMonth]} {currentYear}
                  </h1>
                  <div className="flex gap-2 flex-wrap">
                    {[{field:"incomeEntries",label:"+ دخل",color:PALETTE.income},{field:"fixedExpenses",label:"+ التزام",color:PALETTE.fixed},{field:"variableExpenses",label:"+ مصروف",color:PALETTE.variable},{field:"savingsEntries",label:"+ ادخار",color:PALETTE.savings}].map(({field,label,color})=>(
                      <button key={field} onClick={()=>addEntryRow(field)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-white hover:opacity-90 transition-opacity"
                        style={{background:color}}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {curSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {l:"الدخل الفعلي",v:curSummary.pureIncome,c:PALETTE.income},
                      {l:"الالتزامات",v:curSummary.fixedTotal,c:PALETTE.fixed},
                      {l:"المصاريف",v:curSummary.varTotal,c:PALETTE.variable},
                      {l:"المدخرات",v:curSummary.savingsTotal,c:PALETTE.savings},
                    ].map(x=>(
                      <div key={x.l} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                        <div className="text-xs text-gray-400">{x.l}</div>
                        <div className="text-sm font-bold mt-1" style={{color:x.c}}>{fmt(x.v)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {curSummary && (
                  <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                    <RefreshCw size={16} className="text-indigo-400 shrink-0"/>
                    <div className="text-sm text-indigo-600 dark:text-indigo-300">
                      <span className="font-medium">الرصيد المرحل:</span> {fmt(curSummary.carry)} (ليس دخلاً — إجمالي المتاح: {fmt(curSummary.totalAvail)})
                    </div>
                  </div>
                )}

                {/* جدول الدخل - يشمل الدخل الثابت تلقائياً مع زر "لم يُستلم" */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg" style={{background:PALETTE.income+"22"}}><ArrowUpCircle size={16} style={{color:PALETTE.income}}/></div>
                      <span className="font-semibold text-gray-700 dark:text-white text-sm">جدول الدخل</span>
                    </div>
                    <span className="font-bold text-sm" style={{color:PALETTE.income}}>{fmt(curSummary?.pureIncome??0)}</span>
                  </div>
                  <div className="px-5 pb-5 space-y-2">
                    {curMonthData.incomeEntries.filter(e=>e.isRecurring).map(e=>(
                      <div key={e.id} className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-900">
                        <Repeat size={14} className="text-green-500 shrink-0"/>
                        <span className="text-sm font-medium text-gray-700 dark:text-white flex-1">{e.name}</span>
                        <input type="number" value={e.actual} disabled={!e.received}
                          onChange={ev=>updateEntry("incomeEntries", {...e, actual:parseFloat(ev.target.value)||0})}
                          className="w-28 px-2 py-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white disabled:opacity-40 focus:outline-none"/>
                        <button onClick={()=>updateEntry("incomeEntries", {...e, received: !e.received, actual: !e.received ? e.estimated : 0})}
                          className={`text-xs px-2 py-1 rounded-lg font-medium ${e.received ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"}`}>
                          {e.received ? "مُستلم" : "لم يُستلم"}
                        </button>
                      </div>
                    ))}
                    {curMonthData.incomeEntries.filter(e=>!e.isRecurring).map(e=>(
                      <EntryRow key={e.id} entry={e} onUpdate={(en)=>updateEntry("incomeEntries",en)} onDelete={()=>deleteEntry("incomeEntries",e.id)}/>
                    ))}
                    <button onClick={()=>addEntryRow("incomeEntries")} className="mt-1 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 hover:border-indigo-300 hover:text-indigo-400 transition-colors text-sm">
                      <Plus size={14}/> إضافة دخل إضافي
                    </button>
                  </div>
                </div>

                <SectionTable title="الالتزامات الثابتة" color={PALETTE.fixed} icon={Building2}
                  entries={curMonthData.fixedExpenses}
                  onUpdate={(e)=>updateEntry("fixedExpenses",e)} onDelete={(id)=>deleteEntry("fixedExpenses",id)}
                  onAdd={()=>addEntryRow("fixedExpenses")} total={curSummary?.fixedTotal??0}/>

                <SectionTable title="المصاريف المتغيرة" color={PALETTE.variable} icon={ArrowDownCircle}
                  entries={curMonthData.variableExpenses}
                  onUpdate={(e)=>updateEntry("variableExpenses",e)} onDelete={(id)=>deleteEntry("variableExpenses",id)}
                  onAdd={()=>addEntryRow("variableExpenses")} total={curSummary?.varTotal??0}
                  showCategory/>

                <SectionTable title="المدخرات الشهرية" color={PALETTE.savings} icon={PiggyBank}
                  entries={curMonthData.savingsEntries}
                  onUpdate={(e)=>updateEntry("savingsEntries",e)} onDelete={(id)=>deleteEntry("savingsEntries",id)}
                  onAdd={()=>addEntryRow("savingsEntries")} total={curSummary?.savingsTotal??0}/>

                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-3">هدف الادخار</h3>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <input type="range" min={0} max={100} value={(curMonthData.savingsTarget??0.2)*100}
                        onChange={e=>updateSavingsTarget(e.target.value/100)}
                        className="w-full accent-purple-500"/>
                    </div>
                    <div className="text-lg font-bold text-purple-500">{((curMonthData.savingsTarget??0.2)*100).toFixed(0)}%</div>
                    <div className={`text-xs px-2 py-1 rounded-lg ${curSummary?.targetMet?"bg-green-50 text-green-600":"bg-red-50 text-red-600"}`}>
                      {curSummary?.targetMet ? "✓ محقق" : "✗ لم يحقق"}
                    </div>
                  </div>
                </div>

                {curSummary && (
                  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-2xl p-5 border border-indigo-100 dark:border-indigo-800">
                    <h3 className="font-semibold text-indigo-700 dark:text-indigo-300 text-sm mb-4">ملخص الميزانية</h3>
                    <div className="space-y-2">
                      {[
                        {l:"الدخل الفعلي", v:curSummary.pureIncome, pct:1},
                        {l:"الالتزامات الثابتة", v:curSummary.fixedTotal, pct:curSummary.fixedTotal/Math.max(curSummary.pureIncome,1)},
                        {l:"المصاريف المتغيرة", v:curSummary.varTotal, pct:curSummary.varTotal/Math.max(curSummary.pureIncome,1)},
                        {l:"المدخرات", v:curSummary.savingsTotal, pct:curSummary.savingsPct},
                      ].map(x=>(
                        <div key={x.l} className="flex justify-between items-center text-sm">
                          <span className="text-gray-600 dark:text-gray-300">{x.l}</span>
                          <div className="flex gap-3">
                            <span className="text-gray-400 text-xs">{fmtPct(x.pct)}</span>
                            <span className="font-medium text-gray-800 dark:text-white">{fmt(x.v)}</span>
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-indigo-200 dark:border-indigo-700 pt-2 flex justify-between items-center">
                        <span className="font-bold text-indigo-700 dark:text-indigo-300">الرصيد المتبقي</span>
                        <span className={`font-bold text-lg ${curSummary.remaining>=0?"text-green-600":"text-red-500"}`}>{fmt(curSummary.remaining)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── YEAR VIEW ── */}
            {nav==="year" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold text-gray-800 dark:text-white">ملخص سنة {currentYear}</h1>
                  <div className="flex gap-2 items-center">
                    <button onClick={()=>setCurrentYear(y=>y-1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><ChevronRight size={16}/></button>
                    <span className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl text-sm font-medium">{currentYear}</span>
                    <button onClick={()=>setCurrentYear(y=>y+1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><ChevronLeft size={16}/></button>
                  </div>
                </div>

                {computedYearData[currentYear] && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="إجمالي الدخل السنوي" value={fmt(computedYearData[currentYear].yearPureIncome)} icon={ArrowUpCircle} color={PALETTE.income}/>
                      <StatCard label="إجمالي المصاريف" value={fmt(computedYearData[currentYear].yearFixed+computedYearData[currentYear].yearVar)} icon={ArrowDownCircle} color={PALETTE.variable}/>
                      <StatCard label="إجمالي المدخرات" value={fmt(computedYearData[currentYear].yearSavings)} icon={PiggyBank} color={PALETTE.savings}/>
                      <StatCard label="الرصيد النهائي" value={fmt(computedYearData[currentYear].yearRemaining)} icon={Wallet} color={PALETTE.remaining}/>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                      <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">مقارنة شهرية</h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={yearChartData} barGap={4}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                          <XAxis dataKey="month" tick={{fontSize:11}}/>
                          <YAxis tick={{fontSize:11}}/>
                          <Tooltip formatter={v=>fmt(v)}/>
                          <Legend/>
                          <Bar dataKey="دخل" fill={PALETTE.income} radius={[4,4,0,0]}/>
                          <Bar dataKey="مصاريف" fill={PALETTE.variable} radius={[4,4,0,0]}/>
                          <Bar dataKey="مدخرات" fill={PALETTE.savings} radius={[4,4,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                      <div className="p-5 border-b border-gray-100 dark:border-gray-700">
                        <h3 className="font-semibold text-gray-700 dark:text-white text-sm">تفاصيل جميع الأشهر</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                              {["الشهر","الدخل","الالتزامات","المصاريف","المدخرات","الرصيد","% المدخرات"].map(h=>(
                                <th key={h} className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 text-right">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                            {MONTHS_AR.map((m,i)=>{
                              const s = computedYearData[currentYear].summaries[i];
                              return (
                                <tr key={i} onClick={()=>{setCurrentMonth(i);setNav("month");}}
                                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                  <td className="px-4 py-3 font-medium text-gray-700 dark:text-white">{m}</td>
                                  <td className="px-4 py-3 text-green-600">{fmt(s.pureIncome)}</td>
                                  <td className="px-4 py-3 text-blue-600">{fmt(s.fixedTotal)}</td>
                                  <td className="px-4 py-3 text-orange-600">{fmt(s.varTotal)}</td>
                                  <td className="px-4 py-3 text-purple-600">{fmt(s.savingsTotal)}</td>
                                  <td className="px-4 py-3">
                                    <span className={`font-medium ${s.remaining>=0?"text-teal-600":"text-red-500"}`}>{fmt(s.remaining)}</span>
                                  </td>
                                  <td className="px-4 py-3 text-gray-400">{fmtPct(s.savingsPct)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── SAVINGS ── */}
            {nav==="savings" && (
              <div className="space-y-6">
                <h1 className="text-xl font-bold text-gray-800 dark:text-white">المدخرات والمحفظة</h1>

                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">الرصيد التراكمي عبر السنين</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={cumulativeSavings}>
                      <defs>
                        <linearGradient id="gSav" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={PALETTE.savings} stopOpacity={0.4}/>
                          <stop offset="95%" stopColor={PALETTE.savings} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                      <XAxis dataKey="سنة" tick={{fontSize:12}}/>
                      <YAxis tick={{fontSize:11}}/>
                      <Tooltip formatter={v=>fmt(v)}/>
                      <Area type="monotone" dataKey="تراكمي" stroke={PALETTE.savings} fill="url(#gSav)" strokeWidth={2}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="p-5 border-b border-gray-100 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-700 dark:text-white text-sm">مدخرات كل سنة</h3>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-gray-800">
                    {cumulativeSavings.map(row => (
                      <div key={row.سنة} className="px-5 py-4 flex justify-between items-center">
                        <span className="font-medium text-gray-700 dark:text-white">{row.سنة}</span>
                        <div className="text-left">
                          <div className="text-sm font-bold text-purple-600">{fmt(row.تراكمي)}</div>
                          <div className="text-xs text-gray-400">+ {fmt(row.سنوي)} هذه السنة</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── LOANS & DEBTS ── */}
            {nav==="loans" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold text-gray-800 dark:text-white">الديون والقروض</h1>
                  <button onClick={()=>setModal({type:"addLoan"})} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors">
                    <Plus size={16}/> إضافة قرض
                  </button>
                </div>

                <div className="space-y-3">
                  {loans.length === 0 && (
                    <div className="text-center py-12 text-gray-400">لا توجد قروض أو تقسيطات مضافة</div>
                  )}
                  {loans.map(loan => {
                    const payments = loanPaymentsMap[loan.id]?.[currentYear] || {};
                    const paidCount = Object.values(payments).filter(p=>p.is_paid).length;
                    const remaining = Math.max(0,(loan.total_amount||0) - (loan.monthly_payment||0)*paidCount);
                    const status = loan.end_date
                      ? new Date()>new Date(loan.end_date) ? "منتهي"
                        : new Date()<new Date(loan.start_date) ? "لم يبدأ بعد" : "نشط"
                      : "—";
                    return (
                      <div key={loan.id} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-800 dark:text-white">{loan.name}</span>
                              <span className="text-xs px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">{debtCategoryLabel(loan)}</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {loan.start_date} → {loan.end_date||"—"}
                              {loan.payment_day_of_month && ` • يوم ${loan.payment_day_of_month} من كل شهر`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded-lg ${
                              status==="نشط"?"bg-green-50 text-green-600":
                              status==="منتهي"?"bg-gray-100 text-gray-400":
                              "bg-blue-50 text-blue-600"}`}>{status}</span>
                            <button onClick={async ()=>{ await loansApi.remove(loan.id); setLoans(l=>l.filter(x=>x.id!==loan.id)); }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-3 text-center">
                          <div><div className="text-xs text-gray-400">المبلغ الكلي</div><div className="font-bold text-gray-700 dark:text-white text-sm">{fmt(loan.total_amount)}</div></div>
                          <div><div className="text-xs text-gray-400">الدفعة الشهرية</div><div className="font-bold text-red-500 text-sm">{fmt(loan.monthly_payment)}</div></div>
                          <div><div className="text-xs text-gray-400">دفعات مسددة</div><div className="font-bold text-blue-500 text-sm">{fmtNum(paidCount)} / {fmtNum(loan.months_count||0)}</div></div>
                          <div><div className="text-xs text-gray-400">المتبقي</div><div className="font-bold text-orange-500 text-sm">{fmt(remaining)}</div></div>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs text-gray-400 mb-1">حدد الأشهر التي سددتها فعلياً ({currentYear}):</div>
                          <MonthCircles
                            payments={MONTHS_AR.map((_,i)=>payments[i])}
                            currentYear={currentYear}
                            onToggle={async (monthIdx, isPaid) => {
                              try {
                                await loanPaymentsApi.togglePaid(userId, loan.id, currentYear, monthIdx, isPaid);
                                setLoanPaymentsMap(m => ({
                                  ...m,
                                  [loan.id]: {
                                    ...m[loan.id],
                                    [currentYear]: { ...(m[loan.id]?.[currentYear]||{}), [monthIdx]: { is_paid: isPaid } }
                                  }
                                }));
                              } catch (err) { showToast("تعذّر التحديث", "error"); }
                            }}
                          />
                        </div>

                        {loan.end_date && (
                          <div className="text-xs text-gray-400 mt-2 text-left">{daysUntil(loan.end_date)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2">
                    <HandHeart size={18} className="text-green-500"/>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white">ديون لي (أنا الدائن)</h2>
                  </div>
                  <button onClick={()=>setModal({type:"addDebtOwedToMe"})} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"><Plus size={16}/> إضافة</button>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                  {debtsOwedToMe.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">لا توجد ديون مسجّلة لك</div>}
                  {debtsOwedToMe.map(d=>(
                    <div key={d.id} className={`px-5 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center justify-between ${d.is_settled?"opacity-50":""}`}>
                      <div>
                        <div className="font-medium text-gray-700 dark:text-white text-sm">{d.debtor_name}</div>
                        <div className="text-xs text-gray-400">{d.due_date ? `السداد: ${daysUntil(d.due_date)}` : "بدون تاريخ سداد"}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-green-600">{fmt(d.amount)}</span>
                        <button onClick={async ()=>{ const updated = await debtsOwedToMeApi.update(d.id,{is_settled:!d.is_settled}); setDebtsOwedToMe(ds=>ds.map(x=>x.id===d.id?updated:x)); }}
                          className={`p-1.5 rounded-lg ${d.is_settled?"bg-green-100 text-green-500":"hover:bg-gray-100 text-gray-300"}`}>
                          <CheckCircle size={16}/>
                        </button>
                        <button onClick={async ()=>{ await debtsOwedToMeApi.remove(d.id); setDebtsOwedToMe(ds=>ds.filter(x=>x.id!==d.id)); }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                      </div>
                    </div>
                  ))}
                  {totalOwedToMe > 0 && (
                    <div className="px-5 py-3 bg-green-50 dark:bg-green-900/20 rounded-b-2xl flex justify-between">
                      <span className="text-sm font-medium text-green-600">إجمالي غير مسدد لك</span>
                      <span className="font-bold text-green-600">{fmt(totalOwedToMe)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2">
                    <HandCoins size={18} className="text-red-500"/>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white">ديون عليّ (أنا المدين)</h2>
                  </div>
                  <button onClick={()=>setModal({type:"addDebtIOwe"})} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600"><Plus size={16}/> إضافة</button>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                  {debtsIOwe.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">لا توجد ديون عليك</div>}
                  {debtsIOwe.map(d=>(
                    <div key={d.id} className={`px-5 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center justify-between ${d.is_settled?"opacity-50":""}`}>
                      <div>
                        <div className="font-medium text-gray-700 dark:text-white text-sm">{d.creditor_name}</div>
                        <div className="text-xs text-gray-400">{d.due_date ? `السداد: ${daysUntil(d.due_date)}` : "بدون تاريخ سداد"}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-red-500">{fmt(d.amount)}</span>
                        <button onClick={async ()=>{ const updated = await debtsIOweApi.update(d.id,{is_settled:!d.is_settled}); setDebtsIOwe(ds=>ds.map(x=>x.id===d.id?updated:x)); }}
                          className={`p-1.5 rounded-lg ${d.is_settled?"bg-green-100 text-green-500":"hover:bg-gray-100 text-gray-300"}`}>
                          <CheckCircle size={16}/>
                        </button>
                        <button onClick={async ()=>{ await debtsIOweApi.remove(d.id); setDebtsIOwe(ds=>ds.filter(x=>x.id!==d.id)); }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                      </div>
                    </div>
                  ))}
                  {totalIOwe > 0 && (
                    <div className="px-5 py-3 bg-red-50 dark:bg-red-900/20 rounded-b-2xl flex justify-between">
                      <span className="text-sm font-medium text-red-600">إجمالي عليك غير مسدد</span>
                      <span className="font-bold text-red-600">{fmt(totalIOwe)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── GOALS ── */}
            {nav==="goals" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold text-gray-800 dark:text-white">الأهداف والمشتريات</h1>
                  <button onClick={()=>setModal({type:"addGoal"})} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium">
                    <Plus size={16}/> إضافة
                  </button>
                </div>

                {goals.length === 0 && (
                  <div className="text-center py-16">
                    <Target size={48} className="text-gray-200 mx-auto mb-3"/>
                    <div className="text-gray-400 text-sm">لا توجد أهداف أو مشتريات مضافة</div>
                  </div>
                )}

                <div className="space-y-3">
                  {goals.map(goal=>(
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
                          <div className="text-left">
                            <div className="font-bold text-indigo-600">{fmt(goal.estimated_cost)}</div>
                            <div className={`text-xs text-left ${goal.status==="تم الشراء"?"text-green-500":"text-gray-400"}`}>{goal.status}</div>
                          </div>
                          <button onClick={async ()=>{ const newStatus = goal.status==="تم الشراء"?"لم يُشترى":"تم الشراء"; const updated = await goalsApi.update(goal.id,{status:newStatus}); setGoals(g=>g.map(x=>x.id===goal.id?updated:x)); }}
                            className={`p-1.5 rounded-lg ${goal.status==="تم الشراء"?"bg-green-100 text-green-500":"hover:bg-gray-100 text-gray-300"}`}>
                            <CheckCircle size={16}/>
                          </button>
                          <button onClick={async ()=>{ await goalsApi.remove(goal.id); setGoals(g=>g.filter(x=>x.id!==goal.id)); }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {goals.length > 0 && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl p-4 flex justify-between items-center">
                    <span className="text-sm text-indigo-600 dark:text-indigo-300 font-medium">إجمالي التكلفة التقديرية (غير مشتراة)</span>
                    <span className="font-bold text-indigo-700 dark:text-indigo-300">{fmt(goals.filter(g=>g.status!=="تم الشراء").reduce((s,g)=>s+(g.estimated_cost||0),0))}</span>
                  </div>
                )}
              </div>
            )}

            {/* ── SETTINGS ── */}
            {nav==="settings" && (
              <SettingsPage
                userId={userId}
                profile={profile}
                balanceConfig={balanceConfig}
                setBalanceConfig={setBalanceConfig}
                priorSavings={priorSavings}
                setPriorSavings={setPriorSavings}
                recurringIncomes={recurringIncomes}
                setRecurringIncomes={setRecurringIncomes}
                setModal={setModal}
                showToast={showToast}
                numberFormat={numberFormat}
                onChangeNumberFormat={changeNumberFormat}
              />
            )}
          </main>
        </div>

        {/* ── MODALS ── */}
        <Modal open={modal?.type==="addLoan"} onClose={()=>setModal(null)} title="إضافة قرض أو تقسيط">
          <LoanForm onSave={async loan=>{
            try { const saved = await loansApi.create({ ...loan, user_id: userId }); setLoans(l=>[...l,saved]); setLoanPaymentsMap(m=>({...m,[saved.id]:{}})); setModal(null); }
            catch(err){ showToast("تعذّر الحفظ", "error"); }
          }}/>
        </Modal>

        <Modal open={modal?.type==="addDebtOwedToMe"} onClose={()=>setModal(null)} title="إضافة دين لي (أنا الدائن)">
          <DebtOwedToMeForm onSave={async d=>{
            try { const saved = await debtsOwedToMeApi.create({ ...d, user_id: userId }); setDebtsOwedToMe(ds=>[...ds,saved]); setModal(null); }
            catch(err){ showToast("تعذّر الحفظ", "error"); }
          }}/>
        </Modal>

        <Modal open={modal?.type==="addDebtIOwe"} onClose={()=>setModal(null)} title="إضافة دين عليّ (أنا المدين)">
          <DebtIOweForm onSave={async d=>{
            try { const saved = await debtsIOweApi.create({ ...d, user_id: userId }); setDebtsIOwe(ds=>[...ds,saved]); setModal(null); }
            catch(err){ showToast("تعذّر الحفظ", "error"); }
          }}/>
        </Modal>

        <Modal open={modal?.type==="addGoal"} onClose={()=>setModal(null)} title="إضافة هدف أو مشتريات">
          <GoalForm onSave={async g=>{
            try { const saved = await goalsApi.create({ ...g, user_id: userId }); setGoals(gs=>[...gs,saved]); setModal(null); }
            catch(err){ showToast("تعذّر الحفظ", "error"); }
          }}/>
        </Modal>

        <Modal open={modal?.type==="quickAdd"} onClose={()=>setModal(null)} title="إدخال سريع">
          <QuickAdd onAdd={async (field,entry)=>{
            const apiMap = { incomeEntries: incomeApi, fixedExpenses: fixedExpenseApi, variableExpenses: variableExpenseApi, savingsEntries: savingsApi };
            try {
              const dbRow = toDbRow(field, entry);
              const row = await apiMap[field].create({ user_id: userId, year: currentYear, month: currentMonth, ...dbRow });
              refreshMonth(currentYear, currentMonth, { [field]: [...(monthCache[monthKey]?.[field]||[]), fromDbRow(field, row)] });
              setModal(null);
            } catch(err){ console.error(err); showToast("تعذّر الإضافة", "error"); }
          }}/>
        </Modal>
        <Modal open={modal?.type==="addRecurringIncome"} onClose={()=>setModal(null)} title="إضافة دخل ثابت شهري">
          <RecurringIncomeForm onSave={async r=>{
            try {
              const saved = await recurringIncomeApi.create({
                ...r, user_id: userId,
                start_year: currentYear, start_month: currentMonth,
              });
              setRecurringIncomes(rs=>[...rs,saved]);
              setModal(null);
            } catch(err){ showToast("تعذّر الحفظ", "error"); }
          }}/>
        </Modal>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function SettingsPage({ userId, profile, balanceConfig, setBalanceConfig, priorSavings, setPriorSavings, recurringIncomes, setRecurringIncomes, setModal, showToast, numberFormat, onChangeNumberFormat }) {
  const [localConfig, setLocalConfig] = useState(balanceConfig);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [newPriorSaving, setNewPriorSaving] = useState({ name:"", place:"", amount:0, has_return:false, return_pct:0 });

  const saveBalanceConfig = async () => {
    try {
      const saved = await balanceConfigApi.upsert(userId, {
        start_month: localConfig.start_month,
        start_year: localConfig.start_year,
        start_balance: localConfig.start_balance,
      });
      setBalanceConfig(saved);
      showToast("تم حفظ الإعدادات");
    } catch (err) { showToast("تعذّر الحفظ", "error"); }
  };

  const addPriorSaving = async () => {
    if (!newPriorSaving.name) return;
    try {
      const saved = await priorSavingsV2Api.create({ ...newPriorSaving, user_id: userId });
      setPriorSavings(p => [...p, saved]);
      setNewPriorSaving({ name:"", place:"", amount:0, has_return:false, return_pct:0 });
    } catch (err) { showToast("تعذّر الحفظ", "error"); }
  };

  const removePriorSaving = async (id) => {
    try { await priorSavingsV2Api.remove(id); setPriorSavings(p => p.filter(x=>x.id!==id)); }
    catch (err) { showToast("تعذّر الحذف", "error"); }
  };

  const totalPriorSavings = priorSavings.reduce((s,x)=>s+(x.amount||0),0);

  const handleDeleteEverything = async () => {
    try {
      await dangerZoneApi.deleteAllFinancialData(userId);
      showToast("تم حذف كل البيانات المالية");
      setDangerOpen(false);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      showToast("تعذّر حذف البيانات", "error");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800 dark:text-white">الإعدادات</h1>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-2">
        <h3 className="font-semibold text-gray-700 dark:text-white text-sm">معلومات الحساب</h3>
        <div className="text-sm text-gray-500 dark:text-gray-400">اسم المستخدم: <span className="font-medium text-gray-700 dark:text-white">{profile?.username || "—"}</span></div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
        <h3 className="font-semibold text-gray-700 dark:text-white text-sm">صيغة الأرقام</h3>
        <p className="text-xs text-gray-400">يُحفظ اختيارك ويُستخدم تلقائياً في كل مرة تسجّل فيها الدخول.</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={()=>onChangeNumberFormat("western")}
            className={`py-2.5 rounded-xl text-sm font-medium transition-all ${numberFormat==="western" ? "bg-indigo-600 text-white" : "bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300"}`}>
            123 (إنجليزية)
          </button>
          <button
            onClick={()=>onChangeNumberFormat("arabic")}
            className={`py-2.5 rounded-xl text-sm font-medium transition-all ${numberFormat==="arabic" ? "bg-indigo-600 text-white" : "bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300"}`}>
            ١٢٣ (عربية)
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Repeat size={16} className="text-green-500"/>
            <h3 className="font-semibold text-gray-700 dark:text-white text-sm">الدخل الثابت الشهري (الراتب)</h3>
          </div>
          <button onClick={()=>setModal({type:"addRecurringIncome"})} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700">
            <Plus size={14}/> إضافة
          </button>
        </div>
        {recurringIncomes.length === 0 && <div className="text-center py-4 text-gray-400 text-sm">لم تضف دخلاً ثابتاً بعد</div>}
        <div className="space-y-2">
          {recurringIncomes.map(r => (
            <div key={r.id} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/10 rounded-xl">
              <span className="text-sm font-medium text-gray-700 dark:text-white">{r.name}</span>
              <div className="flex items-center gap-3">
                <span className="font-bold text-green-600 text-sm">{fmt(r.amount)}</span>
                <button onClick={async ()=>{ await recurringIncomeApi.remove(r.id); setRecurringIncomes(rs=>rs.filter(x=>x.id!==r.id)); }} className="p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
        <h3 className="font-semibold text-gray-700 dark:text-white text-sm">الرصيد الحالي ونقطة البداية</h3>
        <Field label="شهر بداية الاستخدام" value={MONTHS_AR[localConfig.start_month]} options={MONTHS_AR} onChange={v=>setLocalConfig(c=>({...c,start_month:MONTHS_AR.indexOf(v)}))}/>
        <Field label="سنة البداية" type="number" value={localConfig.start_year} onChange={v=>setLocalConfig(c=>({...c,start_year:v}))}/>
        <Field label="الرصيد الحالي عند البداية (نقدي/بنكي)" type="number" value={localConfig.start_balance} onChange={v=>setLocalConfig(c=>({...c,start_balance:v}))} suffix="ر.س"/>
        <button onClick={saveBalanceConfig} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors">حفظ</button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-gray-700 dark:text-white text-sm mb-4">المدخرات السابقة (قبل بدء الاستخدام)</h3>
        <div className="space-y-2 mb-4">
          {priorSavings.map(s => (
            <div key={s.id} className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/10 rounded-xl">
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-white">{s.name}</div>
                {s.place && <div className="text-xs text-gray-400">{s.place}</div>}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-purple-600 text-sm">{fmt(s.amount)}</span>
                <button onClick={()=>removePriorSaving(s.id)} className="p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><Trash2 size={14}/></button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={newPriorSaving.name} onChange={e=>setNewPriorSaving(p=>({...p,name:e.target.value}))} placeholder="الاسم" className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none"/>
          <input value={newPriorSaving.place} onChange={e=>setNewPriorSaving(p=>({...p,place:e.target.value}))} placeholder="مكان الادخار" className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none"/>
        </div>
        <div className="flex gap-2">
          <input type="number" value={newPriorSaving.amount} onChange={e=>setNewPriorSaving(p=>({...p,amount:parseFloat(e.target.value)||0}))} placeholder="المبلغ" className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent dark:text-white focus:outline-none"/>
          <button onClick={addPriorSaving} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium">إضافة</button>
        </div>
        {totalPriorSavings > 0 && (
          <div className="flex justify-between pt-3 mt-3 border-t border-gray-100 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">الإجمالي</span>
            <span className="text-sm font-bold text-purple-600">{fmt(totalPriorSavings)}</span>
          </div>
        )}
      </div>

      <div className="bg-red-50 dark:bg-red-900/10 rounded-2xl p-5 border border-red-100 dark:border-red-900">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-red-500"/>
          <h3 className="font-semibold text-red-700 dark:text-red-400 text-sm">منطقة الخطر</h3>
        </div>
        <p className="text-xs text-red-500 mb-4">حذف كل سجلاتك المالية (الدخل، المصاريف، المدخرات، الديون، الأهداف) نهائياً. لا يمكن التراجع عن هذا الإجراء.</p>
        <button onClick={()=>setDangerOpen(true)} className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors">
          مسح السجل بالكامل
        </button>
      </div>

      <ConfirmDangerModal
        open={dangerOpen}
        onClose={()=>setDangerOpen(false)}
        onConfirm={handleDeleteEverything}
        title="مسح السجل بالكامل"
        message="سيتم حذف كل بياناتك المالية نهائياً: الدخل، المصاريف، المدخرات، الديون، القروض، والأهداف. هذا الإجراء لا يمكن التراجع عنه."
        confirmWord="حذف"
      />
    </div>
  );
}
