// src/App.jsx
// نقطة الدخول الرئيسية - يدير حالة تسجيل الدخول ويعرض Login أو BudgetApp

import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./components/Login";
import BudgetApp from "./components/BudgetApp";
import { Wallet } from "lucide-react";

function AppGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse">
            <Wallet size={24} className="text-white" />
          </div>
          <span className="text-sm text-gray-400">جاري التحميل...</span>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  return <BudgetApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  );
}
