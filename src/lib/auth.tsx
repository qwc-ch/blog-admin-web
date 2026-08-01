import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clearAuth, isAuthenticated, setUnauthorizedHandler } from "./api";
import LoginModal from "../components/Login";

interface AuthContextValue {
  loggedIn: boolean;
  /** 需要登录才能继续的操作: 未登录时先弹登录框, 登录成功后自动执行 action */
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
  const loggedInRef = useRef(loggedIn);
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loggedInRef.current = loggedIn;
  }, [loggedIn]);

  useEffect(() => {
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
      pendingRef.current = action;
      setLoginOpen(true);
    }
  }, []);

  const openLogin = useCallback(() => {
    pendingRef.current = null;
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    pendingRef.current = null;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setLoggedIn(false);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setLoggedIn(true);
    setLoginOpen(false);
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.();
  }, []);

  return (
    <AuthContext.Provider
      value={{ loggedIn, requireLogin, openLogin, closeLogin, logout }}
    >
      {children}
      <LoginModal
        open={loginOpen}
        onClose={closeLogin}
        onLogin={handleLoginSuccess}
      />
    </AuthContext.Provider>
  );
}
