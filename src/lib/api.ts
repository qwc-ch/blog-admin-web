const API_BASE = import.meta.env.VITE_API_BASE || "";
const TOKEN_KEY = "firefly_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

let unauthorizedHandler: (() => void) | null = null;

/** 注册 401 处理回调 (由 AuthProvider 注册, 用于弹出登录框) */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

/** 跳转到 GitHub 授权页 (完整浏览器跳转) */
export function githubLoginUrl(): string {
  return `${API_BASE}/api/auth/github`;
}

/** 处理 OAuth 回调 URL: 读取 token/error, 保存 token, 清理 URL。返回结果 */
export function handleOAuthCallback(): { ok: boolean; error: string | null } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const error = params.get("error");
  if (!token && !error) return { ok: false, error: null };
  if (token) setToken(token);
  // 立即清理 URL, 防止 token/error 留在地址栏和浏览器历史里
  const cleanUrl = `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
  return { ok: !!token, error };
}

async function request(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 429) {
    throw new Error("请求过于频繁，请稍后重试");
  }

  if (res.status === 401) {
    clearAuth();
    unauthorizedHandler?.();
    throw new Error("请先登录");
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `请求失败: ${res.status}`);
  }

  return res.json();
}

export interface PostMeta {
  slug: string;
  title: string;
  published: string;
  updated?: string;
  draft: boolean;
  description: string;
  image: string;
  tags: string[];
  category: string;
  lang: string;
  pinned: boolean;
  author: string;
  comment: boolean;
  licenseName?: string;
  licenseUrl?: string;
  sourceLink?: string;
  password?: string;
  passwordHint?: string;
}

export interface PostContent extends PostMeta {
  content: string;
}

export interface ImageItem {
  key: string;
  size: number;
  url: string;
}

function enc(slug: string) {
  return encodeURIComponent(slug);
}

export const postsApi = {
  list: () => request("/api/posts") as Promise<PostMeta[]>,
  get: (slug: string) =>
    request(`/api/posts/${enc(slug)}`) as Promise<PostContent>,
  create: (data: {
    slug: string;
    frontmatter: Record<string, unknown>;
    content: string;
  }) => request("/api/posts", { method: "POST", body: JSON.stringify(data) }),
  update: (
    slug: string,
    data: { frontmatter: Record<string, unknown>; content: string },
  ) =>
    request(`/api/posts/${enc(slug)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (slug: string) =>
    request(`/api/posts/${enc(slug)}`, { method: "DELETE" }),
};

export const imagesApi = {
  list: () => request("/api/images") as Promise<ImageItem[]>,
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/images/upload", { method: "POST", body: form });
  },
  delete: (key: string) =>
    request(`/api/images/${encodeURIComponent(key)}`, { method: "DELETE" }),
};

/** 带进度回调的图片上传 (XHR), 返回图片 URL */
export function uploadImageWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          resolve(result.url);
        } catch {
          reject(new Error("解析响应失败"));
        }
      } else if (xhr.status === 401) {
        clearAuth();
        unauthorizedHandler?.();
        reject(new Error("请先登录"));
      } else if (xhr.status === 429) {
        reject(new Error("上传过于频繁，请稍后重试"));
      } else {
        reject(new Error(`上传失败: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.open("POST", `${API_BASE}/api/images/upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
    xhr.send(form);
  });
}

export const siteConfigApi = {
  get: () =>
    request("/api/config/site") as Promise<{
      config: Record<string, unknown>;
      sha: string;
    }>,
  save: (config: Record<string, unknown>, sha: string, message?: string) =>
    request("/api/config/site", {
      method: "PUT",
      body: JSON.stringify({ config, sha, message }),
    }),
};

export const friendsConfigApi = {
  get: () =>
    request("/api/config/friends") as Promise<{
      friends: unknown[];
      friendsPage: Record<string, unknown>;
      sha: string;
    }>,
  save: (
    friends: unknown[],
    friendsPage: Record<string, unknown>,
    sha: string,
    message?: string,
  ) =>
    request("/api/config/friends", {
      method: "PUT",
      body: JSON.stringify({ friends, friendsPage, sha, message }),
    }),
};
