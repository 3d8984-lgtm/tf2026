import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  // 현장 PC의 구형 크롬(옵셔널 체이닝 미지원)에서도 실행되도록 빌드 타깃을 낮춘다.
  build: {
    target: ["es2015", "chrome64", "edge79", "firefox67", "safari12"],
  },
  esbuild: {
    target: "es2015",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

}));
