// src/lib/supabase.js
// طبقة الاتصال بـ Supabase - كل استعلامات قاعدة البيانات تمر من هنا

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── AUTH ─────────────────────────────────────────────────────────────────
export const auth = {
  signUp: (email, password, fullName) =>
    supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }),

  signIn: (email, password) =>
    supabase.auth.signInWithPassword({ email, password }),

  signOut: () => supabase.auth.signOut(),

  getSession: () => supabase.auth.getSession(),

  onAuthChange: (callback) => supabase.auth.onAuthStateChange(callback),
};

// ─── PROFILE ──────────────────────────────────────────────────────────────
export const profileApi = {
  get: async (userId) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
  },
  update: async (userId, patch) => {
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select().single();
    if (error) throw error;
    return data;
  },
};

// ─── GENERIC MONTH-SCOPED TABLE HELPERS ─────────────────────────────────────
// تستخدم لـ income_entries, fixed_expenses, variable_expenses, savings_entries
const monthScopedApi = (table) => ({
  list: async (userId, year, month) => {
    const { data, error } = await supabase
      .from(table).select('*')
      .eq('user_id', userId).eq('year', year).eq('month', month)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },
  listYear: async (userId, year) => {
    const { data, error } = await supabase
      .from(table).select('*')
      .eq('user_id', userId).eq('year', year);
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
  },
});

export const incomeApi = monthScopedApi('income_entries');
export const fixedExpenseApi = monthScopedApi('fixed_expenses');
export const variableExpenseApi = monthScopedApi('variable_expenses');
export const savingsApi = monthScopedApi('savings_entries');

// ─── MONTH SETTINGS (savings target %) ──────────────────────────────────────
export const monthSettingsApi = {
  get: async (userId, year, month) => {
    const { data, error } = await supabase
      .from('month_settings').select('*')
      .eq('user_id', userId).eq('year', year).eq('month', month)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  upsert: async (userId, year, month, savingsTargetPct, savingsTargetType, savingsTargetAmount) => {
    const patch = {
      user_id: userId, year, month,
      savings_target_pct: savingsTargetPct ?? 0.2,
    };
    if (savingsTargetType !== undefined) patch.savings_target_type = savingsTargetType;
    if (savingsTargetAmount !== undefined) patch.savings_target_amount = savingsTargetAmount;
    const { data, error } = await supabase
      .from('month_settings')
      .upsert(patch, { onConflict: 'user_id,year,month' })
      .select().single();
    if (error) throw error;
    return data;
  },
};

// ─── LOANS ────────────────────────────────────────────────────────────────
export const loansApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('loans').select('*').eq('user_id', userId).order('start_date');
    if (error) throw error;
    return data;
  },
  create: async (loan) => {
    // القيم monthly_payment و months_count و end_date تأتي محسوبة من LoanForm
    // نحذف فقط الحقول الخاصة بالـ frontend
    const {
      _customAmounts, monthly_payment_input, payment_type_mode,
      deduct_on_create, add_on_create,
      ...loanData
    } = loan;
    const { data, error } = await supabase.from('loans').insert(loanData).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { _customAmounts, monthly_payment_input, payment_type_mode, ...cleanPatch } = patch;
    const { data, error } = await supabase.from('loans').update(cleanPatch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('loans').delete().eq('id', id);
    if (error) throw error;
  },
  // ديون نشطة في شهر/سنة معينة (للاستخدام في حساب الالتزامات الثابتة)
  activeInMonth: async (userId, year, month) => {
    const monthStart = new Date(year, month, 1).toISOString().slice(0, 10);
    const monthEnd = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('loans').select('*')
      .eq('user_id', userId)
      .lte('start_date', monthEnd)
      .gte('end_date', monthStart);
    if (error) throw error;
    return data;
  },
};

// ─── PERSONAL DEBTS ──────────────────────────────────────────────────────────
export const personalDebtsApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('personal_debts').select('*').eq('user_id', userId).order('due_date');
    if (error) throw error;
    return data;
  },
  create: async (debt) => {
    const { data, error } = await supabase.from('personal_debts').insert(debt).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('personal_debts').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('personal_debts').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── GOALS ────────────────────────────────────────────────────────────────
export const goalsApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  create: async (goal) => {
    const { data, error } = await supabase.from('goals').insert(goal).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('goals').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('goals').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── PRIOR SAVINGS ────────────────────────────────────────────────────────────
export const priorSavingsApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('prior_savings').select('*').eq('user_id', userId);
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from('prior_savings').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('prior_savings').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── HOUSEHOLDS (مشاركة عائلية) ──────────────────────────────────────────────
export const householdApi = {
  create: async (name, ownerId) => {
    const { data, error } = await supabase.from('households').insert({ name, owner_id: ownerId }).select().single();
    if (error) throw error;
    // أضف المالك كعضو تلقائياً
    await supabase.from('household_members').insert({ household_id: data.id, user_id: ownerId, role: 'owner' });
    return data;
  },
  inviteMember: async (householdId, userId) => {
    const { data, error } = await supabase.from('household_members').insert({ household_id: householdId, user_id: userId, role: 'member' }).select().single();
    if (error) throw error;
    return data;
  },
  listMembers: async (householdId) => {
    const { data, error } = await supabase.from('household_members').select('*, profiles(full_name)').eq('household_id', householdId);
    if (error) throw error;
    return data;
  },
};

// ─── RECURRING INCOME (الدخل الثابت الشهري - الراتب) ─────────────────────────
export const recurringIncomeApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('recurring_income').select('*').eq('user_id', userId).eq('active', true);
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from('recurring_income').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('recurring_income').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  deactivate: async (id) => {
    const { data, error } = await supabase.from('recurring_income').update({ active: false }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('recurring_income').delete().eq('id', id);
    if (error) throw error;
  },
  // الحالة الفعلية لشهر معين (تعديل المبلغ أو "لم يُستلم")
  getOverride: async (recurringIncomeId, year, month) => {
    const { data, error } = await supabase
      .from('recurring_income_overrides').select('*')
      .eq('recurring_income_id', recurringIncomeId).eq('year', year).eq('month', month)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  listOverridesForMonth: async (userId, year, month) => {
    const { data, error } = await supabase
      .from('recurring_income_overrides').select('*')
      .eq('user_id', userId).eq('year', year).eq('month', month);
    if (error) throw error;
    return data;
  },
  upsertOverride: async (userId, recurringIncomeId, year, month, { actualAmount, received }) => {
    const { data, error } = await supabase
      .from('recurring_income_overrides')
      .upsert({
        user_id: userId,
        recurring_income_id: recurringIncomeId,
        year, month,
        actual_amount: actualAmount,
        received,
      }, { onConflict: 'recurring_income_id,year,month' })
      .select().single();
    if (error) throw error;
    return data;
  },
};

// ─── LOAN PAYMENTS (دوائر السداد الشهرية - تُضغط يدوياً) ─────────────────────
export const loanPaymentsApi = {
  listForLoan: async (loanId) => {
    const { data, error } = await supabase.from('loan_payments').select('*').eq('loan_id', loanId);
    if (error) throw error;
    return data;
  },
  listForYear: async (userId, year) => {
    const { data, error } = await supabase.from('loan_payments').select('*').eq('user_id', userId).eq('year', year);
    if (error) throw error;
    return data;
  },
  togglePaid: async (userId, loanId, year, month, isPaid, paymentType = 'now', paidAmount = null) => {
    const { data, error } = await supabase
      .from('loan_payments')
      .upsert({
        user_id: userId,
        loan_id: loanId,
        year, month,
        is_paid: isPaid,
        payment_type: isPaid ? (paymentType || 'now') : null,
        paid_amount: paidAmount,
        paid_at: isPaid ? new Date().toISOString() : null,
      }, { onConflict: 'loan_id,year,month' })
      .select().single();
    if (error) throw error;
    return data;
  },
};

// ─── DEBTS OWED TO ME (ديون لي - أنا الدائن) ─────────────────────────────────
export const debtsOwedToMeApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('debts_owed_to_me').select('*').eq('user_id', userId).order('due_date');
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from('debts_owed_to_me').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('debts_owed_to_me').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('debts_owed_to_me').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── DEBTS I OWE (ديون عليّ - أنا المدين) ───────────────────────────────────
export const debtsIOweApi = {
  list: async (userId) => {
    const { data, error } = await supabase.from('debts_i_owe').select('*').eq('user_id', userId).order('due_date');
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from('debts_i_owe').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('debts_i_owe').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('debts_i_owe').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── USER BALANCE CONFIG (الرصيد الحالي وإعدادات البداية) ───────────────────
export const balanceConfigApi = {
  get: async (userId) => {
    const { data, error } = await supabase.from('user_balance_config').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  },
  upsert: async (userId, patch) => {
    const { data, error } = await supabase
      .from('user_balance_config')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      .select().single();
    if (error) throw error;
    return data;
  },
};

// ─── PRIOR SAVINGS V2 (مدخرات سابقة - مع تصنيف) ──────────────────────────────
export const priorSavingsV2Api = {
  list: async (userId) => {
    const { data, error } = await supabase.from('prior_savings_v2').select('*').eq('user_id', userId);
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from('prior_savings_v2').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('prior_savings_v2').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('prior_savings_v2').delete().eq('id', id);
    if (error) throw error;
  },
};

// ─── DANGER ZONE: مسح السجل بالكامل ──────────────────────────────────────────
// يستدعي دالة قاعدة البيانات delete_all_user_financial_data التي تحذف كل البيانات
// المالية للمستخدم (لا تحذف الحساب نفسه أو الـ profile)
export const dangerZoneApi = {
  deleteAllFinancialData: async (userId) => {
    const { error } = await supabase.rpc('delete_all_user_financial_data', { target_user_id: userId });
    if (error) throw error;
  },
};

// ─── LOAN MONTH AMOUNTS - مبالغ مخصصة لكل شهر ─────────────────────────────
export const loanMonthAmountsApi = {
  listForLoan: async (loanId) => {
    const { data, error } = await supabase.from('loan_month_amounts').select('*').eq('loan_id', loanId).order('month_index');
    if (error) throw error;
    return data;
  },
  upsert: async (userId, loanId, monthIndex, amount) => {
    const { data, error } = await supabase
      .from('loan_month_amounts')
      .upsert({ user_id: userId, loan_id: loanId, month_index: monthIndex, amount },
        { onConflict: 'loan_id,month_index' })
      .select().single();
    if (error) throw error;
    return data;
  },
  bulkUpsert: async (userId, loanId, amounts) => {
    // amounts: [{month_index, amount}]
    const rows = amounts.map(a => ({ user_id: userId, loan_id: loanId, month_index: a.month_index, amount: a.amount }));
    const { data, error } = await supabase
      .from('loan_month_amounts')
      .upsert(rows, { onConflict: 'loan_id,month_index' })
      .select();
    if (error) throw error;
    return data;
  },
};

// ─── RECURRING OBLIGATIONS - الالتزامات المتكررة ──────────────────────────────
export const recurringObligationsApi = {
  list: async (userId) => {
    const { data, error } = await supabase
      .from('recurring_obligations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at');
    if (error) throw error;
    return data;
  },
  create: async (row) => {
    const { data, error } = await supabase.from('recurring_obligations').insert(row).select().single();
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('recurring_obligations').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('recurring_obligations').delete().eq('id', id);
    if (error) throw error;
  },
};

export const recurringObligationPaymentsApi = {
  listForObligation: async (obligationId) => {
    const { data, error } = await supabase.from('recurring_obligation_payments').select('*').eq('obligation_id', obligationId);
    if (error) throw error;
    return data;
  },
  togglePaid: async (userId, obligationId, year, month, isPaid, actualAmount) => {
    const { data, error } = await supabase
      .from('recurring_obligation_payments')
      .upsert({
        user_id: userId,
        obligation_id: obligationId,
        year, month,
        is_paid: isPaid,
        actual_amount: actualAmount,
        paid_at: isPaid ? new Date().toISOString() : null,
      }, { onConflict: 'obligation_id,year,month' })
      .select().single();
    if (error) throw error;
    return data;
  },
};

// ─── BALANCE TRANSACTIONS - حركات الرصيد ─────────────────────────────────────
export const balanceTransactionsApi = {
  list: async (userId, limit = 50) => {
    const { data, error } = await supabase
      .from('balance_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },
  add: async (userId, { amount, reason, transaction_type, reference_id }) => {
    const { data, error } = await supabase
      .from('balance_transactions')
      .insert({ user_id: userId, amount, reason, transaction_type, reference_id })
      .select().single();
    if (error) throw error;
    return data;
  },
};
