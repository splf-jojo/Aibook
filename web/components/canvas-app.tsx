"use client";

import { LogIn, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { CanvasLibrary } from "@/components/canvas-library";
import {
  API_URL,
  TOKEN_STORAGE_KEY,
  apiHeaders,
  type CanvasRecord,
} from "@/lib/canvas-api";

const THEME_KEY = "canvas_app_theme";
const LANGUAGE_KEY = "canvas_app_language";

type AppTheme = "light" | "dark";
type AppLanguage = "ru" | "en" | "zh";

const authText = {
  ru: {
    signInTitle: "Вход",
    registerTitle: "Регистрация",
    login: "Логин",
    password: "Пароль",
    confirmPassword: "Подтвердите пароль",
    signIn: "Войти",
    register: "Создать аккаунт",
    newAccount: "Нет аккаунта? Зарегистрироваться",
    existingAccount: "Уже есть аккаунт? Войти",
    invalid: "Логин — минимум 3 символа, пароль — минимум 8.",
    mismatch: "Пароли не совпадают.",
    failed: "Не удалось выполнить вход или регистрацию.",
    language: "Язык интерфейса",
  },
  en: {
    signInTitle: "Sign in",
    registerTitle: "Create account",
    login: "Username",
    password: "Password",
    confirmPassword: "Confirm password",
    signIn: "Sign in",
    register: "Create account",
    newAccount: "New here? Create an account",
    existingAccount: "Already have an account? Sign in",
    invalid: "Username must be at least 3 characters and password at least 8.",
    mismatch: "Passwords do not match.",
    failed: "Could not sign in or create the account.",
    language: "Interface language",
  },
  zh: {
    signInTitle: "登录",
    registerTitle: "创建账户",
    login: "用户名",
    password: "密码",
    confirmPassword: "确认密码",
    signIn: "登录",
    register: "创建账户",
    newAccount: "还没有账户？注册",
    existingAccount: "已有账户？登录",
    invalid: "用户名至少需要 3 个字符，密码至少需要 8 个字符。",
    mismatch: "两次输入的密码不一致。",
    failed: "无法登录或注册。",
    language: "界面语言",
  },
} satisfies Record<AppLanguage, Record<string, string>>;

const KonvaDrawingCanvas = dynamic(
  () => import("./konva-drawing-canvas").then((module) => module.KonvaDrawingCanvas),
  {
    ssr: false,
    loading: () => <main className="h-dvh bg-[#f4f5f7]" />,
  },
);

function Auth({
  language,
  onAuthenticated,
  onLanguageChange,
}: {
  language: AppLanguage;
  onAuthenticated: (token: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalid" | "mismatch" | "failed" | null>(null);
  const text = authText[language];

  const submit = async () => {
    if (busy) return;
    const normalizedUsername = username.trim();
    if (normalizedUsername.length < 3 || password.length < 8) {
      setError("invalid");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("mismatch");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/auth/${mode}`, {
        method: "POST",
        headers: apiHeaders(undefined, true),
        body: JSON.stringify({ username: normalizedUsername, password }),
      });
      if (!response.ok) throw new Error("auth");
      const payload = (await response.json()) as { access_token: string };
      localStorage.setItem(TOKEN_STORAGE_KEY, payload.access_token);
      onAuthenticated(payload.access_token);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setError(null);
    setConfirmPassword("");
  };

  return (
    <main className="relative grid h-dvh place-items-center bg-[#f4f5f7] p-6">
      <div
        aria-label={text.language}
        className="absolute right-5 top-5 flex items-center rounded-xl border border-[#dfe3e8] bg-white p-1 shadow-sm"
      >
        {(
          [
            ["ru", "RU"],
            ["zh", "中"],
            ["en", "ENG"],
          ] as const
        ).map(([id, label]) => (
          <button
            aria-pressed={language === id}
            className={`h-8 rounded-lg px-2.5 text-xs font-medium transition-colors ${
              language === id
                ? "bg-[#eff6ff] text-[#2563eb]"
                : "text-[#697386] hover:bg-[#eef0f3]"
            }`}
            key={id}
            onClick={() => onLanguageChange(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-[360px] flex-col gap-3 rounded-2xl border border-[#dfe3e8] bg-white p-6 shadow-sm"
      >
        <div className="mb-2">
          <h1 className="text-xl font-semibold text-[#111827]">
            {mode === "login" ? text.signInTitle : text.registerTitle}
          </h1>
        </div>
        <input
          aria-label={text.login}
          autoComplete="username"
          className={`h-11 rounded-lg border bg-white px-3 text-sm text-[#111827] placeholder:text-[#697386] ${error ? "border-red-400" : "border-[#dfe3e8]"}`}
          minLength={3}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={text.login}
          required
          spellCheck={false}
          value={username}
        />
        <input
          aria-label={text.password}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className={`h-11 rounded-lg border bg-white px-3 text-sm text-[#111827] placeholder:text-[#697386] ${error ? "border-red-400" : "border-[#dfe3e8]"}`}
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={text.password}
          required
          type="password"
          value={password}
        />
        {mode === "register" && (
          <input
            aria-label={text.confirmPassword}
            autoComplete="new-password"
            className={`h-11 rounded-lg border bg-white px-3 text-sm text-[#111827] placeholder:text-[#697386] ${error ? "border-red-400" : "border-[#dfe3e8]"}`}
            minLength={8}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder={text.confirmPassword}
            required
            type="password"
            value={confirmPassword}
          />
        )}
        {error ? (
          <p className="text-xs leading-5 text-red-600" role="alert">
            {text[error]}
          </p>
        ) : null}
        <button
          className="mt-1 flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {mode === "login" ? (
            <LogIn aria-hidden="true" size={18} strokeWidth={2} />
          ) : (
            <UserPlus aria-hidden="true" size={18} strokeWidth={2} />
          )}
          {mode === "login" ? text.signIn : text.register}
        </button>
        <button
          className="h-9 text-sm text-[#2563eb] hover:underline"
          disabled={busy}
          onClick={() => switchMode(mode === "login" ? "register" : "login")}
          type="button"
        >
          {mode === "login" ? text.newAccount : text.existingAccount}
        </button>
      </form>
    </main>
  );
}

export function CanvasApp() {
  const [token, setToken] = useState<string | null>(null);
  const [activeCanvas, setActiveCanvas] = useState<CanvasRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("light");
  const [language, setLanguage] = useState<AppLanguage>("en");

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const storedLanguage = localStorage.getItem(LANGUAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    if (storedLanguage === "ru" || storedLanguage === "en" || storedLanguage === "zh") {
      setLanguage(storedLanguage);
    }
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!storedToken) {
      setReady(true);
      return;
    }
    fetch(`${API_URL}/api/auth/me`, {
      headers: apiHeaders(storedToken),
    })
      .then((response) => {
        if (!response.ok) throw new Error("expired");
        setToken(storedToken);
      })
      .catch(() => localStorage.removeItem(TOKEN_STORAGE_KEY))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  }, [language, theme]);

  const changeTheme = useCallback((nextTheme: AppTheme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  }, []);

  const changeLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setActiveCanvas(null);
  }, []);

  const authenticated = useCallback((nextToken: string) => {
    setToken(nextToken);
  }, []);

  if (!ready) return <main className="h-dvh bg-[#f4f5f7]" />;
  if (!token) {
    return (
      <Auth
        language={language}
        onAuthenticated={authenticated}
        onLanguageChange={changeLanguage}
      />
    );
  }
  if (!activeCanvas) {
    return (
      <CanvasLibrary
        appTheme={theme}
        language={language}
        onLanguageChange={changeLanguage}
        onLogout={logout}
        onOpen={setActiveCanvas}
        onThemeChange={changeTheme}
        token={token}
      />
    );
  }
  return (
    <KonvaDrawingCanvas
      canvas={activeCanvas}
      key={activeCanvas.id}
      language={language}
      onBack={() => setActiveCanvas(null)}
      onLogout={logout}
      token={token}
    />
  );
}
