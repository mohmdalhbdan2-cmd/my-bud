// src/components/Login.jsx
// شاشة تسجيل الدخول وإنشاء حساب جديد

import { useState } from "react";
import { Wallet, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const f = (key, value) => setForm((p) => ({ ...p, [key]: value }));

  const validate = () => {
    if (!form.email || !form.password) return "يرجى تعبئة البريد الإلكتروني وكلمة المرور";
    if (mode === "signup") {
      if (!form.username.trim()) return "يرجى كتابة اسم المستخدم";
      if (form.password.length < 6) return "كلمة المرور يجب أن تكون 6 أحرف على الأقل";
      if (form.password !== form.confirmPassword) return "كلمتا المرور غير متطابقتين";
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(form.email, form.password);
      } else {
        await signUp(form.email, form.password, form.username.trim(), form.username.trim());
        setSuccessMsg("تم إنشاء حسابك بنجاح! تحقق من بريدك الإلكتروني لتأكيد الحساب، ثم سجّل دخولك.");
        setMode("login");
        setForm({ username: "", email: form.email, password: "", confirmPassword: "" });
      }
    } catch (err) {
      setError(translateError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const translateError = (msg) => {
    if (msg?.includes("Invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
    if (msg?.includes("User already registered")) return "هذا البريد الإلكتروني مسجّل مسبقاً";
    if (msg?.includes("Email not confirmed")) return "يرجى تأكيد بريدك الإلكتروني أولاً (تحقق من صندوق الوارد)";
    if (msg?.includes("Password should be")) return "كلمة المرور ضعيفة جداً، اختر كلمة مرور أقوى";
    return msg || "حدث خطأ، حاول مرة أخرى";
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-4" style={{fontFamily:"'IBM Plex Sans Arabic','Tajawal',sans-serif"}}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none mb-4">
            <Wallet size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">ميزانيتي</h1>
          <p className="text-sm text-gray-400 mt-1">إدارة مالية ذكية لك ولعائلتك</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl shadow-gray-100 dark:shadow-none border border-gray-100 dark:border-gray-800 p-6 sm:p-8">
          {/* Tabs */}
          <div className="flex bg-gray-50 dark:bg-gray-800 rounded-2xl p-1 mb-6">
            <button
              onClick={() => { setMode("login"); setError(""); setSuccessMsg(""); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                mode === "login" ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-gray-400"
              }`}>
              تسجيل الدخول
            </button>
            <button
              onClick={() => { setMode("signup"); setError(""); setSuccessMsg(""); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                mode === "signup" ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-gray-400"
              }`}>
              حساب جديد
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-xl">
              <CheckCircle size={16} className="text-green-500 shrink-0 mt-0.5" />
              <span className="text-sm text-green-600 dark:text-green-400">{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-1.5">اسم المستخدم</label>
                <div className="relative">
                  <User size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" />
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => f("username", e.target.value)}
                    placeholder="مثال: محمد_العتيبي"
                    className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-1.5">البريد الإلكتروني</label>
              <div className="relative">
                <Mail size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => f("email", e.target.value)}
                  placeholder="example@email.com"
                  dir="ltr"
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-1.5">كلمة المرور</label>
              <div className="relative">
                <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => f("password", e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full pr-10 pl-10 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === "signup" && (
              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-300 block mb-1.5">تأكيد كلمة المرور</label>
                <div className="relative">
                  <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.confirmPassword}
                    onChange={(e) => f("confirmPassword", e.target.value)}
                    placeholder="••••••••"
                    dir="ltr"
                    className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-medium transition-colors mt-2">
              {loading ? "جاري المعالجة..." : mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          {mode === "login" ? "ما عندك حساب؟ " : "عندك حساب مسبقاً؟ "}
          <button
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setSuccessMsg(""); }}
            className="text-indigo-500 font-medium hover:underline">
            {mode === "login" ? "أنشئ حساب جديد" : "سجّل دخولك"}
          </button>
        </p>
      </div>
    </div>
  );
}
