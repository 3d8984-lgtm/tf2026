import { useEffect, useMemo, useRef, useState } from 'react';
import PatternFrame from './PatternFrame';
import { Analysis, BUILTIN_SHAPES, DEFAULTS, Params, Shape, analyzeImage, applyAnalysis, blobify, fileToMask, pickShapes } from './patternEngine';

export type Saved = { shapes: (Shape | null)[]; bgShapes: (Shape | null)[]; art: string | null; analysis: Analysis | null; p: Params; frameSvg: string | null };

/** Normalize a (possibly partial) saved object coming from the server. */
export function normalizeSaved(s: any): Saved {
  s = s || {};
  const strip = (x: any) => (x && x.data ? { data: x.data, url: x.data } : null);
  return {
    shapes: [...(s.shapes || []).map(strip), ...Array(16).fill(null)].slice(0, 16),
    bgShapes: [...(s.bgShapes || []).map(strip), ...Array(8).fill(null)].slice(0, 8),
    art: s.art || null, analysis: s.analysis || null, p: { ...DEFAULTS, ...(s.p || {}) },
    frameSvg: typeof s.frameSvg === 'string' ? s.frameSvg : null,
  };
}

/** Strip blob URLs before sending to the server (only data URLs are portable). */
export function serializeSaved(s: Saved) {
  return { ...s, shapes: s.shapes.map(x => x && { data: x.data, url: x.data }), bgShapes: s.bgShapes.map(x => x && { data: x.data, url: x.data }) };
}

// ---- small UI atoms (inline styles; swap for shadcn/ui if desired) ----
const Row = ({ label, value, children }: { label: string; value?: string | number; children: React.ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
    <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span>{value !== undefined && <b>{value}</b>}</span>{children}
  </label>
);
const Slider = ({ k, min, max, step = 1, p, set, unit = '' , label }: { k: keyof Params; min: number; max: number; step?: number; p: Params; set: (k: keyof Params, v: any) => void; unit?: string; label: string }) => (
  <Row label={label} value={`${p[k]}${unit}`}><input type="range" min={min} max={max} step={step} value={p[k] as number} onChange={e => set(k, +e.target.value)} style={{ width: '100%', accentColor: '#161616' }} /></Row>
);
const Color = ({ k, p, set, label }: { k: keyof Params; p: Params; set: (k: keyof Params, v: any) => void; label: string }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}><span>{label}</span><input type="color" value={p[k] as string} onChange={e => set(k, e.target.value)} style={{ width: '100%', height: 32, border: '1px solid #ccc', borderRadius: 4, padding: 2, background: '#fff' }} /></label>
);
const Check = ({ k, p, set, label }: { k: keyof Params; p: Params; set: (k: keyof Params, v: any) => void; label: string }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" checked={!!p[k]} onChange={e => set(k, e.target.checked)} />{label}</label>
);
const Seg = <T,>({ k, p, set, label, options }: { k: keyof Params; p: Params; set: (k: keyof Params, v: any) => void; label: string; options: [T, string][] }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}><span>{label}</span>
    <div style={{ display: 'flex', gap: 4 }}>{options.map(([v, l]) => { const on = p[k] === v; return <button key={String(v)} onClick={() => set(k, v)} style={{ flex: 1, padding: '6px 4px', border: `1px solid ${on ? '#161616' : '#ccc'}`, borderRadius: 4, background: on ? '#161616' : '#fff', color: on ? '#fff' : '#161616', fontSize: 12, cursor: 'pointer' }}>{l}</button>; })}</div>
  </div>
);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><div style={{ fontSize: 12, fontWeight: 700 }}>{title}</div>{children}</div>
);
const ShapeSlots = ({ shapes, onFile, onClear, cols = 4 }: { shapes: (Shape | null)[]; onFile: (i: number, f: File) => void; onClear: (i: number) => void; cols?: number }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 8 }}>
    {shapes.map((s, i) => (
      <label key={i} style={{ position: 'relative', aspectRatio: '1', border: '1px dashed #bbb', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fafafa' }}>
        <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(i, f); e.target.value = ''; }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        {s ? <div style={{ width: '70%', height: '70%', background: '#161616', WebkitMaskImage: `url("${blobify(s.data || s.url)}")`, maskImage: `url("${blobify(s.data || s.url)}")`, WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' } as React.CSSProperties} /> : <span style={{ fontSize: 18, color: '#bbb' }}>+</span>}
        {s && <button onClick={e => { e.preventDefault(); e.stopPropagation(); onClear(i); }} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, border: 0, borderRadius: 8, background: '#161616', color: '#fff', fontSize: 10, lineHeight: '16px', padding: 0, cursor: 'pointer' }}>×</button>}
      </label>
    ))}
  </div>
);

/** Controlled studio: state is owned by the parent (server-saved per size). */
export default function PatternStudio7({ value, onChange }: { value: Saved; onChange: (next: Saved) => void }) {
  const st = value;
  const stRef = useRef(st); stRef.current = st;
  const setSt = (fn: (s: Saved) => Saved) => onChange(fn(stRef.current));
  const [frameW, setFrameW] = useState(700);
  const frameRef = useRef<HTMLDivElement>(null);
  const p = st.p;

  useEffect(() => { const ro = new ResizeObserver(() => { const w = frameRef.current?.getBoundingClientRect().width; if (w) setFrameW(Math.round(w)); }); if (frameRef.current) ro.observe(frameRef.current); return () => ro.disconnect(); }, []);

  const set = (k: keyof Params, v: any) => setSt(s => ({ ...s, p: { ...s.p, [k]: v, ...(k === 'bgFill' ? { bgFillPaper: false } : {}) } }));
  const setMany = (patch: Partial<Params>) => setSt(s => ({ ...s, p: { ...s.p, ...patch } }));

  const safe = (arr: (Shape | null)[]) => arr.filter((s): s is Shape => !!s).map(s => ({ ...s, url: blobify(s.data || s.url) }));
  const allShapes = useMemo(() => { const up = safe(st.shapes); return up.length ? up : BUILTIN_SHAPES; }, [st.shapes]);
  const shapes = useMemo(() => pickShapes(allShapes, p), [allShapes, p.pickCount, p.pickSeed]);
  const bgShapes = useMemo(() => safe(st.bgShapes), [st.bgShapes]);
  const artUrl = st.art ? blobify(st.art) : null;

  const onFrameSvg = async (f: File) => {
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
    setSt(s => ({ ...s, frameSvg: data }));
  };
  const clearFrameSvg = () => setSt(s => ({ ...s, frameSvg: null }));

  const onArt = async (f: File) => {
    const { art, analysis } = await analyzeImage(f);
    setSt(s => { const p2 = { ...s.p, pickSeed: Math.floor(Math.random() * 1e6) + 1 }; return { ...s, art, analysis, p: p2.auto ? { ...p2, ...applyAnalysis(p2, analysis) } : p2 }; });
  };
  const onShape = async (key: 'shapes' | 'bgShapes', i: number, f: File) => { const m = await fileToMask(f); setSt(s => { const arr = s[key].slice(); arr[i] = m; return { ...s, [key]: arr }; }); };
  const clearShape = (key: 'shapes' | 'bgShapes', i: number) => setSt(s => { const arr = s[key].slice(); arr[i] = null; return { ...s, [key]: arr }; });

  const input: React.CSSProperties = { width: '100%', accentColor: '#161616' };

  return (
    <div style={{ display: 'flex', height: 760, background: '#ecebe7', fontFamily: 'Helvetica, Arial, sans-serif', color: '#161616', borderRadius: 8, overflow: 'hidden' }}>
      <aside style={{ width: 300, flex: 'none', background: '#fff', borderRight: '1px solid #ddd', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 22, boxSizing: 'border-box', overflow: 'auto', height: '100%' }}>
        <div><div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#888' }}>Twinmeta · 07</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Sticker Outline</div></div>

        <Section title="프레임 (SVG 업로드)">
          <label style={{ position: 'relative', height: 96, border: '1px dashed #bbb', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fafafa' }}>
            <input type="file" accept=".svg,image/svg+xml" onChange={e => { const f = e.target.files?.[0]; if (f) onFrameSvg(f); e.target.value = ''; }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
            {st.frameSvg ? <div style={{ width: '100%', height: '100%', background: `url("${st.frameSvg}") center/contain no-repeat` }} /> : <span style={{ fontSize: 12, color: '#999', textAlign: 'center', padding: '0 8px' }}>클릭해서 SVG 프레임 업로드<br />(없으면 기본 팔각형 프레임 사용)</span>}
            {st.frameSvg && <button onClick={e => { e.preventDefault(); e.stopPropagation(); clearFrameSvg(); }} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, border: 0, borderRadius: 10, background: '#161616', color: '#fff', fontSize: 12, lineHeight: '20px', padding: 0, cursor: 'pointer' }}>×</button>}
          </label>
          <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>SVG를 올리면 기본 팔각형 배경 대신 해당 프레임이 전체 영역에 적용됩니다. 패턴 도형과 중앙 이미지는 그대로 위에 얹힙니다.</div>
        </Section>

        <Section title="인플루언서 이미지 (검은 영역)">
          <label style={{ position: 'relative', height: 96, border: '1px dashed #bbb', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fafafa' }}>
            <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) onArt(f); e.target.value = ''; }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
            {artUrl ? <div style={{ width: '100%', height: '100%', background: `url("${artUrl}") center/cover` }} /> : <span style={{ fontSize: 12, color: '#999' }}>클릭해서 이미지 업로드</span>}
          </label>
          {st.analysis && (<>
            <div style={{ display: 'flex', gap: 4 }}>{st.analysis.palette.map(h => <div key={h} style={{ flex: 1, height: 18, borderRadius: 3, background: h }} />)}</div>
            <div style={{ fontSize: 11, color: '#666', lineHeight: 1.5 }}>밝기 → 밀도, 대비 → 해칭 비율, 복잡도 → 크기 편차·회전 (색상·기본 크기 유지)</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><input type="checkbox" checked={p.auto} onChange={e => { set('auto', e.target.checked); if (e.target.checked && st.analysis) setMany(applyAnalysis(p, st.analysis)); }} />이미지에 따라 효과 자동 적용</label>
            {p.auto && <Row label="적용 강도" value={`${p.autoStrength}%`}><input type="range" min={0} max={100} value={p.autoStrength} onChange={e => { const v = +e.target.value; const p2 = { ...p, autoStrength: v }; setMany({ autoStrength: v, ...applyAnalysis(p2, st.analysis!) }); }} style={input} /></Row>}
          </>)}
        </Section>

        <Section title="배경 패턴 도형 (외곽선 레이어)">
          <ShapeSlots shapes={st.bgShapes} onFile={(i, f) => onShape('bgShapes', i, f)} onClear={i => clearShape('bgShapes', i)} />
          <Check k="bgOn" p={p} set={set} label="배경 외곽선 레이어 표시" />
          {p.bgOn && (<>
            <Slider k="bgCount" min={10} max={300} step={5} p={p} set={set} label="배경 도형 개수" />
            <Slider k="bgSize" min={30} max={200} step={5} p={p} set={set} unit="%" label="배경 도형 크기 (띠 폭 대비)" />
            <Slider k="bgSizeVar" min={0} max={80} p={p} set={set} unit="%" label="크기 편차" />
            <Slider k="bgRot" min={0} max={180} p={p} set={set} unit="°" label="회전 폭" />
            <Slider k="bgOverlap" min={0} max={100} p={p} set={set} unit="%" label="겹침 허용" />
            <Slider k="bgStroke" min={1} max={15} step={0.5} p={p} set={set} unit="%" label="외곽선 굵기 (모두 동일, 띠 폭 대비)" />
            <Seg k="bgRows" p={p} set={set} label="띠 안 줄 수 (도형 배치)" options={[[0, '자유 배치'], [1, '한 줄'], [2, '두 줄']]} />
            {p.bgRows > 0 && <Slider k="bgRowJitter" min={0} max={100} p={p} set={set} unit="%" label="줄 안 흔들림" />}
            <Check k="bgOcclude" p={p} set={set} label="겹친 아래 도형의 선 잘라내기" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Color k="bgLine" p={p} set={set} label="외곽선 색" /><Color k="bgFill" p={{ ...p, bgFill: p.bgFillPaper ? p.paper : p.bgFill }} set={set} label="도형 안쪽 색" /></div>
            <Check k="bgFillPaper" p={p} set={set} label="안쪽 색을 바탕색과 동일하게" />
          </>)}
        </Section>

        <Section title="패턴 도형">
          <ShapeSlots shapes={st.shapes} onFile={(i, f) => onShape('shapes', i, f)} onClear={i => clearShape('shapes', i)} />
          <Row label="디자인에 사용할 도형 수 (랜덤 선택)" value={`${shapes.length} / ${allShapes.length}`}><input type="range" min={1} max={16} value={p.pickCount} onChange={e => set('pickCount', +e.target.value)} style={input} /></Row>
          <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>중앙 이미지를 새로 업로드할 때마다 선택되는 도형 조합이 바뀝니다 (디자인별 유일성).</div>
        </Section>

        <Section title="콜라주">
          <Slider k="count" min={20} max={400} step={5} p={p} set={set} label="글리프 개수" />
          <Slider k="size" min={30} max={200} step={5} p={p} set={set} unit="%" label="글리프 크기 (띠 폭 대비)" />
          <Slider k="sizeVar" min={0} max={100} p={p} set={set} unit="%" label="크기 편차" />
          <Slider k="bleed" min={0} max={100} p={p} set={set} unit="%" label="띠 밖으로 넘침" />
          <Seg k="rot" p={p} set={set} label="회전" options={[['none', '없음'], ['free', '자유'], ['tilt', '±기울기'], ['quarter', '90°']]} />
          <Slider k="rotAmt" min={0} max={180} p={p} set={set} unit="°" label="회전 폭" />
          <Seg k="layout" p={p} set={set} label="배치" options={[['poisson', '고른 간격'], ['scatter', '흩뿌림'], ['grid', '격자'], ['rows', '체커']]} />
          <Slider k="jitter" min={0} max={100} p={p} set={set} unit="%" label="배치 흔들림" />
          <Slider k="overlap" min={0} max={100} p={p} set={set} unit="%" label="겹침 허용" />
        </Section>

        <Section title="스티커">
          <Slider k="outline" min={0} max={30} p={p} set={set} unit="%" label="외곽선 굵기 (글자 크기 비례)" />
          <Check k="knockout" p={p} set={set} label="겹친 아래 글자 지우기 (녹아웃)" />
          {p.knockout && <Slider k="knockWidth" min={100} max={200} p={p} set={set} unit="%" label="녹아웃 폭 (외곽선 대비)" />}
          <Slider k="inner" min={0} max={20} p={p} set={set} unit="%" label="안쪽 선 (이중선)" />
          <Slider k="hatch" min={0} max={100} p={p} set={set} unit="%" label="해칭(빗금) 글자 비율" />
          <Slider k="hatchGap" min={3} max={40} step={0.5} p={p} set={set} unit="%" label="빗금 간격 (글자 크기 대비)" />
          <Slider k="hatchMin" min={2} max={16} step={0.5} p={p} set={set} unit="px" label="빗금 최소 간격" />
          <Slider k="hatchLine" min={15} max={85} step={5} p={p} set={set} unit="%" label="빗금 선 굵기 (간격 대비)" />
          <Slider k="hatchAngle" min={0} max={180} step={5} p={p} set={set} unit="°" label="빗금 각도" />
          <Slider k="accentRatio" min={0} max={100} p={p} set={set} unit="%" label="강조색 글자 비율" />
          <Check k="shadowOn" p={p} set={set} label="그림자" />
          {p.shadowOn && (<>
            <Slider k="shadow" min={1} max={25} p={p} set={set} unit="%" label="그림자 오프셋" />
            <Slider k="shadowAngle" min={0} max={359} p={p} set={set} unit="°" label="그림자 방향" />
            <Seg k="shadowMode" p={p} set={set} label="그림자 스타일" options={[['dot', '도트 하프톤'], ['solid', '단색']]} />
            {p.shadowMode === 'dot' && (<>
              <Slider k="shDotGap" min={3} max={20} step={0.5} p={p} set={set} unit="px" label="그림자 도트 간격" />
              <Slider k="shDotSize" min={20} max={110} step={5} p={p} set={set} unit="%" label="그림자 도트 크기" />
              <Slider k="shDotFade" min={0} max={100} step={5} p={p} set={set} unit="%" label="크기 변화 (글자 쪽 작게 → 바깥 크게)" />
              <Slider k="shDotAngle" min={0} max={90} p={p} set={set} unit="°" label="도트 각도" />
            </>)}
            <Color k="shadowColor" p={p} set={set} label="그림자 색 (팝아트)" />
            <div style={{ display: 'flex', gap: 4 }}>{['#00c2ff', '#ffe600', '#ff2d95', '#00e676', '#7c4dff', '#ff6d00'].map(h => <button key={h} onClick={() => set('shadowColor', h)} style={{ flex: 1, height: 22, borderRadius: 3, border: `1px solid ${p.shadowColor === h ? '#161616' : 'rgba(0,0,0,.12)'}`, background: h, cursor: 'pointer' }} />)}</div>
          </>)}
        </Section>

        <Section title="팝아트 도트">
          <Slider k="dotRatio" min={0} max={100} p={p} set={set} unit="%" label="도트 글자 빈도" />
          <Slider k="dotSize" min={10} max={100} p={p} set={set} unit="%" label="도트 전체 배율" />
          <Slider k="dotGap" min={3} max={20} p={p} set={set} unit="px" label="도트 간격" />
          <Seg k="dotPos" p={p} set={set} label="도트 크기 변화 (위치)" options={[['tl', '좌상→우하'], ['br', '우하→좌상'], ['center', '중심 큼'], ['edge', '가장자리 큼']]} />
          <Slider k="dotFade" min={0} max={100} p={p} set={set} unit="%" label="크기 변화 강도" />
          <Slider k="dotMax" min={50} max={140} step={5} p={p} set={set} unit="%" label="최대 도트 (간격 대비)" />
          <Slider k="dotMin" min={0} max={60} step={2} p={p} set={set} unit="%" label="최소 도트 (간격 대비)" />
          <Slider k="dotOrder" min={0} max={100} p={p} set={set} unit="%" label="규칙성 (격자 → 흐트러짐)" />
          <Slider k="dotAngle" min={0} max={90} p={p} set={set} unit="°" label="도트 각도" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Color k="dotColor" p={p} set={set} label="도트 색" /><Color k="dotBg" p={p} set={set} label="도트 바탕 (글자 안)" /></div>
        </Section>

        <Section title="색상">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Color k="paper" p={p} set={set} label="바탕색" /><Color k="line" p={p} set={set} label="외곽선" /><Color k="fill" p={p} set={set} label="글자 채움" /><Color k="accent" p={p} set={set} label="강조 채움" />
          </div>
          {st.analysis && (<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: '#666' }}>이미지 기반 배색 추천</div>
            {st.analysis.schemes.map(s => { const on = p.paper === s.paper && p.line === s.line && p.fill === s.fill; return (
              <button key={s.label} onClick={() => setMany({ paper: s.paper, line: s.line, fill: s.fill, accent: s.accent })} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', border: `1px solid ${on ? '#161616' : '#ddd'}`, borderRadius: 4, background: on ? '#f3f3f3' : '#fff', cursor: 'pointer' }}>
                {[s.paper, s.line, s.fill, s.accent].map((c, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(0,0,0,.12)' }} />)}<span style={{ flex: 1, textAlign: 'left', fontSize: 12 }}>{s.label}</span>
              </button>); })}
          </div>)}
        </Section>

        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
          <button onClick={() => set('seed', p.seed + 1)} style={{ flex: 1, padding: 10, border: 0, borderRadius: 4, background: '#161616', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>셔플 (seed {p.seed})</button>
          <button onClick={() => setSt(s => ({ ...s, p: DEFAULTS }))} style={{ padding: '10px 14px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', fontSize: 13, cursor: 'pointer' }}>초기화</button>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, boxSizing: 'border-box', minWidth: 0 }}>
        <div ref={frameRef} style={{ width: 'min(680px, 100%)' }}>
          <PatternFrame p={p} shapes={shapes} bgShapes={bgShapes} artUrl={artUrl} frameW={frameW} />
        </div>
      </main>
    </div>
  );
}
