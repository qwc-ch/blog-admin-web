import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearAuth,
  handleOAuthCallback,
  isAuthenticated,
  setUnauthorizedHandler,
} from "./api";
import LoginModal from "../components/Login";

interface AuthContextValue {
  loggedIn: boolean;
  /** 需要登录才能继续的操作: 未登录时先弹登录框 (GitHub 跳转登录, 登录后返回需重新操作) */
  requireLogin: (action: () => void) => void;
  openLogin: () => void;
  closeLogin: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  loggedIn: false,
  requireLogin: () => {},
  openLogin: () => {},
  closeLogin: () => {},
  logout: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState(isAuthenticated());
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const loggedInRef = useRef(loggedIn);

  useEffect(() => {
    loggedInRef.current = loggedIn;
  }, [loggedIn]);

  useEffect(() => {
    // OAuth 回调: 读取并保存 token / 展示错误, 并清理 URL
    const { ok, error } = handleOAuthCallback();
    if (error) {
      setLoginError(error);
      setLoginOpen(true);
    } else if (ok) {
      setLoggedIn(true);
    }

    // 请求返回 401 (token 失效): 只同步登录状态, 不自动弹框;
    // 之后用户执行写操作 (requireLogin) 时自然会弹出登录框
    setUnauthorizedHandler(() => {
      if (loggedInRef.current) {
        setLoggedIn(false);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const requireLogin = useCallback((action: () => void) => {
    if (loggedInRef.current) {
      action();
    } else {
      setLoginOpen(true);
    }
  }, []);

  const openLogin = useCallback(() => {
    setLoginError(null);
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setLoginError(null);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setLoggedIn(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ loggedIn, requireLogin, openLogin, closeLogin, logout }}
    >
      {children}
      <LoginModal
        open={loginOpen}
        onClose={closeLogin}
        initialError={loginError}
      />
    </AuthContext.Provider>
  );
}
