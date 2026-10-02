import { useMemo } from 'react';
import { FRAME, NB, Params, Shape, bgFilterRadius, filterRadii, layoutBgGlyphs, layoutGlyphs, shadowTexture } from './patternEngine';

type Props = { p: Params; shapes: Shape[]; bgShapes: Shape[]; artUrl?: string | null; frameW: number; plain?: boolean };

const mask = (u: string): React.CSSProperties => ({ WebkitMaskImage: `url("${u}")`, maskImage: `url("${u}")`, WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' } as React.CSSProperties);
const abs: React.CSSProperties = { position: 'absolute', inset: 0 };

export default function PatternFrame({ p, shapes, bgShapes, artUrl, frameW, plain }: Props) {
  const { cp, bp } = FRAME;
  const glyphs = useMemo(() => layoutGlyphs(p, shapes, frameW), [p, shapes, frameW]);
  const bg = useMemo(() => layoutBgGlyphs(p, bgShapes), [p, bgShapes]);
  const radii = useMemo(() => filterRadii(p, frameW), [p, frameW]);
  const bgR = useMemo(() => bgFilterRadius(p, frameW), [p, frameW]);
  const shTex = p.shadowOn && p.shadowMode === 'dot' ? shadowTexture(p) : '';
  const bgFillCol = p.bgFillPaper ? p.paper : p.bgFill;
  const o = p.outline / 100, inn = p.inner / 100;

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1', filter: plain ? undefined : 'drop-shadow(0 20px 50px rgba(0,0,0,.15))' }}>
      {/* SVG filter defs: dilate/erode produce fully opaque outlines (alpha thresholded 0/1) */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          {radii.map(f => (
            <g key={f.i}>
              <filter id={`dil-halo-${f.i}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                <feMorphology operator="dilate" radius={f.rHalo} in="SourceAlpha" result="d" /><feComponentTransfer in="d" result="dd"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
                <feFlood floodColor={p.line} result="fl" /><feComposite in="fl" in2="dd" operator="in" />
              </filter>
              <filter id={`dil-knock-${f.i}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                <feMorphology operator="dilate" radius={f.rKnock} in="SourceAlpha" result="d" /><feComponentTransfer in="d" result="dd"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
                <feFlood floodColor={p.paper} result="fl" /><feComposite in="fl" in2="dd" operator="in" />
              </filter>
              <filter id={`dil-shadow-${f.i}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                <feMorphology operator="dilate" radius={f.rHalo} in="SourceAlpha" result="d" /><feComponentTransfer in="d" result="dd"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
                <feFlood floodColor={p.shadowColor} result="fl" /><feComposite in="fl" in2="dd" operator="in" />
              </filter>
              <filter id={`dil-shadowdot-${f.i}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB" primitiveUnits="objectBoundingBox">
                <feMorphology operator="dilate" radius={f.rHaloBB} in="SourceAlpha" result="d" /><feComponentTransfer in="d" result="dd"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
                <feImage href={shTex} x="-0.5" y="-0.5" width="2" height="2" preserveAspectRatio="none" result="img" /><feComposite in="img" in2="dd" operator="in" />
              </filter>
              <filter id={`ero-core-${f.i}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                <feMorphology operator="erode" radius={f.rCore} in="SourceAlpha" result="e" /><feComponentTransfer in="e" result="ee"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
                <feComposite in="SourceGraphic" in2="ee" operator="in" />
              </filter>
            </g>
          ))}
          {/* background outline layer: ring = dilate − erode; fill = occluder */}
          <filter id="bg-fill-0" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feMorphology operator="dilate" radius={bgR.rFill} in="SourceAlpha" result="o" /><feComponentTransfer in="o" result="oo"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
            <feFlood floodColor={bgFillCol} result="fl" /><feComposite in="fl" in2="oo" operator="in" />
          </filter>
          <filter id="bg-ring-0" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feMorphology operator="dilate" radius={bgR.rRing} in="SourceAlpha" result="o" /><feMorphology operator="erode" radius={bgR.rRing} in="SourceAlpha" result="i" />
            <feComposite in="o" in2="i" operator="out" result="ring" /><feComponentTransfer in="ring" result="rr"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer>
            <feFlood floodColor={p.bgLine} result="fl" /><feComposite in="fl" in2="rr" operator="in" />
          </filter>
        </defs>
      </svg>

      {/* red chamfered octagon band */}
      <div style={{ position: 'absolute', left: `${FRAME.inset}%`, top: `${FRAME.inset}%`, width: `${FRAME.span}%`, height: `${FRAME.span}%`, background: p.paper, overflow: 'hidden', clipPath: `polygon(${cp}% 0,${100 - cp}% 0,100% ${cp}%,100% ${100 - cp}%,${100 - cp}% 100%,${cp}% 100%,0 ${100 - cp}%,0 ${cp}%)` }}>
        {/* background outline layer */}
        {p.bgOn && (
          <div style={abs}>
            {bg.map((b, i) => (
              <div key={i} style={{ position: 'absolute', left: `${b.cx - b.sz / 2}%`, top: `${b.cy - b.sz / 2}%`, width: `${b.sz}%`, height: `${b.sz}%`, transform: `rotate(${b.rot}deg)` }}>
                {p.bgOcclude && <div style={{ ...abs, filter: 'url(#bg-fill-0)' }}><div style={{ ...abs, background: bgFillCol, ...mask(b.shape.url) }} /></div>}
                <div style={{ ...abs, filter: 'url(#bg-ring-0)' }}><div style={{ ...abs, background: p.bgLine, ...mask(b.shape.url) }} /></div>
              </div>
            ))}
          </div>
        )}
        {/* sticker glyphs */}
        <div style={{ ...abs, isolation: 'isolate' }}>
          {glyphs.map((g, i) => {
            const u = g.shape.url, m = mask(u);
            const fillCol = g.kind === 'accent' ? p.accent : p.fill;
            const body: React.CSSProperties = g.kind === 'dot' ? { background: `url("${g.dotTex}") center/cover no-repeat` }
              : g.kind === 'hatch' ? { background: `repeating-linear-gradient(${p.hatchAngle}deg,${fillCol} 0 ${g.hatchPx - g.hatchLinePx}px,${p.line} ${g.hatchPx - g.hatchLinePx}px ${g.hatchPx}px)` }
              : { background: fillCol };
            const sh = p.shadowOn;
            return (
              <div key={i} style={{ position: 'absolute', left: `${g.cx - g.sz / 2}%`, top: `${g.cy - g.sz / 2}%`, width: `${g.sz}%`, height: `${g.sz}%`, transform: `rotate(${g.rot}deg)` }}>
                {sh && <div style={{ ...abs, transform: `translate(${g.shadowDx}%,${g.shadowDy}%)` }}><div style={{ ...abs, filter: `url(#${p.shadowMode === 'dot' ? 'dil-shadowdot-' : 'dil-shadow-'}${g.bucket})` }}><div style={{ ...abs, background: p.shadowColor, ...m }} /></div></div>}
                {o > 0 && p.knockout && <div style={{ ...abs, filter: `url(#dil-knock-${g.bucket})` }}><div style={{ ...abs, background: p.paper, ...m }} /></div>}
                {o > 0 && <div style={{ ...abs, filter: `url(#dil-halo-${g.bucket})` }}><div style={{ ...abs, background: p.line, ...m }} /></div>}
                <div style={{ ...abs, ...body, ...m }} />
                {inn > 0 && <div style={{ ...abs, background: p.line, ...m }} />}
                {inn > 0 && <div style={{ ...abs, filter: `url(#ero-core-${g.bucket})` }}><div style={{ ...abs, ...body, ...m }} /></div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* black rounded square = influencer artwork */}
      <div style={{ position: 'absolute', left: '9.547%', top: '9.547%', width: '80.906%', height: '80.906%', borderRadius: '2.2%', background: '#111', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {artUrl ? <div style={{ width: '100%', height: '100%', background: `url("${artUrl}") center/cover` }} /> : <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#777' }}>influencer design 1:1</span>}
      </div>
    </div>
  );
}
