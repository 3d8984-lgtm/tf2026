import PageHeader from "@/components/PageHeader";

export default function Licenses() {
  return (
    <div className="space-y-6">
      <PageHeader title="오픈소스 라이선스" description="이 시스템에 포함된 오픈소스 소프트웨어 고지" />

      <section className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-foreground">PiD (Pixel-aware Image Diffusion)</h2>
        <p className="text-sm text-muted-foreground">
          이미지 업스케일링에 NVIDIA Toronto AI Lab의 PiD 모델을 사용합니다.
        </p>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Repository: <a className="text-primary hover:underline" href="https://github.com/nv-tlabs/PiD" target="_blank" rel="noreferrer">https://github.com/nv-tlabs/PiD</a></div>
          <div>License: Apache License, Version 2.0</div>
        </div>
        <pre className="rounded bg-muted/40 p-3 text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
{`Copyright (c) NVIDIA Corporation. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`}
        </pre>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 space-y-2">
        <h2 className="text-lg font-semibold text-foreground">기타 사용 중인 오픈소스</h2>
        <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
          <li>React, Vite, TypeScript — MIT</li>
          <li>Tailwind CSS, shadcn/ui, lucide-react — MIT</li>
          <li>Supabase JS SDK — MIT</li>
          <li>Sharp, archiver (워커) — Apache-2.0 / MIT</li>
        </ul>
      </section>
    </div>
  );
}
