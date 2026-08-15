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
  // 단, 일부 의존성이 BigInt 리터럴을 사용하므로 BigInt를 지원하는 최소 버전으로 설정.
  build: {
    target: ["chrome67", "edge79", "firefox68", "safari14"],
  },
  esbuild: {
    target: "chrome67",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

}));
