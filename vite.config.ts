import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_TARGET = "https://api.520781.xyz";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  // 本地开发: 浏览器请求同源, 由 Vite 代理到后端, 无跨域问题
  server: {
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/img": { target: API_TARGET, changeOrigin: true },
    },
  },
});
